/**
 * The Forge answers one question on every render: is what I am looking at
 * what is installed? These tests pin the store half of that answer — the
 * fingerprint, when it is recorded, and what a reset keeps — plus how the
 * Forge chat's tool events (backend orchestrator/pluginTools.js) land in the
 * draft.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import pluginBuilder, { fingerprint, hashFiles, PLUGIN_FORGE_CHANNEL_KEY } from './pluginBuilder.js';

const MANIFEST = { name: 'notion-sync', version: '0.1.0', tools: [{ type: 'notion-search', schema: { title: 'Search' } }] };
const PRISTINE = JSON.parse(JSON.stringify(pluginBuilder.state));

function makeStore({ withChat = false } = {}) {
  const fetchTools = vi.fn();
  const clearConversation = vi.fn();
  const store = createStore({
    modules: {
      pluginBuilder: { ...pluginBuilder, state: () => JSON.parse(JSON.stringify(PRISTINE)) },
      aiProvider: { namespaced: true, state: () => ({ selectedProvider: 'OpenAI', selectedModel: 'gpt-test' }) },
      tools: { namespaced: true, actions: { fetchTools } },
      ...(withChat ? { chatUnified: { namespaced: true, actions: { clearConversation } } } : {}),
    },
  });
  return { store, fetchTools, clearConversation };
}

function seedDraft(store) {
  store.commit('pluginBuilder/SET_GENERATED_MANIFEST', MANIFEST);
  store.commit('pluginBuilder/SET_GENERATED_CODE', { fileName: 'search.js', code: 'module.exports = {}' });
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

describe('the Forge chat edits the draft through events', () => {
  const apply = (store, eventType, eventData) => store.dispatch('pluginBuilder/applyChatEvent', { eventType, eventData });
  const FILES = {
    'manifest.json': JSON.stringify(MANIFEST, null, 2),
    'search.js': 'export default {}',
    'package.json': JSON.stringify({ name: 'notion-sync', type: 'module' }, null, 2),
  };

  it('a generated plugin becomes the draft, uninstalled', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: false });

    expect(store.getters['pluginBuilder/draftFiles']).toEqual(FILES);
    expect(store.getters['pluginBuilder/draftInstallState']).toBe('draft');
  });

  it('a loaded plugin starts in sync with what is installed', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: true });
    expect(store.getters['pluginBuilder/draftInstallState']).toBe('installed');
  });

  it('an edit to one file supersedes the hand edit of that file only', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: false });
    store.dispatch('pluginBuilder/updateFile', { fileName: 'search.js', content: '// typed by hand' });
    store.dispatch('pluginBuilder/updateFile', { fileName: 'package.json', content: '{"name":"hand"}' });

    await apply(store, 'plugin-file-updated', { file: 'search.js', content: 'export default { v: 2 }' });

    expect(store.getters['pluginBuilder/getFileContent']('search.js')).toBe('export default { v: 2 }');
    expect(store.getters['pluginBuilder/getFileContent']('package.json')).toBe('{"name":"hand"}');
  });

  it('manifest.json is stored parsed, so the Overview reads the change', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: false });
    await apply(store, 'plugin-file-updated', { file: 'manifest.json', content: JSON.stringify({ ...MANIFEST, version: '0.2.0' }, null, 2) });
    expect(store.state.pluginBuilder.generatedManifest.version).toBe('0.2.0');
  });

  it('JSON that does not parse is kept as written rather than dropped', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: false });
    await apply(store, 'plugin-file-updated', { file: 'manifest.json', content: '{ broken' });
    expect(store.getters['pluginBuilder/getFileContent']('manifest.json')).toBe('{ broken');
    expect(store.state.pluginBuilder.generatedManifest).toEqual(MANIFEST);
  });

  it('records the install from the files the chat installed, not from whatever the draft holds now', async () => {
    const { store, fetchTools } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: FILES, installed: false });
    // the user types while the install is in flight
    store.dispatch('pluginBuilder/updateFile', { fileName: 'search.js', content: '// mid-install edit' });

    await apply(store, 'plugin-installed', { name: 'notion-sync', files: FILES });

    expect(store.state.pluginBuilder.installedHash).toBe(hashFiles(FILES));
    expect(store.getters['pluginBuilder/draftInstallState']).toBe('changed');
    expect(store.state.pluginBuilder.builtPluginNames).toEqual(['notion-sync']);
    expect(fetchTools).toHaveBeenCalled();
  });

  it('a deleted file leaves the draft', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-files-replaced', { files: { ...FILES, 'old.js': 'x' }, installed: false });
    await apply(store, 'plugin-file-deleted', { file: 'old.js' });
    expect(Object.keys(store.getters['pluginBuilder/draftFiles'])).toEqual(['manifest.json', 'search.js', 'package.json']);
  });

  it('a chat test run shows in the Test tab', async () => {
    const { store } = makeStore();
    await apply(store, 'plugin-test-result', { pluginName: 'notion-sync', toolType: 'notion-search', result: { ok: false, output: '401' } });
    expect(store.getters['pluginBuilder/testResultFor']('notion-sync', 'notion-search')).toEqual({ ok: false, output: '401' });
  });

  it('ignores events that are not its own', async () => {
    const { store } = makeStore();
    expect(await apply(store, 'widget-field-updated', { field: 'x' })).toBe(false);
  });

  it('hashFiles is the same fingerprint draftHash has always produced, so saved installs stay valid', () => {
    const { store } = makeStore();
    seedDraft(store);
    const files = store.getters['pluginBuilder/draftFiles'];
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    expect(hashFiles(reversed)).toBe(store.getters['pluginBuilder/draftHash']);
    expect(store.getters['pluginBuilder/draftHash']).toBe(fingerprint(JSON.stringify(files)));
  });
});

describe('a new subject gets a new conversation', () => {
  it('Start over clears the Forge chat', () => {
    const { store, clearConversation } = makeStore({ withChat: true });
    store.dispatch('pluginBuilder/resetAll');
    expect(clearConversation).toHaveBeenCalledWith(expect.anything(), { channelKey: PLUGIN_FORGE_CHANNEL_KEY });
  });

  it('opening an installed plugin clears it too', async () => {
    const { store, clearConversation } = makeStore({ withChat: true });
    global.fetch.mockResolvedValue({ json: async () => ({ success: true, files: { 'manifest.json': JSON.stringify(MANIFEST), 'search.js': 'x' } }) });
    await store.dispatch('pluginBuilder/loadPluginForEditing', 'notion-sync');
    expect(clearConversation).toHaveBeenCalledTimes(1);
  });

  it('works without a chat module (tests, early boot)', () => {
    const { store } = makeStore();
    expect(() => store.dispatch('pluginBuilder/resetAll')).not.toThrow();
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
