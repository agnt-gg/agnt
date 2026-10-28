import BaseAction from '../BaseAction.js';
import actTool from './ai-browser-act.js';
import {
  ensureFallbackSurface, openSignInWindow, closeSignInWindow, isSignInWindowOpen, signInWindowClosed,
} from './browserFallbackSurface.js';
import { laneFor, captureLanePages, reopenLanes } from '../../../services/browserLanes.js';
import { performBrowserAction, inspectBrowserPage } from '../../../services/browserActDriver.js';
import { identityProviderForHost } from '../../../services/browserLoginDetection.js';
import {
  runSignIn, signInScope, isSignInPending, SIGN_IN_TIMEOUT_MS, SIGN_IN_MAX_TIMEOUT_MS,
} from '../../../services/browserSignIn.js';

/**
 * browser action="signin" — hand the page to the person, wait, carry on.
 *
 * The engine behind the browser tool's sign-in. The state machine lives in
 * services/browserSignIn.js; this file binds it to the real browser: which tab
 * (the conversation's lane), how to look at it (the verbs driver, through the
 * same per-tab queue), and how to swap the automation browser for a plain
 * window and back (browserFallbackSurface + browserLanes).
 *
 * Chat only: a sign-in needs a person at the screen. A workflow is told where
 * to sign in once instead (Settings), because the profile is shared.
 */

const log = (message) => console.log(message);

/** A conversation turn, as opposed to a workflow node (same test as the other engines). */
function isChatRun(workflowEngine) {
  return Boolean(workflowEngine?.provider || workflowEngine?.normalizedProvider);
}

/**
 * Where the person signs in. An explicit request wins; then what the page
 * itself needs (a provider that refuses automated browsers needs the window);
 * otherwise the conversation's tab, in the live card.
 */
export function chooseSignInMode({ requested, login, url, surfaceKind }) {
  // A canvas Browser widget is a visible browser with its own cookie jar: a
  // window on the AGNT profile would sign in the wrong browser.
  if (surfaceKind === 'widget') return 'here';
  if (requested === 'window' || requested === 'here') return requested;
  if (login?.window) return 'window';
  try {
    if (identityProviderForHost(new URL(url).hostname)?.window) return 'window';
  } catch { /* not a URL: the page decides */ }
  return 'here';
}

/** What the model is told, by outcome. Page fields come from the verb result after the sign-in. */
export function describeSignIn(result, { minutes }) {
  const page = result.page || {};
  const pageFields = {
    url: page.url, title: page.title, snapshot: page.snapshot, signInRequired: page.signInRequired,
  };
  switch (result.outcome) {
    case 'signed-in':
      return {
        success: true,
        signedIn: true,
        mode: result.mode,
        ...pageFields,
        note: 'The user signed in. The login is saved in the AGNT browser profile, so every conversation and workflow '
          + 'now uses it. Carry on with the task from this page. If the site still shows a "Continue with Google"-style '
          + 'button, click it again: the provider is signed in now.',
      };
    case 'not-signed-in':
      return {
        success: false,
        signedIn: false,
        mode: result.mode,
        ...pageFields,
        error: 'The page still asks for a sign-in. Ask the user whether to try again; do not try to sign in for them.',
      };
    case 'finished':
      return {
        success: false,
        signedIn: null,
        mode: result.mode,
        ...pageFields,
        error: result.error || 'The user finished, but the page could not be checked. Look at it again before carrying on.',
      };
    case 'cancelled':
      return { success: false, signedIn: false, mode: result.mode, ...pageFields, error: 'The user cancelled the sign-in.' };
    case 'stopped':
      return { success: false, signedIn: false, mode: result.mode, error: 'The run was stopped while waiting for the sign-in.' };
    case 'timed-out':
      return {
        success: false,
        signedIn: false,
        mode: result.mode,
        ...pageFields,
        error: `Nobody signed in within ${minutes} minute(s). Ask the user whether to try again.`,
      };
    default:
      return { success: false, signedIn: false, mode: result.mode, error: result.error || 'The sign-in could not be started.' };
  }
}

class AIBrowserSignIn extends BaseAction {
  static schema = {
    title: 'Browser Sign-in',
    category: 'action',
    type: 'ai-browser-signin',
    icon: 'key',
    description: 'Show the user a sign-in page and wait while they sign in. Chat only.',
    parameters: {
      url: {
        required: false,
        type: 'string',
        inputType: 'text',
        description: 'The sign-in page. Defaults to the page the conversation\'s browser is on.',
      },
      mode: {
        required: false,
        type: 'string',
        inputType: 'select',
        options: ['auto', 'here', 'window'],
        description: 'auto (default): a browser window for Google/Microsoft/Apple, otherwise the live view in the chat.',
      },
      timeoutSeconds: {
        required: false,
        type: 'number',
        inputType: 'number',
        description: 'How long to wait for the user (default 600, max 1200).',
      },
    },
    outputs: {
      signedIn: { type: 'boolean', description: 'True once the page no longer asks for a sign-in' },
      mode: { type: 'string', description: '"here" (the live view in the chat) or "window" (a separate browser window)' },
      url: { type: 'string', description: 'Where the page is after the sign-in' },
      snapshot: { type: 'string', description: 'The page after the sign-in, with @refs' },
      note: { type: 'string', description: 'What to do next' },
      error: { type: 'string', description: 'Why the sign-in did not complete' },
    },
  };

  constructor() {
    super('ai-browser-signin');
  }

  async execute(params, _inputData, workflowEngine) {
    if (!isChatRun(workflowEngine)) {
      return this.formatOutput({
        success: false,
        error: 'Signing in needs the person at the screen, so it only runs in a conversation. Sign in once from '
          + 'Settings › Browser › Signed-in sites: the AGNT browser profile is shared, so workflows use that login.',
      });
    }
    const userId = workflowEngine?.userId;
    if (!userId) return this.formatOutput({ success: false, error: 'Sign-in could not identify the user for this run.' });

    const lane = laneFor(workflowEngine);
    const scope = signInScope(lane);
    if (isSignInPending(userId, scope)) {
      return this.formatOutput({ success: false, error: 'A sign-in is already waiting in this conversation. Wait for it, or ask the user to cancel it.' });
    }

    const seconds = Math.min(Math.max(Number(params.timeoutSeconds) || SIGN_IN_TIMEOUT_MS / 1000, 10), SIGN_IN_MAX_TIMEOUT_MS / 1000);
    try {
      let surface = await actTool.resolveSurface(workflowEngine, userId);
      const on = () => ({ instanceId: surface.instanceId });
      if (String(params.url || '').trim()) {
        await performBrowserAction(userId, surface.cdpUrl, 'navigate', { url: params.url }, on());
      }
      const first = await inspectBrowserPage(userId, surface.cdpUrl, on());
      if (!/^https?:\/\//i.test(first.url || '')) {
        return this.formatOutput({
          success: false,
          error: 'There is no web page to sign in to yet. Pass url (the site\'s sign-in page), or navigate there first.',
        });
      }
      const mode = chooseSignInMode({
        requested: String(params.mode || '').trim().toLowerCase(), login: first.login, url: first.url, surfaceKind: surface.kind,
      });

      // Pages of every other conversation, so they come back after the window.
      let otherPages = [];
      const result = await runSignIn({
        userId,
        scope,
        url: first.url,
        initialLogin: first.login,
        mode,
        timeoutMs: seconds * 1000,
        signal: workflowEngine?.abortSignal || null,
        ops: {
          canUseWindow: surface.kind !== 'widget',
          inspect: () => inspectBrowserPage(userId, surface.cdpUrl, on()),
          finish: () => performBrowserAction(userId, surface.cdpUrl, 'snapshot', {}, on()),
          openWindow: async (url) => {
            otherPages = await captureLanePages();
            await openSignInWindow({ url, log });
          },
          windowOpen: () => isSignInWindowOpen(),
          windowClosed: () => signInWindowClosed(),
          closeWindow: () => closeSignInWindow({ log }),
          restore: async (url) => {
            const cdpUrl = await ensureFallbackSurface({ hidden: true, log });
            await reopenLanes(otherPages, cdpUrl, { except: surface.instanceId });
            surface = await actTool.resolveSurface(workflowEngine, userId);
            return performBrowserAction(userId, surface.cdpUrl, 'navigate', { url }, on());
          },
        },
      });
      return this.formatOutput(describeSignIn(result, { minutes: Math.round(seconds / 60) || 1 }));
    } catch (err) {
      console.error('[Browser Sign-in] failed:', err);
      return this.formatOutput({ success: false, signedIn: false, error: err?.message || 'The sign-in could not be started.' });
    }
  }
}

export default new AIBrowserSignIn();
