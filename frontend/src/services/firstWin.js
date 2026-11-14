/**
 * The thank-you after a first real task: one card, once per account.
 *
 * A reply counts when Annie finished a task in it: two or more steps, and
 * every step succeeded. The first such reply is the one the card thanks; "Not
 * now" retires it for good. Which AI ran the task is recorded when the turn
 * ends, because the model picker can change afterwards.
 *
 * Pure: the reactive state and the moment of claiming live in
 * composables/useFirstWin.js.
 */
import { parseAgntNotice } from '@/services/agntFlash.js';
import { usedPhrase } from '@/services/giveBack.js';
import { isSubscriptionProvider, providerLabel, resolveProviderKey } from '@/store/app/aiProvider.js';

/** An account with no more chats than this is still on its first tasks. */
export const FIRST_TASK_CHATS = 3;

const KEY = 'agnt:first-win';
const RAN_ON_KINDS = Object.freeze(['flash', 'plan', 'other']);
const EMPTY = Object.freeze({ messageId: null, firstTask: false, ranOn: null, dismissed: false });

const stepSucceeded = (step) => !!step && step.status !== 'interrupted' && !step.error && step.result !== undefined && step.result !== null;

/** A reply in which Annie finished a task: at least two steps, every one of them succeeded. */
export function isFinishedTask(message) {
  if (message?.role !== 'assistant' || parseAgntNotice(message.content)) return false;
  const steps = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return steps.length >= 2 && steps.every(stepSucceeded);
}

/** Which AI a turn ran on, from the chat's provider: AGNT Flash, a plan the person pays for, or another AI. */
export function ranOnFor(selectedProvider) {
  const key = resolveProviderKey(String(selectedProvider || ''));
  if (!key) return null;
  if (String(key).toLowerCase() === 'agnt') return { kind: 'flash' };
  return { kind: isSubscriptionProvider(key) ? 'plan' : 'other', label: providerLabel(key) };
}

/** The receipt: what the task ran on. `account` is the AGNT Flash account, read when the task ran on it. */
export function receiptFor(ranOn, account) {
  if (ranOn?.kind === 'flash') {
    return account?.trial && account.includedCredits > 0
      ? `It ran on your free AGNT Flash credits, and you've used ${usedPhrase(account)} of them.`
      : 'It ran on AGNT Flash.';
  }
  if (ranOn?.kind === 'plan' && ranOn.label) return `It ran on your ${ranOn.label} plan, at no extra charge.`;
  return ranOn?.label ? `It ran on ${ranOn.label}.` : '';
}

// ── Kept per account ────────────────────────────────────────────────────

export function firstWinKey(account) {
  return account ? `${KEY}:${account}` : KEY;
}

/** Only known keys, only their types: a hand-edited or stale value cannot leak through. */
function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY };
  const ranOn =
    raw.ranOn && typeof raw.ranOn === 'object' && RAN_ON_KINDS.includes(raw.ranOn.kind)
      ? { kind: raw.ranOn.kind, ...(typeof raw.ranOn.label === 'string' && raw.ranOn.label ? { label: raw.ranOn.label.slice(0, 80) } : {}) }
      : null;
  return {
    messageId: typeof raw.messageId === 'string' && raw.messageId ? raw.messageId : null,
    firstTask: raw.firstTask === true,
    ranOn,
    dismissed: raw.dismissed === true,
  };
}

export function loadFirstWin(account, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(firstWinKey(account));
    return clean(raw ? JSON.parse(raw) : null);
  } catch {
    // Corrupt JSON or storage disabled: nothing claimed yet.
    return { ...EMPTY };
  }
}

/** Saves and returns the cleaned state. A failed write keeps it for this session. */
export function saveFirstWin(account, state, storage = globalThis.localStorage) {
  const next = clean(state);
  try {
    storage?.setItem(firstWinKey(account), JSON.stringify(next));
  } catch (error) {
    console.warn('[firstWin] could not save:', error?.message || error);
  }
  return next;
}
