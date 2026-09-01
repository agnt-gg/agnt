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
  BROWSER_ACTIONS: ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'read', 'back'],
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
});

describe('which browser it drives', () => {
  it('prefers the widget, and reports it', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP });

    const out = await action.execute({ action: 'read' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.surface).toBe('widget');
    expect(performBrowserAction).toHaveBeenCalledWith('u1', WIDGET_CDP, 'read', expect.anything());
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

describe('how it fails', () => {
  it('names the verbs when given a verb it does not have', async () => {
    const out = await action.execute({ action: 'hover' }, {}, CHAT);
    expect(out.success).toBe(false);
    expect(out.error).toContain('navigate, snapshot, click');
    expect(performBrowserAction).not.toHaveBeenCalled();
  });

  it('forgets a browser that went away — surface AND driver — so retry starts clean', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: WIDGET_CDP });
    performBrowserAction.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:51234'));

    const out = await action.execute({ action: 'read' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/run the action again/i);
    // Both records of the dead browser, not just one — a forgotten surface
    // with a cached driver still replays the dead socket.
    expect(forgetSurfaceByUrl).toHaveBeenCalledWith('u1', WIDGET_CDP);
    expect(dropDriver).toHaveBeenCalledWith('u1');
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
