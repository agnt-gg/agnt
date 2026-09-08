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
  buildSpokenAside,
  buildAudioInputItem,
  buildUserTurnResponse,
  BridgeAction,
} from '../voice/realtimeBridge.js';
import { isFillerOnly, meaningfulTranscript } from '../voice/asrArtifacts.js';
import { MIC_CONSTRAINTS } from '../voice/micConstraints.js';
import { createPrerollBuffer } from '../voice/prerollBuffer.js';
import { createConnectTimeline } from '../voice/connectTimeline.js';
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

/** How many recent call_ids to remember for duplicate detection. */
const MAX_TRACKED_CALLS = 200;

/**
 * How long after going live we wait for the server VAD before concluding the
 * whole utterance happened inside the handshake window (see goLive). The VAD
 * reacts to live speech well inside a second, so silence for this long after
 * the pre-roll was injected means no live audio is coming and the turn must
 * be closed by us. Short enough that a recovered first sentence still feels
 * answered, long enough that the VAD is never raced on a user mid-breath.
 */
const STRANDED_TURN_MS = 1200;

/**
 * A session that is not live this long after the button was pressed has
 * failed, and is told so — it is never left on "Connecting…" for the user to
 * diagnose. Generous next to a healthy connect (well under two seconds
 * measured end to end) and long enough to outlast the server's own
 * per-route provider deadline with a route to spare.
 */
export const CONNECT_DEADLINE_MS = 20000;

/**
 * Exchanges per start(): the first, plus one retry when the failure was the
 * provider's (stalled, 5xx, unreachable) rather than the account's. One,
 * because a second identical failure a moment later is an outage, and an
 * outage is something to tell the user, not to keep hammering.
 */
export const CONNECT_ATTEMPTS = 2;

/** Pause before the retry, jittered up to double so retries do not align. */
export const RETRY_DELAY_MS = 1000;

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
    /**
     * Pre-roll factory, injectable for tests (jsdom has no AudioContext).
     * Production is the real ring over the live mic stream — the mechanism
     * that lets the recorder record the past on THIS transport too.
     */
    createPreroll = createPrerollBuffer,
  } = options;

  const state = ref(RealtimeState.IDLE);
  const isActive = computed(() => state.value !== RealtimeState.IDLE);
  const error = ref(null);
  const assistantPartial = ref('');
  /** True when the account has no OpenAI credit/credentials — caller falls back. */
  const unavailable = ref(false);
  /**
   * Which credential opened the live session, from the server's
   * X-Voice-Credential header: 'openai-codex' (the ChatGPT subscription) or
   * 'openai' (the metered platform key). The server prefers the subscription,
   * so 'openai' means it was refused or missing — a fact worth showing, since
   * the two are billed completely differently and look identical otherwise.
   */
  const credentialSource = ref(null);

  let pc = null;
  let dc = null;
  let micStream = null;
  let audioEl = null;
  /** The audio transceiver. Its sender carries NO track until goLive(). */
  let micTx = null;
  /** Ring recording the mic during the handshake. See prerollBuffer.js. */
  let preroll = null;
  /** Resolves {ok, stream|err} when getUserMedia settles; null under the test seam. */
  let micReady = null;
  /** goLive() acts once per session; READY re-fires on session.updated. */
  let wentLive = false;
  /** Closes a turn whose whole utterance predates the wire. See goLive(). */
  let strandedTimer = null;
  /** Handshake stopwatch — one structured timing line per connect attempt. */
  let timeline = null;
  /** Bumped on start() and stop(); async continuations check it before touching anything. */
  let generation = 0;
  /** Aborts the in-flight SDP exchange when the attempt is stopped. */
  let handshakeAbort = null;
  /** Fires if the session is not live CONNECT_DEADLINE_MS after start(). */
  let connectDeadline = null;
  /** 1-based attempt within the current start(), for the timing line. */
  let connectAttempt = 0;

  /**
   * THE SAFETY NET FOR TURNS THAT NEVER REACHED THE ORCHESTRATOR.
   *
   * By design every utterance goes through run_agnt, and that path writes both
   * sides to the chat itself — so echoing transcripts here would show every
   * exchange twice.
   *
   * The first version concluded from that it should record NOTHING. It was
   * wrong, because the session ALSO permitted the model to handle "greetings
   * and acknowledgements" itself. Those turns went through no orchestrator and
   * no chat: the user watched a conversation happen and leave no trace — gone
   * on reload, and absent from the history, so a later typed message had no
   * idea what had just been said aloud.
   *
   * The instructions now forbid answering anything at all (see
   * realtimeVoiceService.buildInstructions), which closes that hole at the
   * source. This buffer is the belt to that braces: if the model goes
   * off-script and answers by itself anyway, the turn is recorded rather than
   * vanishing. Transcripts are held until the response completes, because only
   * then do we know whether it delegated:
   *
   *   delegated            -> the run_agnt path writes it; drop the buffer
   *   speaking her answer  -> already in the chat verbatim; drop it
   *   neither              -> off-script turn; record it so it is not lost
   */
  let pendingUserText = '';
  let pendingAssistantText = '';

  /**
   * SPEAKING THE ANSWER AS IT ARRIVES, NOT AFTER IT LANDS.
   *
   * Waiting for the orchestrator to finish before speaking a single word means
   * the user hears nothing for as long as the turn takes — seconds on a plain
   * answer, a minute on a tool-heavy one. That silence is the difference
   * between a conversation and a form submission, and it is avoidable: the
   * answer arrives sentence by sentence, so it can be spoken sentence by
   * sentence.
   *
   * The first sentence ANSWERS the pending function call, which unblocks the
   * session and starts the voice immediately. Every later sentence is a
   * separate spoken item.
   *
   * SEQUENCING IS NOT OPTIONAL: the session allows one active response at a
   * time, so a second response.create while the first is still speaking is an
   * error. Chunks therefore queue and drain on response.done — which is also
   * exactly the pacing a person uses, one sentence finishing before the next
   * begins.
   */
  /**
   * call_ids already dispatched, so a repeated frame cannot re-run one.
   * Bounded by MAX_TRACKED_CALLS; cleared with the session.
   */
  const dispatchedCalls = new Set();

  /**
   * ONE USER UTTERANCE FUNDS AT MOST ONE ORCHESTRATOR RUN.
   *
   * The model mints call_ids, so call_id dedupe cannot stop it INVENTING a
   * second call for words it already delivered — which it does, because its
   * instructions demand every user utterance goes to run_agnt and the last
   * utterance is the only verbatim user text it holds. Echo, a breath, a VAD
   * retrigger after narration: any spurious response, and the same words came
   * back as a brand-new turn.
   *
   * The server's own VAD is ground truth for "the user actually spoke":
   * `input_audio_buffer.speech_started` precedes every real turn on an ordered
   * channel. So speech credits exactly one run, dispatch consumes it, and a
   * call arriving with no credit is by definition not the user talking — it is
   * answered (a swallowed call hangs the session) and NOT run. Capped at one
   * credit: transcription events must NOT credit (they arrive after dispatch
   * and would re-fund the very duplicate this exists to stop).
   */
  let utteranceCredit = 0;

  const speakQueue = [];
  /**
   * Bumped every time the user takes the floor — barge-in, or stopping the
   * session. Everything downstream of a spoken turn captures it and goes quiet
   * when it changes.
   *
   * WHY A COUNTER AND NOT JUST A FLAG: an interrupt has to invalidate work that
   * is ALREADY IN FLIGHT (a queued sentence, an orchestrator run mid-stream)
   * without those callers knowing anything about interrupts. Capturing the
   * epoch at the start and comparing on every continuation is the whole
   * mechanism.
   */
  let speechEpoch = 0;
  /** A response is in flight; nothing new may be created until it completes. */
  let responseActive = false;
  /**
   * We are mid-answer: everything being spoken came from the orchestrator and
   * is already in the chat. Distinguishes narration (do not record) from a
   * turn the model answered by itself (record, see below).
   */
  let narrating = false;
  /** The orchestrator run has returned; only queued chunks remain. */
  let runFinished = true;
  /**
   * Narration responses created but not yet finished speaking.
   *
   * An empty queue does NOT mean narration is over — it means the last sentence
   * has been SENT. Clearing `narrating` on queue-empty ended it one response
   * early, so the final sentence looked off-script and was written to the chat
   * a second time. Count what is in flight, not what is waiting.
   */
  let pendingNarrations = 0;

  function clearTurnBuffers() {
    pendingUserText = '';
    pendingAssistantText = '';
  }

  function clearStrandedTimer() {
    if (strandedTimer) {
      clearTimeout(strandedTimer);
      strandedTimer = null;
    }
  }

  /** Send the next queued sentence, if the session is free to speak. */
  function drainSpeakQueue() {
    if (responseActive || speakQueue.length === 0) return;
    responseActive = true;
    pendingNarrations += 1;
    send(buildSpokenAside(speakQueue.shift()));
  }

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

    /**
     * ONE CALL RUNS ONCE, WHATEVER THE WIRE DOES.
     *
     * `answered` below is a closure over a single invocation, so it stops one
     * call being answered twice — it cannot stop the same call being INVOKED
     * twice. When a cancelled response re-delivered its function_call, this
     * ran again with the same call_id and submitted the user's words as a
     * fresh turn, over and over.
     *
     * The bridge now refuses to dispatch a cancelled response's tool calls,
     * which fixes the known cause. This is the second, independent guard: a
     * call_id is a unique identity, so seeing one twice is always a repeat, no
     * matter which frame carried it.
     */
    if (dispatchedCalls.has(action.callId)) return;
    dispatchedCalls.add(action.callId);

    /**
     * NOISE IS NOT A TURN.
     *
     * `utteranceCredit` is granted by `input_audio_buffer.speech_started` — a
     * pure VAD event, fired before a single word has been transcribed. It
     * cannot tell "the user spoke" from "the room made a noise", because at the
     * moment it fires there is nothing to read. So the credit was granted by
     * acoustics and spent by semantics: a cough bought a turn, came back
     * transcribed as "um", and — because the model is correctly instructed to
     * forward EVERY utterance — arrived as a real request. Mid-run that landed
     * as a steer, interrupting work to deliver the word "um".
     *
     * This is the first point in the whole chain where WORDS exist: the tool's
     * `user_message` is a verbatim quote of what was heard. Checking here also
     * avoids depending on whether the separate input-transcription event has
     * arrived yet — an ordering this code does not control and must not assume.
     *
     * The credit is cleared as well. It was bought by a noise; leaving it
     * funded would let a later call spend it.
     */
    if (action.instruction && isFillerOnly(action.instruction)) {
      utteranceCredit = 0;
      send(
        buildFunctionOutput(
          action.callId,
          'That was background noise, not speech. Say nothing and keep listening.'
        )
      );
      return;
    }

    // A call with no unconsumed utterance behind it is the model freelancing,
    // not the user speaking. Answer it (never leave a call open) but do not
    // run it, do not speak, and stay listening.
    if (utteranceCredit === 0) {
      send(
        buildFunctionOutput(
          action.callId,
          'Duplicate call — that was already handled. Do not repeat it. Stay silent and wait for the user to speak.'
        )
      );
      return;
    }
    // Bounded: a long session must not accumulate ids for ever. Sets keep
    // insertion order, so the oldest is the first key.
    if (dispatchedCalls.size > MAX_TRACKED_CALLS) {
      dispatchedCalls.delete(dispatchedCalls.values().next().value);
    }

    const epoch = speechEpoch;

    /**
     * Answer the pending call. Exactly once, on every path — see the header.
     *
     * `speak: false` answers WITHOUT asking the model to say anything. That
     * combination exists for exactly one situation: the user interrupted while
     * this run was still working. The call must still be answered or the
     * session blocks on it for ever, but speaking the result now would be
     * reciting an answer to a question the user has already moved on from.
     */
    let answered = false;
    const answerCall = (text, { speak = true } = {}) => {
      if (answered) return;
      answered = true;
      send(buildFunctionOutput(action.callId, text));
      if (!speak) return;
      narrating = true;
      responseActive = true;
      pendingNarrations += 1;
      send(buildResponseCreate());
      state.value = RealtimeState.SPEAKING;
    };

    if (action.parseError || !action.instruction) {
      // Deliberately does NOT consume the credit: the utterance was never
      // run, so a well-formed retry for the same words is still legitimate.
      answerCall('I could not read that request. Ask the user to rephrase it.');
      return;
    }

    // The utterance is being run — spend its credit now, so no later call can
    // run these words again until the user actually speaks again.
    utteranceCredit = 0;

    state.value = RealtimeState.WORKING;
    runFinished = false;

    /**
     * Called by the host for each speakable sentence as the orchestrator
     * streams. The FIRST one answers the call — that is what makes the voice
     * start immediately instead of after the whole turn.
     */
    const emit = (text) => {
      // Stale epoch = the user has taken the floor since this run started.
      // Keep consuming the stream (the chat still wants it) but say nothing.
      if (gen !== generation || epoch !== speechEpoch) return;
      const clean = String(text || '').trim();
      if (!clean) return;
      if (!answered) {
        answerCall(clean);
        return;
      }
      speakQueue.push(clean);
      drainSpeakQueue();
    };

    let result;
    try {
      result = await Promise.race([
        onRunAgnt(action.instruction, emit),
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

    runFinished = true;
    if (gen !== generation) return; // session was stopped while AGNT worked

    // Interrupted mid-run: answer so the session is not blocked, but do not
    // speak — the user asked for something else while this was working.
    if (epoch !== speechEpoch) {
      answerCall('The user interrupted; this was not read out.', { speak: false });
      return;
    }

    // Nothing streamed — an empty answer, an error, or a timeout. The call has
    // to be answered anyway or the session blocks on it for ever.
    if (!answered) answerCall(result || 'AGNT returned nothing.');
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
          void goLive(gen);
          break;

        case BridgeAction.USER_INTERRUPTED:
          /**
           * INTERRUPT MEANS STOP TALKING — ALL OF IT.
           *
           * The server truncates the audio it is currently playing, and that
           * is all it knows about. Everything else waiting to be spoken lives
           * HERE: sentences already queued, and an orchestrator run still
           * streaming more. Left alone, the cancelled response's `response.done`
           * drains the queue and the old answer calmly resumes — which is
           * exactly what the user was interrupting to stop.
           *
           * So the epoch moves and the local pipeline is emptied. Anything
           * still in flight compares its captured epoch and goes quiet.
           */
          speechEpoch += 1;
          // The user is speaking: fund exactly one run for this utterance.
          utteranceCredit = 1;
          // The live VAD heard them — it owns the turn now, so a pre-roll
          // stranded closer would be a second opinion. See goLive().
          clearStrandedTimer();
          speakQueue.length = 0;
          pendingNarrations = 0;
          narrating = false;
          responseActive = false;
          // The interrupted turn is already in the chat; its buffered
          // transcript must not be recorded as an off-script turn.
          clearTurnBuffers();
          assistantPartial.value = '';
          if (state.value === RealtimeState.SPEAKING) state.value = RealtimeState.LISTENING;
          break;

        case BridgeAction.USER_SAID:
          // Buffered in case the model goes off-script and answers without
          // delegating, in which case the turn is written to the chat. A
          // filler-only transcript must not become a user message there
          // either — same rule, same reason, one function.
          pendingUserText = meaningfulTranscript(action.text);
          break;

        case BridgeAction.ASSISTANT_PARTIAL:
          assistantPartial.value += action.delta;
          if (state.value !== RealtimeState.WORKING) state.value = RealtimeState.SPEAKING;
          break;

        case BridgeAction.ASSISTANT_SAID:
          pendingAssistantText = action.text;
          assistantPartial.value = '';
          if (state.value === RealtimeState.SPEAKING) state.value = RealtimeState.LISTENING;
          break;

        case BridgeAction.TURN_COMPLETE:
          // Whatever was speaking has finished; the session can speak again.
          responseActive = false;

          if (action.hadToolCall) {
            // The run_agnt path writes this turn, and whatever the model
            // produced alongside the call is filler. Drop both; what follows
            // is narration of the orchestrator's answer.
            //
            // That filler used to be SPOKEN, and dropping it here is what made
            // it unrecorded: heard by the user, written nowhere. The session is
            // now text-only by default (realtimeVoiceService.buildSessionConfig),
            // so the model cannot voice it — it arrives as
            // `response.output_text.done` and is discarded silently. Dropping
            // something never heard costs nothing; dropping something heard was
            // the bug.
            narrating = true;
          } else if (narrating) {
            // A narration chunk. Her full answer is already in the chat
            // verbatim; echoing the spoken copy would duplicate it.
            //
            // Narration spans MANY responses now that the answer streams
            // sentence by sentence, so this stays true until the run has
            // returned, the queue is empty, AND everything sent has finished
            // speaking. Clearing it early makes the remaining sentences look
            // off-script and records them a second time.
            pendingNarrations = Math.max(0, pendingNarrations - 1);
            if (runFinished && speakQueue.length === 0 && pendingNarrations === 0) narrating = false;
          } else if (pendingUserText || pendingAssistantText) {
            // Off-script: the model answered without delegating, which its
            // instructions forbid. Record it rather than let the exchange
            // disappear — a visible wrong turn can be corrected, an invisible
            // one cannot.
            if (pendingUserText) onUserSaid(pendingUserText);
            if (pendingAssistantText) onAssistantSaid(pendingAssistantText);
          }

          clearTurnBuffers();
          drainSpeakQueue();
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

  /**
   * True only when the OS will open the mic without asking. jsdom and older
   * runtimes have no permissions API; treating that as "not granted" costs
   * one serial device-open — the safe direction to be wrong in.
   */
  async function micPermissionGranted() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * The moment the session is live: hand over the pre-roll, THEN attach the
   * live track, THEN say we are listening.
   *
   * ORDER IS THE FIX. RTP starts at replaceTrack and not a frame before, so
   * the ring covers exactly the audio the track never carried — one
   * continuous timeline with a single boundary, no gap and no overlap.
   * Attach-then-inject would race the server VAD against our own send and
   * could deliver the same syllables twice.
   */
  async function goLive(gen) {
    if (gen !== generation) return;
    if (wentLive) {
      // session.updated re-fires READY; going live is a once-per-session act.
      becomeListening();
      return;
    }
    wentLive = true;

    // Driven through the test seam (or a future transport) with no peer
    // connection: nothing to attach, the old behaviour stands.
    if (!micReady || !micTx) {
      becomeListening();
      return;
    }

    const mic = await micReady;
    if (gen !== generation) return;
    if (!mic.ok) {
      failSession(gen, 'mic', micErrorMessage(mic.err));
      return;
    }
    timeline?.mark('session_ready');

    let clip = null;
    try {
      clip = preroll ? preroll.harvest() : null;
    } catch {
      clip = null; // losing the pre-roll must not lose the session
    }
    if (clip?.hadSpeech && clip.base64) {
      send(buildAudioInputItem(clip.base64));
      timeline?.mark('preroll_sent');
      /**
       * If the sentence FINISHED before the wire was up, no live audio
       * follows, the server VAD never fires, and the injected item would sit
       * in the conversation unanswered forever. Close the turn ourselves —
       * but only when the ring's tail was silent: a tail still in speech
       * means the words continue onto the live track and the server VAD owns
       * the turn (speech_started also cancels this timer, belt to braces).
       */
      if (clip.endedInSilence) {
        strandedTimer = setTimeout(() => {
          strandedTimer = null;
          if (gen !== generation) return;
          // The user really did speak — our own VAD confirmed it in the ring
          // — so this funds one run, on exactly the grounds speech_started
          // grants credit for a live utterance.
          utteranceCredit = 1;
          send(buildUserTurnResponse());
        }, STRANDED_TURN_MS);
      }
    }

    try {
      await micTx.sender.replaceTrack(mic.stream.getAudioTracks()[0]);
    } catch {
      /* stop() raced us; the generation check below settles it */
    }
    if (gen !== generation) return;
    timeline?.mark('track_live');

    try {
      preroll?.close();
    } catch {
      /* already closed */
    }
    preroll = null;

    becomeListening();
    reportTimeline('connected');
  }

  /** The session is live: the connect deadline has been met and is disarmed. */
  function becomeListening() {
    clearConnectDeadline();
    if (state.value === RealtimeState.CONNECTING) state.value = RealtimeState.LISTENING;
  }

  /**
   * One line per connect ATTEMPT: console for this machine, POST for
   * error.log. A failed or abandoned attempt is reported with the last stage
   * it reached — those used to be the only connects that left no line at all,
   * which is why a stuck "Connecting…" could only be diagnosed from source.
   *
   * @param {'connected'|'failed'|'cancelled'} outcome
   */
  function reportTimeline(outcome) {
    if (!timeline) return;
    const total = timeline.totalMs();
    const line = timeline.summary();
    const marks = timeline.durations();
    const stage = marks.length ? marks[marks.length - 1].name : 'start';
    const attempt = connectAttempt;
    timeline = null;
    const text = `[voice] realtime connect ${outcome} (attempt ${attempt}, at ${stage}) ${total}ms: ${line}`;
    if (outcome === 'connected') console.info(text);
    else console.warn(text);
    try {
      fetch(`${API_CONFIG.BASE_URL}/speech/realtime/timing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ surface, totalMs: total, marks, outcome, stage, attempt }),
      }).catch(() => {});
    } catch {
      /* diagnostics must never break the session */
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  /**
   * End the CURRENT session with a message, from wherever the failure was
   * noticed — a transport that failed, a channel that closed, the deadline.
   *
   * Generation-guarded, so an attempt the user already stopped can never end
   * its replacement. That was the retry bug: stop() closed the old peer but
   * left its request in flight, and when that request failed a moment later
   * it called stop() on the NEW session. "Two or three tries before it goes
   * through" was this, not the network.
   */
  function failSession(gen, stage, message) {
    if (gen !== generation) return;
    error.value = message;
    timeline?.mark(stage);
    reportTimeline('failed');
    stop();
  }

  function armConnectDeadline(gen) {
    clearConnectDeadline();
    connectDeadline = setTimeout(() => {
      connectDeadline = null;
      if (gen !== generation || state.value !== RealtimeState.CONNECTING) return;
      failSession(gen, 'deadline', 'Voice took too long to connect — try again');
    }, CONNECT_DEADLINE_MS);
  }

  function clearConnectDeadline() {
    if (connectDeadline) clearTimeout(connectDeadline);
    connectDeadline = null;
  }

  const micErrorMessage = (err) =>
    err?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not open the microphone';

  /**
   * Tear down the peer connection of the current attempt — and nothing else.
   * The microphone and its pre-roll ring outlive a failed attempt on purpose:
   * a retry reuses them, so the words spoken during the first attempt are
   * still recovered by goLive() on the second.
   *
   * Each handle is detached BEFORE it is closed, so a listener firing
   * synchronously from close() finds it is no longer the live one and stands
   * down (see the identity checks in exchange()).
   */
  function closeTransport() {
    const abort = handshakeAbort;
    handshakeAbort = null;
    try {
      abort?.abort();
    } catch {
      /* already settled */
    }
    const channel = dc;
    dc = null;
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
    const peer = pc;
    pc = null;
    micTx = null;
    try {
      peer?.close();
    } catch {
      /* already closed */
    }
    const el = audioEl;
    audioEl = null;
    if (el) {
      try {
        el.pause();
        el.srcObject = null;
      } catch {
        /* already torn down */
      }
    }
  }

  /**
   * One SDP exchange: a fresh peer connection, offer, POST, answer. Resolves
   * to `{ ok: true }` once the remote description is set, or to a failure
   * that says whether it is worth ONE more try. Never touches `state`, never
   * calls stop() — start() owns that decision, because only it knows whether
   * there is a retry left.
   *
   * Every await is followed by a generation check, and every listener checks
   * that its handle is still the live one, so a stopped or superseded attempt
   * cannot act on anything.
   */
  async function exchange(gen) {
    const abort = new AbortController();
    handshakeAbort = abort;

    const peer = new RTCPeerConnection();
    pc = peer;
    peer.addEventListener('connectionstatechange', () => {
      if (peer !== pc || gen !== generation) return;
      const cs = peer.connectionState;
      if (cs === 'connected') timeline?.mark('ice_connected');
      // 'failed' is terminal; 'disconnected' can recover on its own and is
      // left alone; 'closed' is only ever ours, and ours is detached first.
      else if (cs === 'failed') failSession(gen, 'transport_failed', 'Voice connection failed');
    });

    // Model audio arrives as a remote track; an <audio> element plays it.
    const el = document.createElement('audio');
    el.autoplay = true;
    audioEl = el;
    peer.ontrack = (e) => {
      if (peer === pc) el.srcObject = e.streams[0];
    };

    /**
     * An m-line with NO track: the offer/answer completes without the
     * microphone, and — the actual first-word fix — audio starts flowing at
     * a moment WE choose (goLive's replaceTrack), after the pre-roll has
     * been handed over, not whenever DTLS happens to finish.
     */
    micTx = peer.addTransceiver('audio', { direction: 'sendrecv' });
    const channel = peer.createDataChannel('oai-events');
    dc = channel;
    channel.addEventListener('message', (e) => {
      if (channel === dc) handleMessage(e.data, gen);
    });
    // A channel that closes under a live session is a dead line; without
    // this it stayed "Listening…" with nobody on the other end.
    channel.addEventListener('close', () => {
      if (channel !== dc || gen !== generation) return;
      failSession(gen, 'channel_closed', 'Voice connection closed');
    });
    channel.addEventListener('error', () => {
      if (channel !== dc || gen !== generation) return;
      failSession(gen, 'channel_error', 'Voice connection failed');
    });

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (gen !== generation) return { ok: false, stopped: true };
      timeline?.mark('offer_ready');

      let res;
      try {
        res = await fetch(
          `${API_CONFIG.BASE_URL}/speech/realtime/call?voice=${encodeURIComponent(voice)}&surface=${encodeURIComponent(surface)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${getToken()}` },
            body: offer.sdp,
            signal: abort.signal,
          }
        );
      } catch {
        if (gen !== generation) return { ok: false, stopped: true };
        return { ok: false, retryable: true, reason: 'network', message: 'Could not reach the voice service' };
      }
      if (gen !== generation) return { ok: false, stopped: true };
      timeline?.mark('sdp_answered');

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
        if (reason === 'no-credentials') {
          return {
            ok: false,
            retryable: false,
            reason,
            message: 'Natural voice needs OpenAI credit on this account.',
          };
        }
        // A provider that stalled or fell over is transient and worth one
        // more try; a refused offer or a rejected account is not.
        const transient = res.status >= 500 || reason === 'network' || reason === 'timeout';
        return {
          ok: false,
          retryable: transient,
          reason,
          message: transient
            ? 'The voice service did not answer'
            : 'Could not start the natural voice session.',
        };
      }

      credentialSource.value = res.headers?.get?.('x-voice-credential') || null;
      if (credentialSource.value === 'openai') {
        console.warn('[voice] this session is billed to the OpenAI API key, not the ChatGPT subscription');
      }

      const answer = { type: 'answer', sdp: await res.text() };
      if (gen !== generation) return { ok: false, stopped: true };
      await peer.setRemoteDescription(answer);
      if (gen !== generation) return { ok: false, stopped: true };
      timeline?.mark('remote_set');
      return { ok: true };
    } catch {
      // createOffer / setLocalDescription / setRemoteDescription threw. These
      // sat OUTSIDE any handler before, so a rejected answer left the state
      // on CONNECTING forever with no message.
      if (gen !== generation) return { ok: false, stopped: true };
      return {
        ok: false,
        retryable: false,
        reason: 'handshake',
        message: 'Could not start the natural voice session.',
      };
    } finally {
      if (handshakeAbort === abort) handshakeAbort = null;
    }
  }

  /** A pause the user can cut short: stop() bumps the generation, the caller checks it. */
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function start() {
    if (isActive.value) return true;
    error.value = null;
    unavailable.value = false;
    credentialSource.value = null;
    state.value = RealtimeState.CONNECTING;
    const gen = ++generation;
    connectAttempt = 1;
    timeline = createConnectTimeline();
    /**
     * From here the session is either live or gone by CONNECT_DEADLINE_MS.
     * Before this existed nothing bounded "Connecting…": a handshake that
     * completed but never produced session.created — ICE that never joined, a
     * channel that never opened — sat in that state until the user gave up.
     */
    armConnectDeadline(gen);

    /**
     * THE MIC OPENS IN PARALLEL WITH THE HANDSHAKE, NOT BEFORE IT.
     *
     * getUserMedia is a cold device open — hundreds of milliseconds — and it
     * used to gate the offer serially. The SDP exchange does not need the
     * microphone (the m-line below is created with no track), so when
     * permission is already granted the two run concurrently and the slower
     * one sets the pace instead of the sum.
     *
     * When permission has NOT been granted, the OS prompt can block
     * getUserMedia indefinitely — racing that against a billed realtime
     * session would leave the session open, on the clock, while the user
     * reads a permission dialog. First-ever use stays serial.
     */
    const openMic = () =>
      navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then(
        (stream) => ({ ok: true, stream }),
        (err) => ({ ok: false, err })
      );

    let micPromise;
    if (await micPermissionGranted()) {
      micPromise = openMic();
    } else {
      const mic = await openMic();
      if (gen !== generation) return false;
      if (!mic.ok) {
        failSession(gen, 'mic', micErrorMessage(mic.err));
        return false;
      }
      micPromise = Promise.resolve(mic);
    }

    /**
     * The moment the mic exists it starts recording into the pre-roll ring.
     * The transceiver below carries NO track during the handshake, so this
     * ring is the only place words spoken before the session is live survive
     * — recovering them is goLive()'s first act.
     */
    micReady = micPromise.then((mic) => {
      if (mic.ok && gen === generation) {
        micStream = mic.stream;
        timeline?.mark('mic_open');
        try {
          preroll = createPreroll ? createPreroll(mic.stream) : null;
        } catch {
          preroll = null; // a start without pre-roll is degraded, not failed
        }
      } else if (mic.ok) {
        // stop() won the race; a stream nobody owns must not stay hot.
        try {
          mic.stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* best effort */
        }
      }
      return mic;
    });

    /**
     * The exchange, with ONE retry for a failure that is the provider's and
     * not the account's. The retry reuses the open microphone and its
     * pre-roll; only the peer connection is rebuilt. Anything that is not
     * transient — no credential, a refused offer, a denied mic — ends here on
     * the first answer, because trying again would only reach it more slowly.
     */
    let outcome;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      connectAttempt = attempt;
      outcome = await exchange(gen);
      if (outcome.stopped || gen !== generation) return false; // stop() already cleaned up
      if (outcome.ok) return true;

      timeline?.mark(outcome.reason);
      reportTimeline('failed');
      closeTransport();
      if (!outcome.retryable || attempt === CONNECT_ATTEMPTS) break;

      await pause(RETRY_DELAY_MS * (1 + Math.random()));
      if (gen !== generation) return false;
      timeline = createConnectTimeline();
    }

    unavailable.value = outcome.reason === 'no-credentials';
    error.value = outcome.message;
    stop();
    return false;
  }

  function stop() {
    generation += 1;
    // An attempt the user gave up on is reported as such — with the stage it
    // was stuck at, which is the one fact "it hung on Connecting" needs.
    if (timeline && state.value === RealtimeState.CONNECTING) reportTimeline('cancelled');
    timeline = null;
    clearConnectDeadline();
    closeTransport();
    try {
      micStream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    clearStrandedTimer();
    try {
      preroll?.close();
    } catch {
      /* already closed */
    }
    preroll = null;
    micReady = null;
    wentLive = false;
    micStream = null;
    assistantPartial.value = '';
    clearTurnBuffers();
    speakQueue.length = 0;
    dispatchedCalls.clear();
    utteranceCredit = 0;
    speechEpoch += 1;
    responseActive = false;
    narrating = false;
    runFinished = true;
    pendingNarrations = 0;
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
    credentialSource,
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
