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

import {
  resolveOpenAiVoiceCredentialChain,
  isBorrowedCredential,
} from './auth/openAiVoiceCredential.js';

/**
 * Provider statuses that mean "this CREDENTIAL cannot open the session" as
 * opposed to "the session cannot be opened".
 *
 *   401 wrong or revoked  ·  403 not entitled  ·  429 out of credit / rate limit
 *
 * Only these are worth re-trying with a different credential. A 400 is a bad
 * offer and a 5xx is OpenAI having a bad day — both would fail identically on
 * every other token, so retrying them just spends round trips to reach the same
 * answer more slowly.
 */
const CREDENTIAL_FAILURE_STATUSES = new Set([401, 403, 429]);

/**
 * Provider statuses that mean "this ROUTE no longer exists" — a property of the
 * URL, not of the credential and not of the offer.
 *
 * This class was missing, and it broke voice on 2026-08-20. OpenAI removed
 * chatgpt.com/backend-api/codex/realtime/calls (404 {"detail":"Not Found"} on a
 * freshly refreshed, entitled token), and because 404 was not 401/403/429 the
 * code below treated it as "fails the same way everywhere" and returned —
 * without ever trying api.openai.com/v1/realtime/calls, which accepted the very
 * same token in the same minute (measured: 400 invalid_offer on a garbage SDP,
 * i.e. authentication passed).
 *
 * The attempt-chain comment above literally predicts this event — "a lone
 * exception is the thing most likely to be closed" — and the chain was built as
 * the insurance. A misclassified 404 routed around the insurance. So: 404 (and
 * its siblings 405 gone-verb and 410 gone-forever) advance to the NEXT ATTEMPT,
 * on the same credential first, then the next credential.
 */
const ROUTE_FAILURE_STATUSES = new Set([404, 405, 410]);

/**
 * The ways one credential can be spent on a Realtime session, best first.
 *
 * WHY A ChatGPT TOKEN HAS TWO
 * ---------------------------
 * A subscription token is accepted by BOTH of these (measured, 201 + a real SDP
 * answer from each). They are not equally safe to depend on:
 *
 *   chatgpt.com/backend-api/codex/realtime/calls  — the ChatGPT product's own
 *     endpoint, the one this credential belongs to. Rejects `sk-` keys (401).
 *   api.openai.com/v1/realtime/calls              — the public platform API.
 *
 * Every OTHER platform surface refuses this token on scope: /v1/models 403,
 * /v1/chat/completions, /v1/responses and both /v1/audio routes 401. Realtime
 * is the single exception, and a lone exception is the thing most likely to be
 * closed. If it is, a user whose voice rides it silently falls through to their
 * metered API key — which is exactly the outage this whole path was fixed for.
 * So the subscription asks its own product first and keeps the platform route
 * as the backstop, rather than depending on the anomaly.
 *
 * The two speak different dialects: the Codex backend takes JSON with an `sdp`
 * string, the platform takes multipart. Each attempt therefore builds its own
 * body — and builds it fresh, so no attempt can hand the next one a spent one.
 */
function realtimeAttemptsFor(credential, { sdp, session }) {
  const auth = {
    Authorization: `Bearer ${credential.token}`,
    ...(credential.accountId ? { 'chatgpt-account-id': credential.accountId } : {}),
  };

  const platform = {
    name: 'api.openai.com',
    url: 'https://api.openai.com/v1/realtime/calls',
    build: () => {
      const form = new FormData();
      form.set('sdp', sdp);
      form.set('session', JSON.stringify(session));
      return { headers: auth, body: form };
    },
  };

  if (!isBorrowedCredential(credential.source)) return [platform];

  return [
    {
      name: 'chatgpt.com/backend-api/codex',
      url: 'https://chatgpt.com/backend-api/codex/realtime/calls',
      build: () => ({
        headers: { ...auth, 'Content-Type': 'application/json', originator: 'codex_cli_rs' },
        body: JSON.stringify({ sdp, session }),
      }),
    },
    platform,
  ];
}

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
    '- The user_message field is a TRANSCRIPT, not a request you write. Put their words in it and',
    '  nothing else — no preamble, no "The user said", no "please respond to them", no third person,',
    "  no explanation. It is shown on screen as the user's own message, so anything you add appears",
    '  to them as words they never said.',
    '- Do not reword, shorten, interpret, correct or summarise it. Add context from earlier in the',
    '  conversation only when the request depends on it and would otherwise be meaningless alone.',
    '- NEVER answer from your own knowledge. NEVER guess. NEVER apologise, explain, greet, stall or',
    '  chat. NEVER say you are unable to do something — send it to run_agnt and let her answer.',
    '- Call run_agnt EXACTLY ONCE per utterance: the user speaks, you deliver it, you read the answer,',
    '  and then you WAIT, silently, for them to speak again. NEVER call run_agnt with words you have',
    '  already delivered — a repeated call posts a duplicate of their message on screen.',
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
 * would be enormous. One opaque port keeps the orchestrator as the only thing
 * that has to understand AGNT's capabilities — which it already does, better
 * than any mirror could.
 *
 * THE PARAMETER IS A QUOTE, NOT AN INSTRUCTION
 * --------------------------------------------
 * This field was called `instruction` and described as "the user's request as a
 * complete, self-contained instruction — include any context from the
 * conversation". That is a commission, and the model did the job it was given:
 * it wrote instructions. A user who said "hey, what all can you do?" had this
 * arrive in their chat:
 *
 *     The user said: "Hey, what all can you do?". Please respond to the user
 *     with your capabilities.
 *
 * Not a paraphrase — a FRAMING, with the real words quoted inside it. The
 * schema asked for authorship, so no amount of "do not reword" in the system
 * prompt was going to stop it; the field name and its description are the
 * closest thing to the model's hands.
 *
 * So the field is now named and described as a verbatim quote. What the user
 * said is what lands in the chat, because it is their message, not the voice
 * layer's summary of it.
 */
export function buildTools() {
  return [
    {
      type: 'function',
      name: 'run_agnt',
      description:
        "Deliver what the user just said to AGNT, which has the user's tools, agents, files, " +
        'workspace and memory. Use this for EVERY request of any kind — questions, research, code, ' +
        'file operations, running agents, anything. Returns what AGNT did or found, for you to read aloud.',
      parameters: {
        type: 'object',
        properties: {
          user_message: {
            type: 'string',
            description:
              'EXACTLY what the user said, word for word, as if you were transcribing them. ' +
              'This is their message and it is shown to them on screen verbatim, so it must contain ' +
              'ONLY their words. Never write about the user in the third person, never add a preamble ' +
              'such as "The user said", never append a request such as "please respond", never explain ' +
              'or rephrase. If they said "hey, what all can you do?" then this field is exactly: ' +
              'hey, what all can you do?',
          },
        },
        required: ['user_message'],
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
    /**
     * TEXT, NOT AUDIO — AND THIS IS THE WHOLE POINT.
     *
     * This is the default for responses the SERVER creates on its own, which
     * is precisely one thing: the response it opens when the user stops
     * talking, the one that calls run_agnt. We never create that response, so
     * we cannot configure it directly — but it inherits this.
     *
     * WHAT WENT WRONG. Realtime models narrate their tool calls. Ours would
     * say a line of its own — "let me look into that" — in the same response
     * as the call, out loud, in a voice the user reasonably believes is
     * Annie's. The client then DROPPED that text on purpose (see
     * useRealtimeVoice, TURN_COMPLETE / hadToolCall: whatever is said
     * alongside the call is filler). Heard, never written down. The user
     * caught it before any log did, because there was no log.
     *
     * Two ways to fix that, and only one of them is true afterwards:
     * record what it says, or make it unable to say anything. Recording
     * legitimises a second voice in the conversation. So: the auto-created
     * response may WRITE (which we keep, so an off-script turn still leaves a
     * trace) and may CALL (which is its job), and it cannot SPEAK.
     *
     * Every response the client creates overrides this with
     * `output_modalities: ['audio']`, and those carry only Annie's words —
     * already on screen, verbatim, before they are spoken. So "nothing is
     * heard that is not also written" stops being a rule the model is asked to
     * follow and becomes a property of the session it cannot violate.
     *
     * Verified against the live API: a text-only session with audio input,
     * semantic VAD, an audio output voice and a declared tool is accepted
     * (201). `output_modalities` is genuinely validated — an invalid value is
     * rejected with "Supported values are: 'text' and 'audio'" — so this is
     * not being silently ignored.
     */
    output_modalities: ['text'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        /**
         * NO `noise_reduction` HERE — DELIBERATELY, AND DO NOT ADD IT BACK.
         *
         * It was added to suppress phantom turns at the source: a cough or a
         * chair opens a turn, comes back transcribed as "um", and mid-run
         * lands as a steer. Denoising before the VAD reads the audio seemed
         * like the better half of that fix.
         *
         * It broke barge-in, which is a far worse trade. Interrupting is the
         * HARDEST audio the session ever sees: the user speaks while the
         * assistant's own voice is coming out of the speakers, so the signal is
         * already being carved up by echo cancellation before it arrives. Add a
         * denoiser on top and the residue looks exactly like the noise it is
         * built to remove — so the VAD never fires, the assistant talks over
         * the user, and the one thing they urgently wanted (stop) is the one
         * thing that stopped working.
         *
         * The phantom steer is an ANNOYANCE. A user unable to interrupt is a
         * conversation they cannot get out of. The client-side filter
         * (asrArtifacts.isFillerOnly) fixes the annoyance without touching the
         * audio, so it carries that job alone.
         */
        // Semantic turn detection: the model decides when the user is done
        // from what they said, not from how long they have been quiet.
        turn_detection: { type: 'semantic_vad' },
      },
      // Still configured even though the session default is text: the voice
      // applies to the responses the CLIENT creates, which are the ones that
      // speak. Dropping it here would leave Annie's narration on the API's
      // default voice.
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

  // Any way of signing in with OpenAI works: the ChatGPT/Codex subscription, or
  // a platform API key. The resolver is shared with the status endpoint so what
  // we OFFER and what we can DO can never disagree.
  //
  // We walk EVERY credential rather than trusting the best one, because
  // "resolves" and "works" are different facts: an API key with no credit left
  // resolves perfectly and then 429s. Failing over here is what keeps a dead
  // key from shadowing a live subscription.
  const chain = await resolveOpenAiVoiceCredentialChain(userId);
  if (chain.length === 0) return { ok: false, status: 200, reason: 'no-credentials' };

  const session = buildSessionConfig({ voice, assistantName, surface });

  // The best error to show is the last one from a credential the user can
  // actually act on. A borrowed ChatGPT token being refused is not actionable —
  // see the quiet-degrade note below — so it never becomes the reported failure.
  let surfaceable = null;

  for (const credential of chain) {
    for (const attempt of realtimeAttemptsFor(credential, { sdp, session })) {
      let res;
      try {
        const { headers, body } = attempt.build();
        res = await fetch(attempt.url, { method: 'POST', headers, body });
      } catch (err) {
        // The network is not a property of the credential; the next one would
        // fail the same way.
        return { ok: false, status: 502, reason: 'network', detail: err?.message };
      }

      if (res.ok) return { ok: true, sdp: await res.text() };

      let detail = '';
      try {
        detail = (await res.text()).slice(0, 400);
      } catch {
        detail = '';
      }

      if (ROUTE_FAILURE_STATUSES.has(res.status)) {
        // The ROUTE is gone — upstream moved or removed the endpoint. The same
        // credential may be welcome at the next URL (measured on 2026-08-20:
        // the codex route 404s while the platform route accepts the identical
        // token), so this must not condemn the credential, and it must never be
        // the surfaced error: a vanished vendor URL is not user-actionable.
        console.warn(
          `[speech] ${attempt.name} route not found (${res.status}); trying the next route.`,
        );
        continue;
      }

      if (!CREDENTIAL_FAILURE_STATUSES.has(res.status)) {
        // Not a credential problem — a malformed offer or an outage fails the
        // same way everywhere, so neither another endpoint nor another token
        // would help. Never echo the key or the request headers back; only the
        // provider's own message, truncated.
        return { ok: false, status: res.status, reason: `provider-${res.status}`, detail };
      }

      // A ChatGPT plan that is not entitled to Realtime is, from the user's
      // side, the same situation as having no credential: nothing they did is
      // wrong and nothing they can change fixes it. A PLATFORM key rejected the
      // same way is a real problem — a revoked key, or one out of credit — and
      // is surfaced. That distinction is the entire point of tracking which kind
      // of credential we used.
      if (isBorrowedCredential(credential.source)) {
        console.warn(
          `[speech] ChatGPT sign-in refused by ${attempt.name} (${res.status}); trying the next route.`,
        );
      } else {
        console.warn(`[speech] OpenAI API key rejected for realtime (${res.status}).`);
        surfaceable = { ok: false, status: res.status, reason: `provider-${res.status}`, detail };
      }
    }
  }

  // Every credential refused. If none of them was one the user can fix, this is
  // indistinguishable from having no credential at all: drop to the cascade
  // pipeline instead of showing an error for a feature they never asked for.
  return surfaceable ?? { ok: false, status: 200, reason: 'no-credentials' };
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
