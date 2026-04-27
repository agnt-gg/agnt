/**
 * Chutes.ai E2EE cryptographic primitives.
 *
 * Implements ML-KEM-768 + HKDF-SHA256 + ChaCha20-Poly1305 in pure Node.js,
 * matching the Python reference implementation in chutesai/chutes-e2ee-transport.
 *
 * Primitives:
 *   - ML-KEM-768 (FIPS 203 / Kyber-768) via npm:mlkem
 *   - HKDF-SHA256 via Node.js crypto.hkdfSync
 *   - ChaCha20-Poly1305 via @stablelib/chacha20poly1305
 *   - Gzip via Node.js zlib
 */

import { hkdfSync, randomBytes } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { MlKem768 } from 'mlkem';
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';

// ---------------------------------------------------------------------------
// Constants (must match Python reference exactly)
// ---------------------------------------------------------------------------

const MLKEM_CT_SIZE = 1088;
const TAG_SIZE = 16;

const INFO_REQ = Buffer.from('e2e-req-v1');
const INFO_RESP = Buffer.from('e2e-resp-v1');
const INFO_STREAM = Buffer.from('e2e-stream-v1');

// ---------------------------------------------------------------------------
// HKDF key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte symmetric key from an ML-KEM shared secret.
 *
 * @param {Buffer} sharedSecret — 32-byte ML-KEM shared secret
 * @param {Buffer} mlkemCt — ML-KEM ciphertext (first 16 bytes used as salt)
 * @param {Buffer} info — HKDF info string (INFO_REQ, INFO_RESP, or INFO_STREAM)
 * @returns {Buffer} 32-byte ChaCha20 key
 */
export function deriveKey(sharedSecret, mlkemCt, info) {
  const salt = mlkemCt.slice(0, 16);
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, info, 32));
}

// ---------------------------------------------------------------------------
// ChaCha20-Poly1305 symmetric encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext with ChaCha20-Poly1305.
 *
 * @param {Buffer} key — 32 bytes
 * @param {Buffer} nonce — 12 bytes
 * @param {Buffer} plaintext — data to encrypt
 * @returns {{ ciphertext: Buffer, tag: Buffer }}
 */
export function chachaEncrypt(key, nonce, plaintext) {
  const cipher = new ChaCha20Poly1305(key);
  const sealed = cipher.seal(nonce, plaintext, null); // no AAD
  return {
    ciphertext: sealed.slice(0, -TAG_SIZE),
    tag: sealed.slice(-TAG_SIZE),
  };
}

/**
 * Decrypt ChaCha20-Poly1305 ciphertext.
 *
 * @param {Buffer} key — 32 bytes
 * @param {Buffer} nonce — 12 bytes
 * @param {Buffer} ciphertext — encrypted data (without tag)
 * @param {Buffer} tag — 16-byte Poly1305 tag
 * @returns {Buffer} plaintext
 */
export function chachaDecrypt(key, nonce, ciphertext, tag) {
  const cipher = new ChaCha20Poly1305(key);
  return cipher.open(nonce, Buffer.concat([ciphertext, tag]), null);
}

// ---------------------------------------------------------------------------
// ML-KEM-768 helpers
// ---------------------------------------------------------------------------

const kem = new MlKem768();

/**
 * Generate a per-request ephemeral ML-KEM keypair.
 *
 * @returns {Promise<{ pk: Buffer, sk: Buffer }>}
 */
export async function generateKeyPair() {
  const [pk, sk] = await kem.generateKeyPair();
  return { pk: Buffer.from(pk), sk: Buffer.from(sk) };
}

/**
 * Encapsulate a shared secret against a remote public key.
 *
 * @param {Buffer} remotePk — 1184-byte encapsulation key
 * @returns {Promise<{ ct: Buffer, ss: Buffer }>}
 */
export async function encapsulate(remotePk) {
  const [ct, ss] = await kem.encap(remotePk);
  return { ct: Buffer.from(ct), ss: Buffer.from(ss) };
}

/**
 * Decapsulate a shared secret using the local secret key.
 *
 * @param {Buffer} ct — 1088-byte ciphertext
 * @param {Buffer} sk — local decapsulation key
 * @returns {Promise<Buffer>} shared secret
 */
export async function decapsulate(ct, sk) {
  const ss = await kem.decap(ct, sk);
  return Buffer.from(ss);
}

// ---------------------------------------------------------------------------
// High-level E2EE request/response builders
// ---------------------------------------------------------------------------

/**
 * Build an encrypted E2EE request blob.
 *
 * @param {string} e2ePubkeyB64 — base64-encoded 1184-byte instance E2EE public key
 * @param {Object} payload — OpenAI-compatible request body
 * @returns {Promise<{ blob: Buffer, responseSk: Buffer }>}
 */
export async function buildE2EERequest(e2ePubkeyB64, payload) {
  const { pk: responsePk, sk: responseSk } = await generateKeyPair();

  const e2ePubkey = Buffer.from(e2ePubkeyB64, 'base64');
  const { ct: mlkemCt, ss: sharedSecret } = await encapsulate(e2ePubkey);
  const symKey = deriveKey(sharedSecret, mlkemCt, INFO_REQ);

  const payloadWithPk = {
    ...payload,
    e2e_response_pk: responsePk.toString('base64'),
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payloadWithPk)));

  const nonce = randomBytes(12);
  const { ciphertext, tag } = chachaEncrypt(symKey, nonce, compressed);
  const blob = Buffer.concat([mlkemCt, nonce, ciphertext, tag]);

  return { blob, responseSk };
}

/**
 * Decrypt a non-streaming E2EE response blob.
 *
 * @param {Buffer} responseBlob
 * @param {Buffer} responseSk
 * @returns {Object} decrypted JSON
 */
export async function decryptResponse(responseBlob, responseSk) {
  const mlkemCt = responseBlob.slice(0, MLKEM_CT_SIZE);
  const nonce = responseBlob.slice(MLKEM_CT_SIZE, MLKEM_CT_SIZE + 12);
  const ciphertext = responseBlob.slice(MLKEM_CT_SIZE + 12, -TAG_SIZE);
  const tag = responseBlob.slice(-TAG_SIZE);

  const sharedSecret = await decapsulate(mlkemCt, responseSk);
  const symKey = deriveKey(sharedSecret, mlkemCt, INFO_RESP);
  const plaintext = chachaDecrypt(symKey, nonce, ciphertext, tag);
  const decompressed = gunzipSync(plaintext);
  return JSON.parse(decompressed.toString('utf-8'));
}

/**
 * Decrypt the e2e_init SSE event to derive the stream symmetric key.
 *
 * @param {Buffer} responseSk
 * @param {string} mlkemCtB64 — base64-encoded ML-KEM ciphertext from e2e_init
 * @returns {Promise<Buffer>} stream_key
 */
export async function decryptStreamInit(responseSk, mlkemCtB64) {
  const mlkemCt = Buffer.from(mlkemCtB64, 'base64');
  const sharedSecret = await decapsulate(mlkemCt, responseSk);
  return deriveKey(sharedSecret, mlkemCt, INFO_STREAM);
}

/**
 * Decrypt a single E2EE streaming chunk.
 *
 * @param {string} encChunkB64 — base64-encoded encrypted chunk
 * @param {Buffer} streamKey
 * @returns {string} decrypted plaintext (an SSE data line)
 */
export function decryptStreamChunk(encChunkB64, streamKey) {
  const raw = Buffer.from(encChunkB64, 'base64');
  const nonce = raw.slice(0, 12);
  const ciphertext = raw.slice(12, -TAG_SIZE);
  const tag = raw.slice(-TAG_SIZE);
  const plaintext = chachaDecrypt(streamKey, nonce, ciphertext, tag);
  return Buffer.from(plaintext).toString('utf-8');
}
