/** Optional server-owned PCM adapter boundary. Default unavailable: registering
 * an adapter must be done by owner-governed runtime integration, never a client.
 * No imports of model runtimes, credential storage or GPU mutation here.
 */
export function createPcmStreamHandler({ resolveAdapter = () => null, timeoutMs = 120000 } = {}) {
  let busy = false;
  return async function pcmStreamHandler(req, res) {
    if (!req.user?.id) return res.status(401).json({ code: 'authentication-required' });
    const { text, requestId, engine, voice } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 4096 ||
        typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) ||
        !['faster-qwen-candidate','pocket-tts-cpu'].includes(engine) || (voice != null && (typeof voice !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(voice)))) {
      return res.status(400).json({ code: 'invalid-stream-request' });
    }
    let adapter;
    try { adapter = resolveAdapter(req.user.id); } catch { return res.status(503).json({ code: 'stream-candidate-unavailable' }); }
    if (!adapter || adapter.id !== engine || typeof adapter.generate !== 'function' || ![16000, 22050, 24000, 44100, 48000].includes(adapter.sampleRate)) {
      return res.status(503).json({ code: 'stream-candidate-unavailable' });
    }
    if (busy) return res.status(429).json({ code: 'stream-candidate-busy' });
    busy = true;
    const abort = new AbortController();
    let timer, iterator, pending, ended = false, chunks = 0, samples = 0;
    const error = code => Object.assign(new Error(code), { code });
    let rejectAbort;
    const cancellation = new Promise((_, reject) => { rejectAbort = reject; });
    // May abort between awaited operations; keep the rejection observed.
    cancellation.catch(() => {});
    const cancel = code => { if (!abort.signal.aborted) { abort.abort(); rejectAbort(error(code)); } };
    const onClose = () => { if (!ended) cancel('disconnected'); };
    res.on('close', onClose);
    const write = async record => {
      if (abort.signal.aborted || res.destroyed) throw error('disconnected');
      if (!res.write(JSON.stringify({ ...record, requestId }) + '\n')) {
        let onDrain, onError;
        const drained = new Promise((resolve, reject) => {
          onDrain = resolve; onError = reject;
          res.once('drain', onDrain); res.once('error', onError);
        });
        try { await Promise.race([drained, cancellation]); }
        finally { res.off('drain', onDrain); res.off('error', onError); }
      }
    };
    try {
      const bound = Number.isFinite(timeoutMs) ? Math.min(300000, Math.max(1, timeoutMs)) : 120000;
      timer = setTimeout(() => cancel('timeout'), bound);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      await write({ type: 'start', version: 1, format: 's16le', channels: 1, sampleRate: adapter.sampleRate });
      iterator = adapter.generate({ text, voice, userId: req.user.id, requestId, signal: abort.signal })[Symbol.asyncIterator]();
      while (true) {
        pending = Promise.resolve(iterator.next());
        const next = await Promise.race([pending, cancellation]);
        pending = null;
        if (next.done) break;
        const pcm = next.value;
        if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2 || pcm.length > adapter.sampleRate * 2) throw error('invalid-pcm');
        samples += pcm.length / 2;
        if (samples > adapter.sampleRate * 300 || chunks >= 4096) throw error('stream-limit');
        await write({ type: 'audio', sequence: chunks++, pcm: pcm.toString('base64') });
      }
      if (!chunks) throw error('zero-audio');
      await write({ type: 'done', chunks, samples });
    } catch (e) {
      const code = ['timeout', 'disconnected', 'invalid-pcm', 'stream-limit', 'zero-audio'].includes(e.code) ? e.code : 'generation';
      abort.abort();
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify({ type: 'error', requestId, code }) + '\n');
    } finally {
      clearTimeout(timer); ended = true; res.off('close', onClose);
      if (!res.destroyed && !res.writableEnded) res.end();
      // Do not await an uncooperative native step on the HTTP lifecycle, but
      // never release its serialization latch prematurely either.
      const cleanup = async () => {
        try { await pending; } catch { /* already reported */ }
        try { await iterator?.return?.(); } catch { /* adapter owns diagnostics */ }
        busy = false;
      };
      void cleanup();
    }
  };
}
