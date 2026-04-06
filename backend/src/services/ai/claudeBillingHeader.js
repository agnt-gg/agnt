/**
 * Claude Code Billing Header & CCH Hash Computation
 *
 * Implements the billing attribution header that the real Claude Code CLI
 * injects into every API request as the first system block. Includes:
 *   1. cc_version  — CLI version + 3-char SHA-256 fingerprint suffix
 *   2. cc_entrypoint — "cli"
 *   3. cch — xxHash64 integrity hash of the serialized request body
 *
 * The cch placeholder (00000) is injected into the system prompt, then
 * a custom fetch wrapper intercepts the serialized body, computes the
 * real hash, and replaces the placeholder before the request is sent.
 *
 * References:
 *   - https://a10k.co/b/reverse-engineering-claude-code-cch.html
 *   - Claude Code source leak (March 31 2026)
 */

import crypto from 'crypto';
import xxhashWasm from 'xxhash-wasm';

// ── Constants (extracted from Claude Code binary + source leak) ──────────
const CCH_SEED    = 0x6E52736AC806831En;   // xxHash64 seed (BigInt)
const FP_SALT     = '59cf53e54c78';         // fingerprint salt
const FP_INDICES  = [4, 7, 20];             // character pick indices
const CC_VERSION  = '2.1.92';               // current CLI version to mimic
const CC_ENTRYPOINT = 'cli';

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
 * Compute the 3-char version fingerprint suffix.
 *   sha256(salt + pickedChars + version)[:3]
 *
 * The real CLI picks characters from the first user message at indices
 * [4, 7, 20] and feeds them along with the salt and version into SHA-256.
 *
 * @param {string} firstUserMessage - The first user message in the conversation
 * @returns {string} 3-character hex suffix (e.g. "f2a")
 */
export function computeVersionSuffix(firstUserMessage = '') {
  const chars = FP_INDICES
    .map(i => (i < firstUserMessage.length ? firstUserMessage[i] : '0'))
    .join('');
  const raw = `${FP_SALT}${chars}${CC_VERSION}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 3);
}

/**
 * Build the billing header TEXT with the cch=00000 placeholder.
 *
 * @param {string} versionSuffix - 3-char hex suffix from computeVersionSuffix()
 * @returns {string} e.g. "x-anthropic-billing-header: cc_version=2.1.92.f2a; cc_entrypoint=cli; cch=00000;"
 */
export function buildBillingHeaderText(versionSuffix) {
  return `x-anthropic-billing-header: cc_version=${CC_VERSION}.${versionSuffix}; cc_entrypoint=${CC_ENTRYPOINT}; cch=00000;`;
}

/**
 * Build the billing header as a system content block.
 * This is injected as the FIRST element of the system array.
 *
 * @param {string} firstUserMessage - The first user message in the conversation
 * @returns {{ type: string, text: string }} Content block for the system array
 */
export function buildBillingHeaderBlock(firstUserMessage = '') {
  const suffix = computeVersionSuffix(firstUserMessage);
  return {
    type: 'text',
    text: buildBillingHeaderText(suffix),
  };
}

/**
 * Compute the cch hash for a serialized JSON body containing cch=00000.
 *   xxHash64(body_bytes, seed) & 0xFFFFF → zero-padded 5-char hex
 *
 * @param {string} serializedBody - JSON string containing "cch=00000"
 * @returns {Promise<string>} 5-character hex hash (e.g. "a112b")
 */
export async function computeCch(serializedBody) {
  const xxhash = await getXxhash();
  const buf = new TextEncoder().encode(serializedBody);
  // h64Raw returns a BigInt
  const hash = xxhash.h64Raw(buf, CCH_SEED);
  return (hash & 0xFFFFFn).toString(16).padStart(5, '0');
}

/**
 * Replace the cch=00000 placeholder in a body string with the computed hash.
 *
 * @param {string} serializedBody - JSON string containing "cch=00000"
 * @returns {Promise<string>} The body with cch=00000 replaced with the real hash
 */
export async function replaceCchPlaceholder(serializedBody) {
  const cch = await computeCch(serializedBody);
  return serializedBody.replace('cch=00000', `cch=${cch}`);
}

/**
 * Create a custom fetch wrapper that intercepts Anthropic API requests,
 * computes the cch hash on the serialized body, and replaces the placeholder
 * before the request is actually sent.
 *
 * Pass this as the `fetch` option to the Anthropic SDK constructor.
 *
 * @param {Function} [baseFetch] - Underlying fetch (defaults to globalThis.fetch)
 * @returns {Function} A fetch-compatible function with cch computation
 */
export function createCchFetch(baseFetch) {
  const _fetch = baseFetch || globalThis.fetch;

  return async function cchFetch(url, init) {
    // Only intercept Anthropic messages API calls that have our placeholder
    if (typeof url === 'string' && url.includes('/v1/messages') && init?.body) {
      let body = typeof init.body === 'string' ? init.body : init.body.toString();

      if (body.includes('cch=00000')) {
        body = await replaceCchPlaceholder(body);
        init = { ...init, body };
      }
    }

    return _fetch(url, init);
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
