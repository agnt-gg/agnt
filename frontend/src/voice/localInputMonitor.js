import {createVad} from './energyVad.js';

/** Observe the already-permitted stream, never request another microphone.
 * No connection to destination: this graph cannot play microphone audio.
 * The 20 ms scheduler is a target, not a real-device latency guarantee.
 */
export function monitorLocalInput(stream, onOnset, {
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  schedule = fn => setInterval(fn, 20), cancel = clearInterval,
} = {}) {
  if (!AudioContext) return null;
  let context, source, analyser, timer, stopped = false, enabled = true;
  const vad = createVad();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) cancel(timer);
    try { source?.disconnect(); analyser?.disconnect(); } catch { /* detached */ }
    try { context?.close()?.catch?.(() => {}); } catch { /* closed */ }
  };
  try {
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 1024;
    source.connect(analyser);
    const frame = new Float32Array(analyser.fftSize);
    timer = schedule(() => {
      if (stopped || !enabled) return;
      analyser.getFloatTimeDomainData(frame);
      if (vad.push(frame).onset) onOnset();
    });
    context.resume()?.catch?.(stop);
    return {stop, setEnabled(value) {enabled = Boolean(value); vad.reset();}};
  } catch { stop(); return null; }
}
