/**
 * turnGate — the conversation state machine for voice.
 *
 * This is where "menus with a voice attached" becomes a conversation. Two
 * mechanisms do almost all of that work, and both live here.
 *
 * 1. THE REOPEN WINDOW
 * --------------------
 * Every other assistant COMMITS on the first endpoint: silence detected, turn
 * closed, request sent. That is why you cannot correct yourself. You say
 *
 *     "open the auth file"  ...  "no wait, the session one"
 *
 * and the first half is already gone — it opened the wrong file and your
 * correction arrives as a second, contextless turn.
 *
 * So we do not commit on endpoint. We enter REOPEN and hold for a few hundred
 * ms. Speech resuming inside that window APPENDS to the same turn instead of
 * starting a new one. The user gets to think out loud, trail off, restart, and
 * change direction — and the model sees one coherent utterance. This single
 * behaviour is what makes voice feel like talking to someone who is listening
 * rather than a form that is validating.
 *
 * It also makes the endpointer's job forgiving: a too-eager endpoint costs a
 * few hundred ms of held audio, not a destroyed thought.
 *
 * 2. BARGE-IN WITH SPOKEN-PREFIX TRUTH
 * ------------------------------------
 * The mic stays hot while we speak. When the user cuts in, we cancel playback —
 * and we must record WHAT THEY ACTUALLY HEARD, not what we generated. The model
 * may have produced four sentences; the speaker was 1.3s into sentence two.
 * If we hand the model the full four, then "no, that's not what I meant"
 * refers to text the user never heard, and the assistant defends a sentence
 * that was never spoken. Every assistant that feels deaf gets this wrong.
 *
 * `spokenPrefix` (supplied by the playback queue's playhead) is therefore a
 * first-class field on the committed turn.
 *
 * DESIGN
 * ------
 * A pure reducer: (state, event) → { state, effects[] }. No timers, no audio,
 * no network. The host loop owns the clock and passes `now`. Effects are
 * declarative intents ('start_capture', 'cancel_playback', 'commit_turn'...)
 * that the host executes. That keeps every transition — including the
 * concurrent ones that are impossible to reproduce by hand — testable.
 */

export const VoiceState = Object.freeze({
  /** Not listening at all. Mic may be closed or feeding only the wake detector. */
  IDLE: 'idle',
  /** Armed, waiting for the wake phrase. Audio is analysed but never sent. */
  WAKE_WAIT: 'wake_wait',
  /** Capturing an utterance. */
  LISTENING: 'listening',
  /** Endpoint fired; holding briefly in case the speaker resumes. */
  REOPEN: 'reopen',
  /** Turn committed and in flight. Mic stays hot. */
  THINKING: 'thinking',
  /** Reply audio playing. Mic stays hot. */
  SPEAKING: 'speaking',
});

export const Effect = Object.freeze({
  START_CAPTURE: 'start_capture',
  APPEND_CAPTURE: 'append_capture',
  STOP_CAPTURE: 'stop_capture',
  COMMIT_TURN: 'commit_turn',
  CANCEL_PLAYBACK: 'cancel_playback',
  CANCEL_REQUEST: 'cancel_request',
  ARM_WAKE: 'arm_wake',
  DISARM_WAKE: 'disarm_wake',
  SESSION_END: 'session_end',
});

export const DEFAULT_GATE_CONFIG = Object.freeze({
  /** How long a committed-looking turn stays reopenable. The core number. */
  reopenMs: 600,
  /** Ignore barge-in for this long after playback starts, so the tail of our
   *  own first word (or an AEC miss) cannot self-interrupt. */
  bargeInGraceMs: 250,
  /** Require this much speech before treating it as a real barge-in rather
   *  than a cough or a door. */
  bargeInMinSpeechMs: 120,
  /**
   * End the session after this long with no speech at all. 0 = never.
   *
   * DEFAULT IS 0 — an explicitly-opened session stays open until the user
   * closes it. It was 45s, which meant thinking quietly for three quarters of
   * a minute silently killed the session: you look up to say the thing you
   * were working out and the mic is gone. "It stopped listening" is the exact
   * failure this whole design exists to avoid, and a timeout that fires while
   * the user is still present is that failure with a timer attached.
   *
   * The safeguard against a forgotten hot mic is VISIBILITY, not a timer: the
   * button is tinted, the status strip reads "Listening…", and End is one
   * click. A wake-word session is the case that genuinely wants auto-sleep
   * (nobody opened it deliberately, so nobody knows to close it) — that config
   * should set this explicitly.
   */
  idleTimeoutMs: 0,
  /** When true, a completed reply returns to LISTENING (continuous
   *  conversation). When false, one exchange per wake — the Hermes model. */
  continuous: true,
  /** When true, the session begins in WAKE_WAIT rather than LISTENING. */
  wakeWord: false,
});

const nowOr = (v) => (Number.isFinite(v) ? v : 0);

/**
 * @param {Partial<typeof DEFAULT_GATE_CONFIG>} [config]
 */
export function createTurnGate(config = {}) {
  const cfg = { ...DEFAULT_GATE_CONFIG, ...config };

  let state = VoiceState.IDLE;
  /** Accumulated transcript for the CURRENT turn — survives reopen. */
  let transcript = '';
  /** Timestamp the reopen window opened. */
  let reopenAt = 0;
  /** Timestamp playback began, for the barge-in grace period. */
  let speakingAt = 0;
  /** Continuous speech duration observed during playback. */
  let bargeSpeechMs = 0;
  /** Last time any speech was observed, for the idle timeout. */
  let lastSpeechAt = 0;
  /** Monotonic turn counter — lets the host discard results from a turn that
   *  was superseded by a barge-in. */
  let turnId = 0;

  /**
   * Has the VAD heard any speech at all this turn?
   *
   * This is what distinguishes a real turn from room noise. The obvious guard —
   * "refuse to endpoint on an empty transcript" — is only correct with STREAMING
   * recognition, where text exists while the user is still talking. With batch
   * transcription the transcript is EMPTY at endpoint time by construction: the
   * recording has to stop before there is anything to transcribe, and stopping
   * is what endpointing triggers. That guard therefore refuses every turn, and
   * the assistant listens forever without ever answering.
   *
   * Asking "did anyone actually speak?" is the question the guard meant to ask,
   * and it is answerable from the VAD alone at the moment we need it.
   */
  let sawSpeech = false;

  /**
   * A no-op result. `effects` MUST be present and MUST be an array: callers
   * write `result.effects.includes(...)`, and an event that happens not to
   * cause a transition is the common case, not the rare one. Returning a
   * different shape from the no-op path than from the transition path is how
   * you ship a TypeError that only fires on a cough.
   */
  function snapshot() {
    return { state, effects: [], transcript, turnId };
  }

  function transition(next, effects = []) {
    state = next;
    return { state, effects, transcript, turnId };
  }

  /**
   * @param {object} event
   *   { type:'start'|'stop'|'wake'|'speech_start'|'speech_end'|'transcript'|
   *           'endpoint'|'tick'|'reply_start'|'reply_end'|'request_done'|'abort',
   *     now:number, text?:string, spokenPrefix?:string, speechMs?:number }
   */
  function send(event = {}) {
    const now = nowOr(event.now);
    const type = event.type;

    switch (type) {
      // ---- session control -------------------------------------------------
      case 'start': {
        turnId += 1;
        transcript = '';
        sawSpeech = false;
        lastSpeechAt = now;
        if (cfg.wakeWord) return transition(VoiceState.WAKE_WAIT, [Effect.ARM_WAKE]);
        return transition(VoiceState.LISTENING, [Effect.START_CAPTURE]);
      }

      case 'stop': {
        transcript = '';
        const effects = [Effect.STOP_CAPTURE, Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.DISARM_WAKE, Effect.SESSION_END];
        return transition(VoiceState.IDLE, effects);
      }

      case 'abort': {
        // Cancel whatever is in flight but stay in the session. This starts a
        // NEW turn, so the speech flag resets with it — leaving it latched let
        // the OLD turn's speech re-endpoint the ensuing silence immediately,
        // and the machine looped listening→reopen→commit(empty)→abort forever.
        transcript = '';
        sawSpeech = false;
        turnId += 1;
        if (!cfg.continuous) return transition(VoiceState.IDLE, [Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.SESSION_END]);
        if (cfg.wakeWord) return transition(VoiceState.WAKE_WAIT, [Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.ARM_WAKE]);
        return transition(VoiceState.LISTENING, [Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.START_CAPTURE]);
      }

      case 'wake': {
        if (state !== VoiceState.WAKE_WAIT) return snapshot();
        turnId += 1;
        transcript = '';
        sawSpeech = false;
        lastSpeechAt = now;
        return transition(VoiceState.LISTENING, [Effect.DISARM_WAKE, Effect.START_CAPTURE]);
      }

      // ---- speech edges ----------------------------------------------------
      case 'speech_start': {
        lastSpeechAt = now;
        if (state === VoiceState.LISTENING || state === VoiceState.REOPEN) sawSpeech = true;

        // THE REOPEN. Speech inside the window rejoins the turn in progress
        // rather than starting a new one — this is what lets a user correct
        // themselves without the first half being committed and acted on.
        if (state === VoiceState.REOPEN) {
          return transition(VoiceState.LISTENING, [Effect.APPEND_CAPTURE]);
        }

        // Barge-in: the user is talking over the reply.
        if (state === VoiceState.SPEAKING) {
          bargeSpeechMs = 0;
          if (now - speakingAt < cfg.bargeInGraceMs) return snapshot();
          return snapshot(); // wait for enough speech; see 'tick'
        }

        // Talking over a request that has not produced audio yet still cancels
        // it — the user has moved on, and a reply to a superseded turn is noise.
        if (state === VoiceState.THINKING) {
          bargeSpeechMs = 0;
          return snapshot();
        }

        return snapshot();
      }

      case 'speech_end': {
        lastSpeechAt = now;
        return snapshot();
      }

      case 'transcript': {
        if (typeof event.text === 'string') {
          // The host supplies the full accumulated text for the turn; a reopen
          // continuation is concatenated by the host before it gets here.
          transcript = event.text;
        }
        if (event.text) lastSpeechAt = now;
        return snapshot();
      }

      // ---- the endpoint / reopen dance -------------------------------------
      case 'endpoint': {
        if (state !== VoiceState.LISTENING) return snapshot();
        // Room noise, not a turn. Keyed on speech HEARD rather than text
        // RECEIVED — see sawSpeech.
        if (!sawSpeech && !transcript.trim()) return snapshot();
        reopenAt = now;
        return transition(VoiceState.REOPEN, [Effect.STOP_CAPTURE]);
      }

      case 'tick': {
        // Reopen window expiry → the turn is genuinely over. Commit.
        if (state === VoiceState.REOPEN) {
          if (now - reopenAt >= cfg.reopenMs) {
            return transition(VoiceState.THINKING, [Effect.COMMIT_TURN]);
          }
          return snapshot();
        }

        // Sustained speech during playback → barge-in.
        if (state === VoiceState.SPEAKING) {
          const speechMs = nowOr(event.speechMs);
          bargeSpeechMs = speechMs;
          const graceOver = now - speakingAt >= cfg.bargeInGraceMs;
          if (graceOver && speechMs >= cfg.bargeInMinSpeechMs) {
            turnId += 1;
            transcript = '';
            sawSpeech = true; // the barge-in itself is the speech
            lastSpeechAt = now;
            return transition(VoiceState.LISTENING, [
              Effect.CANCEL_PLAYBACK,
              Effect.CANCEL_REQUEST,
              Effect.START_CAPTURE,
            ]);
          }
          return snapshot();
        }

        // Same during THINKING — no audio yet, but the user has moved on.
        if (state === VoiceState.THINKING) {
          const speechMs = nowOr(event.speechMs);
          if (speechMs >= cfg.bargeInMinSpeechMs) {
            turnId += 1;
            transcript = '';
            sawSpeech = true; // the barge-in itself is the speech
            lastSpeechAt = now;
            return transition(VoiceState.LISTENING, [Effect.CANCEL_REQUEST, Effect.START_CAPTURE]);
          }
          return snapshot();
        }

        // Idle timeout closes a hands-free session that has been abandoned.
        if (cfg.idleTimeoutMs > 0 && (state === VoiceState.LISTENING || state === VoiceState.WAKE_WAIT)) {
          if (now - lastSpeechAt >= cfg.idleTimeoutMs) {
            transcript = '';
            return transition(VoiceState.IDLE, [Effect.STOP_CAPTURE, Effect.DISARM_WAKE, Effect.SESSION_END]);
          }
        }

        return snapshot();
      }

      // ---- reply lifecycle -------------------------------------------------
      case 'reply_start': {
        if (state !== VoiceState.THINKING) return snapshot();
        speakingAt = now;
        bargeSpeechMs = 0;
        return transition(VoiceState.SPEAKING, []);
      }

      case 'reply_end':
      case 'request_done': {
        if (state !== VoiceState.SPEAKING && state !== VoiceState.THINKING) return snapshot();
        transcript = '';
        sawSpeech = false;
        turnId += 1;
        if (!cfg.continuous) {
          if (cfg.wakeWord) return transition(VoiceState.WAKE_WAIT, [Effect.ARM_WAKE]);
          return transition(VoiceState.IDLE, [Effect.SESSION_END]);
        }
        lastSpeechAt = now;
        return transition(VoiceState.LISTENING, [Effect.START_CAPTURE]);
      }

      default:
        return snapshot();
    }
  }

  return {
    send,
    get state() {
      return state;
    },
    get transcript() {
      return transcript;
    },
    get turnId() {
      return turnId;
    },
    /** Whether any speech has been heard in the current turn. */
    get sawSpeech() {
      return sawSpeech;
    },
    get config() {
      return cfg;
    },
    /** True when a barge-in should be shaped as a steer rather than a new turn. */
    isInterruptible() {
      return state === VoiceState.THINKING || state === VoiceState.SPEAKING;
    },
  };
}

export default { VoiceState, Effect, createTurnGate, DEFAULT_GATE_CONFIG };
