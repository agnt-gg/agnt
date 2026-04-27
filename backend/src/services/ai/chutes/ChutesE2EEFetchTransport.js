/**
 * Chutes.ai E2EE custom fetch transport for the OpenAI SDK.
 *
 * Instead of overriding the httpx transport (which Node.js's openai SDK
 * doesn't support natively), we override the `fetch` parameter passed to
 * the OpenAI client constructor. This lets us intercept outgoing requests,
 * encrypt the JSON body via ML-KEM-768 + ChaCha20-Poly1305, route them
 * through `/e2e/invoke`, and transparently decrypt the response.
 *
 * The caller sees ordinary OpenAI JSON/SSE — no E2EE details leak upward.
 */

import ChutesDiscoveryManager from './ChutesDiscoveryManager.js';
import {
  buildE2EERequest,
  decryptResponse,
  decryptStreamInit,
  decryptStreamChunk,
} from './ChutesE2EECrypto.js';

const DEFAULT_API_BASE = 'https://api.chutes.ai';
const DEFAULT_MODELS_BASE = 'https://llm.chutes.ai';

class ChutesE2EEFetchTransport {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey — Chutes access token or API key
   * @param {string} [opts.apiBase='https://api.chutes.ai']
   * @param {string} [opts.modelsBase='https://llm.chutes.ai']
   */
  constructor({ apiKey, apiBase = DEFAULT_API_BASE, modelsBase = DEFAULT_MODELS_BASE }) {
    this._apiKey = apiKey;
    this._apiBase = apiBase.replace(/\/$/, '');
    this._discovery = new ChutesDiscoveryManager({ apiKey, apiBase, modelsBase });
  }

  /**
   * Return a `fetch` function compatible with the OpenAI SDK.
   *
   * Usage:
   *   const transport = new ChutesE2EEFetchTransport({ apiKey });
   *   const client = new OpenAI({ apiKey, fetch: transport.fetch() });
   */
  fetch() {
    return (url, init = {}) => this._handleRequest(url, init);
  }

  async _handleRequest(url, init) {
    const method = (init.method || 'GET').toUpperCase();

    // Only intercept POST requests with a JSON body to known inference paths
    if (method !== 'POST' || !init.body) {
      return this._passthrough(url, init);
    }

    let payload;
    try {
      const bodyText = typeof init.body === 'string' ? init.body : (await this._bufferToString(init.body));
      payload = JSON.parse(bodyText);
    } catch {
      return this._passthrough(url, init);
    }

    const path = new URL(url).pathname;

    // Let /v1/models and other non-chat requests pass through
    if (!this._isInferencePath(path)) {
      return this._passthrough(url, init);
    }

    const model = payload.model;
    if (!model) {
      return this._passthrough(url, init);
    }

    const stream = Boolean(payload.stream);
    const chuteId = await this._discovery.resolveChuteId(model);
    const instance = await this._discovery.getNonce(chuteId);

    // Build encrypted request blob
    const { blob, responseSk } = await buildE2EERequest(instance.e2ePubkey, payload);

    const invokeUrl = `${this._apiBase}/e2e/invoke`;
    const invokeHeaders = {
      Authorization: `Bearer ${this._apiKey}`,
      'X-Chute-Id': chuteId,
      'X-Instance-Id': instance.instanceId,
      'X-E2E-Nonce': instance.nonce,
      'X-E2E-Stream': String(stream).toLowerCase(),
      'X-E2E-Path': path,
      'Content-Type': 'application/octet-stream',
    };

    const invokeRes = await fetch(invokeUrl, {
      method: 'POST',
      headers: invokeHeaders,
      body: blob,
      // Forward abort signal if present
      signal: init.signal,
    });

    if (!invokeRes.ok) {
      // Return the error response directly so upstream sees the right status
      return invokeRes;
    }

    if (stream) {
      return this._wrapStreamResponse(invokeRes, responseSk);
    }

    return this._wrapNonStreamResponse(invokeRes, responseSk);
  }

  _isInferencePath(path) {
    // Match standard OpenAI inference paths that the E2EE endpoint handles
    return path === '/v1/chat/completions' || path === '/v1/completions';
  }

  async _passthrough(url, init) {
    return fetch(url, init);
  }

  async _wrapNonStreamResponse(invokeRes, responseSk) {
    const bodyBuffer = Buffer.from(await invokeRes.arrayBuffer());
    const decrypted = await decryptResponse(bodyBuffer, responseSk);
    const jsonBody = JSON.stringify(decrypted);

    return new Response(jsonBody, {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  _wrapStreamResponse(invokeRes, responseSk) {
    const rawReader = invokeRes.body.getReader();
    let streamKey = null;
    let buffer = '';

    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      start(controller) {
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await rawReader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const result = await processSSELineAsync(line, responseSk, streamKey);
                if (result) {
                  if (result.type === 'stream_key') {
                    streamKey = result.key;
                  } else if (result.type === 'chunk') {
                    controller.enqueue(new TextEncoder().encode(result.data));
                  } else if (result.type === 'done') {
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                  }
                }
              }
            }

            // Flush any trailing buffered data
            if (buffer.trim()) {
              const result = await processSSELineAsync(buffer, responseSk, streamKey);
              if (result && result.type === 'chunk') {
                controller.enqueue(new TextEncoder().encode(result.data));
              }
            }

            controller.close();
          } catch (err) {
            controller.error(err);
          }
        };
        pump();
      },

      cancel() {
        rawReader.cancel();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
      },
    });
  }

  async _bufferToString(body) {
    if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
      return new TextDecoder().decode(body);
    }
    if (body[Symbol.asyncIterator]) {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    }
    return String(body);
  }
}

// ---------------------------------------------------------------------------
// SSE line processor (async)
// ---------------------------------------------------------------------------

async function processSSELineAsync(line, responseSk, currentStreamKey) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) {
    return null;
  }

  const raw = trimmed.slice(6).trim();
  if (raw === '[DONE]') {
    return { type: 'done' };
  }
  if (!raw) {
    return null;
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }

  if (event.e2e_init !== undefined) {
    const key = await decryptStreamInit(responseSk, event.e2e_init);
    return { type: 'stream_key', key };
  }

  if (event.e2e !== undefined) {
    if (!currentStreamKey) {
      throw new Error('Received e2e chunk before e2e_init');
    }
    const decrypted = decryptStreamChunk(event.e2e, currentStreamKey);
    return { type: 'chunk', data: decrypted + '\n\n' };
  }

  if (event.usage !== undefined) {
    return { type: 'chunk', data: trimmed + '\n\n' };
  }

  if (event.e2e_error !== undefined) {
    const errorData = JSON.stringify({ error: event.e2e_error });
    return { type: 'chunk', data: `data: ${errorData}\n\n` };
  }

  return null;
}

export default ChutesE2EEFetchTransport;
