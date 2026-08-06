/**
 * Stream-event tests for CursorCliService.
 *
 * The sibling CursorCliService.test.js deliberately never spawns, so it covers
 * none of the NDJSON parsing. These tests mock `spawn` and push real Cursor
 * wire objects through the parser, which is the only way to pin:
 *
 *   - the delta discriminator (the pre-tool-call flush used to be double-counted)
 *   - tool_call / system events, which used to be dropped by `default:`
 *   - the execution-policy flags actually handed to the CLI
 *
 * Everything else about the process lifecycle (timeouts, the post-result hang)
 * stays an integration concern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';

const spawnCalls = [];
let currentChild = null;

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end() {}, write() {} });
  child.kill = () => {};
  return child;
}

// Keep every other child_process export real — binary resolution uses them.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: (command, args, opts) => {
      spawnCalls.push({ command, args, opts });
      currentChild = makeChild();
      return currentChild;
    },
  };
});

const CursorCliService = (await import('./CursorCliService.js')).default;

/** Feed NDJSON lines to the mocked child, then close it. */
async function runWith(lines, opts = {}) {
  const promise = CursorCliService.runExecRaw({ prompt: 'test', ...opts });
  await Promise.resolve();
  currentChild.stdout.emit('data', Buffer.from(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
  currentChild.emit('close', 0);
  return promise;
}

const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's1' };
const say = (text, extra = {}) => ({
  type: 'assistant',
  message: { content: [{ text }] },
  ...extra,
});

let prevBin; let prevWorkdir;

beforeEach(() => {
  spawnCalls.length = 0;
  currentChild = null;
  prevBin = process.env.AGNT_CURSOR_BIN;
  prevWorkdir = process.env.AGNT_CURSOR_WORKDIR;
  process.env.AGNT_CURSOR_BIN = '/usr/local/bin/cursor-agent';
  process.env.AGNT_CURSOR_WORKDIR = path.join(os.tmpdir(), 'agnt-cursor-test');
});

afterEach(() => {
  if (prevBin === undefined) delete process.env.AGNT_CURSOR_BIN; else process.env.AGNT_CURSOR_BIN = prevBin;
  if (prevWorkdir === undefined) delete process.env.AGNT_CURSOR_WORKDIR; else process.env.AGNT_CURSOR_WORKDIR = prevWorkdir;
});

describe('CursorCliService delta discriminator', () => {
  it('forwards genuine deltas (timestamp, no model_call_id)', async () => {
    const deltas = [];
    await runWith([say('Hello ', { timestamp_ms: 1 }), say('world', { timestamp_ms: 2 }), RESULT], {
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('Hello world');
  });

  it('drops the pre-tool-call flush instead of emitting the text twice', async () => {
    // REGRESSION: this flush carries a timestamp, so the old `timestamp_ms == null`
    // test let it through and the user saw the sentence rendered twice.
    const deltas = [];
    await runWith([
      say('Reading the file', { timestamp_ms: 1 }),
      say('Reading the file', { timestamp_ms: 2, model_call_id: 'call_1' }),
      RESULT,
    ], { onDelta: (t) => deltas.push(t) });
    expect(deltas.join('')).toBe('Reading the file');
  });

  it('still drops the end-of-turn flush (no timestamp)', async () => {
    const deltas = [];
    await runWith([say('hi', { timestamp_ms: 1 }), say('hi'), RESULT], {
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('hi');
  });
});

describe('CursorCliService tool + system events', () => {
  it('normalizes a write tool call and reports its stats', async () => {
    const events = [];
    await runWith([
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c1',
        tool_call: {
          writeToolCall: {
            args: { path: 'src/app.js', fileText: 'x'.repeat(5000) },
            result: { success: { linesCreated: 12, fileSize: 5000 } },
          },
        },
      },
      RESULT,
    ], { onToolCall: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'c1', name: 'write', status: 'completed', path: 'src/app.js',
      stats: { linesCreated: 12, fileSize: 5000 },
    });
    // The 5000-char body must never ride along in the event.
    expect(JSON.stringify(events[0]).length).toBeLessThan(400);
  });

  it('caps a long shell command and surfaces tool errors', async () => {
    const events = [];
    await runWith([
      {
        type: 'tool_call',
        subtype: 'completed',
        tool_call: {
          shellToolCall: { args: { command: 'echo '.repeat(400) }, result: { error: 'exit 1' } },
        },
      },
      RESULT,
    ], { onToolCall: (e) => events.push(e) });

    expect(events[0].name).toBe('shell');
    expect(events[0].error).toBe('exit 1');
    expect(events[0].command.length).toBeLessThan(300);
    expect(events[0].command).toMatch(/more chars/);
  });

  it('reports the init event without leaking a credential', async () => {
    const inits = [];
    await runWith([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-9',
        cwd: '/repo',
        model: 'composer-2.5',
        permissionMode: 'default',
        apiKeySource: 'login',
      },
      RESULT,
    ], { onInit: (e) => inits.push(e) });

    expect(inits[0]).toEqual({
      sessionId: 'sess-9', cwd: '/repo', model: 'composer-2.5',
      permissionMode: 'default', apiKeySource: 'login',
    });
  });

  it('ignores an unrecognised tool payload rather than guessing', async () => {
    const events = [];
    await runWith([{ type: 'tool_call', subtype: 'started', tool_call: {} }, RESULT], {
      onToolCall: (e) => events.push(e),
    });
    expect(events).toHaveLength(0);
  });

  it('does not mistake a non-tool sibling key for the tool itself', async () => {
    // A metadata sibling must not be reported as a tool named 'metadata'.
    const events = [];
    await runWith([
      {
        type: 'tool_call',
        subtype: 'started',
        tool_call: {
          metadata: { requestId: 'r1' },
          readToolCall: { args: { path: 'a.js' } },
        },
      },
      // Only metadata: nothing identifiable, so nothing is reported.
      { type: 'tool_call', subtype: 'started', tool_call: { metadata: { requestId: 'r2' } } },
      RESULT,
    ], { onToolCall: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'read', path: 'a.js' });
  });
});

describe('CursorCliService execution policy', () => {
  it('sends --force by default, and streams when a handler is supplied', async () => {
    await runWith([RESULT], { onDelta: () => {} });
    const { args } = spawnCalls[0];
    expect(args).toContain('--force');
    expect(args).toContain('--stream-partial-output');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
  });

  it('omits --force in a read-only mode and passes --mode through', async () => {
    await runWith([RESULT], { mode: 'plan' });
    const { args } = spawnCalls[0];
    expect(args).not.toContain('--force');
    expect(args[args.indexOf('--mode') + 1]).toBe('plan');
  });

  it('honors force:false', async () => {
    await runWith([RESULT], { force: false });
    expect(spawnCalls[0].args).not.toContain('--force');
  });

  it('maps sandbox:true to enabled', async () => {
    await runWith([RESULT], { sandbox: true });
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--sandbox') + 1]).toBe('enabled');
  });

  it('watching tools alone needs the event stream, not text deltas', async () => {
    await runWith([RESULT], { onToolCall: () => {} });
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).not.toContain('--stream-partial-output');
  });

  it('rejects an unsupported mode before spawning', async () => {
    await expect(CursorCliService.runExecRaw({ prompt: 'x', mode: 'yolo' }))
      .rejects.toThrow(/unsupported mode/i);
    expect(spawnCalls).toHaveLength(0);
  });
});
