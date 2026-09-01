import BaseAction from '../BaseAction.js';
import {
  waitForSurface, forgetSurfaceByUrl, announceHostSurface,
} from '../../../services/browserSurfaces.js';
import {
  ensureFallbackSurface, isLoopbackWebSocket, launchedBrowserLabel,
} from './browserFallbackSurface.js';
import { isCanvasTurn } from '../../../services/orchestrator/pageContext.js';
import { performBrowserAction, dropDriver, BROWSER_ACTIONS } from '../../../services/browserActDriver.js';

/**
 * Browser Actions — the agent drives the browser with deterministic verbs.
 *
 * WHY A THIRD BROWSER TOOL, AND WHICH ONE TO REACH FOR
 * ----------------------------------------------------
 * The three tools are three answers to "who does the reasoning?":
 *
 *   ai-browser-use      a NESTED agent reasons. Hand it a sentence, it runs its
 *                       own perceive-decide-act loop with its own LLM. Right
 *                       for a workflow firing at 3am with nobody in the loop.
 *   ai-browser-control  the CALLING agent reasons, by writing Python executed
 *                       in a browser-use daemon. Powerful escape hatch (raw
 *                       CDP), but every step pays a venv + daemon spawn, and
 *                       the model writes code against a page it cannot see.
 *   ai-browser-act      the CALLING agent reasons, with VERBS. snapshot shows
 *                       the page as an accessibility tree with @refs; click and
 *                       type act on those refs; each call is milliseconds of
 *                       CDP in-process. No Python, no daemon, no second model.
 *
 * This is the architecture every fast production browser agent converged on
 * (Grok's bot, ChatGPT's agent/Atlas, OpenClaw, Playwright MCP): the agent IS
 * the loop, and it sees structure, not pixels.
 *
 * WHY THIS ONE IS NOT chatOnly
 * ----------------------------
 * ai-browser-control is chat-gated because its parameter is a PROGRAM, and
 * workflow node parameters are templated from trigger data — text arriving
 * from Discord or a webhook must never become code. This tool's parameters are
 * data acted on by fixed verbs: a hostile url or ref is the same risk class as
 * the HTTP-request node's url, which workflows already carry. So agents and
 * workflows get it too — which is the point: agents controlling browsers
 * themselves.
 */
class AIBrowserAct extends BaseAction {
  static schema = {
    title: 'Browser Actions',
    category: 'action',
    type: 'ai-browser-act',
    icon: 'globe',
    description: 'The FAST way to browse: drive the browser directly with deterministic verbs — no nested agent, no code, each call is milliseconds. The loop: action="navigate" with url, then action="snapshot" to see the page as an accessibility tree where every interactive element has a @ref, then action="click" or "type" with that ref — and snapshot again after anything changes, because refs die on navigation. snapshot takes query to filter big pages; "read" returns the page text; "press" sends a key (Enter submits); "scroll" moves the viewport; "back" is history. A browser is always available: it drives the Browser widget when one is open and quietly opens a clean browser otherwise — never ask the user to open one. Prefer this for all interactive browsing; use ai_browser_use only to hand a whole task to an autonomous agent, and ai-browser-control only when you need raw Python/CDP.',
    parameters: {
      action: {
        type: 'string',
        inputType: 'text',
        description: 'One of: navigate, snapshot, click, type, press, scroll, read, back.',
      },
      url: {
        type: 'string',
        inputType: 'text',
        description: 'For navigate: where to go. A bare domain is fine — https:// is assumed.',
      },
      ref: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For click/type: the @ref from the latest snapshot, e.g. "e12" or "@e12".',
      },
      text: {
        type: 'string',
        inputType: 'text',
        description: 'For type: replaces what is in the field (it is selected first).',
      },
      submit: {
        type: 'boolean',
        inputType: 'checkbox',
        inputSize: 'half',
        default: false,
        description: 'For type: press Enter afterwards.',
      },
      key: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For press: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End.',
      },
      deltaY: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        default: 600,
        description: 'For scroll: pixels; positive scrolls down.',
      },
      selector: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For read: optional CSS selector; whole page when blank.',
      },
      query: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For snapshot: only include elements whose name or role contains this.',
      },
      maxChars: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        description: 'Cap for snapshot (default 8000) and read (default 6000).',
      },
    },
    outputs: {
      url: { type: 'string', description: 'Where the page is after the action' },
      title: { type: 'string', description: 'The page title after the action' },
      snapshot: { type: 'string', description: 'The accessibility tree with @refs (snapshot only)' },
      text: { type: 'string', description: 'The page text (read only)' },
      surface: { type: 'string', description: '"widget" for the canvas Browser widget, otherwise the launched browser' },
      error: { type: 'string', description: 'Why the action could not be performed' },
    },
  };

  constructor() {
    super('ai-browser-act');
  }

  async execute(params, _inputData, workflowEngine) {
    const action = String(params?.action || '').trim();
    if (!BROWSER_ACTIONS.includes(action)) {
      return this.formatOutput({
        success: false,
        error: `Unknown browser action "${action}". One of: ${BROWSER_ACTIONS.join(', ')}.`,
      });
    }

    const userId = workflowEngine?.userId;
    if (!userId) {
      return this.formatOutput({ success: false, error: 'Browser Actions could not identify the user for this run.' });
    }

    let cdpUrl = null;
    try {
      const surface = await this.resolveSurface(workflowEngine, userId);
      cdpUrl = surface.cdpUrl;

      const result = await performBrowserAction(userId, cdpUrl, action, params);

      return this.formatOutput({
        success: true,
        surface: surface.kind === 'launched' ? (launchedBrowserLabel() || 'launched') : surface.kind,
        ...result,
        error: null,
      });
    } catch (err) {
      // A dead endpoint here is the browser going away between the registry's
      // probe and our verb. Forget every record of it — the surface entry AND
      // the driver — so the obvious next move ("try again") starts clean
      // instead of replaying the same refused socket.
      if (cdpUrl && /not open|connection closed|connection errored|ECONNREFUSED|refused|no page to show/i.test(err?.message || '')) {
        forgetSurfaceByUrl(userId, cdpUrl);
        dropDriver(userId);
        return this.formatOutput({
          success: false,
          error: 'The browser this was driving is no longer reachable. It has been forgotten — '
            + 'run the action again and a fresh browser will be used.',
        });
      }
      console.error('[Browser Actions] failed:', err);
      return this.formatOutput({ success: false, error: err?.message || 'Unknown error occurred' });
    }
  }

  /**
   * The browser to drive: the widget when there is one, otherwise one we open.
   *
   * Same resolution the other browser tools use, same reasons: the widget is
   * preferred because it sits beside the conversation; the fallback is a
   * browser AGNT OWNS with a clean profile, never the user's.
   *
   * The wait is paid only on a canvas turn, where calling the tool auto-opens
   * the widget and the two race. Anywhere else no widget can appear and the
   * wait would be pure latency — but waitForSurface(0) still runs one probing
   * pass, so an EXISTING widget is found and dead entries are pruned.
   */
  async resolveSurface(workflowEngine, userId) {
    const workspaceId = workflowEngine?.workspaceState?.id || null;
    const instanceId = workflowEngine?.workspaceState?.browserInstanceId || null;
    const isChat = Boolean(workflowEngine?.provider || workflowEngine?.normalizedProvider);

    const appearWait = isChat && isCanvasTurn(workflowEngine) ? 8000 : 0;
    const surface = await waitForSurface(userId, { workspaceId, instanceId }, appearWait);
    if (surface) return { cdpUrl: surface.cdpUrl, kind: 'widget' };

    // hidden except in plain desktop chat: on a canvas the streamed widget is
    // the window, and in a workflow nobody is watching — but in main chat with
    // no canvas an OS window is the only way the user can see anything.
    const hidden = !isChat || isCanvasTurn(workflowEngine);
    const cdpUrl = await ensureFallbackSurface({ hidden, log: (m) => console.log(m) });
    if (!isLoopbackWebSocket(cdpUrl)) {
      throw new Error(`Refusing to drive a non-local browser endpoint: ${cdpUrl}`);
    }
    announceHostSurface(userId, cdpUrl, { workspaceId });
    return { cdpUrl, kind: 'launched' };
  }
}

export default new AIBrowserAct();
