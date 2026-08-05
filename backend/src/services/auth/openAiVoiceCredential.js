/**
 * openAiVoiceCredential — the single answer to "can this user run
 * speech-to-speech, and with which token?"
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 * ---------------------------------
 * Two places ask that question: the SDP exchange (`createRealtimeCall`) and the
 * capability probe the client uses to decide whether to OFFER voice at all
 * (`GET /api/speech/realtime/status`). They used to answer it separately, and
 * both answered it as `getValidAccessToken(userId, 'openai')` — a platform API
 * key, nothing else.
 *
 * That is the actual defect, and it is worse than a missing provider. A user
 * signed in with ChatGPT/Codex was told voice did not exist, so they never
 * attempted the call that would have succeeded. Fixing only the call site would
 * have left the feature invisible; fixing only the probe would have offered a
 * feature that then failed. Whenever two call sites must agree about a
 * capability, the way to make them agree forever is to give them one function,
 * not two matching edits.
 *
 * WHAT THE OAUTH TOKEN CAN AND CANNOT DO (measured, 2026-08-04)
 * ------------------------------------------------------------
 * A ChatGPT/Codex OAuth token is NOT a general-purpose platform credential:
 *
 *     POST /v1/realtime/calls          201  ✅  (and /v1/realtime/client_secrets 200)
 *     GET  /v1/models                  403      missing scope api.model.read
 *     POST /v1/audio/speech            401      missing scope api.model.audio.request
 *     POST /v1/audio/transcriptions    401      missing scope api.model.audio.request
 *     POST /v1/chat/completions        401      missing scope model.request
 *
 * OpenAI entitles it for Realtime specifically. That asymmetry is the whole
 * reason this fallback lives HERE and not inside
 * `AuthManager.getValidAccessToken('openai')`: putting it there would hand a
 * scope-limited token to every consumer of the `openai` provider — TTS, Whisper,
 * chat — each of which would then fail with a 401 that reads like a broken key.
 * The token is only valid for this one surface, so only this one surface may
 * reach for it.
 *
 * PROVENANCE NOTE
 * ---------------
 * The Codex credential is a machine-level file (`~/.codex/auth.json`), not a
 * per-user secret, exactly as it already is for the `openai-codex` chat
 * provider and every other CLI-backed provider. This introduces no sharing that
 * the platform did not already have; it keeps voice consistent with chat.
 */

import authManager from './AuthManager.js';
import codexAuthManager from './CodexAuthManager.js';

/**
 * What KIND of credential we resolved — not where it was found.
 *
 * The distinction that matters downstream is scope, not provenance: a platform
 * key can do everything and its failures are the user's business, while a
 * ChatGPT OAuth token is entitled for Realtime alone and its rejection should
 * degrade quietly to the cascade pipeline. An `sk-` key sitting in the Codex
 * auth file is a PLATFORM credential and is reported as one.
 */
export const VOICE_CREDENTIAL_SOURCE = Object.freeze({
  /** A platform API key: full scope, failures are worth surfacing. */
  PLATFORM: 'openai',
  /** A ChatGPT/Codex OAuth token: Realtime-only, failures degrade quietly. */
  CHATGPT: 'openai-codex',
});

/**
 * Every credential this user could open a Realtime session with, best first.
 *
 * WHY A CHAIN AND NOT A WINNER
 * ----------------------------
 * This used to resolve exactly one credential, eagerly, and hand it to the
 * caller as the answer. That conflates two different events — "a credential
 * exists" and "a credential works" — and the gap between them is a real bug a
 * user hit: a metered API key that has run out of credit still RESOLVES
 * perfectly, so it won, and the session died with a 429 while a fully entitled
 * ChatGPT subscription sat one branch away, never tried. Resolution cannot know
 * whether a token works; only the call knows. So resolution's job is to enumerate
 * candidates and rank them, and the call's job is to walk them.
 *
 * ORDER: SUBSCRIPTION BEFORE METER
 * --------------------------------
 * The ChatGPT/Codex token is tried FIRST. A Realtime minute on a ChatGPT
 * subscription is already paid for, while the same minute on a platform key is
 * billed per token, so preferring the subscription is both cheaper and the
 * behaviour a user with both would expect. Nothing is lost by the reversal:
 * a plan that is not entitled answers 401/403 and the caller moves to the key.
 *
 * @returns {Promise<Array<{ token: string, source: string, accountId: string|null }>>}
 *   Empty means "this user cannot do speech-to-speech" — a normal state, never
 *   an exception. Every failure path inside is swallowed for that reason: this
 *   is a capability probe as much as a credential fetch, and a probe that
 *   throws would take out the status endpoint with it.
 */
export async function resolveOpenAiVoiceCredentialChain(userId) {
  const chain = [];
  const seen = new Set();
  const push = (candidate) => {
    if (!candidate || seen.has(candidate.token)) return;
    seen.add(candidate.token);
    chain.push(candidate);
  };

  // Tier 1 — ChatGPT / Codex OAuth. `ensureValidToken` owns JWT expiry checking
  // and refresh-token rotation against auth.openai.com, so token lifecycle is
  // not reimplemented here.
  try {
    const token = await codexAuthManager.ensureValidToken();
    if (typeof token === 'string' && token.trim()) {
      const trimmed = token.trim();
      push(
        trimmed.startsWith('sk-')
          ? // An `sk-` key sitting in the Codex auth file is a platform key that
            // happens to live there. Scope, not provenance, decides the source.
            { token: trimmed, source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null }
          : {
              token: trimmed,
              source: VOICE_CREDENTIAL_SOURCE.CHATGPT,
              // Sent as `chatgpt-account-id`, matching what the Codex CLI does,
              // so a user with more than one ChatGPT account gets the session
              // billed to the account they signed in with. Verified accepted (201).
              accountId: safeAccountId(),
            },
      );
    }
  } catch {
    // No Codex auth file, unreadable, or refresh failed outright.
  }

  // Tier 2 — platform API key (env → local encrypted store → remote vault).
  try {
    const key = await authManager.getValidAccessToken(userId, 'openai');
    if (typeof key === 'string' && key.trim()) {
      push({ token: key.trim(), source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null });
    }
  } catch {
    // A vault that cannot be reached is not a credential. Fall through.
  }

  return chain;
}

/**
 * The single best credential, or `null`.
 *
 * Kept for the capability probe, which asks "is there any way in?" and has no
 * call to fail over from.
 *
 * @returns {Promise<{ token: string, source: string, accountId: string|null } | null>}
 */
export async function resolveOpenAiVoiceCredential(userId) {
  const [best] = await resolveOpenAiVoiceCredentialChain(userId);
  return best ?? null;
}

/**
 * Can this user run speech-to-speech right now?
 *
 * The capability probe and the credential fetch are the same question asked
 * with different urgency, so they share an implementation by construction —
 * the status endpoint cannot drift from the call path because there is nothing
 * for it to drift from.
 */
export async function hasOpenAiVoiceCredential(userId) {
  return (await resolveOpenAiVoiceCredentialChain(userId)).length > 0;
}

/**
 * True when the credential is entitled for Realtime only.
 *
 * Callers use this to decide what a 401/403 MEANS: for a platform key it is a
 * real problem the user should hear about; for a borrowed OAuth token it means
 * "this plan is not entitled", which is indistinguishable, from the user's
 * point of view, from having no credential at all.
 */
export function isBorrowedCredential(source) {
  return source === VOICE_CREDENTIAL_SOURCE.CHATGPT;
}

function safeAccountId() {
  try {
    return codexAuthManager.getChatGptAccountId() || null;
  } catch {
    return null;
  }
}

export default {
  resolveOpenAiVoiceCredentialChain,
  resolveOpenAiVoiceCredential,
  hasOpenAiVoiceCredential,
  isBorrowedCredential,
  VOICE_CREDENTIAL_SOURCE,
};
