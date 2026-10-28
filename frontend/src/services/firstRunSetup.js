/**
 * First-run setup: the three connections that make AGNT useful on day one,
 * in the order people need them (decided 2026-10-28):
 *
 *   1. their AI   a subscription they already pay for (ChatGPT, Claude Code…),
 *                 with an API key or a local model as the quiet fallback;
 *   2. Google     Gmail, Calendar and Drive in one sign-in, so Annie has
 *                 somewhere to work;
 *   3. a phone    Text Annie (iMessage, RCS or SMS), on paid plans.
 *
 * Everything else a first run used to ask (theme, display name, workspace
 * folder) has a sensible default and lives in Settings.
 *
 * Pure: facts in, plain data out. FirstRunSetup.vue renders it, in the
 * onboarding modal (Studio) and in the first chat (AGNT One).
 */
import { FIRST_RUN_SUBSCRIPTION_ORDER, connectableAiProviders } from '@/store/app/aiProvider.js';

export const SETUP_STEPS = Object.freeze([
  { id: 'ai', label: 'Your AI' },
  { id: 'google', label: 'Google' },
  { id: 'phone', label: 'Your phone', pro: true },
]);
const STEP_IDS = SETUP_STEPS.map((step) => step.id);

/**
 * The two plans most people already pay for get the big cards; the rest of
 * the subscription lane is one quiet row under them (roughly 80/20 by weight).
 */
export const HERO_PLAN_IDS = Object.freeze(['openai-codex', 'claude-code']);

/** Which plans each hero card signs in with: the reason it costs nothing extra. */
export const HERO_PLAN_NAMES = Object.freeze({
  'openai-codex': 'Plus, Pro or Business',
  'claude-code': 'Claude Pro or Max',
});

/** The account, not the CLI: you sign in with your ChatGPT or Claude account. */
export const SIGN_IN_NAMES = Object.freeze({ 'openai-codex': 'ChatGPT', 'claude-code': 'Claude' });

// Used only until the provider catalog arrives; the catalog's own record wins.
const HERO_FALLBACK = Object.freeze({
  'openai-codex': { id: 'openai-codex', name: 'ChatGPT', icon: 'openai', connectionType: 'oauth' },
  'claude-code': { id: 'claude-code', name: 'Claude Code', icon: 'claude', connectionType: 'oauth' },
});

const lower = (value) => String(value || '').toLowerCase();

/**
 * The subscription sign-ins, split into the two hero cards and the row below,
 * in the app's first-run order.
 *
 * Drawn from connectableAiProviders, the one list every setup screen offers,
 * so its rules hold here too (ChatGPT is hidden when its own service says it
 * cannot be used). A hero that is not offered gives its card to the next plan
 * in order. Before the catalog has loaded at all, the two heroes still show:
 * their sign-in works by id.
 */
export function planTiles(providers = [], { codexStatus } = {}) {
  const list = Array.isArray(providers) ? providers.filter(Boolean) : [];
  if (list.length === 0) return { hero: HERO_PLAN_IDS.map((id) => HERO_FALLBACK[id]), more: [] };
  const offered = new Map(connectableAiProviders(list, { codexStatus }).map((p) => [lower(p.id), p]));
  const ordered = [...HERO_PLAN_IDS, ...FIRST_RUN_SUBSCRIPTION_ORDER.filter((id) => !HERO_PLAN_IDS.includes(id))]
    .map((id) => offered.get(id))
    .filter(Boolean);
  return { hero: ordered.slice(0, 2), more: ordered.slice(2) };
}

export const isGoogleConnected = (connectedIds) => (Array.isArray(connectedIds) ? connectedIds : []).some((id) => lower(id) === 'google');

/** Linked = any phone past its link code. A paused phone is still linked. */
export const isPhoneLinked = (textAnnieState) =>
  (textAnnieState?.phones || []).some((phone) => !!phone?.state && phone.state !== 'pending');

/** Whether the plan includes texting; null while unknown (not loaded, or offline). */
export const phoneEligible = (textAnnieState) => (textAnnieState?.plan ? textAnnieState.plan.eligible === true : null);

/** Which of the three are done. */
export function setupStatus({ aiConnected = false, connectedIds = [], textAnnieState = null } = {}) {
  return { ai: !!aiConnected, google: isGoogleConnected(connectedIds), phone: isPhoneLinked(textAnnieState) };
}

export const allDone = (status) => STEP_IDS.every((id) => !!status?.[id]);

/**
 * The step to show next: the first one after `after` (or from the start) that
 * is neither done nor skipped. Null when nothing is left, which is the done
 * screen. Done steps are passed over: a Google account already connected is
 * not a screen to click through.
 */
export function nextStep(status = {}, skipped = {}, after = null) {
  const start = after ? STEP_IDS.indexOf(after) + 1 : 0;
  return STEP_IDS.slice(Math.max(start, 0)).find((id) => !status[id] && !skipped[id]) || null;
}

/** The ah-ha. Specific on purpose: Annie needs the whole job to do it in one go. */
export const AHA_PROMPT =
  'Prep me for tomorrow: read my calendar, research anyone I am meeting from outside my company, ' +
  'go through my recent email with them, write a one-page brief for each meeting in a Google Doc, ' +
  'and draft the replies I owe. Read and draft only. Send nothing.';
export const FIRST_ASK_PROMPT = 'What can you do for me?';

/**
 * What the done screen offers to ask first. The ah-ha needs Google, so it is
 * only offered once Google is connected; otherwise a first question.
 */
export function finishOffer(status = {}) {
  if (status.google) {
    return {
      kicker: 'Start with the one that saves an hour',
      title: 'Prep me for tomorrow',
      text: AHA_PROMPT.replace(/^Prep me for tomorrow: r/, 'R'),
      prompt: AHA_PROMPT,
    };
  }
  return {
    kicker: 'Start here',
    title: FIRST_ASK_PROMPT,
    text: 'Research, documents, automations: ask in plain words and I work out the steps.',
    prompt: FIRST_ASK_PROMPT,
  };
}
