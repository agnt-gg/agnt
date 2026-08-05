/**
 * useVoiceEngines — the whole voice feature, for any chat surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Voice was built on BaseScreen (the main chat) and the other composers lagged
 * behind it, over and over:
 *
 *   - the voice button was invisible on every panel chat (wrong slot)
 *   - the legacy dictation mic survived on surfaces the sweep missed
 *   - the realtime session did not inherit the conversation-switch guard
 *   - natural voice and the two-register answer never reached the panels at
 *     all, so the workspace chat was still speaking through Windows SAPI
 *
 * Every one of those was the same shape: logic that lives INSIDE one host
 * component cannot be shared, so a second host gets a partial copy and then
 * drifts. Four rounds of that is enough evidence.
 *
 * So the feature lives here and the hosts supply only what genuinely differs
 * between them — how to send, what is streaming, and when the conversation
 * changed. Everything else (engine selection, the run_agnt bridge, the
 * two-register split, the cascade's stream bridging, the view bindings) is
 * written once.
 *
 * WHAT A HOST MUST PROVIDE
 * ------------------------
 *   submit(text)        send `text` as a user turn on this surface
 *   streamingAnswer()   the assistant text currently streaming, or ''
 *   isStreaming         Ref<boolean>, true while a turn is in flight
 *   epoch               Ref<number>, bumped ONLY when the user genuinely
 *                       navigates to a different conversation
 *   steer(text)         OPTIONAL. How to interrupt a turn already in flight,
 *                       for surfaces where a plain submit would be dropped.
 *
 * The three stores disagree on all four: the main chat has
 * `store.state.chat.messages` and a `triggerSubmit()`, the panels have
 * `getters['chatUnified/getFormattedMessages'](channelKey)` and a
 * `sendMessage` dispatch, the agent tab has its own `sendChatMessage`. Those
 * differences are the adapters; nothing else is.
 *
 * WHY `epoch` AND NOT A CONVERSATION ID
 * -------------------------------------
 * A conversation id changes for two entirely different reasons: the user
 * navigating away, and the backend assigning a permanent id to the
 * conversation they are already in (on the first send). Comparing ids cannot
 * tell those apart, and treating the second as a switch aborted the run and
 * made the voice say "AGNT returned nothing" over the first message of every
 * new chat. An epoch is incremented only by real navigation, so it cannot be
 * fooled by a rename.
 */

import { computed, watch } from 'vue';
import { useVoiceSession } from './useVoiceSession.js';
import { useRealtimeVoice } from './useRealtimeVoice.js';
import { createSentenceChunker } from '../voice/sentenceChunker.js';
import { spokenRegister } from '../voice/voiceReplyPolicy.js';
import { armVoiceTurn } from '../services/voiceTurn.js';

/**
 * The realtime engine's states, expressed in the cascade's vocabulary so a
 * host's status strip and button tints work unchanged whichever engine is
 * running.
 */
const REALTIME_STATE_AS_CASCADE = Object.freeze({
  connecting: 'thinking',
  working: 'thinking',
  listening: 'listening',
  speaking: 'speaking',
});

export function useVoiceEngines(options = {}) {
  const {
    surface = 'chat',
    submit,
    streamingAnswer,
    isStreaming,
    epoch,
    getAgents = () => [],
    steer = null,
  } = options;

  if (typeof submit !== 'function' || typeof streamingAnswer !== 'function') {
    throw new Error('useVoiceEngines: submit and streamingAnswer are required');
  }

  const currentEpoch = () => (epoch && typeof epoch.value === 'number' ? epoch.value : 0);

  // ---- the cascade engine (VAD -> Whisper -> orchestrator -> TTS) --------
  //
  // Kept as the fallback for accounts without OpenAI credit. No onSteer
  // handler on purpose: a submit during a live turn is ALREADY a mid-run steer
  // on these surfaces, so routing voice through the same submit makes an
  // interruption take the exact path the keyboard takes, rather than a second
  // implementation that can drift from it.
  //
  // `steer` is optional because the surfaces genuinely differ: the main chat
  // turns a submit during a live turn into a steer by itself, while the panel
  // store drops a send while one is streaming, so it needs an explicit
  // interruption path. Only the cascade uses it — the realtime engine's
  // barge-in is handled server-side, and its turns go through run_agnt.
  const cascade = useVoiceSession({
    onCommit: ({ text }) => submit(text),
    onSteer: steer ? ({ text }) => steer(text) : null,
    getAgents,
  });

  // Bridge the assistant stream into the cascade. Watching the store's
  // rendered message rather than tapping SSE keeps ONE decoder for every
  // surface — a second subscriber is a second place for the protocol to rot.
  watch(
    () => (cascade.isActive.value ? streamingAnswer() : null),
    (content) => {
      if (content === null) return;
      cascade.handleStreamEvent('content_delta', { accumulated: content });
    }
  );

  watch(isStreaming, (streaming, was) => {
    if (was && !streaming && cascade.isActive.value) cascade.handleStreamEvent('done', {});
  });

  // ---- the run_agnt bridge ----------------------------------------------

  /**
   * Run what the user said through the orchestrator, speaking the answer
   * SENTENCE BY SENTENCE as it arrives.
   *
   * WHY NOT WAIT FOR THE WHOLE TURN — resolving on the falling edge of
   * isStreaming means nothing is spoken until every tool round has finished:
   * seconds on a plain answer, a minute on a tool-heavy one, and the user
   * hears silence throughout. The answer arrives progressively, so it is
   * spoken progressively; the first sentence answers the pending call and
   * starts the voice immediately.
   *
   * TWO REGISTERS, NOT A SUMMARY — only the answer's OPENING PARAGRAPH is
   * spoken. The turn is marked as spoken before it is submitted and the
   * backend asks for the answer in that shape, so the split is AUTHORED rather
   * than derived: the writer knows the shape of the answer before writing a
   * word of it, which no downstream summariser reading a stream ever can. The
   * spoken text stays a literal prefix of the written text, so the voice and
   * the screen cannot contradict each other.
   *
   * WHY THE CHUNKER — the model speaks what it is handed verbatim, which is
   * only survivable if the text is speakable. sentenceChunker is the tested
   * definition of both "where does a sentence end" (it will not split
   * `v2.17.2`) and "what must never be read aloud" (fenced code and tables
   * become a short spoken note). Re-deriving either rule here would let two
   * definitions drift apart.
   */
  const runAgntForVoice = (userMessage, emit) =>
    new Promise((resolve) => {
      const epochAtStart = currentEpoch();
      const chunker = createSentenceChunker();
      let spokeSomething = false;

      const speak = (chunks) => {
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          spokeSomething = true;
          emit(chunk);
        }
      };

      // Arm BEFORE submitting: the store consumes this on the very next send,
      // matched by text, so only this turn is marked as spoken.
      armVoiceTurn(userMessage);
      submit(userMessage);

      const stopContent = watch(streamingAnswer, (raw) => {
        if (currentEpoch() !== epochAtStart) return;
        // Only the spoken register. Once the blank line arrives this stops
        // growing, so the chunker naturally falls silent for the detail.
        speak(chunker.push(spokenRegister(raw)));
      });

      const stopStream = watch(isStreaming, (streaming, was) => {
        if (!(was && !streaming)) return;
        // Both watchers are torn down BEFORE resolving: one left alive fires
        // on every later turn and resolves stale promises, which would have
        // the model speak an answer to a different question.
        stopContent();
        stopStream();

        if (currentEpoch() !== epochAtStart) {
          resolve(''); // switched away; the session is being stopped anyway
          return;
        }

        speak(chunker.flush());
        // The return value only answers the call when NOTHING streamed —
        // otherwise the first emitted sentence already did.
        resolve(spokeSomething ? '' : 'I have put the answer in the chat.');
      });
    });

  // ---- the natural engine (speech-to-speech, orchestrator behind it) -----
  //
  // Transcripts of turns that went through run_agnt are NOT written to the
  // chat here — runAgntForVoice already put both sides there via the normal
  // send path. The composable only records a turn the model answered entirely
  // on its own, which its instructions forbid; see useRealtimeVoice.js.
  const realtime = useRealtimeVoice({
    surface,
    onRunAgnt: runAgntForVoice,
  });

  // ---- one button, best available engine --------------------------------

  /**
   * Natural voice needs OpenAI credit. When it is not available the session
   * refuses cleanly (`unavailable`) and we fall through to the cascade rather
   * than showing an error for something the user cannot act on mid-sentence.
   */
  const toggleVoice = async () => {
    if (realtime.isActive.value) return realtime.stop();
    if (cascade.isActive.value) return cascade.stop();

    if (realtime.isSupported) {
      const ok = await realtime.start();
      if (ok) return true;
      if (!realtime.unavailable.value) return false; // a real failure, already surfaced
    }
    return cascade.toggle();
  };

  /** End every live session. Call this when the conversation changes. */
  const stopVoice = () => {
    if (cascade.isActive.value) cascade.stop();
    if (realtime.isActive.value) realtime.stop();
  };

  // A conversation switch ends any live session: the mic belongs to the
  // conversation it was opened in, and a session that outlives it keeps
  // committing into whichever chat is now on screen.
  if (epoch) watch(epoch, stopVoice);

  // ---- one set of view bindings, whichever engine is running -------------

  const voiceActive = computed(() => realtime.isActive.value || cascade.isActive.value);
  const voiceState = computed(() => {
    if (!realtime.isActive.value) return cascade.state.value;
    return REALTIME_STATE_AS_CASCADE[realtime.state.value] || 'listening';
  });
  const voicePartial = computed(() =>
    realtime.isActive.value ? realtime.assistantPartial.value : cascade.partialTranscript.value
  );
  const voiceError = computed(() =>
    realtime.isActive.value ? realtime.error.value : cascade.error.value
  );
  /** True when the speech-to-speech engine is the one running. */
  const voiceNatural = computed(() => realtime.isActive.value);

  return {
    voiceActive,
    voiceState,
    voicePartial,
    voiceError,
    voiceNatural,
    voiceLevel: cascade.level,
    toggleVoice,
    stopVoice,
    isSupported: cascade.isSupported || realtime.isSupported,
  };
}

export default useVoiceEngines;
