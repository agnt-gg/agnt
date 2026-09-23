/** Mount the real header: an empty model must never remove the recovery control. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

vi.mock('@/composables/useElectron', () => ({
  useElectron: () => ({ isElectron: { value: false } }),
  electronUtils: { window: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() } },
}));

import CanvasScreen from './CanvasScreen.vue';
import widgetLayoutModule from '@/store/features/widgetLayout.js';

let wrapper;
function renderHeader(selection = {}, authenticated = true) {
  const page = { id: 'test-chat-page', name: 'Chat', route: 'ChatScreen', order: 0 };
  const store = createStore({
    modules: {
      userAuth: { namespaced: true, getters: { isAuthenticated: () => authenticated } },
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider: null, selectedModel: null, customProviders: [], ...selection }),
      },
      widgetLayout: {
        ...widgetLayoutModule,
        state: () => ({ pages: [page], activePageId: page.id, layouts: {}, isDirty: false, isLoaded: true }),
        actions: { setActivePage: vi.fn() },
      },
      contentOutputs: { namespaced: true, getters: { unreadOutputIdSet: () => new Set() } },
      chat: { namespaced: true, getters: { streamingOutputIds: () => new Set() } },
    },
  });
  wrapper = mount(CanvasScreen, {
    global: {
      plugins: [store],
      stubs: {
        WidgetCanvas: true, WidgetCatalog: true, SimpleModal: true, Teleport: true,
        Tooltip: { template: '<span><slot /></span>' },
        ChatProviderSelector: {
          name: 'ChatProviderSelector',
          props: ['isOpen'],
          emits: ['close'],
          template: '<div class="test-provider-panel"><button @click="$emit(\'close\')">Close</button></div>',
        },
      },
    },
  });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Header test must not access the network'); }));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Given the authenticated top bar next to the clock', () => {
  it.each([
    [null, null],
    ['OpenAI-Codex', null],
    ['OpenAI-Codex', ''],
  ])('when provider=%s and model=%s, then Select model stays available and opens/closes the picker', async (provider, model) => {
    renderHeader({ selectedProvider: provider, selectedModel: model });
    expect(wrapper.find('#cvClock').exists()).toBe(true);
    const control = wrapper.find('.cv-global-model-clickable');
    expect(control.exists()).toBe(true);
    expect(control.text()).toContain('Select model');
    expect(control.element.tagName).toBe('BUTTON');
    expect(control.attributes('type')).toBe('button');
    expect(control.attributes('aria-label')).toBe('Change default AI model');
    expect(control.attributes('aria-expanded')).toBe('false');
    await control.trigger('click');
    expect(wrapper.find('.test-provider-panel').exists()).toBe(true);
    expect(control.attributes('aria-expanded')).toBe('true');
    await wrapper.find('.test-provider-panel button').trigger('click');
    expect(wrapper.find('.test-provider-panel').exists()).toBe(false);
    expect(control.attributes('aria-expanded')).toBe('false');
  });

  it('preserves the provider/model label and lets the same button toggle the picker', async () => {
    renderHeader({ selectedProvider: 'OpenAI-Codex', selectedModel: 'saved-test-model' });
    const control = wrapper.find('.cv-global-model-clickable');
    expect(control.text()).toContain('openai-codex/saved-test-model');
    await control.trigger('click');
    expect(wrapper.find('.test-provider-panel').exists()).toBe(true);
    await control.trigger('click');
    expect(wrapper.find('.test-provider-panel').exists()).toBe(false);
  });

  it('resolves a custom-provider ID to its friendly name', () => {
    renderHeader({
      selectedProvider: 'custom-123', selectedModel: 'private-model',
      customProviders: [{ id: 'custom-123', provider_name: 'Private host' }],
    });
    expect(wrapper.find('.cv-global-model-clickable').text()).toContain('Private host/private-model');
  });

  it('updates the label after settings load, and remains usable if the model later becomes empty', async () => {
    const store = renderHeader();
    expect(wrapper.find('.cv-global-model-clickable').text()).toContain('Select model');
    store.state.aiProvider.selectedProvider = 'OpenAI-Codex';
    store.state.aiProvider.selectedModel = 'saved-test-model';
    await nextTick();
    expect(wrapper.find('.cv-global-model-clickable').text()).toContain('openai-codex/saved-test-model');
    store.state.aiProvider.selectedModel = null;
    await nextTick();
    expect(wrapper.find('.cv-global-model-clickable').text()).toContain('Select model');
    await wrapper.find('.cv-global-model-clickable').trigger('click');
    expect(wrapper.find('.test-provider-panel').exists()).toBe(true);
  });

  it('does not expose the authenticated toolbar on the sign-in screen', () => {
    renderHeader({}, false);
    expect(wrapper.find('.cv-toolbar').exists()).toBe(false);
    expect(wrapper.find('.cv-global-model-clickable').exists()).toBe(false);
  });
});
