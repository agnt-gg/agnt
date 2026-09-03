import { describe, it, expect, vi } from 'vitest';
import { createEagerToolRuns, toolCallFingerprint } from './eagerToolRuns.js';

const call = (id, name = 'execute_shell_command', args = '{"command":"echo A"}') => ({
  id,
  type: 'function',
  function: { name, arguments: args },
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe('eagerToolRuns — a call starts once, the moment it is complete', () => {
  it('starts a run and reports that it did', () => {
    const run = vi.fn(async () => 'done');
    const runs = createEagerToolRuns(run);
    expect(runs.start(call('a'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(runs.has('a')).toBe(true);
  });

  it('never starts the same id twice', () => {
    const run = vi.fn(async () => 'done');
    const runs = createEagerToolRuns(run);
    runs.start(call('a'));
    expect(runs.start(call('a'))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores a call with no id', () => {
    const run = vi.fn(async () => 'done');
    const runs = createEagerToolRuns(run);
    expect(runs.start({ function: { name: 'x', arguments: '{}' } })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('claim hands back the run and forgets it', async () => {
    const runs = createEagerToolRuns(async (tc) => `ran ${tc.id}`);
    runs.start(call('a'));
    const claimed = runs.claim('a');
    expect(claimed.duplicateOf).toBeNull();
    await expect(claimed.promise).resolves.toBe('ran a');
    expect(runs.has('a')).toBe(false);
    expect(runs.claim('a')).toBeUndefined();
  });

  it('claim of an id that was never started is undefined (the round runs it itself)', () => {
    const runs = createEagerToolRuns(async () => 'x');
    expect(runs.claim('nope')).toBeUndefined();
  });
});

describe('eagerToolRuns — a re-streamed attempt must not run the work twice', () => {
  it('an identical call under a new id is a duplicate of the first run', async () => {
    const run = vi.fn(async (tc) => `ran ${tc.id}`);
    const runs = createEagerToolRuns(run);
    runs.start(call('first'));
    expect(runs.start(call('second'))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    const dup = runs.claim('second');
    expect(dup.duplicateOf).toBe('first');
    await expect(dup.promise).resolves.toBe('ran first');
  });

  it('different arguments are a different call', () => {
    const run = vi.fn(async () => 'x');
    const runs = createEagerToolRuns(run);
    runs.start(call('a', 'write_file', '{"path":"a.txt"}'));
    runs.start(call('b', 'write_file', '{"path":"b.txt"}'));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('same arguments to a different tool are a different call', () => {
    const run = vi.fn(async () => 'x');
    const runs = createEagerToolRuns(run);
    runs.start(call('a', 'read_file', '{"path":"a.txt"}'));
    runs.start(call('b', 'write_file', '{"path":"a.txt"}'));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('fingerprint is name + raw arguments', () => {
    expect(toolCallFingerprint(call('x', 'grep_files', '{"pattern":"a"}'))).toBe('grep_files::{"pattern":"a"}');
    expect(toolCallFingerprint({})).toBe('::');
  });
});

describe('eagerToolRuns — nothing started is ever abandoned', () => {
  it('drain returns every unclaimed original run and clears the ledger', async () => {
    const runs = createEagerToolRuns(async (tc) => tc.id);
    runs.start(call('a', 'x', '{"n":1}'));
    runs.start(call('b', 'x', '{"n":2}'));
    runs.start(call('b-dup', 'x', '{"n":2}')); // duplicate: not its own work
    runs.claim('a');

    const unclaimed = runs.drain();
    expect(unclaimed.map((u) => u.id)).toEqual(['b']);
    await expect(unclaimed[0].promise).resolves.toBe('b');
    expect(runs.size).toBe(0);
  });

  it('after drain, a call with a previously seen fingerprint starts fresh (next round)', () => {
    const run = vi.fn(async () => 'x');
    const runs = createEagerToolRuns(run);
    runs.start(call('a'));
    runs.drain();
    expect(runs.start(call('a2'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a runner that throws never produces an unhandled rejection', async () => {
    const boom = new Error('boom');
    const runs = createEagerToolRuns(async () => { throw boom; });
    runs.start(call('a'));
    const { promise } = runs.claim('a');
    await expect(promise).resolves.toEqual({ __eagerRunError: boom });
  });

  it('a runner that throws synchronously is contained the same way', async () => {
    const runs = createEagerToolRuns(() => { throw new Error('sync boom'); });
    runs.start(call('a'));
    const result = await runs.claim('a').promise;
    expect(result.__eagerRunError.message).toBe('sync boom');
  });

  it('a claim taken before the run finishes still resolves to the run result', async () => {
    const gate = deferred();
    const runs = createEagerToolRuns(() => gate.promise);
    runs.start(call('a'));
    const claimed = runs.claim('a');
    gate.resolve('late');
    await expect(claimed.promise).resolves.toBe('late');
  });
});
