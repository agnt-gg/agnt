// A REGISTRY SURFACE COMES IN TWO SHAPES, AND BOTH ARE LOCAL.
//
// The registry holds Electron bridges (ws://127.0.0.1:PORT/token) and
// browsers AGNT launched (ws://127.0.0.1:PORT/devtools/browser/<uuid>), the
// second because launched browsers announce themselves so a streamed client
// can watch them. Two defects followed from treating every entry as a bridge,
// both reported from live use on 2026-09-01:
//
//   - Browser Control validated the endpoint with the BRIDGE-shaped regex,
//     which rejects the slashes in a devtools path, and refused a browser it
//     had opened itself: "Refusing to drive a non-local browser endpoint:
//     ws://127.0.0.1:62815/devtools/browser/...".
//   - Both tools reported every entry as kind 'widget', announcing a launched
//     browser to the user as their canvas widget.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const waitForSurface = vi.fn();
const getActiveSurface = vi.fn();
const announceHostSurface = vi.fn();
vi.mock('../../../services/browserSurfaces.js', () => ({
  waitForSurface: (...a) => waitForSurface(...a),
  getActiveSurface: (...a) => getActiveSurface(...a),
  announceHostSurface: (...a) => announceHostSurface(...a),
  forgetSurfaceByUrl: vi.fn(),
  // The REAL predicates — the point of these tests is which one each tool uses.
  isLocalBridgeUrl: (url) => /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(url || ''),
  surfaceKind: (s) => (s?.transport === 'host-cdp' ? 'launched' : 'widget'),
}));

const ensureFallbackSurface = vi.fn();
vi.mock('./browserFallbackSurface.js', () => ({
  ensureFallbackSurface: (...a) => ensureFallbackSurface(...a),
  closeFallbackSurface: vi.fn(),
  isLoopbackWebSocket: (url) => /^ws:\/\/(127\.0\.0\.1|\[::1\]):\d+\//.test(url || ''),
  launchedBrowserLabel: () => 'Google Chrome',
}));

vi.mock('../../../services/orchestrator/pageContext.js', () => ({ isCanvasTurn: () => false }));
vi.mock('./browserUseEnvironment.js', () => ({
  ensureCli: vi.fn(async () => '/venv/bin/browser-use'),
  browserUsePaths: () => ({ python: '/venv/bin/python', cli: '/venv/bin/browser-use' }),
  runProcess: vi.fn(),
  BROWSER_USE_VERSION: '0.13.8',
}));
vi.mock('../../../services/browserActDriver.js', () => ({
  performBrowserAction: vi.fn(),
  dropDriver: vi.fn(),
  BROWSER_ACTIONS: ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'read', 'back'],
}));

const { default: actTool } = await import('./ai-browser-act.js');
const { default: controlTool } = await import('./ai-browser-control.js');

/** What a browser AGNT launched actually reports — slashes and all. */
const HOST = 'ws://127.0.0.1:62815/devtools/browser/1d0d2495-be2a-4cbb-91d1-1c5bc09911a9';
/** What an Electron widget bridge reports. */
const BRIDGE = 'ws://127.0.0.1:51234/tok3n-value';
const CHAT = { userId: 'u1', provider: 'anthropic' };

beforeEach(() => {
  vi.clearAllMocks();
  ensureFallbackSurface.mockResolvedValue(HOST);
  getActiveSurface.mockReturnValue(null);
});

describe('Browser Control and a launched browser', () => {
  it('DRIVES a launched browser from the registry (the reported refusal)', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: HOST, transport: 'host-cdp' });

    const out = await controlTool.resolveSurface(CHAT, 'u1', 0);

    expect(out.cdpUrl).toBe(HOST);
    expect(out.kind).toBe('launched');
  });

  it('still drives an Electron bridge, and still calls it a widget', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: BRIDGE, transport: 'electron-bridge' });

    const out = await controlTool.resolveSurface(CHAT, 'u1', 0);

    expect(out.cdpUrl).toBe(BRIDGE);
    expect(out.kind).toBe('widget');
  });

  it('still refuses an endpoint that is genuinely not local', async () => {
    // The guard must keep its teeth: loosening the SHAPE must not loosen the
    // LOCATION, which is the property that makes driving it safe at all.
    waitForSurface.mockResolvedValue({ cdpUrl: 'ws://10.0.0.5:9222/devtools/browser/abc' });

    await expect(controlTool.resolveSurface(CHAT, 'u1', 0)).rejects.toThrow(/non-local/);
  });
});

describe('Browser Actions reports which browser it drove', () => {
  it('calls a launched browser launched, not a widget', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: HOST, transport: 'host-cdp' });

    const out = await actTool.resolveSurface(CHAT, 'u1');

    expect(out.kind).toBe('launched');
  });

  it('calls an Electron bridge a widget', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: BRIDGE, transport: 'electron-bridge' });

    const out = await actTool.resolveSurface(CHAT, 'u1');

    expect(out.kind).toBe('widget');
  });

  it('treats an entry with no transport as a widget, for older announcements', async () => {
    waitForSurface.mockResolvedValue({ cdpUrl: BRIDGE });

    const out = await actTool.resolveSurface(CHAT, 'u1');

    expect(out.kind).toBe('widget');
  });
});
