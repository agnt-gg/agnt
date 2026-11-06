/**
 * "Connect your AI": one message, said the same way everywhere (the AGNT One
 * capsule, the Studio journey, Settings, the chat's Flash meter).
 *
 * AGNT Flash is on for everyone and fine for light work; professional,
 * top-quality work wants a frontier model, and most people already pay for one
 * (ChatGPT, Claude, Gemini). So connecting your own AI is the first step of the
 * first ten minutes, offered as a sign-in to the plan you have before an API
 * key (decided 2026-10-21).
 *
 * "Has its own AI" is the journey's own count (useJourney readFacts aiModels):
 * any connected AI provider other than AGNT, or a custom endpoint.
 */

export const CONNECT_AI_TITLE = 'Connect your AI';
export const CONNECT_AI_WHY =
  'AGNT Flash is fine for light work. For professional, top-quality results, connect the AI you already pay for. Signing in with your ChatGPT, Claude or Gemini plan costs nothing extra.';
export const CONNECT_AI_HINT = 'ChatGPT, Claude or Gemini: the plan you already pay for';

/** Subscriptions first, in the order most people have them. */
export const SUBSCRIPTION_SIGN_INS = Object.freeze([
  { providerId: 'openai-codex', label: 'ChatGPT' },
  { providerId: 'claude-code', label: 'Claude' },
]);

export const hasOwnAi = (facts) => Number(facts?.aiModels) > 0;

// "Start with AGNT Flash for now" quiets the prompts for this session only:
// the step stays open, and the next session asks again.
const LATER_KEY = 'agnt:connect-ai-later';
export function deferredThisSession() {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}
export function deferThisSession() {
  try {
    sessionStorage.setItem(LATER_KEY, '1');
  } catch {
    /* storage disabled: the prompt simply shows again */
  }
}
