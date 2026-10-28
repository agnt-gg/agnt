/**
 * The sign-in handoff: bring the page to the person, wait while they sign in,
 * then give the browser back to the agent — signed in, for good.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The agent's browser is headless. When a site wanted a login, the agent had
 * no way to hand over: it asked in prose ("type your password in the Chrome
 * window") for a window that did not exist (trace 64eeeb9c, 2026-10-28).
 * Every serious agent browser has this primitive — ChatGPT's agent pauses and
 * offers "take over", Browser Use pauses at login pages for the human — and
 * the login lands in a persistent profile so it is asked for once.
 *
 * ---------------------------------------------------------------------------
 * TWO PLACES TO SIGN IN
 * ---------------------------------------------------------------------------
 *   here   — the conversation's own tab, in the live card. The person types
 *            into the stream (it forwards mouse and keys). The wait watches
 *            the page and finishes by itself once it stops being a sign-in.
 *   window — the same profile in a plain browser window with no automation
 *            attached (browserFallbackSurface.openSignInWindow). Required by
 *            Google, Microsoft and Apple, which refuse automated browsers.
 *            Nothing can watch that window, so it finishes when the person
 *            closes it or presses Done.
 *
 * A "here" sign-in that hits "this browser may not be secure" moves to the
 * window by itself; the person can also ask for the window at any time.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT
 * ---------------------------------------------------------------------------
 * It knows nothing about CDP, processes or HTTP. The caller hands it `ops`
 * (inspect the page, open/close the window, restore the browser), which keeps
 * the state machine testable on its own and keeps one owner per mechanism.
 * State is in memory: a sign-in belongs to a running tool call, and a restart
 * ends the call anyway.
 */

import { randomUUID } from 'crypto';

export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
export const SIGN_IN_MAX_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_MS = 1500;
/** Clear polls in a row before a sign-in counts as done: redirect chains pass through ordinary pages. */
const SETTLE_POLLS = 2;

/** `${userId}\n${scope}` -> the sign-in waiting there. */
const pending = new Map();

const keyFor = (userId, scope) => `${userId}\n${scope}`;

/** Where a sign-in is tracked: a conversation's lane, or the shared browser. */
export function signInScope(lane) {
  return lane || 'shared';
}

export function isSignInPending(userId, scope) {
  return pending.has(keyFor(userId, scope));
}

/** What a client may know about a waiting sign-in. Never an endpoint, never page content. */
function publicView(entry) {
  return {
    id: entry.id,
    status: entry.status,
    mode: entry.mode,
    url: entry.currentUrl || entry.url,
    host: hostOf(entry.currentUrl || entry.url),
    provider: entry.provider,
    canUseWindow: entry.canUseWindow,
    startedAt: entry.startedAt,
    deadline: entry.deadline,
    error: entry.error || null,
  };
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

/** The sign-in waiting in a scope, or null. */
export function getSignIn(userId, scope) {
  const entry = pending.get(keyFor(userId, scope));
  return entry ? publicView(entry) : null;
}

/**
 * The person says they are finished ('done') or gave up ('cancelled').
 * `id`, when given, must match: a stale button must not end a newer sign-in.
 * @returns {boolean} whether a waiting sign-in took the answer
 */
export function finishSignIn(userId, scope, outcome, id = null) {
  if (outcome !== 'done' && outcome !== 'cancelled') return false;
  const entry = pending.get(keyFor(userId, scope));
  if (!entry || entry.outcome || (id && entry.id !== id)) return false;
  entry.outcome = outcome;
  entry.wake();
  return true;
}

/** The person wants the plain window instead of signing in here. */
export function requestSignInWindow(userId, scope, id = null) {
  const entry = pending.get(keyFor(userId, scope));
  if (!entry || entry.outcome || (id && entry.id !== id)) return false;
  if (entry.mode === 'window' || !entry.canUseWindow) return false;
  entry.windowRequested = true;
  entry.wake();
  return true;
}

/** Sleep for `ms`, or less when something wakes the entry (an answer, an abort, the window closing). */
function napOrWake(entry, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      entry.wake = () => {};
      resolve();
    }
    entry.wake = done;
  });
}

/**
 * Wait for the person to sign in.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.scope           signInScope(lane)
 * @param {string} args.url             the page to sign in on
 * @param {object|null} [args.initialLogin] classifyLoginPage() of that page
 * @param {'here'|'window'} [args.mode]
 * @param {number} [args.timeoutMs]
 * @param {AbortSignal|null} [args.signal]  the run being stopped ends the wait
 * @param {number} [args.pollMs]
 * @param {object} args.ops
 *   inspect()        -> { url, title, login }       (here only)
 *   finish()         -> a verb result for the page   (here: the page as it now is)
 *   canUseWindow     boolean
 *   openWindow(url), closeWindow(), windowOpen() -> boolean, windowClosed() -> Promise
 *   restore(url)     -> a verb result after the automation browser is back (window; may be absent)
 * @returns {Promise<{ outcome: 'signed-in'|'not-signed-in'|'finished'|'cancelled'|'stopped'|'timed-out'|'failed',
 *                     signedIn: boolean|null, mode: string, page: object|null, error: string|null }>}
 */
export async function runSignIn({
  userId, scope, url, initialLogin = null, mode = 'here', timeoutMs = SIGN_IN_TIMEOUT_MS, signal = null, pollMs = POLL_MS, ops,
}) {
  const key = keyFor(userId, scope);
  if (pending.has(key)) throw new Error('A sign-in is already waiting here. Finish or cancel it first.');

  const budget = Math.min(Math.max(Number(timeoutMs) || SIGN_IN_TIMEOUT_MS, 10_000), SIGN_IN_MAX_TIMEOUT_MS);
  const startedAt = Date.now();
  const entry = {
    id: randomUUID(),
    scope,
    url,
    currentUrl: url,
    provider: initialLogin?.provider || hostOf(url),
    mode: 'here',
    status: 'waiting',
    canUseWindow: ops.canUseWindow !== false,
    startedAt,
    deadline: startedAt + budget,
    outcome: null,
    error: null,
    windowRequested: mode === 'window',
    wake: () => {},
  };
  pending.set(key, entry);
  const onAbort = () => entry.wake();
  signal?.addEventListener?.('abort', onAbort);

  let sawWall = Boolean(initialLogin);
  let clearPolls = 0;
  let page = null;

  const openWindow = async () => {
    entry.status = 'opening-window';
    entry.windowRequested = false;
    try {
      await ops.openWindow(entry.url);
      entry.mode = 'window';
      entry.status = 'window';
      // The window closing is the person saying "done"; wake at once rather than at the next poll.
      ops.windowClosed().then(() => entry.wake(), () => entry.wake());
    } catch (err) {
      entry.error = err?.message || String(err);
      entry.outcome = 'failed';
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) { entry.outcome = entry.outcome || 'stopped'; break; }
      if (entry.outcome) break;
      if (Date.now() >= entry.deadline) { entry.outcome = 'timed-out'; break; }

      if (entry.windowRequested && entry.mode !== 'window' && entry.canUseWindow) {
        // eslint-disable-next-line no-await-in-loop -- one transition, then back to waiting
        await openWindow();
        continue;
      }

      if (entry.mode === 'window') {
        if (!ops.windowOpen()) { entry.outcome = 'done'; break; }
      } else {
        // eslint-disable-next-line no-await-in-loop -- polling the page by design
        const now = await ops.inspect().catch(() => null);
        if (now) {
          entry.currentUrl = now.url || entry.currentUrl;
          if (now.login?.kind === 'rejected-browser' && entry.canUseWindow) {
            entry.windowRequested = true;
            continue;
          }
          // A consent screen still needs the person; it counts as part of the wall.
          if (now.login) { sawWall = true; clearPolls = 0; } else if (sawWall) {
            clearPolls += 1;
            if (clearPolls >= SETTLE_POLLS) { entry.outcome = 'auto'; break; }
          }
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await napOrWake(entry, pollMs);
    }

    // Give the browser back to the agent, whatever the outcome: a window left
    // open would hold the profile and stop every conversation's browser.
    entry.status = 'finishing';
    try {
      if (entry.mode === 'window') {
        if (ops.windowOpen()) await ops.closeWindow();
        page = ops.restore ? await ops.restore(entry.url) : null;
      } else if (ops.finish && entry.outcome !== 'failed') {
        page = await ops.finish();
      }
    } catch (err) {
      entry.error = entry.error || `The browser could not be restored after the sign-in: ${err?.message || err}`;
    }
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
    pending.delete(key);
  }

  const finished = entry.outcome === 'done' || entry.outcome === 'auto';
  const signedIn = finished ? (page ? !page.signInRequired : null) : false;
  let outcome;
  if (entry.outcome === 'failed') outcome = 'failed';
  // 'finished': the person finished but nothing could check the result (no
  // page to restore, or the restore failed) — never reported as signed in.
  else if (finished) outcome = { true: 'signed-in', false: 'not-signed-in' }[String(signedIn)] || 'finished';
  else outcome = entry.outcome;
  return { outcome, signedIn, mode: entry.mode, page, error: entry.error };
}

/** Test seam. */
export function _resetSignIns() {
  for (const entry of pending.values()) { entry.outcome = 'cancelled'; entry.wake(); }
  pending.clear();
}
