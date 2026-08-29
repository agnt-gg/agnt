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
const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
const spawn = vi.fn();

vi.mock('../../../services/browserSurfaces.js', () => ({
  waitForSurface: (...a) => waitForSurface(...a),
  forgetSurfaceByUrl: (...a) => forgetSurfaceByUrl(...a),
  getActiveSurface: (...a) => getActiveSurface(...a),
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
  it('refuses when no Browser widget is open, rather than falling back', async () => {
    waitForSurface.mockResolvedValue(null);

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/no AGNT Browser widget open/i);
    // THE POINT: browser-harness's own fallback is the user's real Chrome.
    expect(out.error).toMatch(/never attaches to your own Chrome/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('says the connection DROPPED when the widget is open but unreachable', async () => {
    // These are different problems with different fixes, and telling someone to
    // open a widget they are looking at is the least useful thing this can say.
    // It happened: the guest webContents was rebuilt, the bridge closed with it,
    // and the tool reported "no widget open" at a widget on screen.
    waitForSurface.mockResolvedValue(null);
    getActiveSurface.mockReturnValue({ instanceId: 'w1', cdpUrl: CDP });

    const out = await action.execute({ python: 'print(1)' }, {}, CHAT);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/connection to AGNT has dropped/i);
    expect(out.error).toMatch(/try again in a moment/i);
    // It must NOT tell the user to open one.
    expect(out.error).not.toMatch(/no AGNT Browser widget open/i);
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
