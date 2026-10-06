/**
 * The Plugin Forge chat's two directions.
 *
 * OUT: every turn must carry the whole draft as `pluginState` — the backend
 * picks the `plugin` surface, its tools and its prompt from exactly that, and
 * the old Forge chat failed because the model never saw the plugin it was
 * asked about.
 * IN: the chat's tool events must land in the store even when the Forge pane
 * is not mounted, and still reach the pane when it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import pluginBuilder, { PLUGIN_FORGE_CHANNEL_KEY } from '@/store/features/pluginBuilder.js';
import { usePluginChatContext, askPluginForge, PLUGIN_FORGE_ASK_EVENT } from './usePluginChatContext.js';

const PRISTINE = JSON.parse(JSON.stringify(pluginBuilder.state));
const MANIFEST = { name: 'notion-sync', version: '1.0.0', tools: [{ type: 'notion-search', entryPoint: './search.js' }] };

function setup() {
  const store = createStore({
    modules: {
      pluginBuilder: { ...pluginBuilder, state: () => JSON.parse(JSON.stringify(PRISTINE)) },
      tools: { namespaced: true, actions: { fetchTools: vi.fn() } },
    },
  });
  let context;
  const Host = defineComponent({
    setup() {
      context = usePluginChatContext();
      return () => h('div');
    },
  });
  mount(Host, { global: { plugins: [store] } });
  return { store, context };
}

beforeEach(() => localStorage.clear());

describe('what the chat sends', () => {
  it('is the plugin surface on its own channel', () => {
    const { context } = setup();
    expect(context.chatType).toBe('plugin');
    expect(context.channelKey.value).toBe(PLUGIN_FORGE_CHANNEL_KEY);
  });

  it('sends an empty draft as such, so the backend still knows it is Plugin Forge', () => {
    const { context } = setup();
    expect(context.pageState.value).toEqual({ pluginState: { name: '', files: {}, installState: 'none' } });
    expect(context.pageContext.value).toEqual({ pluginContext: { name: '' } });
  });

  it('sends every file as the user sees it, hand edits included', async () => {
    const { store, context } = setup();
    store.commit('pluginBuilder/SET_GENERATED_MANIFEST', MANIFEST);
    store.commit('pluginBuilder/SET_GENERATED_CODE', { fileName: 'search.js', code: 'v1' });
    store.dispatch('pluginBuilder/updateFile', { fileName: 'search.js', content: 'typed by hand' });
    await nextTick();

    const { pluginState } = context.pageState.value;
    expect(pluginState.name).toBe('notion-sync');
    expect(pluginState.installState).toBe('draft');
    expect(pluginState.files).toEqual({ 'manifest.json': JSON.stringify(MANIFEST, null, 2), 'search.js': 'typed by hand' });
  });
});

describe('what the chat receives', () => {
  it('applies plugin events to the store and still re-broadcasts them for the pane', () => {
    const { store, context } = setup();
    const seen = [];
    const listener = (event) => seen.push(event.detail.eventType);
    window.addEventListener('chat-sse-event', listener);

    context.onFrontendEvent('plugin-files-replaced', { files: { 'manifest.json': JSON.stringify(MANIFEST), 'search.js': 'x' }, installed: false });
    window.removeEventListener('chat-sse-event', listener);

    expect(store.state.pluginBuilder.generatedManifest).toEqual(MANIFEST);
    expect(seen).toEqual(['plugin-files-replaced']);
  });

  it('passes other events through untouched', () => {
    const { store, context } = setup();
    const spy = vi.spyOn(store, 'dispatch');
    context.onFrontendEvent('tool-completed', {});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('askPluginForge', () => {
  it('is how the pane hands the chat a message', () => {
    const texts = [];
    const listener = (event) => texts.push(event.detail.text);
    window.addEventListener(PLUGIN_FORGE_ASK_EVENT, listener);
    askPluginForge('fix the 401');
    window.removeEventListener(PLUGIN_FORGE_ASK_EVENT, listener);
    expect(texts).toEqual(['fix the 401']);
  });
});
