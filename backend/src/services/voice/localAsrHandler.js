import { createLocalAsrSession } from './localAsrSession.js';

/** Optional raw PCM input: 16kHz mono s16le, at most 60s. No disk uploads,
 * partial commits, client URLs, model selection or automatic provider fallback.
 * resolveBinding is a server-owned, per-user binding lookup (sync or async).
 * Default is unavailable until owner integration supplies a verified binding.
 */
export function createLocalAsrHandler({ resolveBinding = () => null, timeoutMs = 60000 } = {}) {
  const attempts = new Map(); // bounded ten-minute replay window, not durable execution dedupe
  let active = false;
  return async function localAsrHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const reject = (status, reason) => res.status(status).json({ ok: false, reason });
    if (!req.user?.id) return reject(401, 'authentication-required');
    const utteranceId = req.headers['x-asr-utterance-id'];
    const length = req.headers['content-length'];
    if (typeof utteranceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(utteranceId) ||
        req.headers['content-type'] !== 'audio/pcm' || Object.keys(req.query || {}).length ||
        (length !== undefined && (!/^\d+$/.test(length) || +length < 2 || +length > 1920000 || +length % 2))) {
      return reject(400, 'invalid-asr-request');
    }
    const now = Date.now();
    for (const [key, expires] of attempts) if (expires <= now) attempts.delete(key);
    const key = JSON.stringify([req.user.id, utteranceId]);
    if (attempts.has(key)) return reject(409, 'duplicate-utterance');
    if (active || attempts.size >= 2048) return reject(429, 'local-asr-busy');
    // Reserve before awaiting owner lookup: concurrent requests must not race
    // admission or start a second socket. Unavailable lookup consumes no audio.
    active = true;
    const bound = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60000, timeoutMs)) : 60000;
    let session, timer, ended = false, failure, cancelled = false;
    const cancellation = new Promise(resolve => { failure = resolve; });
    const cancel = reason => { cancelled = true; session?.cancel(); failure({ ok: false, reason, utteranceId }); };
    const onClose = () => { if (!ended) cancel('disconnected'); };
    res.on('close', onClose);
    req.once('aborted', onClose);
    try {
      timer = setTimeout(() => cancel('timeout'), bound);
      const work = async () => {
        let binding;
        try { binding = await resolveBinding(req.user.id); } catch { /* content-blind */ }
        if (cancelled || ended) return { ok: false, reason: 'cancelled' };
        if (!binding || binding.id !== 'local-asr-candidate' || binding.sampleRate !== 16000 || typeof binding.openSocket !== 'function') {
          return { ok: false, reason: 'local-asr-unavailable' };
        }
        attempts.set(key, Date.now() + 600000);
        session = createLocalAsrSession({ openSocket: binding.openSocket, utteranceId, timeoutMs: bound });
        const ready = await session.ready;
        if (!ready.ok) return ready;
        let bytes = 0, carry = Buffer.alloc(0);
        // Early validation must not let iterator.return() destroy the response
        // socket and race the explicit 400 with a disconnected/502 outcome.
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          bytes += chunk.length;
          if (bytes > 1920000) return { ok: false, reason: 'invalid-audio' };
          const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
          const even = data.length - data.length % 2;
          carry = Buffer.from(data.subarray(even));
          for (let i = 0; i < even; i += 32000) {
            const sent = await session.sendAudio(data.subarray(i, Math.min(even, i + 32000)));
            if (!sent.ok) return sent;
          }
        }
        if (carry.length || !bytes) return { ok: false, reason: 'invalid-audio' };
        return session.finalize();
      };
      const outcome = await Promise.race([work(), cancellation]);
      if (!res.destroyed) {
        if (outcome.ok) res.json(outcome);
        else reject(outcome.reason === 'local-asr-unavailable' ? 503 : outcome.reason === 'timeout' ? 504 : outcome.reason === 'invalid-audio' ? 400 : 502,
          ['local-asr-unavailable', 'timeout', 'invalid-audio', 'empty-final', 'disconnected', 'cancelled'].includes(outcome.reason) ? outcome.reason : 'local-asr-failed');
      }
    } catch {
      if (!res.destroyed) reject(502, 'local-asr-failed');
    } finally {
      ended = true; clearTimeout(timer); session?.cancel();
      res.off('close', onClose); req.off('aborted', onClose);
      // Stop unread request input on cancellation; transport close != GPU compute cancellation.
      if (!req.complete) req.destroy();
      active = false;
    }
  };
}
