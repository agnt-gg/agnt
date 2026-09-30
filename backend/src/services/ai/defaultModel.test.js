import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saved = vi.hoisted(() => ({ store: {} }));
vi.mock('./lastModelsCache.js', () => ({
  getLastSuccessfulModels: (key) => saved.store[String(key).toLowerCase()] || null,
}));

const { resolveDefaultModel, resolveDefaultModelAsync, liveModelIds, NOT_A_CHAT_MODEL } = await import('./defaultModel.js');
const { getProviderConfig } = await import('./providerConfigs.js');

const asModels = (...ids) => ids.map((id) => ({ id, name: id }));

beforeEach(() => { saved.store = {}; });
afterEach(() => vi.unstubAllGlobals());

describe('resolveDefaultModel', () => {
  it('REGRESSION: never returns a registry default the vendor no longer lists', () => {
    // Live DeepSeek catalogue on 2026-09-30.
    saved.store.deepseek = asModels('deepseek-flash', 'deepseek-v4-pro');
    const model = resolveDefaultModel('deepseek');
    expect(['deepseek-flash', 'deepseek-v4-pro']).toContain(model);
  });

  it('keeps the first registry pick the live catalogue confirms', () => {
    const [first, second] = getProviderConfig('openai').recommendedModels;
    saved.store.openai = asModels('babbage-002', second, first);
    expect(resolveDefaultModel('openai')).toBe(first);
  });

  it('honours a caller-supplied preference order', () => {
    saved.store.groq = asModels('openai/gpt-oss-120b', 'qwen/qwen3.6-27b');
    expect(resolveDefaultModel('groq', { preferred: ['qwen/qwen3.6-27b', 'openai/gpt-oss-120b'] })).toBe('qwen/qwen3.6-27b');
  });

  it('skips non-chat models when nothing preferred is live', () => {
    saved.store.groq = asModels('whisper-large-v3', 'canopylabs/orpheus-v1-english', 'meta-llama/llama-prompt-guard-2-22m', 'openai/gpt-oss-safeguard-20b', 'qwen/qwen3.6-27b');
    expect(resolveDefaultModel('groq', { preferred: ['gone-model'] })).toBe('qwen/qwen3.6-27b');
  });

  it('reads a list saved under the old display-name key', () => {
    saved.store['together ai'] = asModels('Qwen/Qwen3.5-397B-A17B');
    expect(liveModelIds(getProviderConfig('togetherai')).ordered).toEqual(['Qwen/Qwen3.5-397B-A17B']);
    expect(resolveDefaultModel('togetherai', { preferred: ['dead'] })).toBe('Qwen/Qwen3.5-397B-A17B');
  });

  it('falls back to the unverified registry pick only when never fetched', () => {
    expect(resolveDefaultModel('openai')).toBe(getProviderConfig('openai').recommendedModels[0]);
  });

  it('returns null for an unknown provider', () => {
    expect(resolveDefaultModel('no-such-provider')).toBeNull();
  });

  it.each(['whisper-1', 'text-embedding-3-large', 'tts-1', 'gpt-image-2', 'omni-moderation-latest', 'lyria-3.5'])('%s is not a chat model', (id) => {
    expect(NOT_A_CHAT_MODEL.test(id)).toBe(true);
  });
});

describe('resolveDefaultModelAsync — local', () => {
  it("asks the local server and takes its first chat model (was hardcoded 'llama-3.2-1b-instruct')", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'text-embedding-nomic-embed-text-v1.5' }, { id: 'qwen3.5-4b' }, { id: 'qwen/qwen3.5-9b' }] }),
    })));
    expect(await resolveDefaultModelAsync('local')).toBe('qwen3.5-4b');
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/models$/);
  });

  it('returns null, not a guess, when the local server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resolveDefaultModelAsync('local')).toBeNull();
  });

  it('delegates every other provider to the sync resolver', async () => {
    saved.store.deepseek = asModels('deepseek-flash');
    expect(await resolveDefaultModelAsync('deepseek')).toBe('deepseek-flash');
  });
});
