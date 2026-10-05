/**
 * The Forge answers one question on every render: is what I am looking at
 * what is installed? These tests pin the store half of that answer — the
 * fingerprint, when it is recorded, and what a reset keeps — plus the chat
 * transcript the Forge now shows for a first generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import pluginBuilder, { fingerprint } from './pluginBuilder.js';

const MANIFEST = { name: 'notion-sync', version: '0.1.0', tools: [{ type: 'notion-search', schema: { title: 'Search' } }] };
const PRISTINE = JSON.parse(JSON.stringify(pluginBuilder.state));

function makeStore() {
  const fetchTools = vi.fn();
  const store = createStore({
    modules: {
      pluginBuilder: { ...pluginBuilder, state: () => JSON.parse(JSON.stringify(PRISTINE)) },
      aiProvider: { namespaced: true, state: () => ({ selectedProvider: 'OpenAI', selectedModel: 'gpt-test' }) },
      tools: { namespaced: true, actions: { fetchTools } },
    },
  });
  return { store, fetchTools };
}

function seedDraft(store) {
  store.commit('pluginBuilder/SET_GENERATED_MANIFEST', MANIFEST);
  store.commit('pluginBuilder/SET_GENERATED_CODE', { fileName: 'search.js', code: 'module.exports = {}' });
}

/** A fetch that answers with an SSE body built from [event, data] pairs. */
function sseResponse(events) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    ok: true,
    body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })) }) },
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  global.fetch = vi.fn();
});

describe('fingerprint', () => {
  it('is stable for equal input and differs for different input', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });
});

describe('draft vs installed', () => {
  it('has no fingerprint until a draft exists', () => {
    const { store } = makeStore();
    expect(store.getters['pluginBuilder/draftHash']).toBeNull();
    expect(store.getters['pluginBuilder/hasUninstalledWork']).toBe(false);
  });

  it('a fresh draft is uninstalled work', () => {
    const { store } = makeStore();
    seedDraft(store);
    expect(store.getters['pluginBuilder/draftHash']).toEqual(expect.any(String));
    expect(store.getters['pluginBuilder/hasUninstalledWork']).toBe(true);
  });

  it('a successful build records what was installed and who built it', async () => {
    const { store, fetchTools } = makeStore();
    seedDraft(store);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, pluginName: 'notion-sync' }) });

    const result = await store.dispatch('pluginBuilder/buildAndInstallPlugin');

    expect(result.success).toBe(true);
    expect(store.state.pluginBuilder.installedHash).toBe(store.getters['pluginBuilder/draftHash']);
    expect(store.getters['pluginBuilder/hasUninstalledWork']).toBe(false);
    expect(store.state.pluginBuilder.builtPluginNames).toEqual(['notion-sync']);
    expect(fetchTools).toHaveBeenCalled();
  });

  it('an edit after install is uninstalled work again', async () => {
    const { store } = makeStore();
    seedDraft(store);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await store.dispatch('pluginBuilder/buildAndInstallPlugin');

    store.dispatch('pluginBuilder/updateFile', { fileName: 'search.js', content: 'module.exports = { changed: true }' });

    expect(store.getters['pluginBuilder/hasUninstalledWork']).toBe(true);
  });

  it('a build the server rejects records nothing', async () => {
    // HTTP 200 with success:false used to count as installed.
    const { store } = makeStore();
    seedDraft(store);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: false, error: 'invalid manifest' }) });

    const result = await store.dispatch('pluginBuilder/buildAndInstallPlugin');

    expect(result).toEqual({ success: false, error: 'invalid manifest' });
    expect(store.state.pluginBuilder.installedHash).toBeNull();
    expect(store.state.pluginBuilder.builtPluginNames).toEqual([]);
  });

  it('loading an installed plugin for editing starts in sync with it', async () => {
    const { store } = makeStore();
    global.fetch.mockResolvedValue({
      json: async () => ({ success: true, files: { 'manifest.json': JSON.stringify(MANIFEST), 'search.js': 'module.exports = {}' } }),
    });

    await store.dispatch('pluginBuilder/loadPluginForEditing', 'notion-sync');

    expect(store.state.pluginBuilder.installedHash).not.toBeNull();
    expect(store.getters['pluginBuilder/hasUninstalledWork']).toBe(false);
  });

  it('Start over clears the draft but keeps the list of builds', async () => {
    const { store } = makeStore();
    seedDraft(store);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await store.dispatch('pluginBuilder/buildAndInstallPlugin');

    store.dispatch('pluginBuilder/resetAll');

    expect(store.state.pluginBuilder.generatedManifest).toBeNull();
    expect(store.state.pluginBuilder.installedHash).toBeNull();
    expect(store.state.pluginBuilder.builtPluginNames).toEqual(['notion-sync']);
    expect(JSON.parse(localStorage.getItem('pluginBuilderState')).builtPluginNames).toEqual(['notion-sync']);
  });
});

describe('first generation is a conversation', () => {
  it('records the request and a summary of what was built', async () => {
    const { store } = makeStore();
    global.fetch.mockResolvedValue(
      sseResponse([
        ['manifest', MANIFEST],
        ['code', { file: 'search.js', code: 'module.exports = {}' }],
        ['complete', {}],
      ]),
    );

    await store.dispatch('pluginBuilder/generatePlugin', { description: 'Search my Notion' });

    const messages = store.state.pluginBuilder.conversation;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('Search my Notion');
    expect(messages[1].content).toBe('Built notion-sync: 1 tool (Search).');
  });

  it('records a failure in the conversation instead of losing it', async () => {
    const { store } = makeStore();
    global.fetch.mockResolvedValue({ ok: false, statusText: 'Bad Gateway', json: async () => ({ error: 'provider down' }) });

    const result = await store.dispatch('pluginBuilder/generatePlugin', { description: 'Search my Notion' });

    expect(result.success).toBe(false);
    expect(store.state.pluginBuilder.conversation.at(-1).content).toBe('Generation failed: provider down');
  });
});

describe('test results', () => {
  it('are kept per plugin and tool', () => {
    const { store } = makeStore();
    store.dispatch('pluginBuilder/recordTestResult', { pluginName: 'a', toolType: 't', result: { ok: true } });

    expect(store.getters['pluginBuilder/testResultFor']('a', 't')).toEqual({ ok: true });
    expect(store.getters['pluginBuilder/testResultFor']('b', 't')).toBeNull();
  });
});
