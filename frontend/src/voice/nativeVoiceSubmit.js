import { createRequestVoiceBridge } from './requestVoiceBridge.js';
import { normalizeVoiceMetadata } from './voiceMetadata.js';

/** Request-local provenance; never upgrade an unknown source to verbatim. */
export function nativeVoiceMetadata(turn) {
  if (!turn) return [];
  return normalizeVoiceMetadata([{
    type: 'voice-input', kind: turn.commitKind, utteranceId: turn.utteranceId,
    observedTranscript: turn.transcript, delegatedInterpretation: turn.delegatedInterpretation,
  }]);
}

/** Observer errors cannot break the text path, and must not print user content. */
export function observeVoiceEvent(observer, name, data) {
  if (typeof observer === 'function') {
    try { observer(name, data); } catch { /* observer only */ }
  }
}

/** Adapt an existing Promise-returning send path, not a second chat client.
 * Native overlap is rejected, not silently turned into a steer: the existing
 * steer protocol has no request-local terminal receipt. Accepted tasks survive
 * listening/playback stop; their stale speech is discarded by the controller.
 */
export function createNativeVoiceSubmit({ send, isBusy = () => false, getExpectedIdentity = () => ({}) }) {
  let inFlight = false;
  return async (turn) => {
    if (inFlight || isBusy()) return { submitted: false, accepted: false, completed: false, reason: 'voice_turn_busy' };
    if (typeof send !== 'function' || typeof turn?.text !== 'string' || !turn.text.trim()) {
      return { submitted: false, accepted: false, completed: false, reason: 'voice_submit_unavailable' };
    }
    inFlight = true;
    let bridge, bound = false, observed = false;
    const makeBridge = expected => createRequestVoiceBridge({ onAccepted: turn.onAccepted,
      onSpeech: turn.onSpeech, expected, requireAuthenticatedReceipt: true });
    bridge = makeBridge({});
    const bindVoiceRequest = identity => {
      if (bound || observed || !identity ||
          !['userId', 'requestId', 'provider', 'model'].every(key =>
            typeof identity[key] === 'string' && identity[key].trim().length > 0 && identity[key].length <= 256)) {
        bridge.event('error', {});
        throw new Error('voice_request_origin_unbound');
      }
      bound = true;
      bridge = makeBridge({ ...identity });
    };
    try {
      const initial = getExpectedIdentity();
      if (initial && Object.keys(initial).length) bindVoiceRequest(initial);
      await send(turn.text, {
        voiceMetadata: { transcript: turn.transcript, utteranceId: turn.utteranceId,
          commitKind: turn.commitKind, delegatedInterpretation: turn.delegatedInterpretation },
        bindVoiceRequest,
        onVoiceStreamEvent: (name, data) => {
          observed = true;
          if (!bound) bridge.event('error', {});
          bridge.event(name, data);
        },
      });
    } catch {
      bridge.event('error', {});
    } finally {
      inFlight = false;
    }
    return bridge.finish();
  };
}
