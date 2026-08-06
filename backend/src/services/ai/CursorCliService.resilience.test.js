/**
 * Resilience tests for CursorCliService — the layer between `runExecRaw` and
 * every caller: when a run is retried, and with what.
 *
 * CursorCliService.events.test.js drives the NDJSON parser through runExecRaw
 * and so never exercises the retry wrapper at all. These tests script several
 * sequential spawns and assert on the argv of each, which is the only way to
 * pin:
 *
 *   - the model-entitlement fallback (a Free Cursor plan rejects every named
 *     model, which killed 100% of cursor-cli calls with a message about
 *     "usage limits")
 *   - which emissions make a stall-retry unsafe (the old proxy for this
 *     drifted the moment new handlers were added)
 *   - --sandbox normalization, so an env-var typo fails here with a readable
 *     message instead of at spawn inside a process nobody is watching
 */
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';

const spawnCalls = [];
/** Scripted responses, one per spawn, consumed in order. */
let script = [];

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end() {}, write() {} });
  child.kill = () => {};
  return child;
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: (command, args, opts) => {
      spawnCalls.push({ command, args, opts });
      const child = makeChild();
      const step = script.shift() || { lines: [] };
      // Asynchronous so runExec has attached its handlers first.
      setTimeout(() => {
        if (step.hang) {
          // Emit anything the step wants observed, then never close: this is
          // the stall the hard timer exists for.
          for (const line of step.lines || []) {
            child.stdout.emit('data', Buffer.from(`${JSON.stringify(line)}\n`));
          }
          return;
        }
        for (const line of step.lines || []) {
          child.stdout.emit('data', Buffer.from(`${JSON.stringify(line)}\n`));
        }
        if (step.stderr) child.stderr.emit('data', Buffer.from(step.stderr));
        child.emit('close', step.code ?? 0);
      }, 0);
      return child;
    },
  };
});

const CursorCliService = (await import('./CursorCliService.js')).default;

const RESULT = {
  type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's1',
};
const INIT = {
  type: 'system', subtype: 'init', session_id: 's1', model: 'Auto', apiKeySource: 'login',
};
const say = (text, extra = {}) => ({ type: 'assistant', message: { content: [{ text }] }, ...extra });
const toolCall = (subtype = 'started') => ({
  type: 'tool_call', subtype, call_id: 'c1', tool_call: { readToolCall: { args: { path: '/tmp/a' } } },
});

/** Verbatim stderr from a real Free-plan cursor-agent run (captured 2026-08-06). */
const FREE_PLAN_STDERR =
  'ActionRequiredError: Named models unavailable Free plans can only use Auto. '
  + 'Switch to Auto or upgrade plans to continue.\n';

const argOf = (call, flag) => {
  const i = call.args.indexOf(flag);
  return i === -1 ? undefined : call.args[i + 1];
};
const has = (call, flag) => call.args.includes(flag);

let prevBin; let prevWorkdir; let warn;

beforeEach(() => {
  spawnCalls.length = 0;
  script = [];
  CursorCliService.resetModelEntitlement();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  prevBin = process.env.AGNT_CURSOR_BIN;
  prevWorkdir = process.env.AGNT_CURSOR_WORKDIR;
  process.env.AGNT_CURSOR_BIN = '/usr/local/bin/cursor-agent';
  process.env.AGNT_CURSOR_WORKDIR = path.join(os.tmpdir(), 'agnt-cursor-test');
});

afterEach(() => {
  warn.mockRestore();
  CursorCliService.resetModelEntitlement();
  if (prevBin === undefined) delete process.env.AGNT_CURSOR_BIN;
  else process.env.AGNT_CURSOR_BIN = prevBin;
  if (prevWorkdir === undefined) delete process.env.AGNT_CURSOR_WORKDIR;
  else process.env.AGNT_CURSOR_WORKDIR = prevWorkdir;
});

describe('model entitlement — a Free plan cannot use named models', () => {
  it('names the real cause instead of blaming a usage limit', async () => {
    // Both attempts rejected, so the returned error is the raw one.
    script = [
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
    ];
    const result = await CursorCliService.runExec({ prompt: 'hi', model: 'cursor-grok-4.5-high' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot use named models/i);
    expect(result.error).toMatch(/AGNT_CURSOR_DEFAULT_MODEL=auto/);
    expect(result.error).not.toMatch(/usage limit/i);
  });

  it('retries once with auto and returns the answer', async () => {
    script = [
      { lines: [INIT], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [RESULT] },
    ];
    const result = await CursorCliService.runExec({ prompt: 'hi', model: 'cursor-grok-4.5-high' });

    expect(spawnCalls).toHaveLength(2);
    expect(argOf(spawnCalls[0], '--model')).toBe('cursor-grok-4.5-high');
    expect(argOf(spawnCalls[1], '--model')).toBe('auto');
    expect(result.success).toBe(true);
    expect(result.text).toBe('done');
  });

  it('a real init event does not block the retry', async () => {
    // The CLI emits system/init BEFORE rejecting the model, so an observer has
    // already been called by the time we decide. An init describes the run,
    // not the answer — a second run legitimately has a second init, and
    // counting it would have made this fix unreachable for streaming callers.
    script = [
      { lines: [INIT], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [INIT, RESULT] },
    ];
    const inits = [];
    const result = await CursorCliService.runExec({
      prompt: 'hi', model: 'cursor-grok-4.5-high', onInit: (e) => inits.push(e),
    });
    expect(spawnCalls).toHaveLength(2);
    expect(inits).toHaveLength(2);
    expect(result.success).toBe(true);
  });

  it('keeps the session on the retry — the CLI died before touching it', async () => {
    // Unlike a stall (where the session is wedged and must be abandoned), the
    // model was rejected at startup. Dropping resume/sessionId here would
    // silently discard the conversation's history.
    script = [
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [RESULT] },
    ];
    await CursorCliService.runExec({
      prompt: 'hi', model: 'cursor-grok-4.5-high', resume: true, sessionId: 'sess-1',
    });
    expect(argOf(spawnCalls[1], '--resume')).toBe('sess-1');
  });

  it('remembers, so later calls do not pay a doomed round-trip each time', async () => {
    script = [
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [RESULT] },
      { lines: [RESULT] },
    ];
    await CursorCliService.runExec({ prompt: 'one', model: 'cursor-grok-4.5-high' });
    await CursorCliService.runExec({ prompt: 'two', model: 'cursor-grok-4.5-high' });

    expect(spawnCalls).toHaveLength(3);
    // Third spawn is the SECOND call's first attempt: already auto.
    expect(argOf(spawnCalls[2], '--model')).toBe('auto');
    // And it warns once, not on every call.
    expect(warn.mock.calls.filter((c) => /cannot use named models/.test(String(c[0])))).toHaveLength(1);
  });

  it('reports a usable default model once entitlement is known', async () => {
    script = [{ lines: [], stderr: FREE_PLAN_STDERR, code: 1 }, { lines: [RESULT] }];
    await CursorCliService.runExec({ prompt: 'hi', model: 'cursor-grok-4.5-high' });
    expect(CursorCliService.getDefaultModel()).toBe('auto');
    CursorCliService.resetModelEntitlement();
    expect(CursorCliService.getDefaultModel()).not.toBe('auto');
  });

  it('does not loop when auto itself is rejected', async () => {
    script = [
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
      { lines: [], stderr: FREE_PLAN_STDERR, code: 1 },
    ];
    const result = await CursorCliService.runExec({ prompt: 'hi', model: 'cursor-grok-4.5-high' });
    expect(spawnCalls).toHaveLength(2);
    expect(result.success).toBe(false);
  });

  it('leaves a genuine spend limit alone — a different model would not help', async () => {
    script = [{ lines: [], stderr: 'ActionRequiredError: usage limit reached for this model\n', code: 1 }];
    const result = await CursorCliService.runExec({ prompt: 'hi', model: 'cursor-grok-4.5-high' });
    expect(spawnCalls).toHaveLength(1);
    expect(result.error).toMatch(/usage limit/i);
  });
});

describe('stall retry — safe only while nothing has reached the caller', () => {
  const STALL = { prompt: 'hi', timeoutMs: 25 };

  it('retries a silent stall with a fresh session', async () => {
    script = [{ hang: true }, { lines: [RESULT] }];
    const result = await CursorCliService.runExec({ ...STALL, resume: true, sessionId: 'sess-1' });
    expect(spawnCalls).toHaveLength(2);
    expect(has(spawnCalls[1], '--resume')).toBe(false);
    expect(result.success).toBe(true);
  });

  it('retries a streaming call that stalled BEFORE emitting anything', async () => {
    // The old guard refused this purely because handlers were supplied. There
    // is nothing to duplicate when nothing was sent.
    script = [{ hang: true }, { lines: [say('hi', { timestamp_ms: 1 }), RESULT] }];
    const deltas = [];
    const result = await CursorCliService.runExec({ ...STALL, onDelta: (t) => deltas.push(t) });
    expect(spawnCalls).toHaveLength(2);
    expect(deltas.join('')).toBe('hi');
    expect(result.success).toBe(true);
  });

  it('refuses once text has been emitted — a retry would double the answer', async () => {
    script = [{ hang: true, lines: [say('half an answer', { timestamp_ms: 1 })] }, { lines: [RESULT] }];
    const deltas = [];
    await expect(CursorCliService.runExec({ ...STALL, onDelta: (t) => deltas.push(t) }))
      .rejects.toThrow(/timed out/);
    expect(spawnCalls).toHaveLength(1);
    expect(deltas.join('')).toBe('half an answer');
  });

  it('refuses once a TOOL event has been emitted', async () => {
    // REGRESSION: the guard tested only for onDelta/onReasoning, so an
    // observer watching file writes was re-fed its events on every stall —
    // exactly the duplication the guard exists to prevent.
    script = [{ hang: true, lines: [toolCall()] }, { lines: [RESULT] }];
    const tools = [];
    await expect(CursorCliService.runExec({ ...STALL, onToolCall: (e) => tools.push(e) }))
      .rejects.toThrow(/timed out/);
    expect(spawnCalls).toHaveLength(1);
    expect(tools).toHaveLength(1);
  });

  it('still passes the caller its own handler results, not the wrapper\'s', async () => {
    // The counter wraps the handlers; it must stay invisible to the caller.
    script = [{ lines: [say('x', { timestamp_ms: 1 }), toolCall('completed'), RESULT] }];
    const seen = [];
    await CursorCliService.runExec({
      prompt: 'hi',
      onDelta: (t) => seen.push(['delta', t]),
      onToolCall: (e) => seen.push(['tool', e.name, e.status]),
    });
    expect(seen).toEqual([['delta', 'x'], ['tool', 'read', 'completed']]);
  });
});

describe('--sandbox is validated like --mode', () => {
  const run = (sandbox) => {
    script = [{ lines: [RESULT] }];
    return CursorCliService.runExecRaw({ prompt: 'hi', sandbox });
  };

  it.each([
    [true, 'enabled'], ['true', 'enabled'], ['enabled', 'enabled'], ['Enabled', 'enabled'],
    [false, 'disabled'], ['false', 'disabled'], ['disabled', 'disabled'],
  ])('normalizes %o to %s', async (input, expected) => {
    await run(input);
    expect(argOf(spawnCalls[0], '--sandbox')).toBe(expected);
  });

  it.each([null, undefined, ''])('omits the flag entirely for %o', async (input) => {
    await run(input);
    expect(has(spawnCalls[0], '--sandbox')).toBe(false);
  });

  it('rejects a value the CLI would reject, and names the env var', async () => {
    // CURSOR_CLI_SANDBOX=yes previously spawned `--sandbox yes`, which the CLI
    // refuses (its choices are enabled|disabled) — a config typo surfacing as
    // an unexplained provider outage.
    script = [{ lines: [RESULT] }];
    await expect(CursorCliService.runExecRaw({ prompt: 'hi', sandbox: 'yes' }))
      .rejects.toThrow(/unsupported sandbox 'yes'.*CURSOR_CLI_SANDBOX/s);
    expect(spawnCalls).toHaveLength(0);
  });
});
