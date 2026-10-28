/**
 * The sign-in WINDOW flow, shared by the two places a person signs in:
 * a conversation (browser action="signin") and Settings › Browser.
 *
 * One sequence, so it is written once: remember every conversation's page,
 * hand the profile to a plain window, and when the person is done bring the
 * automation browser back with every conversation's page where it was.
 * The waiting itself is browserSignIn.runSignIn; this supplies its window ops.
 */

import {
  ensureFallbackSurface, openSignInWindow, closeSignInWindow, isSignInWindowOpen, signInWindowClosed,
} from '../tools/library/browserEngines/browserFallbackSurface.js';
import { captureLanePages, reopenLanes } from './browserLanes.js';
import {
  runSignIn, getSignIn, isSignInPending, SIGN_IN_TIMEOUT_MS,
} from './browserSignIn.js';

/**
 * The window half of runSignIn's ops.
 * @param {object} [options]
 * @param {Function} [options.log]
 * @param {string|null} [options.keepLane]  a lane the caller restores itself (its own page)
 * @param {Function|null} [options.restorePage] (url, cdpUrl) => verb result for the caller's page, after the browser is back
 */
export function signInWindowOps({ log = console.log, keepLane = null, restorePage = null } = {}) {
  let otherPages = [];
  return {
    openWindow: async (url) => {
      otherPages = await captureLanePages();
      await openSignInWindow({ url, log });
    },
    windowOpen: () => isSignInWindowOpen(),
    windowClosed: () => signInWindowClosed(),
    closeWindow: () => closeSignInWindow({ log }),
    restore: async (url) => {
      const cdpUrl = await ensureFallbackSurface({ hidden: true, log });
      await reopenLanes(otherPages, cdpUrl, { except: keepLane });
      return restorePage ? restorePage(url, cdpUrl) : null;
    },
  };
}

// ─── Settings › Browser › "Sign in to a site…" ───────────────────────────────

export const SETTINGS_SCOPE = 'settings';

/** userId -> how the last Settings sign-in ended, so the page can say so after the wait is gone. */
const lastSettingsResults = new Map();

/**
 * Start a sign-in from Settings: always the window (no conversation, no live
 * card), and nothing to check afterwards but the site list itself. Returns at
 * once; the wait runs in the background and is answered from the page.
 * @returns {object} getSignIn() for the new sign-in
 */
export function startSettingsSignIn(userId, url, { log = console.log } = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\/[^\s/]+/i.test(target)) throw new Error('Enter the web address of the site to sign in to (https://…).');
  if (isSignInPending(userId, SETTINGS_SCOPE)) throw new Error('A sign-in window is already open. Finish or cancel it first.');

  lastSettingsResults.delete(userId);
  const host = (() => { try { return new URL(target).host; } catch { return null; } })();
  runSignIn({
    userId,
    scope: SETTINGS_SCOPE,
    url: target,
    mode: 'window',
    timeoutMs: SIGN_IN_TIMEOUT_MS,
    ops: { canUseWindow: true, inspect: async () => null, ...signInWindowOps({ log }) },
  }).then(
    (result) => lastSettingsResults.set(userId, { outcome: result.outcome, error: result.error, host, at: Date.now() }),
    (err) => lastSettingsResults.set(userId, { outcome: 'failed', error: err?.message || String(err), host, at: Date.now() }),
  );
  return getSignIn(userId, SETTINGS_SCOPE);
}

/** How the last Settings sign-in ended, or null. */
export function lastSettingsSignIn(userId) {
  return lastSettingsResults.get(userId) || null;
}

/** Test seam. */
export function _resetSettingsSignIns() {
  lastSettingsResults.clear();
}
