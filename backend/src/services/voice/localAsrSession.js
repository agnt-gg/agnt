/** Nemotron speech-stream boundary (server.py reset protocol, reviewed 2026-09-08).
 * Server-owned openSocket supplies an owner-discovered endpoint; no URL, model,
 * credentials or runtime admission claim comes from browser input here.
 * One dedicated socket/reader per utterance is intentional: this wire protocol
 * has no correlation IDs. Never reuse it after a final, timeout or cancellation.
 * Returns ASR evidence, not authority to execute or a claim of verbatim accuracy.
 */
export function createLocalAsrSession({ openSocket, utteranceId, onPartial = () => {}, timeoutMs = 10000 } = {}) {
  if (typeof openSocket !== 'function' || typeof utteranceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(utteranceId)) throw new Error('invalid-asr-config');
  const bound = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60000, timeoutMs)) : 10000;
  let socket, state = 'connecting', bytes = 0, sendPending = null, result, timer;
  let settleReady, settleResult;
  const ready = new Promise(resolve => { settleReady = resolve; });
  const completion = new Promise(resolve => { settleResult = resolve; });
  const finish = value => {
    if (result) return result;
    result = Object.freeze({ ...value, utteranceId }); state = 'closed'; clearTimeout(timer);
    socket?.off('message', onMessage); socket?.off('close', onClose);
    // ws may emit an error during close; retain only a content-blind observer.
    socket?.off('error', onError); socket?.on('error', ignoreError);
    try { socket?.terminate(); } catch { /* already closed */ }
    settleReady({ ok: false, reason: value.reason || 'closed' });
    settleResult(result); return result;
  };
  const fail = reason => finish({ ok: false, reason });
  const ignoreError = () => {};
  const onClose = () => fail('disconnected');
  const onError = () => fail('transport');
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => fail('timeout'), ms); };
  const onMessage = (data, binary) => {
    if (result) return;
    if (binary || !Buffer.isBuffer(data) || data.length > 65536) { fail('invalid-record'); return; }
    let r; try { r = JSON.parse(data.toString('utf8')); } catch { fail('invalid-record'); return; }
    if (r?.type === 'ready' && state === 'connecting') {
      state = 'listening'; arm(60000); settleReady({ ok: true }); return;
    }
    if (r?.type === 'error') { fail('generation'); return; }
    if (r?.type !== 'transcript' || typeof r.text !== 'string' || r.text.length > 16384 || !['listening', 'draining', 'finalizing'].includes(state)) {
      fail('invalid-record'); return;
    }
    if (r.is_final === true && r.finalize === true) {
      if (state !== 'finalizing') { fail('unexpected-final'); return; }
      if (!r.text.trim()) { fail('empty-final'); return; }
      finish({ ok: true, transcript: r.text.trim(), kind: 'local-asr-hard-final', audioBytes: bytes });
    } else if (r.is_final === false && state === 'listening') {
      try { onPartial(r.text); } catch { /* diagnostic observer cannot commit */ }
    }
    // Soft final and missing finalize remain unconfirmed. Never substitute them.
  };
  function send(data) {
    return new Promise(resolve => {
      try {
        if (socket.readyState !== 1) { resolve(fail('transport')); return; }
        socket.send(data, error => resolve(error ? fail('transport') : { ok: true }));
      } catch { resolve(fail('transport')); }
    });
  }
  try {
    socket = openSocket(); socket.on('message', onMessage); socket.on('close', onClose); socket.on('error', onError); arm(bound);
  } catch { fail('unavailable'); }
  return {
    ready,
    async sendAudio(pcm) {
      if (state !== 'listening') return { ok: false, reason: 'not-listening' };
      if (sendPending) return { ok: false, reason: 'busy' };
      if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2 || pcm.length > 32000 || bytes + pcm.length > 1920000) return fail('invalid-audio');
      bytes += pcm.length;
      // Own bytes until send settles, no caller mutation or accumulating queue.
      sendPending = send(Buffer.from(pcm));
      const outcome = await Promise.race([sendPending, completion]); sendPending = null;
      return outcome;
    },
    finalize() {
      if (result || state === 'finalizing' || state === 'draining') return completion;
      if (state !== 'listening') { fail('not-ready'); return completion; }
      if (!bytes) { fail('zero-audio'); return completion; }
      state = 'draining'; arm(bound);
      const reset = () => {
        if (result) return;
        state = 'finalizing';
        void send(JSON.stringify({ type: 'reset', finalize: true }));
      };
      if (sendPending) void sendPending.then(reset); else reset();
      return completion;
    },
    cancel() { return fail('cancelled'); },
  };
}
