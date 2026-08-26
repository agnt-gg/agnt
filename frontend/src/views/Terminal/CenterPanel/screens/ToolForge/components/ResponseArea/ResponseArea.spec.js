import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import SharedResponseArea from './ResponseArea.vue';

describe('SharedResponseArea', () => {
  let wrapper;
  let store;
  let router;

  beforeEach(async () => {
    // Mock DOM elements and methods
    document.body.innerHTML = `
      <editor-area>
        <inner-editor-area id="response-area"></inner-editor-area>
      </editor-area>
    `;

    // Mock addEventListener
    Element.prototype.addEventListener = vi.fn();

    // Create a mock Vuex store
    store = createStore({
      modules: {
        chat: {
          namespaced: true,
          state: {
            messages: [{ role: 'assistant', content: 'Test response content' }],
          },
        },
      },
    });

    // Create a mock router with memory history for testing
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'Home', component: { template: '<div>Home</div>' } },
        { path: '/tool-forge', name: 'ToolForge', component: { template: '<div>Tool Forge</div>' } },
      ],
    });

    // Set initial route and wait for it
    await router.push('/tool-forge');
    await router.isReady();

    // Mount the component
    wrapper = mount(SharedResponseArea, {
      global: {
        plugins: [store, router],
        stubs: {
          'inner-editor-area': {
            template: '<div id="response-area" contenteditable="true"><slot /></div>',
          },
        },
      },
    });
  });

  it('renders correctly', () => {
    expect(wrapper.find('#response-area').exists()).toBe(true);
  });

  it('shows the empty state when there is no content', () => {
    expect(wrapper.find('#placeholder-text').exists()).toBe(true);
  });

  it('renders content read-only — tool output is not editable', async () => {
    await wrapper.setProps({ content: 'generated output' });
    const display = wrapper.find('.content-display');
    expect(display.exists()).toBe(true);
    expect(display.attributes('contenteditable')).toBe('false');
    expect(display.text()).toContain('generated output');
    expect(wrapper.find('#placeholder-text').exists()).toBe(false);
  });
});
