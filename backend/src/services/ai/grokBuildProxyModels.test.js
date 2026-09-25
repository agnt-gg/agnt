/**
 * The Grok Build picker's catalogue comes from the chat proxy's
 * GET /v1/models — the surface AGNT actually sends chat to — not
 * `grok models`, which also lists cursor-* / cline-pass-* ids the proxy 400s
 * on. No network: fetch and the credential API are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GrokBuildAuthManager from '../auth/GrokBuildAuthManager.js';
import {
  listProxyModels,
  listProxyModelEntries,
  __resetGrokBuildProxyModelsCacheForTests,
} from './grokBuildProxyModels.js';

// Trimmed live response shape (CLI 1.0.41).
const effort = (value, isDefault = false) => ({ id: value, value, label: value, default: isDefault });
const LIVE_BODY = {
  object: 'list',
  data: [
    { id: 'grok-4.7', object: 'model', context_window: 500000, reasoning_effort: 'high', supports_reasoning_effort: true,
      reasoning_efforts: [effort('xhigh'), effort('high', true), effort('medium'), effort('low')] },
    { id: 'grok-4.7-build-fast', object: 'model', context_window: 500000 },
    { id: 'grok-4.6', object: 'model', context_window: 500000 },
    { id: 'grok-4.5', object: 'model', context_window: 500000, reasoning_effort: 'high', supports_reasoning_effort: true,
      reasoning_efforts: [effort('high', true), effort('medium'), effort('low')] },
  ],
};

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
let fetchSpy;
let tokenSpy;

beforeEach(() => {
  __resetGrokBuildProxyModelsCacheForTests();
  tokenSpy = vi.spyOn(GrokBuildAuthManager, 'ensureValidToken').mockResolvedValue('tok');
  vi.spyOn(GrokBuildAuthManager, 'getCliVersion').mockResolvedValue('1.0.41');
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listProxyModels', () => {
  it('returns the ids the proxy reports, in order', async () => {
    fetchSpy.mockResolvedValue(ok(LIVE_BODY));
    expect(await listProxyModels()).toEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  });

  it('sends the same client headers LlmService uses', async () => {
    fetchSpy.mockResolvedValue(ok(LIVE_BODY));
    await listProxyModels();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cli-chat-proxy.grok.com/v1/models');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'x-grok-client-version': '1.0.41',
      'x-grok-client-identifier': 'xai-grok-cli',
      'x-grok-client-surface': 'grok-build',
    });
  });

  it('caches a success, and forceRefresh bypasses the cache', async () => {
    fetchSpy.mockImplementation(async () => ok(LIVE_BODY));
    await listProxyModels();
    await listProxyModels();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await listProxyModels({ forceRefresh: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns [] on a non-2xx so the caller falls back to the static list', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 426 }));
    expect(await listProxyModels()).toEqual([]);
  });

  it('returns [] on a network error, and does not cache the failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await listProxyModels()).toEqual([]);
    fetchSpy.mockResolvedValueOnce(ok(LIVE_BODY));
    expect(await listProxyModels()).toHaveLength(4);
  });

  it('returns [] without calling the proxy when there is no token', async () => {
    tokenSpy.mockResolvedValue(null);
    expect(await listProxyModels()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops malformed and duplicate entries', async () => {
    fetchSpy.mockResolvedValue(ok({ data: [null, {}, { id: '' }, { id: 42 }, { id: 'grok-4.7' }, { id: 'grok-4.7' }] }));
    expect(await listProxyModels()).toEqual(['grok-4.7']);
  });
});

describe('listProxyModelEntries', () => {
  it('keeps each model\'s published efforts, default and context window', async () => {
    fetchSpy.mockResolvedValue(ok({
      data: [
        LIVE_BODY.data[0],
        LIVE_BODY.data[3],
        // The proxy says it takes none: must become [], never "unknown".
        { id: 'grok-x-flat', supports_reasoning_effort: false, reasoning_efforts: [effort('high')] },
        { id: 'grok-x-bare' },
      ],
    }));
    expect(await listProxyModelEntries()).toEqual([
      { id: 'grok-4.7', contextWindow: 500000, reasoningEfforts: ['xhigh', 'high', 'medium', 'low'], reasoningDefaultEffort: 'high' },
      { id: 'grok-4.5', contextWindow: 500000, reasoningEfforts: ['high', 'medium', 'low'], reasoningDefaultEffort: 'high' },
      { id: 'grok-x-flat', contextWindow: undefined, reasoningEfforts: [], reasoningDefaultEffort: undefined },
      { id: 'grok-x-bare', contextWindow: undefined, reasoningEfforts: [], reasoningDefaultEffort: undefined },
    ]);
    // The id list comes from the same cached fetch.
    expect(await listProxyModels()).toEqual(['grok-4.7', 'grok-4.5', 'grok-x-flat', 'grok-x-bare']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('cached entries are copies — a caller mutating one cannot poison the cache', async () => {
    fetchSpy.mockResolvedValue(ok({ data: [{ id: 'grok-4.7', reasoning_efforts: [{ value: 'low' }] }] }));
    const first = await listProxyModelEntries();
    first[0].reasoningEfforts.push('bogus');
    expect((await listProxyModelEntries())[0].reasoningEfforts).toEqual(['low']);
  });
});
