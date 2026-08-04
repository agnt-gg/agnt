/**
 * realtimeBridge — the pure half of speech-to-speech voice.
 *
 * The realtime model talks to us over a WebRTC data channel in JSON events.
 * This module turns that event stream into INTENTIONS — "run this instruction
 * through AGNT", "the user said X", "the assistant said Y" — without touching
 * WebRTC, the network, or the DOM. That separation is the whole reason this
 * file exists: the interesting logic (which events matter, how a tool call is
 * assembled and answered, what counts as a turn) is then testable by feeding it
 * recorded event objects, and the runtime around it stays thin enough to read.
 *
 * WHAT THE MODEL IS ALLOWED TO DO
 * -------------------------------
 * Exactly one tool: `run_agnt`. The session instructions (authored server-side,
 * in realtimeVoiceService.js) forbid it from answering anything itself. So the
 * only tool call this bridge ever expects is run_agnt, and anything else is a
 * misconfiguration worth surfacing rather than silently ignoring.
 *
 * THE EVENT SHAPES, AS OF THE GA INTERFACE
 * ----------------------------------------
 *   response.done                      final result; output[] may hold a
 *                                      function_call with name/call_id/arguments
 *   response.output_audio_transcript.delta   what the assistant is SAYING, live
 *   conversation.item.input_audio_transcription.completed   what the USER said
 *   input_audio_buffer.speech_started  user started talking (barge-in)
 *   error                              session-level failure
 *
 * Audio never appears here. Over WebRTC the peer connection carries it directly
 * to an <audio> element, which is why this design has no playback queue, no
 * chunker and no spoken-prefix bookkeeping — the transport does all of it, and
 * the server truncates its own unplayed audio on interruption.
 */

/** Actions the runtime should perform. Declarative on purpose — see header. */
export const BridgeAction = Object.freeze({
  /** Run an instruction through the AGNT orchestrator and return the result. */
  RUN_AGNT: 'run_agnt',
  /** The user's speech, transcribed — for the chat transcript. */
  USER_SAID: 'user_said',
  /** The assistant's speech, transcribed — for the chat transcript. */
  ASSISTANT_SAID: 'assistant_said',
  /** Live partial of what the assistant is currently saying. */
  ASSISTANT_PARTIAL: 'assistant_partial',
  /** The user began speaking (barge-in; the server truncates its own audio). */
  USER_INTERRUPTED: 'user_interrupted',
  /** Session-level error worth showing. */
  ERROR: 'error',
  /** The session is live and configured. */
  READY: 'ready',
  /**
   * A model response finished. `hadToolCall` says whether it delegated to
   * AGNT, which is what lets the runtime decide whether this turn is ALREADY
   * recorded in the chat (the run_agnt path writes it) or whether it happened
   * purely in audio and would otherwise leave no trace at all.
   */
  TURN_COMPLETE: 'turn_complete',
});

/** The only tool the session declares. Kept in sync with realtimeVoiceService. */
export const AGNT_TOOL_NAME = 'run_agnt';

/**
 * Translate one server event into zero or more actions.
 *
 * Pure: same event in, same actions out, no state. Anything requiring memory
 * across events (assembling a streamed transcript) is the runtime's job, which
 * keeps this function trivially testable.
 *
 * @param {object} event  parsed JSON from the data channel
 * @returns {Array<{type: string, [k: string]: any}>}
 */
export function interpretEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return [];

  switch (event.type) {
    case 'session.created':
    case 'session.updated':
      return [{ type: BridgeAction.READY, session: event.session }];

    case 'input_audio_buffer.speech_started':
      return [{ type: BridgeAction.USER_INTERRUPTED }];

    case 'conversation.item.input_audio_transcription.completed': {
      const text = (event.transcript || '').trim();
      return text ? [{ type: BridgeAction.USER_SAID, text }] : [];
    }

    case 'response.output_audio_transcript.delta': {
      const delta = event.delta || '';
      return delta ? [{ type: BridgeAction.ASSISTANT_PARTIAL, delta }] : [];
    }

    case 'response.output_audio_transcript.done': {
      const text = (event.transcript || '').trim();
      return text ? [{ type: BridgeAction.ASSISTANT_SAID, text }] : [];
    }

    case 'response.done': {
      const actions = [];
      const outputs = Array.isArray(event.response?.output) ? event.response.output : [];
      let hadToolCall = false;

      for (const item of outputs) {
        if (item?.type !== 'function_call') continue;
        hadToolCall = true;

        // Arguments arrive as a JSON *string*. A model can emit malformed JSON
        // under load, and throwing here would kill the session for what should
        // be one failed turn — so parse defensively and let the runtime answer
        // the call with an error the model can speak.
        let args = {};
        let parseError = null;
        try {
          args = item.arguments ? JSON.parse(item.arguments) : {};
        } catch (err) {
          parseError = err?.message || 'unparseable arguments';
        }

        if (item.name !== AGNT_TOOL_NAME) {
          // The session declares exactly one tool. Anything else means the
          // config drifted; surface it rather than hanging on an unanswered
          // call (the model waits forever for a function_call_output).
          actions.push({
            type: BridgeAction.ERROR,
            message: `Realtime session requested an unknown tool: ${item.name}`,
            callId: item.call_id,
          });
          continue;
        }

        /**
         * The wire field is `user_message` — named and described as a verbatim
         * quote, because calling it `instruction` invited the model to AUTHOR
         * one ('The user said: "...". Please respond...' appearing in the chat
         * as the user's own message). See realtimeVoiceService.buildTools.
         *
         * `instruction` is still read as a fallback: the tool schema is
         * server-authored and sent at connect time, so a browser holding a
         * bundle from before this change would otherwise find nothing and
         * report every turn as unreadable.
         */
        const spoken = typeof args.user_message === 'string' ? args.user_message : args.instruction;

        actions.push({
          type: BridgeAction.RUN_AGNT,
          callId: item.call_id,
          instruction: typeof spoken === 'string' ? spoken.trim() : '',
          parseError,
        });
      }

      // Always last, so the runtime sees the turn's tool calls before it
      // decides what to record.
      actions.push({ type: BridgeAction.TURN_COMPLETE, hadToolCall });
      return actions;
    }

    case 'error':
      return [
        {
          type: BridgeAction.ERROR,
          message: event.error?.message || 'Realtime session error',
          code: event.error?.code,
        },
      ];

    default:
      return [];
  }
}

/**
 * The client event that answers a tool call.
 *
 * `output` must be a STRING — the API rejects an object — and the model reads
 * it as the tool's return value, so what goes in here is what it will speak.
 */
export function buildFunctionOutput(callId, result) {
  const text =
    typeof result === 'string' ? result : JSON.stringify(result === undefined ? null : result);
  return {
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: callId, output: text },
  };
}

/** Ask the model to speak now (used after answering a tool call). */
export function buildResponseCreate() {
  return { type: 'response.create' };
}

/**
 * Inject a spoken line without it being a model decision — used for "AGNT is
 * still working" style holds. `conversation: 'none'` keeps it out of the
 * session history so it cannot confuse later turns.
 */
export function buildSpokenAside(text) {
  return {
    type: 'response.create',
    response: { conversation: 'none', output_modalities: ['audio'], instructions: `Say exactly: ${text}` },
  };
}

export default {
  interpretEvent,
  buildFunctionOutput,
  buildResponseCreate,
  buildSpokenAside,
  BridgeAction,
  AGNT_TOOL_NAME,
};
