/**
 * CONTRACT for the Browser Actions tool: which browser it drives, and how it
 * fails. The verbs themselves are browserActDriver's contract, tested there.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const waitForSurface = vi.fn();
const forgetSurfaceByUrl = vi.fn();
const announceHostSurface = vi.fn();
vi.mock('../../../services/browserSurfaces.js', () => ({
  waitForSurface: (...a) => waitForSurface(...a),
  forgetSurfaceByUrl: (...a) => forgetSurfaceByUrl(...a),
  announceHostSurface: (...a) => announceHostSurface(...a),
  // The real implementation: a registry entry is a widget unless it names the
  // host-cdp transport, which is what a launched browser announces itself as.
  surfaceKind: (s) => (s?.transport === 'host-cdp' ? 'launched' : 'widget'),
}));

const ensureFallbackSurface = vi.fn();
vi.mock('./browserFallbackSurface.js', () => ({
  ensureFallbackSurface: (...a) => ensureFallbackSurface(...a),
  isLoopbackWebSocket: (url) => /^ws:\/\/(127\.0\.0\.1|\[::1\]):\d+\//.test(url || ''),
  launchedBrowserLabel: () => 'Chrome',
}));

const isCanvasTurn = vi.fn();
vi.mock('../../../services/orchestrator/pageContext.js', () => ({
  isCanvasTurn: (...a) => isCanvasTurn(...a),
}));

const performBrowserAction = vi.fn();
const dropDriver = vi.fn();
vi.mock('../../../services/browserActDriver.js', () => ({
  performBrowserAction: (...a) => performBrowserAction(...a),
  dropDriver: (...a) => dropDriver(...a),
  BROWSER_ACTIONS: [
    'navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'read', 'back',
    'wait', 'select', 'hover', 'dialog', 'tabs', 'open', 'focus', 'close', 'console', 'errors', 'requests',
  ],
}));

const ensureLane = vi.fn();
const bindConversation = vi.fn();
vi.mock('../../../services/browserLanes.js', () => ({
  // The real rule: a server conversation id gets a lane; a temp- id does not.
  laneFor: (engine) => {
    const id = engine?.conversationId;
    return typeof id === 'string' && id && !id.startsWith('temp-') ? `conv:${id}` : null;
  },
  ensureLane: (...a) => ensureLane(...a),
  bindConversation: (...a) => bindConversation(...a),
}));

const { default: action } = await import('./ai-browser-act.js');

const WIDGET_CDP = 'ws://127.0.0.1:51234/tok3n';
const LAUNCHED_CDP = 'ws://127.0.0.1:9333/devtools/browser/abc';

/** A chat run: the orchestrator's stand-in engine carries the provider. */
const CHAT = { userId: 'u1', provider: 'anthropic', workspaceState: { id: 'ws_1' } };
/** A workflow run has no provider fields. */
const WORKFLOW = { userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  waitForSurface.mockResolvedValue(null);
  ensureFallbackSurface.mockResolvedValue(LAUNCHED_CDP);
  performBrowserAction.mockResolvedValue({ url: 'https://x/', title: 'X' });
  isCanvasTurn.mockReturnValue(false);
  ensureLane.mockImplementation(async (userId, lane, { cdpUrl, workspaceId }) => ({
    instanceId: `host:${userId}:${lane}`, cdpUrl, transport: 'host-cdp', lane, workspaceId,
  }));
});

describe('which browser it drives', () => {
  it('prefers the widget, and reports it', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP });

    const out = await action.execute({ action: 'read' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.surface).toBe('widget');
    expect(performBrowserAction).toHaveBeenCalledWith('u1', WIDGET_CDP, 'read', expect.anything(), expect.anything());
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('waits for the widget ONLY on a canvas turn, where calling the tool opens one', async () => {
    isCanvasTurn.mockReturnValue(true);
    await action.execute({ action: 'read' }, {}, CHAT);
    expect(waitForSurface.mock.calls[0][2]).toBe(8000);

    isCanvasTurn.mockReturnValue(false);
    await action.execute({ action: 'read' }, {}, CHAT);
    // Elsewhere no widget can ever appear, so waiting would be pure latency —
    // but the zero-wait pass still probes, so an existing widget is found.
    expect(waitForSurface.mock.calls[1][2]).toBe(0);
  });

  it('launches HIDDEN everywhere — a visible OS window is never a side effect', async () => {
    // The first version launched visible in plain desktop chat ("the OS window
    // is the only view there") and the very first real use reported that
    // window as a malfunction. The Browser widget streams any host browser on
    // any surface, so watchability never requires a window.
    for (const [engine, canvas] of [[CHAT, true], [CHAT, false], [WORKFLOW, false]]) {
      ensureFallbackSurface.mockClear();
      isCanvasTurn.mockReturnValue(canvas);
      await action.execute({ action: 'read' }, {}, engine);
      expect(ensureFallbackSurface.mock.calls[0][0].hidden).toBe(true);
    }
  });

  it('announces the launched browser so the widget\'s stream can find it', async () => {
    isCanvasTurn.mockReturnValue(true);
    const out = await action.execute({ action: 'read' }, {}, CHAT);

    expect(out.surface).toBe('Chrome');
    expect(announceHostSurface).toHaveBeenCalledWith('u1', LAUNCHED_CDP, expect.anything());
  });
});

/**
 * THE THREE PLACES A PERSON USES THE BROWSER, and the one driver behind them.
 * Main chat and agent chat are the same shape to this tool (a provider, no
 * canvas); a workspace turn is a canvas turn with a workspace id and, once the
 * widget exists, its instance id; a workflow has no provider at all. Every
 * path ends in performBrowserAction with the same verb and params — which is
 * why a driver improvement lands on all of them at once.
 */
describe('one driver, every surface', () => {
  const MAIN_CHAT = { userId: 'u1', provider: 'openai' };
  const AGENT_CHAT = { userId: 'u1', provider: 'anthropic', agentId: 'agent_7', normalizedProvider: 'anthropic' };
  const WORKSPACE = { userId: 'u1', provider: 'openai', workspaceState: { id: 'ws_9', browserInstanceId: 'inst_3' } };

  it('main chat: no widget can appear, so it probes once and drives a hidden browser', async () => {
    const out = await action.execute({ action: 'navigate', url: 'agnt.gg' }, {}, MAIN_CHAT);
    expect(waitForSurface).toHaveBeenCalledWith('u1', { workspaceId: null, instanceId: null }, 0);
    expect(ensureFallbackSurface.mock.calls[0][0].hidden).toBe(true);
    expect(out.surface).toBe('Chrome');
    expect(performBrowserAction).toHaveBeenCalledWith('u1', LAUNCHED_CDP, 'navigate', expect.objectContaining({ url: 'agnt.gg' }), expect.anything());
  });

  it('agent chat: identical to main chat — an agent is a chat with a different author', async () => {
    const out = await action.execute({ action: 'read' }, {}, AGENT_CHAT);
    expect(waitForSurface.mock.calls[0][2]).toBe(0);
    expect(out.surface).toBe('Chrome');
    expect(performBrowserAction).toHaveBeenCalledWith('u1', LAUNCHED_CDP, 'read', expect.anything(), expect.anything());
  });

  it('workspace: a canvas turn waits for THIS workspace\'s widget instance and drives it', async () => {
    isCanvasTurn.mockReturnValue(true);
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP, transport: 'electron-bridge' });
    const out = await action.execute({ action: 'snapshot' }, {}, WORKSPACE);
    expect(waitForSurface).toHaveBeenCalledWith('u1', { workspaceId: 'ws_9', instanceId: 'inst_3' }, 8000);
    expect(out.surface).toBe('widget');
    expect(performBrowserAction).toHaveBeenCalledWith('u1', WIDGET_CDP, 'snapshot', expect.anything(), expect.anything());
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('workspace with no widget yet: launches hidden and announces it to the workspace', async () => {
    isCanvasTurn.mockReturnValue(true);
    await action.execute({ action: 'snapshot' }, {}, WORKSPACE);
    expect(announceHostSurface).toHaveBeenCalledWith('u1', LAUNCHED_CDP, { workspaceId: 'ws_9' });
  });

  it('the new verbs and their params reach the driver untouched, on every surface', async () => {
    const cases = [
      ['wait', { selector: '#done', timeoutMs: 3000 }],
      ['select', { ref: 'e4', value: 'Canada' }],
      ['dialog', { accept: false, text: 'nope' }],
      ['focus', { tabId: 'T2' }],
      ['requests', { filter: 'failed' }],
      ['press', { key: 'Control+Shift+t' }],
    ];
    for (const engine of [MAIN_CHAT, AGENT_CHAT, WORKSPACE, { userId: 'u1' }]) {
      for (const [verb, params] of cases) {
        performBrowserAction.mockClear();
        // eslint-disable-next-line no-await-in-loop
        const out = await action.execute({ action: verb, ...params }, {}, engine);
        expect(out.success, `${verb} on ${JSON.stringify(engine)}`).toBe(true);
        expect(performBrowserAction).toHaveBeenCalledWith('u1', expect.any(String), verb, expect.objectContaining(params), expect.anything());
      }
    }
  });

  it('driver-level signals (navigated, blockedByDialog, newTab, loopDetected) pass through to the model', async () => {
    performBrowserAction.mockResolvedValue({
      url: 'https://b/', title: 'B', navigated: true, from: 'https://a/', snapshot: 'URL: https://b/',
      blockedByDialog: { type: 'alert', message: 'hi' }, newTab: { id: 'T9' }, loopDetected: true, warning: 'stop',
    });
    const out = await action.execute({ action: 'click', ref: 'e1' }, {}, MAIN_CHAT);
    expect(out).toMatchObject({
      success: true, navigated: true, from: 'https://a/', blockedByDialog: { type: 'alert' }, newTab: { id: 'T9' }, loopDetected: true, warning: 'stop',
    });
  });
});

describe('how it fails', () => {
  it('names the verbs when given a verb it does not have', async () => {
    const out = await action.execute({ action: 'teleport' }, {}, CHAT);
    expect(out.success).toBe(false);
    expect(out.error).toContain('navigate, snapshot, click');
    expect(performBrowserAction).not.toHaveBeenCalled();
  });

  it('forgets a browser that went away, and leaves the connection to its owner', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP });
    performBrowserAction.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:51234'));

    const out = await action.execute({ action: 'read' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/run the action again/i);
    // The surface registry is this tool's record to forget.
    expect(forgetSurfaceByUrl).toHaveBeenCalledWith('u1', WIDGET_CDP);
    // The DRIVER is not. It drops itself inside performBrowserAction, under
    // the per-user lock. Dropping it from out here runs after this verb has
    // settled, when the next queued turn may already hold a NEW connection —
    // and closing that one breaks a verb that is working.
    expect(dropDriver).not.toHaveBeenCalled();
  });

  it('reports a page-level failure as itself, without burning the surface', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP });
    performBrowserAction.mockRejectedValue(new Error('No element @e9 in the current snapshot. Take a snapshot first.'));

    const out = await action.execute({ action: 'click', ref: 'e9' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toContain('@e9');
    expect(forgetSurfaceByUrl).not.toHaveBeenCalled();
  });
});

/**
 * ONE TAB PER CONVERSATION. Every conversation used to drive the same page of
 * the one launched browser, so two chats browsing at once took each other's
 * agent, refs and live view with them.
 */
describe('a conversation drives its own tab', () => {
  const CONVO = (id, extra = {}) => ({ userId: 'u1', provider: 'openai', conversationId: id, ...extra });

  it('goes straight to its lane: no other browser is ever a candidate', async () => {
    await action.execute({ action: 'navigate', url: 'x.com' }, {}, CONVO('c1'));
    // Probing for "the newest unbound browser" is exactly how one chat used
    // to land in another chat's page.
    expect(waitForSurface).not.toHaveBeenCalled();
    expect(ensureLane).toHaveBeenCalledWith('u1', 'conv:c1', { cdpUrl: LAUNCHED_CDP, workspaceId: null });
    expect(performBrowserAction).toHaveBeenCalledWith(
      'u1', LAUNCHED_CDP, 'navigate', expect.anything(), { instanceId: 'host:u1:conv:c1' },
    );
    expect(announceHostSurface).not.toHaveBeenCalled();
  });

  it('two conversations reach two different tabs', async () => {
    await action.execute({ action: 'read' }, {}, CONVO('c1'));
    await action.execute({ action: 'read' }, {}, CONVO('c2'));
    const instances = performBrowserAction.mock.calls.map((call) => call[4].instanceId);
    expect(instances).toEqual(['host:u1:conv:c1', 'host:u1:conv:c2']);
  });

  it('a workspace turn still drives its widget, and the card is told so', async () => {
    isCanvasTurn.mockReturnValue(true);
    waitForSurface.mockResolvedValue({ instanceId: 'inst_3', cdpUrl: WIDGET_CDP, transport: 'electron-bridge' });
    const out = await action.execute({ action: 'read' }, {}, CONVO('c1', { workspaceState: { id: 'ws_9', browserInstanceId: 'inst_3' } }));
    expect(out.surface).toBe('widget');
    expect(ensureLane).not.toHaveBeenCalled();
    expect(bindConversation).toHaveBeenCalledWith('u1', 'conv:c1', 'inst_3');
    expect(performBrowserAction.mock.calls[0][4]).toEqual({ instanceId: 'inst_3' });
  });

  it('a workspace turn with no widget gets its own lane, recorded against the workspace', async () => {
    isCanvasTurn.mockReturnValue(true);
    await action.execute({ action: 'read' }, {}, CONVO('c1', { workspaceState: { id: 'ws_9' } }));
    expect(ensureLane).toHaveBeenCalledWith('u1', 'conv:c1', { cdpUrl: LAUNCHED_CDP, workspaceId: 'ws_9' });
  });

  it('a temp- id or a workflow keeps the shared default tab', async () => {
    await action.execute({ action: 'read' }, {}, CONVO('temp-123'));
    await action.execute({ action: 'read' }, {}, WORKFLOW);
    expect(ensureLane).not.toHaveBeenCalled();
    expect(announceHostSurface).toHaveBeenCalledTimes(2);
  });

  it('losing its own tab does not make every other conversation forget the browser', async () => {
    performBrowserAction.mockRejectedValue(new Error('that browser has no page to show'));
    const out = await action.execute({ action: 'read' }, {}, CONVO('c1'));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/run the action again/i);
    expect(forgetSurfaceByUrl).not.toHaveBeenCalled();
  });

  it('a dead browser is still forgotten, lane or not', async () => {
    performBrowserAction.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9333'));
    await action.execute({ action: 'read' }, {}, CONVO('c1'));
    expect(forgetSurfaceByUrl).toHaveBeenCalledWith('u1', LAUNCHED_CDP);
  });
});
