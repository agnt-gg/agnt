/**
 * realtimeVoiceService — speech-to-speech voice for AGNT, with the orchestrator
 * as the brain.
 *
 * WHY THIS EXISTS
 * ---------------
 * The cascade pipeline (VAD -> Whisper -> orchestrator -> TTS) can be made
 * fast, but it can never be made NATURAL. Prosody, breath, laughter, the way a
 * person trails off and picks back up — all of that lives in the audio, and a
 * cascade throws the audio away at the first step. Text is a lossy intermediate
 * and no TTS engine can put back what the transcription removed.
 *
 * A speech-to-speech model keeps the audio end to end. That is where
 * ChatGPT's voice quality comes from — not from a better TTS.
 *
 * THE OBJECTION, AND THE ANSWER
 * -----------------------------
 * The obvious objection is that the realtime model would be answering, and it
 * has no tools, no agents, no workspace, no memory — a beautiful voice attached
 * to something that cannot do the work.
 *
 * That is only true if you let the realtime model be the BRAIN. It does not
 * have to be. Here it is the EARS AND MOUTH, and it is given exactly one tool:
 *
 *     run_agnt(instruction)
 *
 * Its instructions forbid it from answering anything from its own knowledge.
 * Every substantive request becomes a run_agnt call, which the client routes
 * into the real orchestrator — same conversation, same 300 tools, same agents,
 * same workspace context, same memory — and the result comes back for the
 * realtime model to SPEAK.
 *
 * So the user gets the voice of a speech-to-speech model and the capability of
 * the full platform. Neither is traded for the other.
 *
 * TRANSPORT: THE UNIFIED INTERFACE, NOT EPHEMERAL TOKENS
 * ------------------------------------------------------
 * OpenAI offers two browser paths. Ephemeral tokens mint a short-lived
 * credential that the browser then uses to talk to OpenAI directly. The
 * unified interface instead has the browser POST its SDP offer to US, and we
 * forward it with the session config.
 *
 * We use the unified interface deliberately. It costs one extra hop at setup
 * (once, ~100ms) and buys three things: no OpenAI credential of any kind ever
 * reaches the browser; the session configuration — including the instructions
 * that constrain the model to run_agnt — is server-authored and cannot be
 * tampered with by a modified client; and the whole exchange rides the existing
 * authenticated route surface, so it is covered by the route-security manifest
 * like everything else.
 */

import authManager from './auth/AuthManager.js';

/** Speech-to-speech model. GA interface — no beta header. */
export const REALTIME_MODEL = 'gpt-realtime-2.1';

/** Voices the API accepts. marin and cedar are the highest quality. */
export const REALTIME_VOICES = Object.freeze([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

export const DEFAULT_VOICE = 'marin';

/**
 * The instruction that makes this a MOUTH, not a second assistant.
 *
 * THE MISTAKE THIS REPLACES
 * ------------------------
 * The first version opened with "You are Annie" and let the model handle
 * "conversational glue" itself — greetings, acknowledgements, clarifications.
 * That looked harmless and was the root of three separate defects:
 *
 *   1. Those turns never reached the orchestrator, so they never appeared in
 *      the chat, never persisted, and never entered the history. The user
 *      watched a conversation happen and leave no trace.
 *   2. It had a personality of its own, so its lines and Annie's lines were
 *      subtly different people — the user could not tell which one they were
 *      talking to.
 *   3. "Glue" has no natural edge. A model given permission to answer easy
 *      things will decide what counts as easy, and it does not know what it
 *      cannot see.
 *
 * Annie is the orchestrator. She has the tools, the memory, the context and the
 * personality. THIS MODEL IS A SPEAKER: it converts the user's speech to an
 * instruction and Annie's answer to audio. It has no identity, no opinions and
 * no discretion, and it answers NOTHING by itself — not even "hello", which is
 * a real turn Annie should get to answer in her own voice.
 *
 * Everything the user hears is Annie's words. That is the whole point.
 */
export function buildInstructions({ assistantName = 'Annie', surface = 'chat' } = {}) {
  return [
    `You are the voice interface for ${assistantName}, an AI assistant running on AGNT.`,
    `You are NOT ${assistantName}. You are not an assistant at all. You are the ears and the mouth:`,
    `you carry the user's words to ${assistantName}, and you read ${assistantName}'s words aloud.`,
    '',
    'YOU HAVE NO VOICE OF YOUR OWN — THIS IS ABSOLUTE:',
    'You have no knowledge, no opinions, no personality and no judgement. You never answer anything.',
    '',
    '- EVERY single thing the user says goes to run_agnt. Every one. Including "hello", "thanks",',
    '  "never mind", small talk, follow-ups, and anything you think is trivial or obvious.',
    `  ${assistantName} answers all of it, in her own words. You do not get to decide what is worth`,
    '  her attention.',
    '- Pass what the user said THROUGH AS THEY SAID IT. Do not reword, shorten, interpret, correct',
    '  or summarise it. Add context from earlier in the conversation only when the request depends',
    '  on it and would otherwise be meaningless on its own.',
    '- NEVER answer from your own knowledge. NEVER guess. NEVER apologise, explain, greet, stall or',
    '  chat. NEVER say you are unable to do something — send it to run_agnt and let her answer.',
    '',
    'SPEAKING HER ANSWER — THIS IS ABSOLUTE:',
    'When run_agnt returns, SPEAK THAT TEXT EXACTLY AS GIVEN, word for word.',
    'Do NOT summarise it, reword it, shorten it, expand it, or add anything before or after it — no',
    '"sure", no "here you go", no sign-off. The user is reading those same words on screen while you',
    'speak them. If you say something different, the screen and the voice disagree and the user can',
    'trust neither. You are reading her answer aloud, not writing your own.',
    '',
    'Read it naturally — warm, unhurried, like a person talking rather than a machine reciting. The',
    'delivery is yours; the words are hers.',
    '',
    'WHILE SHE WORKS:',
    'run_agnt can take anywhere from a second to a minute. Say NOTHING while you wait. The interface',
    'already shows the user that work is happening. Do not fill the silence, do not narrate progress',
    'you cannot see, and do not invent a holding phrase — that would be your voice, not hers.',
    '',
    `Everything ${assistantName} produces also appears in the ${surface} on screen, in full.`,
  ].join('\n');
}

/**
 * The single tool. Deliberately one, not many.
 *
 * Mirroring AGNT's 300 tools into the realtime session would be the obvious
 * move and it would be wrong: the tool list would have to be kept in sync
 * forever, every schema change would break voice silently, the realtime model
 * would need per-tool judgement it has no context for, and the session payload
 * would be enormous. One opaque instruction port keeps the orchestrator as the
 * only thing that has to understand AGNT's capabilities — which it already
 * does, better than any mirror could.
 */
export function buildTools() {
  return [
    {
      type: 'function',
      name: 'run_agnt',
      description:
        'Send an instruction to AGNT, which has the user\'s tools, agents, files, workspace and memory. ' +
        'Use this for EVERY request that needs knowledge or work of any kind — questions, research, code, ' +
        'file operations, running agents, anything. Returns what AGNT did or found, for you to speak aloud.',
      parameters: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description:
              "The user's request as a complete, self-contained instruction. Include any context from " +
              'the conversation the request depends on, because AGNT does not hear the audio.',
          },
        },
        required: ['instruction'],
      },
    },
  ];
}

/**
 * Session configuration sent alongside the SDP offer.
 *
 * `semantic_vad` is why this design can drop the hand-built endpointer: the
 * model decides turn boundaries from meaning rather than from a silence timer,
 * which is the same problem semanticEndpointer.js solves lexically — but done
 * on the audio, where the evidence actually is.
 */
export function buildSessionConfig({ voice = DEFAULT_VOICE, assistantName, surface } = {}) {
  const chosen = REALTIME_VOICES.includes(voice) ? voice : DEFAULT_VOICE;
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        // Semantic turn detection: the model decides when the user is done
        // from what they said, not from how long they have been quiet.
        turn_detection: { type: 'semantic_vad' },
      },
      output: {
        format: { type: 'audio/pcm' },
        voice: chosen,
      },
    },
    instructions: buildInstructions({ assistantName, surface }),
    tools: buildTools(),
    tool_choice: 'auto',
  };
}

/**
 * Exchange the browser's SDP offer for OpenAI's SDP answer, attaching the
 * server-authored session config.
 *
 * @returns {Promise<{ ok: true, sdp: string } | { ok: false, status: number, reason: string, detail?: string }>}
 *   "No credentials" is a NORMAL result, not an exception — the client falls
 *   back to the cascade pipeline. Only genuine provider failures carry detail.
 */
export async function createRealtimeCall({ sdp, userId, voice, assistantName, surface } = {}) {
  if (typeof sdp !== 'string' || !sdp.trim()) {
    return { ok: false, status: 400, reason: 'missing-sdp' };
  }

  let apiKey = null;
  try {
    apiKey = await authManager.getValidAccessToken(userId, 'openai');
  } catch {
    apiKey = null;
  }
  if (!apiKey) return { ok: false, status: 200, reason: 'no-credentials' };

  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(buildSessionConfig({ voice, assistantName, surface })));

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, status: 502, reason: 'network', detail: err?.message };
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      detail = '';
    }
    // Never echo the key or the request headers back — only the provider's own
    // message, truncated.
    return { ok: false, status: res.status, reason: `provider-${res.status}`, detail };
  }

  const answer = await res.text();
  return { ok: true, sdp: answer };
}

export default {
  createRealtimeCall,
  buildSessionConfig,
  buildInstructions,
  buildTools,
  REALTIME_MODEL,
  REALTIME_VOICES,
  DEFAULT_VOICE,
};
