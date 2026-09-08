import { createLocalPcmCapture } from './localPcmCapture.js';
import { createLocalAsrClient } from './localAsrClient.js';
import { createSpeechOut } from './speechOut.js';
import { validNarrationConfig } from './codexVoiceConfig.js';
/** Local input adapter only: existing submitTurn owns model, auth and task life.
 * Explicit Send is the user's utterance boundary. Pauses never commit partials.
 */
export function createLocalVoiceController({ apiBase = '/api', getToken, submitTurn, onState = () => {}, onListening = () => {}, onTranscript = () => {}, onError = () => {}, createCapture = createLocalPcmCapture, createAsr = createLocalAsrClient, createNarrator = config => createSpeechOut(config, {getToken}) } = {}) {
 let active = false, listening = false, pending = false, generation = 0, inputEpoch = 0, playbackEpoch = 0, capture, asr, narrator;
 const state = () => onState(!active ? 'idle' : pending ? 'working' : listening ? 'listening' : 'paused');
 function stopPlayback() { playbackEpoch++; narrator?.cancel(); if (active) state(); }
 function pause() { inputEpoch++; listening = false; onListening(false); capture?.stop(); asr?.stopListening(); state(); }
 function stop() { generation++; active = false; pause(); stopPlayback(); pending = false; state(); }
 async function listen() {
  if (!active || pending || listening) return false;
  const g = generation, e = ++inputEpoch;
  // Invalidate and release the old setup before publishing another capture.
  capture?.stop();
  stopPlayback(); onState('connecting');
  const own = createCapture({ onOnset: () => { if (active && g === generation && e === inputEpoch) stopPlayback(); }, onError: code => { if (active && g === generation && e === inputEpoch) { pause(); onError(code); state(); } } });
  capture = own;
  let ok = false; try { ok = await own.start(); } catch { /* fail closed */ }
  if (!active || g !== generation || e !== inputEpoch) { own.stop(); return false; }
  listening = ok === true; onListening(listening); state();
  if (!listening) onError('local_microphone_unavailable');
  return listening;
 }
 async function start({ output = 'webspeech', providerEngine } = {}) {
  if (active) return false;
  if (typeof submitTurn !== 'function' || !validNarrationConfig({output,providerEngine})) { onError('local_voice_unavailable'); return false; }
  active = true; const g = ++generation; asr = createAsr({apiBase,getToken});
  narrator = createNarrator({engine:output,apiBase,...(providerEngine === undefined ? {} : {providerEngine})});
  const starting = listen(), e = inputEpoch;
  const ok = await starting; if (!ok && active && g === generation && e === inputEpoch) stop(); return ok;
 }
 async function commit() {
  if (!active || !listening || pending) return {ok:false,reason:'not-recording'};
  const g = generation, e = inputEpoch, p = playbackEpoch;
  const pcm = capture.finish(); listening = false; onListening(false);
  if (!pcm?.length) { state(); onError('local_empty_audio'); return {ok:false,reason:'empty-audio'}; }
  const job = {}; pending = job; state();
  const live = () => active && generation === g;
  try {
   const result = await asr.transcribe({pcm,utteranceId:`local_${globalThis.crypto.randomUUID().replaceAll('-', '')}`});
   if (!live() || e !== inputEpoch) return {ok:false,reason:'stale'};
   if (!result?.ok) { onError(`local_asr_${result?.reason || 'failed'}`); return result; }
   onTranscript({text:result.turn.text});
   let accepted = null, speech = null, invalid = false, sealed = false;
   const seenMessages = new Set();
   const identityKeys = ['executionId','conversationId','requestId','accountId','userId','provider','model'];
   const identity = {};
   const bindIdentity = r => identityKeys.every(k => {
    if (r?.[k] === undefined) return true;
    if (typeof r[k] !== 'string' || !r[k] || (identity[k] !== undefined && identity[k] !== r[k])) return false;
    identity[k] = r[k]; return true;
   });
   const receipt = await submitTurn({...result.turn, onAccepted:r => {
    if (sealed || !live()) return;
    if (r?.accepted !== true || !['executionId','conversationId','assistantMessageId'].every(k => typeof r[k] === 'string' && r[k]) || !bindIdentity(r)) { invalid = true; return; }
    if (accepted?.assistantMessageId !== r.assistantMessageId) {
     if (speech !== null || seenMessages.has(r.assistantMessageId)) { invalid = true; return; }
     seenMessages.add(r.assistantMessageId);
    }
    accepted = {...r};
   }, onSpeech:(text,id) => {
    if (sealed || !live()) return;
    if (typeof text !== 'string' || text.length > 16384 || id !== accepted?.assistantMessageId || (speech !== null && text !== speech)) invalid = true;
    else speech = text;
   }});
   sealed = true;
   if (!bindIdentity(receipt) || !bindIdentity(receipt?.requestIdentity)) invalid = true;
   // Submission is settled. Playback does not own the input/submit lock.
   if (live() && pending === job) { pending = false; state(); }
   const confirmed = !invalid && receipt?.accepted === true && receipt.completed === true && accepted?.accepted === true &&
    ['executionId','conversationId','assistantMessageId'].every(k => typeof receipt[k] === 'string' && receipt[k] && receipt[k] === accepted[k]);
   if (live() && !confirmed) onError('local_turn_unconfirmed');
   if (live() && p === playbackEpoch && confirmed && speech?.trim()) {
    onState('speaking'); const played = await narrator.speak(speech);
    if (live() && p === playbackEpoch && played?.ok !== true) onError('local_narration_failed');
   }
   return receipt;
  } catch { if (live()) onError('local_voice_failed'); return {ok:false,reason:'failed'}; }
  finally { if (g === generation) { if (pending === job) { pending = false; state(); } else if (!pending && p === playbackEpoch) state(); } }
 }
 return {start,stop,commit,stopPlayback,setListening: value => value ? listen() : pause(),get active(){return active;},get listening(){return listening;}};
}
