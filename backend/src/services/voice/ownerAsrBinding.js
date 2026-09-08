import { open } from 'node:fs/promises';
import WebSocket from 'ws';

// Consumer of workstation interfaces/consumer-contracts/voice-dictation.env v1.
// Never source/execute the file. Contract readiness is NOT runtime admission or
// model qualification. This binds the existing canonical service only; it never
// starts a runtime, allocates a GPU, promotes a candidate or selects a text model.
export function parseOwnerAsrContract(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 32768) throw new Error('invalid-owner-contract');
  const vars = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m || Object.hasOwn(vars, m[1])) throw new Error('invalid-owner-contract');
    vars[m[1]] = m[2];
  }
  const required = { WORKSTATION_LANE_CONTRACT_VERSION: '1', WORKSTATION_LANE_CONTRACT_GROUP: 'voice-dictation',
    VOICE_ASR_ENABLED: 'true', VOICE_ASR_LANE_ID: 'asr', VOICE_ASR_BIND: '127.0.0.1',
    VOICE_ASR_PROTOCOL: 'ws', VOICE_ASR_API_SHAPE: 'speech-stream', VOICE_ASR_CONTRACT_STATUS: 'ready' };
  if (Object.entries(required).some(([k,v]) => vars[k] !== v) || !/^[a-zA-Z0-9_.@-]+\.service$/.test(vars.VOICE_ASR_RUNTIME_OWNER || '')) throw new Error('invalid-owner-contract');
  const socket = new URL(vars.NVIDIA_ASR_URL), health = new URL(vars.NVIDIA_ASR_HEALTH_URL);
  if (socket.protocol !== 'ws:' || health.protocol !== 'http:' || socket.hostname !== '127.0.0.1' || health.hostname !== socket.hostname ||
      !socket.port || health.port !== socket.port || socket.pathname !== '/' || health.pathname !== '/health' ||
      [socket, health].some(u => u.username || u.password || u.search || u.hash)) throw new Error('invalid-owner-endpoint');
  return Object.freeze({ socketUrl: socket.href, healthUrl: health.href });
}
async function readBoundedContract(path) {
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new Error('invalid-owner-contract');
    const buffer = Buffer.alloc(32769);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 32768) throw new Error('invalid-owner-contract');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
export function createOwnerAsrResolver({ contractPath = process.env.AGNT_LOCAL_ASR_CONTRACT || '',
  allowedUsers = (process.env.AGNT_LOCAL_ASR_USERS || '').split(',').map(s => s.trim()).filter(Boolean),
  readContract = readBoundedContract, fetch: fetchImpl = globalThis.fetch,
  openSocket = (url, options) => new WebSocket(url, options), timeoutMs = 3000 } = {}) {
  // Snapshot administrator selection; not a browser-supplied endpoint or user list.
  const users = new Set(Array.isArray(allowedUsers) ? allowedUsers : []);
  return async userId => {
    if (!contractPath || typeof userId !== 'string' || !users.has(userId)) return null;
    const controller = new AbortController(); let timer, reader;
    const cancellation = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('owner-timeout')); }, Math.max(1, Math.min(3000, timeoutMs || 3000)));
    });
    const wait = p => Promise.race([p, cancellation]);
    try {
      const contract = parseOwnerAsrContract(await wait(readContract(contractPath)));
      const response = await wait(fetchImpl(contract.healthUrl, { signal: controller.signal, redirect: 'error' }));
      if (!response.ok || !response.body?.getReader) return null;
      reader = response.body.getReader(); let bytes = 0, raw = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for (;;) {
        const { done, value } = await wait(reader.read()); if (done) break;
        bytes += value.byteLength; if (bytes > 8192) return null;
        raw += decoder.decode(value, { stream: true });
      }
      const health = JSON.parse(raw + decoder.decode());
      if (health.status !== 'healthy' || health.model_loaded !== true || (health.sample_rate !== undefined && health.sample_rate !== 16000)) return null;
      return Object.freeze({ id: 'local-asr-candidate', sampleRate: 16000,
        openSocket: () => openSocket(contract.socketUrl, { maxPayload: 65536, followRedirects: false, handshakeTimeout: 3000 }) });
    } catch { return null; } // No endpoint, model path or internal errors exposed.
    finally {
      clearTimeout(timer); controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* closed */ }
      try { reader?.releaseLock(); } catch { /* closed */ }
    }
  };
}
