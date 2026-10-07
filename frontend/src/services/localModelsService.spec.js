import { describe, it, expect, vi, beforeEach } from 'vitest';

const config = vi.hoisted(() => ({ DEPLOYMENT_CONFIG: { DISABLE_LOCAL_LLM: false } }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://local.test/api' }, DEPLOYMENT_CONFIG: config.DEPLOYMENT_CONFIG }));

import { fetchLocalStatus, isLocalReady, getLocalStatus, setupLocalModel, resetLocalStatusCache } from './localModelsService.js';

const reply = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

describe('localModelsService', () => {
  beforeEach(() => {
    resetLocalStatusCache();
    config.DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM = false;
    localStorage.setItem('token', 't');
    global.fetch = vi.fn(async () => reply({ ready: true, models: ['qwen3.5-4b'] }));
  });

  it('REGRESSION: asks the backend, never a local server port (Local was LM-Studio-only and broke on phones)', async () => {
    await fetchLocalStatus();
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://local.test/api/local-models/status');
    expect(init.headers.Authorization).toBe('Bearer t');
    expect(url).not.toMatch(/127\.0\.0\.1|:1234/);
  });

  it('screens polling together share one request', async () => {
    await Promise.all([isLocalReady(), isLocalReady(), fetchLocalStatus()]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fresh bypasses the shared read', async () => {
    await fetchLocalStatus();
    await fetchLocalStatus({ fresh: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('hosted, or signed out: no request, not ready', async () => {
    config.DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM = true;
    expect(await isLocalReady()).toBe(false);
    config.DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM = false;
    localStorage.removeItem('token');
    expect(await fetchLocalStatus()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a failing backend reads as "not ready", never a throw, for pollers', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await isLocalReady()).toBe(false);
  });

  it('the connect flow gets the reason when something fails', async () => {
    global.fetch = vi.fn(async () => reply({ error: 'too_big', message: 'Qwen 3.8 27B is too large for this computer.' }, false, 400));
    await expect(setupLocalModel('qwen3.8-27b')).rejects.toMatchObject({ code: 'too_big', message: 'Qwen 3.8 27B is too large for this computer.' });
    global.fetch = vi.fn(async () => reply({}, false, 500));
    await expect(getLocalStatus()).rejects.toThrow('HTTP 500');
  });

  it('setup posts the model id as JSON', async () => {
    await setupLocalModel('qwen3.5-4b');
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://local.test/api/local-models/managed/setup');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ modelId: 'qwen3.5-4b' });
  });
});
