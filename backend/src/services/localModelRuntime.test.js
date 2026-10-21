import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createLocalModelRuntime, lmsCandidates, LOCAL_SERVER_URL, LMSTUDIO_NATIVE_MODELS_URL, LOCAL_CHAT_CONTEXT } from './localModelRuntime.js';

const serving = (models) => async (url) => {
  expect(url).toBe(`${LOCAL_SERVER_URL}/models`);
  return { ok: true, json: async () => ({ data: models.map((id) => ({ id })) }) };
};
const down = async () => { throw new Error('ECONNREFUSED'); };
const LMS = '/home/u/.lmstudio/bin/lms';
const base = { candidates: () => [LMS], sleep: async () => {} };

describe('local model runtime (LM Studio)', () => {
  it('running: reports its models and nothing to start', async () => {
    const rt = createLocalModelRuntime({ ...base, fetchImpl: serving(['qwen3-8b']), exists: () => true });
    expect(await rt.status()).toMatchObject({ running: true, models: ['qwen3-8b'], installed: true, canStart: false });
  });

  // Reported 2026-10-07: "I click the link and nothing happens" with LM Studio installed but stopped.
  // Reported 2026-10-21: "Starting LM Studio" never closed. `lms server start`
  // wakes a service that keeps the command's pipes open, so awaiting the
  // command never finished. It is launched detached; the server is the answer.
  it('installed but stopped: launches `lms server start` detached and waits on the server, not the command', async () => {
    let up = false;
    const launch = vi.fn(async () => { setTimeout(() => { up = true; }, 0); });
    const run = vi.fn(() => new Promise(() => {})); // a command that never reports back
    const rt = createLocalModelRuntime({ ...base, exists: () => true, run, launch, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), fetchImpl: (url) => (up ? serving(['qwen3-8b'])(url) : down()) });
    expect(await rt.status()).toMatchObject({ running: false, installed: true, canStart: true });
    const result = await rt.start();
    expect(launch).toHaveBeenCalledWith(LMS, ['server', 'start']);
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ running: true, models: ['qwen3-8b'] });
    expect(result.error).toBeUndefined();
  });

  it('not installed: never runs anything and says so', async () => {
    const run = vi.fn();
    const rt = createLocalModelRuntime({ ...base, exists: () => false, run, fetchImpl: down });
    const result = await rt.start();
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ running: false, installed: false, error: 'not_installed', downloadUrl: 'https://lmstudio.ai/download' });
  });

  it('a start that cannot launch returns the reason instead of throwing', async () => {
    const launch = vi.fn(async () => { throw new Error('spawn EACCES'); });
    const rt = createLocalModelRuntime({ ...base, exists: () => true, launch, fetchImpl: down });
    expect(await rt.start()).toMatchObject({ running: false, error: 'start_failed', detail: 'spawn EACCES' });
  });

  it('a server that never comes up times out', async () => {
    let t = 0;
    const realNow = Date.now;
    Date.now = () => (t += 10_000);
    try {
      const rt = createLocalModelRuntime({ ...base, exists: () => true, launch: async () => {}, fetchImpl: down });
      expect(await rt.start()).toMatchObject({ running: false, error: 'start_timeout' });
    } finally { Date.now = realNow; }
  });

  it('a hosted instance never looks for or runs a CLI', async () => {
    const run = vi.fn();
    const exists = vi.fn(() => true);
    const rt = createLocalModelRuntime({ ...base, hosted: () => true, exists, run, fetchImpl: down });
    expect(await rt.status()).toMatchObject({ installed: false, canStart: false });
    expect(await rt.start()).toMatchObject({ error: 'not_available_on_hosted' });
    expect(run).not.toHaveBeenCalled();
  });

  describe('prepare: a model must fit a chat turn before AGNT switches to it', () => {
    /** LM Studio whose native list changes as lms loads/unloads. */
    const studio = (initial) => {
      let models = initial.map((m) => ({ ...m }));
      const run = vi.fn(async (_file, args) => {
        const id = args[1];
        if (args[0] === 'unload') models = models.map((m) => (m.id === id ? { ...m, state: 'not-loaded', loaded_context_length: undefined } : m));
        if (args[0] === 'load') {
          const ctx = Number(args[args.indexOf('--context-length') + 1]);
          models = models.map((m) => (m.id === id ? { ...m, state: 'loaded', loaded_context_length: ctx } : m));
        }
        return { stdout: '', stderr: '' };
      });
      const fetchImpl = async (url) => {
        expect(url).toBe(LMSTUDIO_NATIVE_MODELS_URL);
        return { ok: true, json: async () => ({ data: models }) };
      };
      return { run, fetchImpl, models: () => models };
    };

    // Reported 2026-10-21: qwen3.5-4b was loaded with 4096 context; the first turn needed ~23K and failed.
    it('THE REPORTED CASE: a model loaded with 4096 is reloaded with 32K under the same id', async () => {
      const lm = studio([
        { id: 'qwen3.5-4b', type: 'vlm', state: 'loaded', loaded_context_length: 4096, max_context_length: 262144 },
        { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 },
      ]);
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: lm.run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toEqual({ model: 'qwen3.5-4b', contextLength: LOCAL_CHAT_CONTEXT, reloaded: true });
      expect(lm.run.mock.calls.map((c) => c[1])).toEqual([
        ['unload', 'qwen3.5-4b'],
        ['load', 'qwen3.5-4b', '--context-length', String(LOCAL_CHAT_CONTEXT), '--identifier', 'qwen3.5-4b', '--yes'],
      ]);
    });

    it('a model already loaded with enough context is used as is', async () => {
      const lm = studio([{ id: 'qwen3-8b', type: 'llm', state: 'loaded', loaded_context_length: 65536, max_context_length: 131072 }]);
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: lm.run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toEqual({ model: 'qwen3-8b', contextLength: 65536, reloaded: false });
      expect(lm.run).not.toHaveBeenCalled();
    });

    it('nothing loaded: loads the first chat model, never an embedding model, capped at its own maximum', async () => {
      const lm = studio([
        { id: 'nomic-embed', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 },
        { id: 'coder-3b', type: 'llm', state: 'not-loaded', max_context_length: 16384 },
      ]);
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: lm.run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toEqual({ model: 'coder-3b', contextLength: 16384, reloaded: true });
      expect(lm.run.mock.calls.map((c) => c[1][0])).toEqual(['load']);
    });

    it('a load LM Studio refuses is reported, never thrown', async () => {
      const lm = studio([{ id: 'big', type: 'llm', state: 'not-loaded', max_context_length: 131072 }]);
      const run = vi.fn(async () => { throw Object.assign(new Error('exit 1'), { stderr: 'Not enough memory' }); });
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toMatchObject({ error: 'load_failed', model: 'big', contextLength: LOCAL_CHAT_CONTEXT, detail: 'Not enough memory' });
    });

    it('a load that reports success but leaves the context small is not trusted', async () => {
      const lm = studio([{ id: 'qwen', type: 'llm', state: 'loaded', loaded_context_length: 4096, max_context_length: 131072 }]);
      const run = vi.fn(async () => ({})); // claims success, changes nothing
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toMatchObject({ error: 'load_failed', detail: expect.stringContaining('4096') });
    });

    it('no chat model, or a named one that is missing, says which', async () => {
      const lm = studio([{ id: 'nomic-embed', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 }]);
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: lm.run, fetchImpl: lm.fetchImpl });
      expect(await rt.prepare()).toMatchObject({ error: 'no_chat_model' });
      expect(await rt.prepare('ghost')).toMatchObject({ error: 'model_not_found', detail: 'ghost' });
    });

    it('not LM Studio (no native API): nothing to prepare', async () => {
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: vi.fn(), fetchImpl: down });
      expect(await rt.prepare('qwen3:8b')).toEqual({ model: 'qwen3:8b', skipped: true });
    });
  });

  it('looks for lms in both LM Studio layouts, then PATH', () => {
    const list = lmsCandidates('/h', ['/usr/bin', '/opt/x'].join(path.delimiter));
    expect(list[0]).toBe(path.join('/h', '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'));
    expect(list[1]).toBe(path.join('/h', '.cache', 'lm-studio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'));
    expect(list).toHaveLength(4);
  });
});
