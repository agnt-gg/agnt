/**
 * useRealtimeVoice — speech-to-speech conversation with AGNT behind it.
 *
 * WHAT THIS IS, AND WHY IT IS NOT THE CASCADE
 * -------------------------------------------
 * The cascade pipeline (useVoiceSession) is VAD -> Whisper -> orchestrator ->
 * TTS. Each hop is defensible and the whole thing can be made fast, but it can
 * never be made NATURAL: the moment speech becomes text, the prosody, the
 * hesitation, the emphasis and the emotion are gone, and no TTS engine can put
 * them back. That loss is structural, not a tuning problem.
 *
 * A speech-to-speech model keeps the audio end to end, which is where the
 * quality people mean when they say "it sounds like a person" actually comes
 * from.
 *
 * The catch is that such a model has no tools, no agents, no workspace and no
 * memory — so it is only useful if it is NOT the one answering. Here it is the
 * ears and the mouth, with exactly one tool (`run_agnt`) wired straight into
 * the real orchestrator. The user gets a natural voice AND the whole platform,
 * because the two jobs are given to the two things that are good at them.
 *
 * WHAT THE TRANSPORT GIVES US FOR FREE
 * ------------------------------------
 * Everything the cascade had to build by hand, WebRTC + the realtime session
 * provide natively, and better:
 *
 *   turn-taking      `semantic_vad` decides from MEANING, on the audio, where
 *                    the evidence is — the same job semanticEndpointer.js does
 *                    lexically on a transcript that does not exist yet
 *   barge-in         talk over it and the server cancels and truncates its own
 *                    unplayed audio; no cancel token, no generation counter
 *   spoken prefix    the server knows what it actually played, so the
 *                    conversation state is truncated correctly without any of
 *                    our playhead bookkeeping
 *   playback         the peer connection feeds an <audio> element directly;
 *                    no queue, no chunker, no drain primitive
 *
 * So this file is deliberately much smaller than useVoiceSession, and the
 * things that were hard there are simply absent here.
 */

import { ref, computed, onUnmounted } from 'vue';
import {
  interpretEvent,
  buildFunctionOutput,
  buildResponseCreate,
  BridgeAction,
} from '../voice/realtimeBridge.js';
import { API_CONFIG } from '../../user.config.js';

export const RealtimeState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LISTENING: 'listening',
  WORKING: 'working', // an AGNT run is in flight
  SPEAKING: 'speaking',
});

/**
 * How long we let a single AGNT run hold the tool call open.
 *
 * The session BLOCKS on an unanswered function call — the model will wait
 * silently forever, which the user experiences as a dead line. A long research
 * task can legitimately take minutes, so this is generous, but it must not be
 * infinite: on expiry we answer the call with an honest message the model can
 * speak, and the conversation survives.
 */
const AGNT_CALL_TIMEOUT_MS = 180000;

export function useRealtimeVoice(options = {}) {
  const {
    onRunAgnt = async () => 'AGNT is not connected on this surface.',
    onUserSaid = () => {},
    onAssistantSaid = () => {},
    getToken = () => localStorage.getItem('token'),
    voice = 'marin',
    surface = 'chat',
    /**
     * Frame transmitter. Defaults to the data channel; injectable so tests can
     * OBSERVE what is sent.
     *
     * This exists because the first version of the test suite asserted "a tool
     * call is always answered" while asserting nothing of the kind: `send`
     * short-circuits on a closed channel, `dc` is null under test, so every
     * test passed with zero frames emitted. A property nobody can observe is a
     * property nobody is testing.
     */
    sendFrame = null,
  } = options;

  const state = ref(RealtimeState.IDLE);
  const isActive = computed(() => state.value !== RealtimeState.IDLE);
  const error = ref(null);
  const assistantPartial = ref('');
  /** True when the account has no OpenAI credit/credentials — caller falls back. */
  const unavailable = ref(false);

  let pc = null;
  let dc = null;
  let micStream = null;
  let audioEl = null;
  /** Bumped on stop(); async continuations check it before touching anything. */
  let generation = 0;

  function send(event) {
    if (sendFrame) {
      sendFrame(event);
      return;
    }
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(event));
  }

  // ---- the tool call: AGNT does the work -------------------------------

  /**
   * Answer a run_agnt call. MUST always answer, on every path — a swallowed
   * error leaves the model waiting on a call that will never be resolved, and
   * the session appears to hang with no error anywhere.
   */
  async function handleRunAgnt(action, gen) {
    if (!action.callId) return;

    if (action.parseError || !action.instruction) {
      send(
        buildFunctionOutput(
          action.callId,
          'I could not read that request. Ask the user to rephrase it.'
        )
      );
      send(buildResponseCreate());
      return;
    }

    state.value = RealtimeState.WORKING;

    let result;
    try {
      result = await Promise.race([
        onRunAgnt(action.instruction),
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                'That is taking longer than expected and is still running in the chat. ' +
                  'Tell the user it is still going and offer to check back.'
              ),
            AGNT_CALL_TIMEOUT_MS
          )
        ),
      ]);
    } catch (err) {
      result = `AGNT hit an error: ${err?.message || 'unknown failure'}. Tell the user plainly.`;
    }

    if (gen !== generation) return; // session was stopped while AGNT worked

    send(buildFunctionOutput(action.callId, result || 'AGNT returned nothing.'));
    send(buildResponseCreate());
    state.value = RealtimeState.SPEAKING;
  }

  // ---- event pump --------------------------------------------------------

  function handleMessage(raw, gen) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return; // a malformed frame is not worth killing the session over
    }

    for (const action of interpretEvent(event)) {
      switch (action.type) {
        case BridgeAction.READY:
          if (state.value === RealtimeState.CONNECTING) state.value = RealtimeState.LISTENING;
          break;

        case BridgeAction.USER_INTERRUPTED:
          // The server truncates its own unplayed audio; we only reflect state.
          assistantPartial.value = '';
          if (state.value === RealtimeState.SPEAKING) state.value = RealtimeState.LISTENING;
          break;

        case BridgeAction.USER_SAID:
          onUserSaid(action.text);
          break;

        case BridgeAction.ASSISTANT_PARTIAL:
          assistantPartial.value += action.delta;
          if (state.value !== RealtimeState.WORKING) state.value = RealtimeState.SPEAKING;
          break;

        case BridgeAction.ASSISTANT_SAID:
          onAssistantSaid(action.text);
          assistantPartial.value = '';
          if (state.value === RealtimeState.SPEAKING) state.value = RealtimeState.LISTENING;
          break;

        case BridgeAction.RUN_AGNT:
          void handleRunAgnt(action, gen);
          break;

        case BridgeAction.ERROR:
          error.value = action.message;
          // An unknown tool call still has to be answered or the session hangs.
          if (action.callId) {
            send(buildFunctionOutput(action.callId, 'That tool is not available.'));
            send(buildResponseCreate());
          }
          break;

        default:
          break;
      }
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  async function start() {
    if (isActive.value) return true;
    error.value = null;
    unavailable.value = false;
    state.value = RealtimeState.CONNECTING;
    const gen = ++generation;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      error.value =
        err?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not open the microphone';
      state.value = RealtimeState.IDLE;
      return false;
    }

    pc = new RTCPeerConnection();

    // Model audio arrives as a remote track; an <audio> element plays it.
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    pc.addTrack(micStream.getTracks()[0]);
    dc = pc.createDataChannel('oai-events');
    dc.addEventListener('message', (e) => handleMessage(e.data, gen));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let res;
    try {
      res = await fetch(
        `${API_CONFIG.BASE_URL}/speech/realtime/call?voice=${encodeURIComponent(voice)}&surface=${encodeURIComponent(surface)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${getToken()}` },
          body: offer.sdp,
        }
      );
    } catch (err) {
      error.value = 'Could not reach the voice service';
      stop();
      return false;
    }

    // The route answers with JSON (not SDP) when the account has no usable
    // OpenAI credential — a normal state, and the caller falls back to the
    // cascade pipeline rather than showing an error.
    const contentType = res.headers?.get?.('content-type') || '';
    if (!res.ok || contentType.includes('application/json')) {
      let reason = `http-${res.status}`;
      try {
        const body = await res.json();
        reason = body.reason || reason;
      } catch {
        /* not JSON after all */
      }
      unavailable.value = reason === 'no-credentials';
      error.value = unavailable.value
        ? 'Natural voice needs OpenAI credit on this account.'
        : 'Could not start the natural voice session.';
      stop();
      return false;
    }

    const answer = { type: 'answer', sdp: await res.text() };
    if (gen !== generation) return false; // stopped mid-handshake
    await pc.setRemoteDescription(answer);

    return true;
  }

  function stop() {
    generation += 1;
    try {
      dc?.close();
    } catch {
      /* already closed */
    }
    try {
      pc?.close();
    } catch {
      /* already closed */
    }
    try {
      micStream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
      } catch {
        /* already torn down */
      }
    }
    dc = null;
    pc = null;
    micStream = null;
    audioEl = null;
    assistantPartial.value = '';
    state.value = RealtimeState.IDLE;
  }

  function toggle() {
    return isActive.value ? (stop(), Promise.resolve(false)) : start();
  }

  onUnmounted(() => {
    try {
      stop();
    } catch {
      /* teardown is best-effort */
    }
  });

  return {
    state,
    isActive,
    error,
    unavailable,
    assistantPartial,
    isSupported: typeof RTCPeerConnection !== 'undefined',
    start,
    stop,
    toggle,
    /** Test seam: drive the event pump without a peer connection. */
    _handleMessage: (raw) => handleMessage(raw, generation),
  };
}

export default useRealtimeVoice;
