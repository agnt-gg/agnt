/** Candidate PCM protocol v1. Exact request binding, bounded NDJSON and one
 * awaited sink write. No blob/arrayBuffer, no automatic provider fallback.
 * A drained browser sink is not evidence of human hearing or semantic fidelity.
 */
export async function consumePcmStream({ body, sink, requestId, signal, isAllowed = () => true, onPlaying = () => {} }) {
  let reader, started = false, terminal = false, receivedSamples = 0, allowedSamples = 0, chunks = 0;
  const failure = reason => Object.assign(new Error(reason), { reason });
  let aborted = signal?.aborted || false;
  const stop = () => { try { sink?.stop(); } catch { /* preserve original outcome */ } };
  const onAbort = () => { aborted = true; stop(); reader?.cancel().catch(() => {}); };
  const guard = () => {
    if (aborted) throw failure('cancelled');
    if (!isAllowed()) throw failure('stale');
  };
  try {
    if (!body?.getReader || !sink?.write || !sink?.drain || !sink?.stop || !requestId) throw failure('unavailable');
    reader = body.getReader(); signal?.addEventListener('abort', onAbort, { once: true });
    guard();
    let format;
    const record = async line => {
      guard();
      if (terminal) throw failure('after-terminal');
      let r;
      try { r = JSON.parse(line); } catch { throw failure('invalid-json'); }
      if (!r || r.requestId !== requestId) throw failure('identity');
      if (!started) {
        if (r.type !== 'start' || r.version !== 1 || r.format !== 's16le' || r.channels !== 1 || ![16000, 22050, 24000, 44100, 48000].includes(r.sampleRate)) throw failure('format');
        started = true; format = r; return;
      }
      if (r.type === 'error') throw failure('generation');
      if (r.type === 'done') {
        if (!chunks || r.chunks !== chunks || r.samples !== receivedSamples) throw failure('terminal-count');
        terminal = true; return;
      }
      if (r.type !== 'audio' || r.sequence !== chunks || typeof r.pcm !== 'string' || !r.pcm.length || r.pcm.length > 128000 || r.pcm.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.pcm)) throw failure('audio-record');
      const bytes = atob(r.pcm);
      if (!bytes.length || bytes.length % 2 || bytes.length > format.sampleRate * 2) throw failure('audio-size');
      const samples = new Float32Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i++) {
        const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
        samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
      }
      receivedSamples += samples.length;
      if (receivedSamples > format.sampleRate * 300 || chunks >= 4096) throw failure('stream-limit');
      guard();
      await sink.write(samples, format.sampleRate, { requestId, sequence: chunks, isAllowed: () => !aborted && isAllowed(), onStarted: () => { guard(); if (chunks === 0) onPlaying(); } });
      guard();
      allowedSamples += samples.length; chunks++;
    };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    while (true) {
      guard();
      const { value, done } = await reader.read();
      guard();
      if (done) break;
      // A transport chunk is bounded independently of line size. A malicious
      // peer cannot make a huge concatenated-record allocation in this parser.
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1 || value.byteLength > 262144) throw failure('record-limit');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        if (newline > 131072) throw failure('record-limit');
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) throw failure('empty-record');
        await record(line);
      }
      if (buffer.length > 131072) throw failure('record-limit');
    }
    buffer += decoder.decode();
    if (buffer.length || !terminal) throw failure('incomplete');
    guard(); await sink.drain(); guard();
    return { ok: true, requestId, chunks, receivedSamples, allowedSamples, playbackDrained: true };
  } catch (error) {
    stop();
    return { ok: false, reason: error.reason || 'stream', requestId, chunks, receivedSamples, allowedSamples, playbackDrained: false };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { await reader?.cancel(); } catch { /* already closed */ }
    try { reader?.releaseLock(); } catch { /* already released */ }
  }
}
