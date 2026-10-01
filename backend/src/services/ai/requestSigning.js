/**
 * Request signing and stream error handling.
 *
 * Adds a signature block to outgoing messages requests, computes the body
 * hash the block carries, and keeps structured errors that arrive inside an
 * HTTP-200 event stream.
 *
 * The placeholder is written into the first system block. A custom fetch
 * wrapper then intercepts the serialized body, computes the real hash, and
 * replaces the placeholder before the request is sent.
 */

import crypto from 'crypto';
import xxhashWasm from 'xxhash-wasm';
import { getCachedClientVersion } from './clientVersions.js';

// ── Constants ───────────────────────────────────────────────────────────
const HASH_SEED   = 0x6E52736AC806831En;   // xxHash64 seed (BigInt)
const SIG_SALT    = '59cf53e54c78';         // signature salt
const SIG_INDICES = [4, 7, 20];             // character pick indices
const ENTRYPOINT  = 'cli';

/**
 * The client version carried in the signature.
 *
 * Read from clientVersions.js rather than held as a literal, so the value
 * tracks the same source as the user-agent and a stale constant can never
 * drift out from under it.
 */
function currentVersion() {
  return getCachedClientVersion('claude-code');
}

// ── Lazy-loaded xxhash instance ─────────────────────────────────────────
let _xxhash = null;

async function getXxhash() {
  if (!_xxhash) {
    _xxhash = await xxhashWasm();
  }
  return _xxhash;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the 3-char signature suffix.
 *   sha256(salt + pickedChars + version)[:3]
 *
 * Characters are picked from the first user message at indices [4, 7, 20]
 * and fed along with the salt and version into SHA-256.
 *
 * @param {string} firstUserMessage - The first user message in the conversation
 * @param {string} [version] - Version to hash over. Defaults to the resolved
 *   current version; pass it explicitly to pin a suffix and its text to the
 *   same version.
 * @returns {string} 3-character hex suffix
 */
export function computeSignatureSuffix(firstUserMessage = '', version = currentVersion()) {
  const chars = SIG_INDICES
    .map(i => (i < firstUserMessage.length ? firstUserMessage[i] : '0'))
    .join('');
  const raw = `${SIG_SALT}${chars}${version}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 3);
}

/**
 * Build the signature TEXT with the hash placeholder.
 *
 * @param {string} versionSuffix - 3-char hex suffix from computeSignatureSuffix()
 * @param {string} [version] - Version to embed. Must be the same version the
 *   suffix was hashed over.
 * @returns {string} The signature text carrying the placeholder
 */
export function buildSigningText(versionSuffix, version = currentVersion()) {
  return `x-anthropic-billing-header: cc_version=${version}.${versionSuffix}; cc_entrypoint=${ENTRYPOINT}; cch=00000;`;
}

/**
 * Build the signature as a system content block.
 * This is injected as the FIRST element of the system array.
 *
 * @param {string} firstUserMessage - The first user message in the conversation
 * @returns {{ type: string, text: string }} Content block for the system array
 */
export function buildSigningBlock(firstUserMessage = '') {
  // Resolve ONCE and thread it through both calls. The suffix is a hash OVER
  // the version, so reading it twice could pair a suffix with a different
  // version if a background cache refresh landed in between.
  const version = currentVersion();
  const suffix = computeSignatureSuffix(firstUserMessage, version);
  return {
    type: 'text',
    text: buildSigningText(suffix, version),
  };
}

/**
 * Compute the body hash for a serialized JSON body containing the placeholder.
 *   xxHash64(body_bytes, seed) & 0xFFFFF → zero-padded 5-char hex
 *
 * @param {string} serializedBody - JSON string containing the placeholder
 * @returns {Promise<string>} 5-character hex hash
 */
export async function computeSignatureHash(serializedBody) {
  const xxhash = await getXxhash();
  const buf = new TextEncoder().encode(serializedBody);
  // h64Raw returns a BigInt
  const hash = xxhash.h64Raw(buf, HASH_SEED);
  return (hash & 0xFFFFFn).toString(16).padStart(5, '0');
}

/**
 * Replace the placeholder in a body string with the computed hash.
 *
 * @param {string} serializedBody - JSON string containing the placeholder
 * @returns {Promise<string>} The body with the placeholder replaced
 */
export async function applySignatureHash(serializedBody) {
  const hash = await computeSignatureHash(serializedBody);
  return serializedBody.replace('cch=00000', `cch=${hash}`);
}

const STREAM_ERROR_STATUS = Object.freeze({
  overloaded_error: 529,
  rate_limit_error: 429,
});

/**
 * Error emitted when the upstream reports a failure inside an HTTP-200 event
 * stream. The SDK passes those payloads on without a status, which destroys
 * the upstream type and request ID as a generic "Connection error".
 */
export class StreamError extends Error {
  constructor(payload, headers) {
    const upstream = payload?.error || {};
    const type = upstream.type || 'stream_error';
    const requestId = payload?.request_id || headers?.get?.('request-id') || null;
    const status = STREAM_ERROR_STATUS[type];
    const message = upstream.message || 'Streaming request failed';
    super(`${status ? `${status} ` : ''}${type}: ${message}${requestId ? ` (request_id: ${requestId})` : ''}`);
    this.name = 'StreamError';
    this.status = status;
    this.type = type;
    this.requestId = requestId;
    this.error = upstream;
    this.headers = headers;
  }
}

function parseStreamErrorFrame(frame) {
  let event = '';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (event !== 'error' || data.length === 0) return null;
  try {
    return JSON.parse(data.join('\n'));
  } catch {
    return { error: { type: 'stream_error', message: data.join('\n') } };
  }
}

/**
 * Preserve HTTP-200 stream errors before the SDK flattens them.
 * Frames are buffered only until their terminating blank line, then forwarded
 * byte-for-byte (after UTF-8 decode/encode) unless the frame is an error.
 */
function preserveStreamErrors(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!response?.body || !contentType.includes('text/event-stream')) return response;

  const source = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  let pumping = false;
  const stream = new ReadableStream({
    async pull(controller) {
      if (pumping) return;
      pumping = true;
      try {
        while (true) {
          const separator = pending.match(/\r?\n\r?\n/);
          if (separator) {
            const end = separator.index + separator[0].length;
            const frame = pending.slice(0, separator.index);
            const encodedFrame = pending.slice(0, end);
            pending = pending.slice(end);
            const payload = parseStreamErrorFrame(frame);
            if (payload) {
              await source.cancel().catch(() => {});
              controller.error(new StreamError(payload, response.headers));
              return;
            }
            controller.enqueue(encoder.encode(encodedFrame));
            return;
          }

          const { value, done } = await source.read();
          if (!done) {
            pending += decoder.decode(value, { stream: true });
            continue;
          }

          pending += decoder.decode();
          if (pending) {
            const payload = parseStreamErrorFrame(pending);
            if (payload) {
              controller.error(new StreamError(payload, response.headers));
              return;
            }
            controller.enqueue(encoder.encode(pending));
            pending = '';
            return;
          }
          controller.close();
          return;
        }
      } finally {
        pumping = false;
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Create a custom fetch wrapper that intercepts messages requests, computes
 * the body hash, replaces the placeholder, and preserves structured errors
 * embedded in HTTP-200 event streams.
 *
 * Pass this as the `fetch` option to the SDK constructor.
 *
 * @param {Function} [baseFetch] - Underlying fetch (defaults to globalThis.fetch)
 * @returns {Function} A fetch-compatible function with hash computation
 */
export function createSigningFetch(baseFetch) {
  const _fetch = baseFetch || globalThis.fetch;

  return async function signingFetch(url, init) {
    // Only intercept messages calls that carry the placeholder
    if (typeof url === 'string' && url.includes('/v1/messages') && init?.body) {
      let body = typeof init.body === 'string' ? init.body : init.body.toString();

      if (body.includes('cch=00000')) {
        body = await applySignatureHash(body);
        init = { ...init, body };
      }
    }

    const response = await _fetch(url, init);
    return preserveStreamErrors(response);
  };
}

/**
 * Extract the text of the first user message from a messages array.
 *
 * @param {Array} messages - Array of { role, content } message objects
 * @returns {string} The text content of the first user message, or ''
 */
export function extractFirstUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const textBlock = msg.content.find(b => b.type === 'text');
        if (textBlock) return textBlock.text || '';
      }
      return '';
    }
  }
  return '';
}
