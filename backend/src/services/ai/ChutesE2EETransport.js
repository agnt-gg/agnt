/**
 * Native Chutes E2EE transport for AGNT.
 *
 * Implements the full Chutes end-to-end encryption protocol using:
 *   ML-KEM-768 (post-quantum key encapsulation)
 *   HKDF-SHA256 (key derivation)
 *   ChaCha20-Poly1305 (authenticated encryption)
 *   Gzip (payload compression)
 *
 * Exposes an OpenAI-compatible `chat.completions.create` interface so it
 * integrates transparently with the existing `OpenAiLikeAdapter`.
 *
 * Protocol reference:
 *   https://github.com/chutesai/chutes-e2ee-transport
 */

import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { createMlKem768 } from 'mlkem';

// ─────────────────────── Constants ────────────────────────────────────────

const MLKEM_CT_SIZE = 1088;  // ML-KEM-768 ciphertext size in bytes
const TAG_SIZE = 16;         // ChaCha20-Poly1305 auth tag size

// HKDF info strings (must match server-side constants)
const INFO_REQ    = Buffer.from('e2e-req-v1');
const INFO_RESP   = Buffer.from('e2e-resp-v1');
const INFO_STREAM = Buffer.from('e2e-stream-v1');

const MODEL_MAP_TTL_MS    = 5 * 60 * 1000;  // 5 minutes
const NONCE_DEFAULT_TTL_S = 55;              // seconds

// Module-level ML-KEM-768 singleton — createMlKem768() is async but its
// methods (generateKeyPair, encap, decap) are synchronous once resolved.
const _kemReady = createMlKem768();

// ─────────────────────── Crypto primitives ────────────────────────────────

/**
 * HKDF-SHA256 key derivation.
 * Salt is the first 16 bytes of the ML-KEM ciphertext (matches Python impl).
 */
function _deriveKey(sharedSecret, mlkemCt, info) {
  const salt = mlkemCt.slice(0, 16);
  return Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, info, 32));
}

/**
 * ChaCha20-Poly1305 authenticated encryption.
 * Returns { ct: Buffer, tag: Buffer }.
 */
function _chachaEncrypt(key, nonce, plaintext) {
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_SIZE });
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, tag };
}

/**
 * ChaCha20-Poly1305 authenticated decryption.
 * Throws if the auth tag is invalid.
 */
function _chachaDecrypt(key, nonce, ciphertext, tag) {
  const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_SIZE });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─────────────────────── Request builder ──────────────────────────────────

/**
 * Encrypt an OpenAI-format request payload for the Chutes E2EE protocol.
 *
 * Binary blob layout:
 *   mlkem_ct (1088 bytes) | nonce (12 bytes) | ciphertext (variable) | tag (16 bytes)
 *
 * @param {string} e2ePubkeyB64  Base64-encoded ML-KEM-768 public key of the GPU instance.
 * @param {object} payload       OpenAI-format request body (will be mutated with e2e_response_pk).
 * @returns {{ blob: Buffer, responseSk: Buffer }}
 */
async function _buildE2EERequest(e2ePubkeyB64, payload) {
  const kem = await _kemReady;

  // 1. Generate an ephemeral keypair — the server will use responsePk to encrypt the response.
  const [responsePk, responseSk] = kem.generateKeyPair();

  // 2. Encapsulate to the instance's public key: produces mlkemCt + sharedSecret.
  const e2ePubkey = Buffer.from(e2ePubkeyB64, 'base64');
  const [mlkemCt, sharedSecret] = kem.encap(e2ePubkey);

  const mlkemCtBuf = Buffer.from(mlkemCt);

  // 3. Derive request symmetric key via HKDF.
  const symKey = _deriveKey(Buffer.from(sharedSecret), mlkemCtBuf, INFO_REQ);

  // 4. Embed our response public key so the server can encrypt the reply to us.
  const payloadWithPk = { ...payload, e2e_response_pk: Buffer.from(responsePk).toString('base64') };

  // 5. Compress + encrypt.
  const compressed = gzipSync(Buffer.from(JSON.stringify(payloadWithPk)));
  const nonce = crypto.randomBytes(12);
  const { ct, tag } = _chachaEncrypt(symKey, nonce, compressed);

  // 6. Concatenate into the binary blob.
  const blob = Buffer.concat([mlkemCtBuf, nonce, ct, tag]);

  return { blob, responseSk: Buffer.from(responseSk) };
}

// ─────────────────────── Response decryption ──────────────────────────────

/**
 * Decrypt a non-streaming E2EE response blob.
 *
 * @param {Buffer} responseBlob  Raw response body from /e2e/invoke.
 * @param {Buffer} responseSk    Our ephemeral secret key (from _buildE2EERequest).
 * @returns {object}  Parsed JSON response.
 */
async function _decryptResponse(responseBlob, responseSk) {
  const kem = await _kemReady;

  const mlkemCt   = responseBlob.slice(0, MLKEM_CT_SIZE);
  const nonce      = responseBlob.slice(MLKEM_CT_SIZE, MLKEM_CT_SIZE + 12);
  const ciphertext = responseBlob.slice(MLKEM_CT_SIZE + 12, responseBlob.length - TAG_SIZE);
  const tag        = responseBlob.slice(responseBlob.length - TAG_SIZE);

  const ss = Buffer.from(kem.decap(mlkemCt, responseSk));
  const symKey = _deriveKey(ss, mlkemCt, INFO_RESP);

  const compressed = _chachaDecrypt(symKey, nonce, ciphertext, tag);
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}

/**
 * Decrypt the `e2e_init` SSE event to derive the per-stream symmetric key.
 *
 * @param {Buffer} responseSk   Our ephemeral secret key.
 * @param {string} mlkemCtB64   Base64-encoded ML-KEM ciphertext from e2e_init.
 * @returns {Buffer}  32-byte stream symmetric key.
 */
async function _decryptStreamInit(responseSk, mlkemCtB64) {
  const kem = await _kemReady;
  const mlkemCt = Buffer.from(mlkemCtB64, 'base64');
  const ss = Buffer.from(kem.decap(mlkemCt, responseSk));
  return _deriveKey(ss, mlkemCt, INFO_STREAM);
}

/**
 * Decrypt a single `e2e` streaming chunk.
 * Chunk binary layout: nonce (12 bytes) | ciphertext (variable) | tag (16 bytes)
 *
 * @param {string} encChunkB64  Base64-encoded encrypted chunk from e2e event.
 * @param {Buffer} streamKey    Stream symmetric key from _decryptStreamInit.
 * @returns {string}  Decrypted SSE line (e.g. "data: {...}").
 */
function _decryptStreamChunk(encChunkB64, streamKey) {
  const raw = Buffer.from(encChunkB64, 'base64');
  const nonce      = raw.slice(0, 12);
  const ciphertext = raw.slice(12, raw.length - TAG_SIZE);
  const tag        = raw.slice(raw.length - TAG_SIZE);
  return _chachaDecrypt(streamKey, nonce, ciphertext, tag).toString('utf8');
}

// ─────────────────────── Async stream reader ──────────────────────────────

/**
 * Yield raw bytes from a response body, handling both native fetch
 * ReadableStream (Node 18+) and node-fetch streams (async iterable).
 */
async function* _readBodyBytes(body) {
  if (typeof body[Symbol.asyncIterator] === 'function') {
    yield* body;
  } else if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ─────────────────────── ChutesE2EEClient ─────────────────────────────────

/**
 * OpenAI-compatible client that transparently encrypts requests using
 * the Chutes E2EE protocol.
 *
 * Usage (matches the OpenAI SDK interface that OpenAiLikeAdapter expects):
 *   const client = new ChutesE2EEClient(apiKey);
 *   const response = await client.chat.completions.create({ model, messages, ... });
 *   const stream   = await client.chat.completions.create({ model, messages, stream: true });
 *   for await (const chunk of stream) { ... }
 */
export class ChutesE2EEClient {
  /**
   * @param {string} apiKey   Chutes API key (cpk_...).
   * @param {string} apiBase  Base URL for all Chutes API calls (default: https://llm.chutes.ai).
   */
  constructor(apiKey, apiBase = 'https://llm.chutes.ai') {
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/$/, '');

    // Model name → chute_id resolution cache
    this._modelMap = {};
    this._modelMapLoadedAt = 0;

    // Nonce pool cache: chute_id → { instances: [{instanceId, pubkey, nonces}], expiresAt }
    this._nonceCache = {};

    // Expose OpenAI-compatible chat.completions.create interface
    this.chat = {
      completions: {
        create: (params) => this._create(params),
      },
    };
  }

  // ── Public: create() ────────────────────────────────────────────────────

  async _create(params) {
    const stream = params.stream ?? false;
    const model = params.model;

    // 1. Resolve model name → chute UUID
    const chuteId = await this._resolveChute(model);

    // 2. Consume one nonce from the per-chute pool
    const { instanceId, pubkey, nonce } = await this._getNonce(chuteId);

    // 3. Encrypt the request payload
    const { blob, responseSk } = await _buildE2EERequest(pubkey, { ...params, stream });

    // 4. Build E2EE headers
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Chute-Id': chuteId,
      'X-Instance-Id': instanceId,
      'X-E2E-Nonce': nonce,
      'X-E2E-Stream': String(stream),
      'X-E2E-Path': '/v1/chat/completions',
      'Content-Type': 'application/octet-stream',
    };

    // 5. POST to /e2e/invoke
    const invokeUrl = `${this.apiBase}/e2e/invoke`;
    const response = await fetch(invokeUrl, { method: 'POST', headers, body: blob });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const truncated = errText.length > 200 ? errText.slice(0, 200) + '...' : errText;
      const err = new Error(`Chutes E2EE error ${response.status}: ${truncated}`);
      err.status = response.status;
      throw err;
    }

    if (stream) {
      // Return an async generator directly — OpenAiLikeAdapter iterates it with for-await.
      return this._decryptStream(response, responseSk);
    }

    // Non-streaming: read full binary body and decrypt
    const arrayBuf = await response.arrayBuffer();
    return _decryptResponse(Buffer.from(arrayBuf), responseSk);
  }

  // ── Streaming decryption ─────────────────────────────────────────────────

  async *_decryptStream(response, responseSk) {
    let streamKey = null;
    const decoder = new TextDecoder();
    let lineBuffer = '';

    for await (const rawBytes of _readBodyBytes(response.body)) {
      lineBuffer += typeof rawBytes === 'string'
        ? rawBytes
        : decoder.decode(rawBytes, { stream: true });

      // Process complete newline-terminated lines
      let nlIdx;
      while ((nlIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, nlIdx).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(nlIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') return;

        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        if (event.e2e_init) {
          // First SSE event: derive the per-stream symmetric key
          streamKey = await _decryptStreamInit(responseSk, event.e2e_init);

        } else if (event.e2e) {
          // Encrypted content chunk
          if (!streamKey) throw new Error('[ChutesE2EE] Received e2e chunk before e2e_init');
          const decrypted = _decryptStreamChunk(event.e2e, streamKey);
          const chunk = this._parseSseLine(decrypted);
          if (chunk) yield chunk;

        } else if (event.usage) {
          // Usage stats are sent in plaintext — pass through as a final chunk
          yield { choices: [], usage: event.usage };

        } else if (event.e2e_error) {
          throw new Error(`[ChutesE2EE] Stream error: ${JSON.stringify(event.e2e_error)}`);
        }
      }
    }
  }

  /**
   * Parse a decrypted SSE line ("data: {...}") into an OpenAI chunk object.
   * Returns null for unparseable / terminal lines.
   */
  _parseSseLine(sseText) {
    const trimmed = sseText.trim();
    if (!trimmed.startsWith('data: ')) return null;
    const jsonStr = trimmed.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') return null;
    try { return JSON.parse(jsonStr); } catch { return null; }
  }

  // ── Model resolution ─────────────────────────────────────────────────────

  async _resolveChute(model) {
    // UUID → use directly without resolution
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(model)) {
      return model;
    }

    await this._refreshModelMap();
    let chuteId = this._modelMap[model];
    if (chuteId) return chuteId;

    // Force refresh and try once more
    this._modelMapLoadedAt = 0;
    await this._refreshModelMap();
    chuteId = this._modelMap[model];
    if (chuteId) return chuteId;

    throw new Error(
      `[ChutesE2EE] Could not resolve model "${model}" to a chute_id. ` +
      'Verify the model name is available at /v1/models.'
    );
  }

  async _refreshModelMap() {
    const now = Date.now();
    if (now - this._modelMapLoadedAt < MODEL_MAP_TTL_MS) return;

    try {
      const resp = await fetch(`${this.apiBase}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!resp.ok) return; // keep stale map rather than crashing

      const data = await resp.json();
      const newMap = {};
      for (const entry of (data.data || [])) {
        if (entry.id && entry.chute_id) {
          newMap[entry.id] = entry.chute_id;
        }
      }
      this._modelMap = newMap;
      this._modelMapLoadedAt = now;
    } catch (err) {
      console.warn('[ChutesE2EE] Failed to refresh model map:', err.message);
    }
  }

  // ── Nonce management ────────────────────────────────────────────────────

  async _getNonce(chuteId) {
    const cached = this._nonceCache[chuteId];
    if (cached && Date.now() < cached.expiresAt) {
      for (const inst of cached.instances) {
        if (inst.nonces.length > 0) {
          return { instanceId: inst.instanceId, pubkey: inst.pubkey, nonce: inst.nonces.shift() };
        }
      }
    }

    // Fetch fresh instances + nonces from the API
    await this._fetchInstances(chuteId);

    const fresh = this._nonceCache[chuteId];
    if (fresh) {
      for (const inst of fresh.instances) {
        if (inst.nonces.length > 0) {
          return { instanceId: inst.instanceId, pubkey: inst.pubkey, nonce: inst.nonces.shift() };
        }
      }
    }

    throw new Error(
      `[ChutesE2EE] No nonces available for chute ${chuteId}. ` +
      'The model may have no active E2EE-capable instances.'
    );
  }

  async _fetchInstances(chuteId) {
    const resp = await fetch(`${this.apiBase}/e2e/instances/${chuteId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
      throw new Error(`[ChutesE2EE] Failed to fetch instances for chute ${chuteId}: ${resp.status} ${truncated}`);
    }

    const data = await resp.json();
    const instances = (data.instances || []).map((inst) => ({
      instanceId: inst.instance_id,
      pubkey: inst.e2e_pubkey,
      nonces: [...inst.nonces],
    }));

    const ttlMs = (data.nonce_expires_in ?? NONCE_DEFAULT_TTL_S) * 1000;
    this._nonceCache[chuteId] = { instances, expiresAt: Date.now() + ttlMs };
  }
}
