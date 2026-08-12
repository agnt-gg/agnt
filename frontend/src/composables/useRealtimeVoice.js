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
  /** Handshake stopwatch — one structured timing line per connect. */
  let timeline = null;
  /** Bumped on stop(); async continuations check it before touching anything. */
  let generation = 0;

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
      if (state.value === RealtimeState.CONNECTING) state.value = RealtimeState.LISTENING;
      return;
    }
    wentLive = true;

    // Driven through the test seam (or a future transport) with no peer
    // connection: nothing to attach, the old behaviour stands.
    if (!micReady || !micTx) {
      if (state.value === RealtimeState.CONNECTING) state.value = RealtimeState.LISTENING;
      return;
    }

    const mic = await micReady;
    if (gen !== generation) return;
    if (!mic.ok) {
      error.value =
        mic.err?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not open the microphone';
      stop();
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

    if (state.value === RealtimeState.CONNECTING) state.value = RealtimeState.LISTENING;
    reportTimeline();
  }

  /** One line per connect: console for this machine, POST for error.log. */
  function reportTimeline() {
    if (!timeline) return;
    const total = timeline.totalMs();
    const line = timeline.summary();
    const marks = timeline.durations();
    timeline = null;
    console.info(`[voice] realtime connect ${total}ms: ${line}`);
    try {
      fetch(`${API_CONFIG.BASE_URL}/speech/realtime/timing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ surface, totalMs: total, marks }),
      }).catch(() => {});
    } catch {
      /* diagnostics must never break the session */
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  async function start() {
    if (isActive.value) return true;
    error.value = null;
    unavailable.value = false;
    state.value = RealtimeState.CONNECTING;
    const gen = ++generation;
    timeline = createConnectTimeline();

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
      if (!mic.ok) {
        error.value =
          mic.err?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not open the microphone';
        state.value = RealtimeState.IDLE;
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

    pc = new RTCPeerConnection();
    pc.addEventListener('connectionstatechange', () => {
      if (pc?.connectionState === 'connected') timeline?.mark('ice_connected');
    });

    // Model audio arrives as a remote track; an <audio> element plays it.
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    /**
     * An m-line with NO track: the offer/answer completes without the
     * microphone, and — the actual first-word fix — audio starts flowing at
     * a moment WE choose (goLive's replaceTrack), after the pre-roll has
     * been handed over, not whenever DTLS happens to finish.
     */
    micTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    dc = pc.createDataChannel('oai-events');
    dc.addEventListener('message', (e) => handleMessage(e.data, gen));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    timeline.mark('offer_ready');

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
    timeline?.mark('remote_set');

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
    clearStrandedTimer();
    try {
      preroll?.close();
    } catch {
      /* already closed */
    }
    preroll = null;
    micReady = null;
    micTx = null;
    wentLive = false;
    timeline = null;
    dc = null;
    pc = null;
    micStream = null;
    audioEl = null;
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
