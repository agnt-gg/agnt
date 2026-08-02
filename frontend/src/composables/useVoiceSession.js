/**
 * useVoiceSession — the runtime that turns AGNT into something you talk to.
 *
 * WHAT THIS COMPOSES
 * ------------------
 *   audioCapture      one mic, one graph, VAD frames + recording
 *   semanticEndpointer  when is the turn over (content-aware, not a timer)
 *   turnGate          reopen window, barge-in, session lifecycle
 *   sentenceChunker   speak the first sentence while the rest generates
 *   speechOut         playback + the record of what was actually heard
 *   wakePhrase        "hey annie", agent routing, whole-utterance stop
 *
 * Each of those is pure and separately tested. This file is the only place with
 * timers, sockets and a microphone, and it is deliberately thin: it translates
 * gate EFFECTS into I/O and nothing else. Logic that can live in a pure module
 * belongs in one, because logic in here can only be tested with a sound card.
 *
 * DECOUPLED FROM THE STORE ON PURPOSE
 * -----------------------------------
 * Sending a message is a callback, not an import. AGNT has many chat surfaces
 * (main chat, agent panel, tool/widget/workflow forges), and every one of them
 * sends differently. Taking `onCommit` means voice works on all of them without
 * this file knowing any of them exist.
 */

import { ref, computed, onUnmounted } from 'vue';
import { createAudioCapture } from '../voice/audioCapture.js';
import { createTurnGate, VoiceState, Effect } from '../voice/turnGate.js';
import { shouldEndpoint } from '../voice/semanticEndpointer.js';
import { createSentenceChunker } from '../voice/sentenceChunker.js';
import { createSpeechOut, isWebSpeechAvailable } from '../voice/speechOut.js';
import { detectWake, isStopPhrase, stripWakePhrase } from '../voice/wakePhrase.js';
import { API_CONFIG } from '../../user.config.js';

/** How often the gate is ticked. Bounds reopen/barge-in resolution. */
const TICK_MS = 50;

export function useVoiceSession(options = {}) {
  const {
    onCommit = () => {},
    onSteer = null,
    onWakeAgent = null,
    getAgents = () => [],
    getToken = () => localStorage.getItem('token'),
    config = {},
  } = options;

  // ---- reactive surface --------------------------------------------------
  const state = ref(VoiceState.IDLE);
  const isActive = computed(() => state.value !== VoiceState.IDLE);
  const isListening = computed(() => state.value === VoiceState.LISTENING);
  const isSpeaking = computed(() => state.value === VoiceState.SPEAKING);
  const isThinking = computed(() => state.value === VoiceState.THINKING);
  const partialTranscript = ref('');
  const level = ref(0);
  const error = ref(null);
  const isTranscribing = ref(false);
  const calibrating = ref(false);

  // ---- machinery ---------------------------------------------------------
  const capture = createAudioCapture();
  const gate = createTurnGate(config.gate);
  const chunker = createSentenceChunker(config.chunker);
  const speech = createSpeechOut({ ...config.output, getToken }, { getToken });

  let timer = null;
  let speechMsDuringPlayback = 0;
  /** Transcript text carried across a reopen. */
  let carried = '';
  /** Turn id the current stream belongs to; guards late arrivals. */
  let streamTurn = 0;

  /**
   * THE ORDERING PROBLEM (recorded here because it shapes the whole design).
   *
   * The endpointer is semantic: it classifies the transcript to decide how long
   * a pause means "finished". But with batch transcription the transcript does
   * not exist until the recording STOPS, and the recording only stops once we
   * have endpointed. At the moment of the first decision there is, by
   * construction, no text to classify.
   *
   * So the first segment of a turn is timed on VAD alone (the NEUTRAL budget),
   * and the semantic thresholds apply from the continuation onward, where real
   * text exists. The reopen window is what makes that safe: a first-segment
   * endpoint is provisional, and speech resuming inside the window rejoins the
   * same turn. Streaming ASR would give partials early enough to classify from
   * the first word — that is the upgrade path, and `gate.sawSpeech` is the seam.
   */

  /**
   * The in-flight transcription for the segment just closed.
   *
   * Committing must WAIT for this. Whisper takes a few hundred milliseconds to
   * a second and a half; the reopen window is 600ms. Without this the timer
   * fires COMMIT_TURN while the transcript is still in flight, `gate.transcript`
   * is empty, and the turn is dropped on the floor with no error — which the
   * user experiences as "it randomly ignores me".
   */
  let pendingSegment = null;

  /**
   * Did a barge-in cancel a run that was already in flight?
   *
   * This CANNOT be derived from the gate's state at commit time. `runEffects`
   * applies the transition before executing its effects, so by the time
   * COMMIT_TURN runs the gate is already in THINKING — and `isInterruptible()`
   * reports true for a perfectly ordinary first turn. Using it here made every
   * normal utterance take the steer path, silently turning first questions into
   * mid-run corrections of a run that did not exist.
   *
   * The honest signal is the event itself: a barge-in emits CANCEL_REQUEST.
   */
  let interruptedRun = false;

  const now = () => Date.now();

  // ---- effects -----------------------------------------------------------

  async function runEffects(result) {
    state.value = result.state;

    for (const effect of result.effects) {
      switch (effect) {
        case Effect.START_CAPTURE:
          carried = '';
          partialTranscript.value = '';
          pendingSegment = null;
          // The speech burst that opened this capture has been consumed. Not
          // clearing it lets the SAME burst trigger a second barge-in on the
          // next tick — see speechMsDuringPlayback.
          speechMsDuringPlayback = 0;
          chunker.reset();
          speech.reset();
          capture.startRecording();
          break;

        case Effect.APPEND_CAPTURE:
          // The reopen path: keep what we already transcribed and record more
          // into the SAME turn.
          capture.startRecording();
          break;

        case Effect.STOP_CAPTURE:
          pendingSegment = finishSegment();
          await pendingSegment;
          break;

        case Effect.COMMIT_TURN:
          // Never commit ahead of the transcript for the segment just closed.
          await pendingSegment;
          commit();
          break;

        case Effect.CANCEL_PLAYBACK:
          cancelPlayback();
          break;

        case Effect.CANCEL_REQUEST:
          // The orchestrator run is left alone deliberately: AGNT can steer a
          // run mid-flight, so an interruption becomes a course correction
          // rather than a wasted turn.
          //
          // `streamTurn` is deliberately NOT updated here. It records which
          // turn owns the live stream; the gate has just incremented turnId, so
          // leaving it stale is precisely what makes the guard in
          // handleStreamEvent discard the superseded run's remaining deltas.
          // Assigning gate.turnId to it re-matched the two and let the
          // cancelled reply keep talking.
          interruptedRun = true;
          break;

        case Effect.SESSION_END:
          capture.stop();
          stopTimer();
          break;

        default:
          break;
      }
    }
  }

  function send(event) {
    return runEffects(gate.send({ ...event, now: now() }));
  }

  // ---- speech to text ----------------------------------------------------

  /**
   * Close the current recording and transcribe it, merging into the turn's
   * accumulated transcript so a reopen continuation appends rather than
   * replaces.
   */
  async function finishSegment() {
    const blob = await capture.stopRecording();
    if (!blob || blob.size < 1200) return; // sub-threshold audio: room noise

    isTranscribing.value = true;
    try {
      const form = new FormData();
      form.append('audio', blob, 'utterance.webm');
      const res = await fetch(`${API_CONFIG.BASE_URL}/speech/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      const text = (data?.transcript || '').trim();
      if (!text) return;

      carried = carried ? `${carried} ${text}` : text;
      partialTranscript.value = carried;
      gate.send({ type: 'transcript', now: now(), text: carried });
    } catch (err) {
      error.value = err?.message || 'Transcription failed';
    } finally {
      isTranscribing.value = false;
    }
  }

  // ---- committing a turn -------------------------------------------------

  function commit() {
    const text = (gate.transcript || carried).trim();
    carried = '';
    partialTranscript.value = '';
    if (!text) return;

    // A whole-utterance stop ends the session and is never sent to the model.
    // "stop the docker container" is not a stop phrase; see wakePhrase.js.
    if (isStopPhrase(text)) {
      stop();
      return;
    }

    const wake = detectWake(text, { agents: getAgents() });
    if (wake?.target === 'agent' && onWakeAgent) {
      const command = stripWakePhrase(text, wake);
      onWakeAgent({ agentId: wake.agentId, agentName: wake.agentName, text: command });
      return;
    }

    const clean = wake ? stripWakePhrase(text, wake) || text : text;
    const wasInterruption = interruptedRun;
    interruptedRun = false;
    streamTurn = gate.turnId;

    // Interrupting a live run steers it instead of starting a rival turn.
    // `spokenPrefix` is what the user ACTUALLY HEARD — not what was generated —
    // so "no, that's not what I meant" resolves against reality.
    if (onSteer && wasInterruption) {
      onSteer({ text: clean, spokenPrefix: speech.spokenPrefix() });
    } else {
      onCommit({ text: clean, voice: true });
    }
  }

  function cancelPlayback() {
    const heard = speech.cancel();
    capture.setDucked(false);
    return heard;
  }

  // ---- consuming the assistant stream ------------------------------------

  /**
   * Feed orchestrator SSE events in. The caller owns the connection; this only
   * needs to know what was said and when it ended.
   */
  function handleStreamEvent(eventName, data = {}) {
    if (!isActive.value) return;

    switch (eventName) {
      case 'content_delta': {
        if (gate.turnId !== streamTurn) return; // superseded by a barge-in
        const chunks = chunker.push(data.accumulated || '');
        if (chunks.length && state.value === VoiceState.THINKING) {
          send({ type: 'reply_start' });
          capture.setDucked(true);
        }
        for (const c of chunks) speech.speak(c);
        break;
      }

      case 'tool_pending':
      case 'tool_start':
        // The orb carries the working state; narrating every tool is noise.
        break;

      case 'done':
      case 'final_content': {
        if (gate.turnId !== streamTurn) return;
        for (const c of chunker.flush()) speech.speak(c);
        // Wait for the queue to drain before reopening the mic, otherwise the
        // tail of the reply is treated as the start of the next question.
        void speech.speak('').then(() => {
          if (gate.turnId !== streamTurn) return;
          capture.setDucked(false);
          send({ type: 'reply_end' });
        });
        break;
      }

      case 'error':
        error.value = data?.error || 'Stream error';
        capture.setDucked(false);
        send({ type: 'reply_end' });
        break;

      default:
        break;
    }
  }

  // ---- the clock ---------------------------------------------------------

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      calibrating.value = capture.isCalibrating;

      if (gate.state === VoiceState.LISTENING && !capture.isCalibrating) {
        const decision = shouldEndpoint(
          {
            transcript: partialTranscript.value || carried,
            silenceMs: capture.silenceMs,
            // VAD, not the transcript. Without this the first segment can never
            // endpoint, because endpointing is what produces the text the
            // endpointer wants to read. See THE ORDERING PROBLEM above.
            hasSpeech: gate.sawSpeech,
          },
          config.endpointer
        );
        if (decision.endpoint) send({ type: 'endpoint' });
      }

      send({ type: 'tick', speechMs: speechMsDuringPlayback });
    }, TICK_MS);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // ---- wiring ------------------------------------------------------------

  capture.on('speech_start', () => {
    speechMsDuringPlayback = 0;
    send({ type: 'speech_start' });
  });

  capture.on('speech_end', () => {
    speechMsDuringPlayback = 0;
    send({ type: 'speech_end' });
  });

  /**
   * Mirror the VAD's live state — including the silence.
   *
   * This used to be `if (f.speaking) speechMsDuringPlayback = f.speechMs`,
   * which only ever RAISED the value and never lowered it. After one barge-in
   * the stale figure still cleared the barge-in threshold, so the next tick in
   * THINKING fired another barge-in, which endpointed, committed, and returned
   * to THINKING — an unbreakable interruption loop in which the assistant could
   * never finish a reply again. A latched value that only ever grows is not a
   * measurement.
   */
  capture.on('frame', (f) => {
    speechMsDuringPlayback = f.speaking ? f.speechMs : 0;
  });

  capture.on('level', (v) => {
    level.value = v;
  });

  // ---- public control ----------------------------------------------------

  async function start() {
    error.value = null;
    const res = await capture.start();
    if (!res.ok) {
      error.value =
        res.error === 'NotAllowedError'
          ? 'Microphone permission denied'
          : res.message || 'Could not open the microphone';
      return false;
    }
    startTimer();
    await send({ type: 'start' });
    return true;
  }

  function stop() {
    speech.cancel();
    capture.setDucked(false);
    send({ type: 'stop' });
    stopTimer();
    capture.stop();
    partialTranscript.value = '';
    carried = '';
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
    // state
    state,
    isActive,
    isListening,
    isSpeaking,
    isThinking,
    isTranscribing,
    calibrating,
    partialTranscript,
    level,
    error,
    supported: isWebSpeechAvailable(),

    // control
    start,
    stop,
    toggle,
    handleStreamEvent,
    configureOutput: (patch) => speech.configure(patch),
    spokenPrefix: () => speech.spokenPrefix(),
  };
}

export default useVoiceSession;
