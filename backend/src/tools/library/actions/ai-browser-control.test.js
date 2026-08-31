/**
 * CONTRACT: Browser Control runs model-authored Python, so the interesting
 * assertions are all about what it REFUSES.
 *
 * Four properties are load-bearing, and each is a way this could go wrong
 * silently rather than loudly:
 *
 *   1. It never runs outside a conversation. A workflow node's parameters are
 *      templated from trigger data — Discord, email, a webhook — and this tool's
 *      parameter is a program. browserUseRunner.js exists because its
 *      predecessor concatenated exactly that data into a `python -c` payload.
 *
 *   2. It never attaches to a browser the USER owns. Left alone, browser-harness
 *      finds a DevToolsActivePort and drives whatever Chrome they have open,
 *      with their real logged-in sessions. When no widget is available it must
 *      open a CLEAN browser of its own instead — never adopt theirs.
 *
 *   3. It never inherits BU_NAME or BU_CDP_URL. A named daemon gives itself a
 *      dedicated tab via Target.createTarget, which the single-webview surface
 *      refuses outright; BU_CDP_URL is an HTTP endpoint the widget does not
 *      serve. Both are plausible leftovers in a developer's shell, and both fail
 *      in ways that look nothing like their cause.
 *
 *   4. It never runs a program against a daemon it has not aimed and verified.
 *      THIS ONE SHIPPED BROKEN. See "the shared daemon follows the widget".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const waitForSurface = vi.fn();
const forgetSurfaceByUrl = vi.fn();
/** What the registry BELIEVES, before any liveness probe. */
const getActiveSurface = vi.fn();
const ensureFallbackSurface = vi.fn();
const closeFallbackSurface = vi.fn();
/** A launched browser announces itself so a streamed client can watch it. */
const announceHostSurface = vi.fn();
/** What the launcher reports it has open; null when nothing is launched. */
let launchedLabel = null;
const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
const spawn = vi.fn();

vi.mock('../../../services/browserSurfaces.js', () => ({
  waitForSurface: (...a) => waitForSurface(...a),
  forgetSurfaceByUrl: (...a) => forgetSurfaceByUrl(...a),
  getActiveSurface: (...a) => getActiveSurface(...a),
  announceHostSurface: (...a) => announceHostSurface(...a),
  // The real predicate: only ws://127.0.0.1:<port>/<token> is a local bridge.
  isLocalBridgeUrl: (url) => /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(url || ''),
}));

vi.mock('./browserUseEnvironment.js', () => ({
  ensureCli: vi.fn().mockResolvedValue('/venv/bin/browser-use'),
  browserUsePaths: () => ({ python: '/venv/bin/python', cli: '/venv/bin/browser-use' }),
  runProcess: (...a) => runProcess(...a),
  BROWSER_USE_VERSION: '0.13.8',
}));

vi.mock('./browserFallbackSurface.js', () => ({
  ensureFallbackSurface: (...a) => ensureFallbackSurface(...a),
  closeFallbackSurface: (...a) => closeFallbackSurface(...a),
  launchedBrowserLabel: () => launchedLabel,
  // The real predicate: any loopback ws:// endpoint, since a launched browser
  // picks its own port and path.
  isLoopbackWebSocket: (url) => /^ws:\/\/(127\.0\.0\.1|\[::1\]):\d+\//.test(url || ''),
}));

vi.mock('child_process', () => ({ spawn: (...a) => spawn(...a) }));

const { default: action, _resetDaemonEndpoint, stripHarnessNoise } = await import('./ai-browser-control.js');

const CDP = 'ws://127.0.0.1:51234/tok3n';
const OTHER_CDP = 'ws://127.0.0.1:60000/other';
/** What a browser we launched looks like: Chrome's own devtools path. */
const LAUNCHED_CDP = 'ws://127.0.0.1:9222/devtools/browser/abc-123';
/** Main chat: a conversation with no canvas, so `workspaceState` is absent. */
const CHAT = { userId: 'u1', provider: 'Anthropic', model: 'claude-sonnet-4-5' };
/** The Workspace canvas, which sends workspaceState and auto-opens the widget. */
const CANVAS = {
  userId: 'u1',
  provider: 'Anthropic',
  model: 'claude-sonnet-4-5',
  workspaceState: { id: 'ws1', browserInstanceId: 'w1' },
};
const WORKFLOW = { userId: 'u1' };

/**
 * How many targets the preflight probe reports.
 *
 * The probe and the user's program go through the SAME spawn and are only
 * distinguishable by what lands on stdin. Separating them here is what lets a
 * test say "the program fails" without the preflight failing first — an earlier
 * version of this file replaced `spawn` wholesale and the preflight silently
 * ate every payload.
 */
let preflightTargets;

/** What the user's program does: () => ({ stdout, stderr, code }) or 'hang'. */
let programBehaviour;

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Only ever called on timeout, where the real code resolves on 'close'.
  child.kill = vi.fn(() => child.emit('close', null));
  child.stdin = {
    written: '',
    on: vi.fn(),
    write(text) { this.written += text; },
    end() {
      const program = this.written;
      const outcome = program.includes('__AGNT_TARGETS__')
        ? { stdout: `__AGNT_TARGETS__ ${preflightTargets}` }
        : programBehaviour(program);
      if (outcome === 'hang') return;
      setImmediate(() => {
        if (outcome.stdout) child.stdout.emit('data', Buffer.from(outcome.stdout));
        if (outcome.stderr) child.stderr.emit('data', Buffer.from(outcome.stderr));
        child.emit('close', outcome.code ?? 0);
      });
    },
  };
  return child;
}

const envOf = (call) => call[2].env;
/** The child that ran the user's program — the last one spawned. */
const lastProgram = () => spawn.mock.results[spawn.mock.results.length - 1].value.stdin.written;

beforeEach(() => {
  vi.clearAllMocks();
  _resetDaemonEndpoint();
  runProcess.mockResolvedValue({ stdout: '', stderr: '' });
  waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: CDP });
  getActiveSurface.mockReturnValue(null);
  ensureFallbackSurface.mockResolvedValue(LAUNCHED_CDP);
  launchedLabel = null;
  preflightTargets = 1;
  programBehaviour = () => ({ stdout: 'hello from the page' });
  spawn.mockImplementation(() => makeChild());
  delete process.env.BU_NAME;
  delete process.env.BU_CDP_URL;
});

afterEach(() => {
  delete process.env.BU_NAME;
  delete process.env.BU_CDP_URL;
});

describe('it only runs where a person is present', () => {
  it('refuses a workflow run, and does not spawn anything', async () => {
    const out = await action.execute({ python: 'print(page_info())' }, {}, WORKFLOW);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only runs in a conversation/i);
    // Naming the alternative is the difference between a dead end and a
    // redirect: the workflow answer is the Browser Agent node.
    expect(out.error).toMatch(/ai-browser-use/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a workflow run even when a browser surface is available', async () => {
    // The gate must not be reachable via "well, there IS a widget open".
    waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: CDP });
    const out = await action.execute({ python: 'print(1)' }, {}, WORKFLOW);
    expect(out.success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs for a chat turn', async () => {
    const out = await action.execute({ python: 'print(page_info())' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.output).toBe('hello from the page');
    // Preflight, then the program.
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(lastProgram()).toBe('print(page_info())');
  });

  it('declares itself chat-only, which is what keeps it out of the node palette', () => {
    expect(action.constructor.schema.chatOnly).toBe(true);
  });

  it('refuses an empty program', async () => {
    const out = await action.execute({ python: '   ' }, {}, CHAT);
    expect(out.success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('it only ever drives a browser AGNT is rendering', () => {
  it('LAUNCHES a clean browser when no widget is open, instead of refusing', async () => {
    // It used to fail here, on the reasoning that any fallback meant the user's
    // own Chrome. That conflated "do not touch their browser" with "do not open
    // one", and failed for a reason they could do nothing useful about.
    waitForSurface.mockResolvedValue(null);

    const out = await action.execute({ python: 'print(page_info())' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(ensureFallbackSurface).toHaveBeenCalledTimes(1);
    expect(envOf(spawn.mock.calls[0]).BU_CDP_WS).toBe(LAUNCHED_CDP);
    // Reported, so the assistant can say where the window came from.
    expect(out.surface).toBe('launched');

    // THE LINE THAT MAKES A WEB CLIENT WORK. A browser tab has no <webview>, so
    // it always lands here — and without this announcement the work happens on
    // the host with no registry entry for a viewer to subscribe to, which is
    // the invisible-agent bug wearing a different hat.
    expect(announceHostSurface).toHaveBeenCalledWith('u1', LAUNCHED_CDP, expect.anything());
  });

  it('announces a NAMED browser too, because a headless host has no window either', async () => {
    // "Open Brave and go to X" opens a separate OS window on a desktop. On a
    // server there is no window, and the person who asked still has to be able
    // to see what it did.
    waitForSurface.mockResolvedValue(null);
    await action.execute({ python: 'print(1)', browser: 'brave' }, {}, CHAT);
    expect(announceHostSurface).toHaveBeenCalledWith('u1', LAUNCHED_CDP, expect.anything());
  });

  it('does NOT announce a host surface when the widget is driven', async () => {
    // The widget announced itself; a second entry under a different id would be
    // two registry rows for one browser, and the newest-wins rule would start
    // handing turns to whichever was refreshed last.
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    expect(announceHostSurface).not.toHaveBeenCalled();
  });

  it('prefers the widget and never launches when one is reachable', async () => {
    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.surface).toBe('widget');
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('a NAMED browser skips the widget, because the widget cannot be Brave', async () => {
    // The widget is an Electron surface. "Open Brave and go to X" cannot be
    // satisfied by it at all, so quietly using it would answer a different
    // question than the one asked. Same precedent as externalWindow on the
    // Browser Agent: an explicit human instruction outranks the default.
    waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: CDP });
    launchedLabel = 'Brave';

    const out = await action.execute({ python: 'print(1)', browser: 'brave' }, {}, CHAT);

    expect(ensureFallbackSurface).toHaveBeenCalledWith(expect.objectContaining({ browser: 'brave' }));
    expect(envOf(spawn.mock.calls[0]).BU_CDP_WS).toBe(LAUNCHED_CDP);
    // Reported by NAME, so the user knows which window opened.
    expect(out.surface).toBe('Brave');
  });

  it('does not even look for a widget when a browser is named', async () => {
    await action.execute({ python: 'print(1)', browser: 'brave' }, {}, CANVAS);
    expect(waitForSurface).not.toHaveBeenCalled();
  });

  it('reports a named browser that is not installed, by name', async () => {
    ensureFallbackSurface.mockRejectedValue(new Error('Vivaldi does not appear to be installed on this machine.'));

    const out = await action.execute({ python: 'print(1)', browser: 'vivaldi' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Vivaldi does not appear to be installed/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ignores a blank browser value rather than treating it as a request', async () => {
    const out = await action.execute({ python: 'print(1)', browser: '   ' }, {}, CHAT);
    expect(out.surface).toBe('widget');
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('MAIN CHAT: launches at once instead of waiting for a widget that cannot appear', async () => {
    // There is no canvas in main chat, so TOOL_WIDGET_MAP cannot open a Browser
    // widget and nothing will ever announce itself. Polling the full timeout
    // there is eight seconds of dead air before the browser it was always going
    // to launch.
    waitForSurface.mockResolvedValue(null);

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.surface).toBe('launched');
    expect(waitForSurface).toHaveBeenCalledWith('u1', expect.anything(), 0);
  });

  it('CANVAS: still waits for the widget it just opened', async () => {
    // The canvas mounts the widget as this tool is called, so the backend gets
    // here while the webview is still attaching its debugger. Removing this
    // wait would make the first "go look at X" of a session open a second,
    // separate browser next to the widget the user just watched appear.
    waitForSurface.mockResolvedValue(null);

    await action.execute({ python: 'print(1)' }, {}, CANVAS);

    expect(waitForSurface).toHaveBeenCalledWith('u1', expect.anything(), 8000);
  });

  it('MAIN CHAT: still waits when a widget is open in a workspace elsewhere', async () => {
    // A turn that is not workspace-bound may legitimately drive whichever
    // browser the account has open. That one is worth waiting for.
    getActiveSurface.mockReturnValue({ instanceId: 'w9', cdpUrl: CDP });
    waitForSurface.mockResolvedValue(null);

    await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(waitForSurface).toHaveBeenCalledWith('u1', expect.anything(), 8000);
  });

  it('waits for a registered-but-unreachable widget before opening anything', async () => {
    // A widget IS on screen with a dropped bridge, which repairs itself on the
    // widget's own heartbeat. Opening a second window beside the one the user is
    // already watching would be worse than waiting a moment for it to recover.
    getActiveSurface.mockReturnValue({ instanceId: 'w1', cdpUrl: CDP });
    waitForSurface
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ instanceId: 'w1', cdpUrl: CDP });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(waitForSurface).toHaveBeenCalledTimes(2);
    expect(out.surface).toBe('widget');
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('launches if the unreachable widget never recovers', async () => {
    getActiveSurface.mockReturnValue({ instanceId: 'w1', cdpUrl: CDP });
    waitForSurface.mockResolvedValue(null);

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.surface).toBe('launched');
  });

  it('reports why it could not open one, when it cannot', async () => {
    waitForSurface.mockResolvedValue(null);
    ensureFallbackSurface.mockRejectedValue(new Error('no Chrome, Chromium or Edge could be found'));

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/could be found/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a launched endpoint that is somehow not loopback', async () => {
    waitForSurface.mockResolvedValue(null);
    ensureFallbackSurface.mockResolvedValue('ws://10.0.0.5:9222/devtools/browser/abc');

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/non-local browser endpoint/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('closes the LAUNCHED browser when its connection is refused, so the retry reopens', async () => {
    waitForSurface.mockResolvedValue(null);
    programBehaviour = () => ({
      stderr: 'RuntimeError: Failed to establish CDP connection', code: 1,
    });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(closeFallbackSurface).toHaveBeenCalled();
    // A launched browser is ours, so it is not the registry's to forget.
    expect(forgetSurfaceByUrl).not.toHaveBeenCalled();
    expect(out.error).toMatch(/run the step again/i);
  });

  it('refuses an endpoint that is not a loopback bridge', async () => {
    waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: 'ws://10.0.0.5:9222/devtools/browser/abc' });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/non-local browser endpoint/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('forgets a surface whose bridge is gone, so the retry can succeed', async () => {
    programBehaviour = () => ({
      stderr: 'RuntimeError: Failed to establish CDP connection', code: 1,
    });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(forgetSurfaceByUrl).toHaveBeenCalledWith('u1', CDP);
    expect(out.error).toMatch(/no longer open/i);
  });
});

describe('the environment it hands the CLI', () => {
  it('points it at the widget with BU_CDP_WS', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    expect(envOf(spawn.mock.calls[0]).BU_CDP_WS).toBe(CDP);
    expect(envOf(spawn.mock.calls[1]).BU_CDP_WS).toBe(CDP);
  });

  it('CLEARS an inherited BU_NAME and BU_CDP_URL', async () => {
    // A named daemon calls Target.createTarget, which the single-tab surface
    // refuses; BU_CDP_URL points at HTTP discovery the bridge does not serve.
    process.env.BU_NAME = 'leftover-from-a-shell';
    process.env.BU_CDP_URL = 'http://127.0.0.1:9222';

    await action.execute({ python: 'print(1)' }, {}, CHAT);

    const env = envOf(spawn.mock.calls[0]);
    // undefined, not "undefined": Node omits undefined keys from the child's
    // environment entirely, which is what makes this a clear rather than an
    // overwrite with a string that would still select a named daemon.
    expect(env.BU_NAME).toBeUndefined();
    expect(env.BU_CDP_URL).toBeUndefined();
  });

  it('leaves telemetry, cloud sync, recording and domain skills off', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    const env = envOf(spawn.mock.calls[0]);
    expect(env.ANONYMIZED_TELEMETRY).toBe('false');
    expect(env.BROWSER_USE_CLOUD_SYNC).toBe('false');
    expect(env.BH_RECORD).toBe('0');
    expect(env.BH_DOMAIN_SKILLS).toBe('0');
  });

  it('sends the program on stdin, never as an argument', async () => {
    // The whole reason browserUseRunner.js exists. An argument is a place for
    // quoting to go wrong; stdin is not.
    await action.execute({ python: 'print(page_info())' }, {}, CHAT);

    for (const call of spawn.mock.calls) expect(call[1]).toEqual([]);
    expect(lastProgram()).toBe('print(page_info())');
  });
});

describe('the shared daemon follows the widget', () => {
  it('AIMS THE DAEMON ON THE FIRST CALL, and proves it sees the surface', async () => {
    // THE BUG THAT SHIPPED. The first version skipped the restart when it had
    // not yet aimed the daemon itself, reasoning there was nothing of ours to
    // replace. But the daemon is a detached process that OUTLIVES the backend,
    // and a live daemon never re-reads BU_CDP_WS. After an app restart it was
    // still bound to a dead bridge from the previous session, reported zero
    // targets, was judged healthy by upstream's probe (an empty target list is
    // still a "result"), and a navigation then "succeeded" against a page in no
    // visible window — while the user's widget sat on a completely different
    // page and the tool reported the ghost as fact.
    await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1].join(' ')).toMatch(/admin\.restart_daemon\(\)/);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(envOf(spawn.mock.calls[0]).BU_CDP_WS).toBe(CDP);
  });

  it('REFUSES to run the program when the daemon sees no targets', async () => {
    preflightTargets = 0;

    const out = await action.execute({ python: 'print(page_info())' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/cannot see the Browser widget/i);
    // Exactly one spawn: the preflight. The user's program never ran, so it
    // cannot report a confident result about a window nobody is looking at.
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('re-aims on the next call after a failed preflight', async () => {
    preflightTargets = 0;
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    runProcess.mockClear();

    preflightTargets = 1;
    const out = await action.execute({ python: 'print(2)' }, {}, CHAT);

    // A bad daemon must not be remembered as the aimed one.
    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it('does not restart while the surface is unchanged', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    runProcess.mockClear();
    spawn.mockClear();

    await action.execute({ python: 'print(2)' }, {}, CHAT);

    expect(runProcess).not.toHaveBeenCalled();
    // No preflight either: the daemon is already proven for this endpoint.
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('restarts when the surface changes', async () => {
    // ensure_daemon only self-heals a DEAD connection. With two widgets open the
    // old one is alive and healthy, so nothing upstream would notice that it is
    // the wrong window — the same cross-window bug browserSurfaces.js guards.
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    runProcess.mockClear();
    spawn.mockClear();
    waitForSurface.mockResolvedValue({ instanceId: 'w2', cdpUrl: OTHER_CDP });

    await action.execute({ python: 'print(2)' }, {}, CHAT);

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1].join(' ')).toMatch(/admin\.restart_daemon\(\)/);
    expect(envOf(spawn.mock.calls[0]).BU_CDP_WS).toBe(OTHER_CDP);
    expect(envOf(spawn.mock.calls[1]).BU_CDP_WS).toBe(OTHER_CDP);
  });

  it('still runs the step when the old daemon could not be stopped', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    waitForSurface.mockResolvedValue({ instanceId: 'w2', cdpUrl: OTHER_CDP });
    runProcess.mockRejectedValue(new Error('no such process'));

    const out = await action.execute({ python: 'print(2)' }, {}, CHAT);

    // ensure_daemon will spawn a replacement, and the preflight proves it.
    expect(out.success).toBe(true);
  });
});

describe('what comes back', () => {
  it('reports a non-zero exit with the diagnostics attached', async () => {
    programBehaviour = () => ({
      stdout: 'partial', stderr: 'NameError: name "goto" is not defined', code: 1,
    });

    const out = await action.execute({ python: 'goto("x")' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.output).toBe('partial');
    expect(out.error).toMatch(/NameError/);
  });

  it('explains a timeout instead of reporting an empty result', async () => {
    programBehaviour = () => 'hang';

    const out = await action.execute({ python: 'wait_for_load()', timeoutSeconds: 0.01 }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/limit/i);
  });
});

describe('the update banner is never relayed to the model', () => {
  it('strips it, because it tells agents to run --update -y', () => {
    // Following that instruction unpins the environment — the exact failure
    // BROWSER_USE_VERSION exists to prevent.
    const noisy = [
      '[browser-harness] update available: 0.1.9 -> 0.1.10',
      '[browser-harness] agents: run `browser-harness --update -y` to upgrade and restart the daemon',
      'RuntimeError: something that actually matters',
    ].join('\n');

    const cleaned = stripHarnessNoise(noisy);

    expect(cleaned).toBe('RuntimeError: something that actually matters');
    expect(cleaned).not.toMatch(/--update/);
  });

  it('leaves genuine stderr alone', () => {
    expect(stripHarnessNoise('Traceback (most recent call last):')).toBe('Traceback (most recent call last):');
  });

  it('does not surface the banner as a step failure', async () => {
    programBehaviour = () => ({
      stdout: 'ok',
      stderr: '[browser-harness] update available: 0.1.9 -> 0.1.10\n',
    });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.diagnostics).toBeNull();
  });
});
