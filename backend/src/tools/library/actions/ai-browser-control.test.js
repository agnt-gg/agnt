/**
 * CONTRACT: Browser Control runs model-authored Python, so the interesting
 * assertions are all about what it REFUSES.
 *
 * Three properties are load-bearing, and each is a way this could go wrong
 * silently rather than loudly:
 *
 *   1. It never runs outside a conversation. A workflow node's parameters are
 *      templated from trigger data — Discord, email, a webhook — and this tool's
 *      parameter is a program. browserUseRunner.js exists because its
 *      predecessor concatenated exactly that data into a `python -c` payload.
 *
 *   2. It never attaches to a browser AGNT is not rendering. Left alone,
 *      browser-harness finds a DevToolsActivePort and drives whatever Chrome the
 *      user has open — their real one, with their real logged-in sessions. A
 *      missing widget must therefore be an error, never a fallback.
 *
 *   3. It never inherits BU_NAME or BU_CDP_URL. A named daemon gives itself a
 *      dedicated tab via Target.createTarget, which the single-webview surface
 *      refuses outright; BU_CDP_URL is an HTTP endpoint the widget does not
 *      serve. Both are plausible leftovers in a developer's shell, and both fail
 *      in ways that look nothing like their cause.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const waitForSurface = vi.fn();
const forgetSurfaceByUrl = vi.fn();
const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
const spawn = vi.fn();

vi.mock('../../../services/browserSurfaces.js', () => ({
  waitForSurface: (...a) => waitForSurface(...a),
  forgetSurfaceByUrl: (...a) => forgetSurfaceByUrl(...a),
  // The real predicate: only ws://127.0.0.1:<port>/<token> is a local bridge.
  isLocalBridgeUrl: (url) => /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(url || ''),
}));

vi.mock('./browserUseEnvironment.js', () => ({
  ensureCli: vi.fn().mockResolvedValue('/venv/bin/browser-use'),
  browserUsePaths: () => ({ python: '/venv/bin/python', cli: '/venv/bin/browser-use' }),
  runProcess: (...a) => runProcess(...a),
  BROWSER_USE_VERSION: '0.13.8',
}));

vi.mock('child_process', () => ({ spawn: (...a) => spawn(...a) }));

const { default: action, _resetDaemonEndpoint, stripHarnessNoise } = await import('./ai-browser-control.js');

const CDP = 'ws://127.0.0.1:51234/tok3n';
const OTHER_CDP = 'ws://127.0.0.1:60000/other';
const CHAT = { userId: 'u1', provider: 'Anthropic', model: 'claude-sonnet-4-5' };
const WORKFLOW = { userId: 'u1' };

/** A child process that reports `result` once the caller has written stdin. */
function fakeChild({ stdout = '', stderr = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.stdin = {
    written: '',
    on: vi.fn(),
    write(text) { this.written += text; },
    end: () => {
      setImmediate(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
      });
    },
  };
  return child;
}

const envOf = (call) => call[2].env;

beforeEach(() => {
  vi.clearAllMocks();
  _resetDaemonEndpoint();
  runProcess.mockResolvedValue({ stdout: '', stderr: '' });
  waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: CDP });
  spawn.mockImplementation(() => fakeChild({ stdout: 'hello from the page' }));
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
    expect(spawn).toHaveBeenCalledTimes(1);
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
  it('refuses when no Browser widget is open, rather than falling back', async () => {
    waitForSurface.mockResolvedValue(null);

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/no AGNT Browser widget open/i);
    // THE POINT: browser-harness's own fallback is the user's real Chrome.
    expect(out.error).toMatch(/never attaches to your own Chrome/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses an endpoint that is not a loopback bridge', async () => {
    waitForSurface.mockResolvedValue({ instanceId: 'w1', cdpUrl: 'ws://10.0.0.5:9222/devtools/browser/abc' });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/non-local browser endpoint/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('forgets a surface whose bridge is gone, so the retry can succeed', async () => {
    spawn.mockImplementation(() => fakeChild({
      stderr: 'RuntimeError: Failed to establish CDP connection', code: 1,
    }));

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
    let child;
    spawn.mockImplementation(() => { child = fakeChild({ stdout: 'ok' }); return child; });

    await action.execute({ python: 'print(page_info())' }, {}, CHAT);

    expect(spawn.mock.calls[0][1]).toEqual([]);
    expect(child.stdin.written).toBe('print(page_info())');
  });
});

describe('the shared daemon follows the widget', () => {
  it('does not restart anything on the first call', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('does not restart while the surface is unchanged', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    await action.execute({ python: 'print(2)' }, {}, CHAT);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('restarts when the surface changes', async () => {
    // ensure_daemon only self-heals a DEAD connection. With two widgets open the
    // old one is alive and healthy, so nothing upstream would notice that it is
    // the wrong window — the same cross-window bug browserSurfaces.js guards.
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    waitForSurface.mockResolvedValue({ instanceId: 'w2', cdpUrl: OTHER_CDP });

    await action.execute({ python: 'print(2)' }, {}, CHAT);

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1].join(' ')).toMatch(/admin\.restart_daemon\(\)/);
    expect(envOf(spawn.mock.calls[1]).BU_CDP_WS).toBe(OTHER_CDP);
  });

  it('still runs the step when the old daemon could not be stopped', async () => {
    await action.execute({ python: 'print(1)' }, {}, CHAT);
    waitForSurface.mockResolvedValue({ instanceId: 'w2', cdpUrl: OTHER_CDP });
    runProcess.mockRejectedValue(new Error('no such process'));

    const out = await action.execute({ python: 'print(2)' }, {}, CHAT);

    // ensure_daemon will probe the survivor, find it pointed at a dead socket
    // and replace it. Failing the user's step over that would be worse.
    expect(out.success).toBe(true);
  });
});

describe('what comes back', () => {
  it('reports a non-zero exit with the diagnostics attached', async () => {
    spawn.mockImplementation(() => fakeChild({
      stdout: 'partial', stderr: 'NameError: name "goto" is not defined', code: 1,
    }));

    const out = await action.execute({ python: 'goto("x")' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.output).toBe('partial');
    expect(out.error).toMatch(/NameError/);
  });

  it('explains a timeout instead of reporting an empty result', async () => {
    spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.end = () => {};           // never finishes on its own
      child.kill = () => child.emit('close', null);
      return child;
    });

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
    spawn.mockImplementation(() => fakeChild({
      stdout: 'ok',
      stderr: '[browser-harness] update available: 0.1.9 -> 0.1.10\n',
    }));

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(true);
    expect(out.diagnostics).toBeNull();
  });
});
