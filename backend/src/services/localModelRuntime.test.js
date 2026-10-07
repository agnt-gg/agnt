import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createLocalModelRuntime, lmsCandidates, LOCAL_SERVER_URL } from './localModelRuntime.js';

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
  it('installed but stopped: start runs `lms server start` and waits until it serves', async () => {
    let up = false;
    const run = vi.fn(async () => { up = true; return { stdout: '', stderr: '' }; });
    const rt = createLocalModelRuntime({ ...base, exists: () => true, run, fetchImpl: (url) => (up ? serving(['qwen3-8b'])(url) : down()) });
    expect(await rt.status()).toMatchObject({ running: false, installed: true, canStart: true });
    const result = await rt.start();
    expect(run).toHaveBeenCalledWith(LMS, ['server', 'start'], expect.any(Number));
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

  it('a failing start returns the reason instead of throwing', async () => {
    const run = vi.fn(async () => { throw Object.assign(new Error('exit 1'), { stderr: 'LM Studio is not set up' }); });
    const rt = createLocalModelRuntime({ ...base, exists: () => true, run, fetchImpl: down });
    expect(await rt.start()).toMatchObject({ running: false, error: 'start_failed', detail: 'LM Studio is not set up' });
  });

  it('a server that never comes up times out', async () => {
    let t = 0;
    const realNow = Date.now;
    Date.now = () => (t += 10_000);
    try {
      const rt = createLocalModelRuntime({ ...base, exists: () => true, run: async () => ({}), fetchImpl: down });
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

  it('looks for lms in both LM Studio layouts, then PATH', () => {
    const list = lmsCandidates('/h', ['/usr/bin', '/opt/x'].join(path.delimiter));
    expect(list[0]).toBe(path.join('/h', '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'));
    expect(list[1]).toBe(path.join('/h', '.cache', 'lm-studio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'));
    expect(list).toHaveLength(4);
  });
});
