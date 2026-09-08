import { MIC_CONSTRAINTS } from './micConstraints.js';
/** Explicit, bounded utterance capture. No endpointing/automatic task submission.
 * Browser resampling must really produce 16kHz; reject incompatible devices.
 * The graph's output is permanently zero, never monitor the room on speakers.
 */
export function createLocalPcmCapture({ getUserMedia = c => navigator.mediaDevices.getUserMedia(c), AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, onOnset = () => {}, onError = () => {}, maxSamples = 960000, setupTimeoutMs = 20000 } = {}) {
 let generation = 0, stream, context, source, processor, mute, frames = [], count = 0, invalid = false, timer, cancelSetup;
 function stop() {
  generation++; clearTimeout(timer); cancelSetup?.(); cancelSetup = null;
  if (processor) processor.onaudioprocess = null;
  for (const node of [source, processor, mute]) { try { node?.disconnect(); } catch {} }
  try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
  stream?.getTracks().forEach(t => t.stop());
  stream = context = source = processor = mute = null; frames = []; count = 0;
 }
 async function start() {
  stop(); invalid = false; const g = generation;
  const lateStop = s => s?.getTracks().forEach(t => t.stop());
  const cancelled = new Promise((_, reject) => { cancelSetup = () => reject(new Error('cancelled')); });
  cancelled.catch(() => {});
  try {
   if (!AudioContext) throw new Error('audio-context-unavailable');
   const acquisition = Promise.resolve().then(() => getUserMedia(MIC_CONSTRAINTS));
   acquisition.then(s => { if (g !== generation) lateStop(s); }, () => {});
   const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('microphone-timeout')), setupTimeoutMs); });
   const s = await Promise.race([acquisition, timeout, cancelled]);
   if (g !== generation) { lateStop(s); return false; }
   stream = s; context = new AudioContext({ sampleRate: 16000 });
   if (context.sampleRate !== 16000) throw new Error('sample-rate-unsupported');
   await Promise.race([context.resume(), timeout, cancelled]);
   if (g !== generation) return false;
   source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(1024, 1, 1);
   mute = context.createGain(); mute.gain.value = 0;
   processor.onaudioprocess = event => {
    if (g !== generation || invalid) return;
    const input = event.inputBuffer.getChannelData(0); let energy = 0;
    if (count + input.length > maxSamples) { invalid = true; stop(); onError('utterance-too-long'); return; }
    const bytes = new Uint8Array(input.length * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < input.length; i++) {
     const value = Number.isFinite(input[i]) ? Math.max(-1, Math.min(1, input[i])) : 0;
     energy += value * value; view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true);
    }
    frames.push(bytes); count += input.length;
    if (Math.sqrt(energy / input.length) >= 0.025) onOnset();
   };
   source.connect(processor); processor.connect(mute); mute.connect(context.destination);
   clearTimeout(timer); cancelSetup = null; return true;
  } catch { if (g === generation) { stop(); onError('microphone-unavailable'); } return false; }
 }
 function finish() {
  const pcm = !invalid && count ? new Uint8Array(count * 2) : null;
  if (pcm) { let offset = 0; for (const frame of frames) { pcm.set(frame, offset); offset += frame.length; } }
  stop(); return pcm;
 }
 return { start, stop, finish };
}
