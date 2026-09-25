import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ConfigureTab from './ConfigureTab.vue';

/**
 * Per-tier reasoning effort in the PER-AGENT fallback editor (Agents →
 * Configure). Same contract as Connectors → Fallback Providers:
 *   - a third select appears only for a model with an effort control
 *   - '' = "same as chat", saved by OMITTING the key (the pre-existing shape)
 *   - provider change resets effort; model change clears one it doesn't offer
 *
 * `<script setup>` hides internals, so these assert on what the rendered
 * selects receive and on the emitted save payload.
 */

const BaseSelectStub = {
  name: 'BaseSelect',
  props: ['modelValue', 'label', 'id', 'options', 'disabled', 'placeholder', 'maxHeight', 'selectClass', 'zIndex'],
  emits: ['update:modelValue'],
  template: '<div class="base-select-stub"></div>',
};
const ListWithSearchStub = { name: 'ListWithSearch', props: ['items', 'selectedItems', 'title'], template: '<div />' };
const SimpleModalStub = { name: 'SimpleModal', template: '<div />', methods: { showModal: () => Promise.resolve(false) } };

const control = (...values) => ({
  kind: 'effort',
  options: values.map((v) => ({ value: v, label: v === 'xhigh' ? 'Max' : v[0].toUpperCase() + v.slice(1) })),
});

function makeStore() {
  return createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({
          selectedProvider: 'Anthropic',
          customProviders: [],
          allModels: { 'Grok-Build': ['grok-4.7', 'grok-4.5', 'grok-plain'] },
          modelMetadata: {
            'Grok-Build': {
              'grok-4.7': { reasoningControl: control('default', 'low', 'medium', 'high', 'xhigh') },
              'grok-4.5': { reasoningControl: control('default', 'low', 'medium', 'high') },
              'grok-plain': {},
            },
          },
        }),
        getters: {
          filteredProviders: () => ['Anthropic', 'Grok-Build', 'OpenAI'],
          inferReasoningControl: () => () => null,
        },
        actions: {
          fetchProviderModels: () => Promise.resolve([]),
          fetchCustomProviders: () => Promise.resolve([]),
        },
      },
    },
  });
}

async function mountTab(fallbackProviders) {
  const wrapper = mount(ConfigureTab, {
    props: {
      selectedAgent: {
        id: 'agent-1', name: 'Test Agent', description: '', provider: 'Anthropic', model: 'claude-opus-5',
        fallbackEnabled: true, fallbackProviders, assignedTools: [], assignedWorkflows: [], assignedSkills: [],
      },
      availableTools: [], availableSkills: [], categoryOptions: [],
    },
    global: {
      plugins: [makeStore()],
      stubs: { BaseSelect: BaseSelectStub, ListWithSearch: ListWithSearchStub, SimpleModal: SimpleModalStub },
    },
  });
  await flushPromises();
  return wrapper;
}

const select = (wrapper, id) => wrapper.findAllComponents(BaseSelectStub).find((c) => c.props('id') === id);

async function saveAndGetPayload(wrapper) {
  await wrapper.find('.action-button.primary').trigger('click');
  await flushPromises();
  const events = wrapper.emitted('save-configuration');
  return events[events.length - 1][0];
}

beforeEach(() => localStorage.setItem('token', 'test-token'));
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('ConfigureTab — fallback effort select', () => {
  it('offers the model\'s own efforts, led by "same as chat"', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    const opts = select(wrapper, 'agentFallbackEffort0').props('options');
    expect(opts.map((o) => o.value)).toEqual(['', 'default', 'low', 'medium', 'high', 'xhigh']);
    expect(opts[0].label).toMatch(/same as chat/i);
    expect(opts.find((o) => o.value === 'default').label).toBe('Provider default');
  });

  it('is absent for a model without an effort control', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-plain' }]);
    expect(select(wrapper, 'agentFallbackEffort0')).toBeUndefined();
  });

  it('shows a saved effort', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    expect(select(wrapper, 'agentFallbackEffort0').props('modelValue')).toBe('xhigh');
  });
});

describe('ConfigureTab — saving fallback effort', () => {
  it('sends a chosen effort with its tier', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    select(wrapper, 'agentFallbackEffort0').vm.$emit('update:modelValue', 'xhigh');
    await flushPromises();
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
  });

  it('omits the key for "same as chat"', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
  });

  it('keeps a saved effort through load+save even before metadata confirms it', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-plain', reasoning: 'high' }]);
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders[0].reasoning).toBe('high');
  });
});

describe('ConfigureTab — keeping effort valid for the row', () => {
  it('clears an effort the newly chosen model does not offer', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    select(wrapper, 'agentFallbackModel0').vm.$emit('update:modelValue', 'grok-4.5');
    await flushPromises();
    expect(select(wrapper, 'agentFallbackEffort0').props('modelValue')).toBe('');
  });

  it('keeps an effort the new model also offers', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'low' }]);
    select(wrapper, 'agentFallbackModel0').vm.$emit('update:modelValue', 'grok-4.5');
    await flushPromises();
    expect(select(wrapper, 'agentFallbackEffort0').props('modelValue')).toBe('low');
  });

  it('resets model and effort when the provider changes', async () => {
    const wrapper = await mountTab([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    select(wrapper, 'agentFallbackProvider0').vm.$emit('update:modelValue', 'OpenAI');
    await flushPromises();
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([{ provider: 'OpenAI', model: null }]);
  });
});
