import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ConfigureTab from './ConfigureTab.vue';

/**
 * Custom OpenAI-compatible providers as PER-AGENT fallback tiers.
 *
 * The backend feeds customProviderIds to both the agent chain and the user
 * chain (OrchestratorService / AutonomousMessageService), and the global
 * dropdown (FallbackProviders.vue) already offers custom providers. This
 * component is the remaining surface that writes a chain, and it still built
 * its options from `aiProviders` alone — the filteredProviders getter, which
 * returns state.providers, i.e. built-ins only.
 *
 * Two rules make this NOT a copy of the global editor:
 *
 *   1. The model select here offers an explicit { value: '', label: 'Provider
 *      default' } option. That is a valid choice for a built-in (the chain
 *      builder substitutes the provider's first text model) and an invalid one
 *      for a custom provider (no static model list, so buildProviderChain drops
 *      the tier). Offering it to a custom provider invites the user to build a
 *      tier that silently never fires.
 *   2. The PRIMARY provider select must not change. Its option values are
 *      display names, so a custom provider would render as a raw UUID.
 *
 * `<script setup>` does not expose internals on wrapper.vm, so these tests
 * assert on what the rendered BaseSelects are actually handed and on the
 * emitted save payload — which is the real contract anyway.
 */

const SPARK_LING = '2d6a62f5-b7e9-4cfe-92cc-d4bede6e9202';
const SPARK_QWEN = '56515f9f-92ca-4456-b9cf-72bfdc30277e';

/** Records the props each select was handed, addressable by its id. */
const BaseSelectStub = {
  name: 'BaseSelect',
  props: ['modelValue', 'label', 'id', 'options', 'disabled', 'placeholder', 'maxHeight', 'selectClass', 'zIndex'],
  emits: ['update:modelValue'],
  template: '<div class="base-select-stub"></div>',
};

const ListWithSearchStub = {
  name: 'ListWithSearch',
  props: ['items', 'selectedItems', 'title'],
  template: '<div class="list-stub"></div>',
};

const SimpleModalStub = {
  name: 'SimpleModal',
  template: '<div class="modal-stub"></div>',
  methods: { showModal: () => Promise.resolve(false) },
};

function makeAgent(overrides = {}) {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: '',
    provider: 'Anthropic',
    model: 'claude-opus-5',
    fallbackEnabled: true,
    fallbackProviders: [],
    assignedTools: [],
    assignedWorkflows: [],
    assignedSkills: [],
    ...overrides,
  };
}

function makeStore({
  providers = ['Anthropic', 'OpenAI', 'GrokAI'],
  customProviders = [],
  allModels = {},
} = {}) {
  const dispatched = [];
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({ allModels, customProviders, selectedProvider: 'Anthropic' }),
        getters: { filteredProviders: () => providers },
        actions: {
          fetchProviderModels: () => Promise.resolve([]),
          fetchCustomProviders: () => Promise.resolve([]),
        },
      },
    },
  });
  const realDispatch = store.dispatch.bind(store);
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    return realDispatch(type, payload);
  };
  return { store, dispatched };
}

async function mountTab({ agent = {}, ...storeOpts } = {}) {
  const { store, dispatched } = makeStore(storeOpts);
  const wrapper = mount(ConfigureTab, {
    props: {
      selectedAgent: makeAgent(agent),
      availableTools: [],
      availableSkills: [],
      categoryOptions: [],
    },
    global: {
      plugins: [store],
      stubs: {
        BaseSelect: BaseSelectStub,
        ListWithSearch: ListWithSearchStub,
        SimpleModal: SimpleModalStub,
      },
    },
  });
  await flushPromises();
  return { wrapper, store, dispatched };
}

/** The options a given BaseSelect (addressed by its id) was rendered with. */
function optionsOf(wrapper, id) {
  const hit = wrapper.findAllComponents(BaseSelectStub).find((c) => c.props('id') === id);
  if (!hit) throw new Error(`no BaseSelect rendered with id "${id}"`);
  return hit.props('options');
}

function selectProp(wrapper, id, prop) {
  const hit = wrapper.findAllComponents(BaseSelectStub).find((c) => c.props('id') === id);
  if (!hit) throw new Error(`no BaseSelect rendered with id "${id}"`);
  return hit.props(prop);
}

async function saveAndGetPayload(wrapper) {
  await wrapper.find('.action-button.primary').trigger('click');
  await flushPromises();
  const events = wrapper.emitted('save-configuration');
  return events[events.length - 1][0];
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ConfigureTab — custom providers in the per-agent fallback dropdown', () => {
  it('offers an active custom provider as a fallback tier', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: '', model: '' }] },
    });
    const opts = optionsOf(wrapper, 'agentFallbackProvider0');
    expect(opts).toContainEqual({ value: SPARK_LING, label: 'spark-ling' });
  });

  it('labels the custom option with its name, not its UUID', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: '', model: '' }] },
    });
    const opt = optionsOf(wrapper, 'agentFallbackProvider0').find((o) => o.value === SPARK_LING);
    expect(opt.label).toBe('spark-ling');
  });

  it('leaves the PRIMARY provider dropdown alone', async () => {
    // providerOptions values are display names; a custom provider there would
    // render as a raw UUID and be saved as the agent's primary by that id.
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    const values = optionsOf(wrapper, 'agentConfigProvider').map((o) => o.value);
    expect(values).not.toContain(SPARK_LING);
    expect(values).toContain('Anthropic');
  });

  it('still offers the built-in providers alongside the custom ones', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { provider: 'Anthropic', fallbackProviders: [{ provider: '', model: '' }] },
    });
    const values = optionsOf(wrapper, 'agentFallbackProvider0').map((o) => o.value);
    expect(values).toContain('OpenAI');
    expect(values).toContain(SPARK_LING);
  });

  it('excludes a custom provider that is the agent primary', async () => {
    const { wrapper } = await mountTab({
      customProviders: [
        { id: SPARK_LING, provider_name: 'spark-ling' },
        { id: SPARK_QWEN, provider_name: 'spark-qwen' },
      ],
      agent: { provider: SPARK_LING, fallbackProviders: [{ provider: '', model: '' }] },
    });
    const values = optionsOf(wrapper, 'agentFallbackProvider0').map((o) => o.value);
    expect(values).not.toContain(SPARK_LING);
    expect(values).toContain(SPARK_QWEN);
  });

  it('does not offer the same custom provider on two rows', async () => {
    const { wrapper } = await mountTab({
      customProviders: [
        { id: SPARK_LING, provider_name: 'spark-ling' },
        { id: SPARK_QWEN, provider_name: 'spark-qwen' },
      ],
      agent: {
        fallbackProviders: [
          { provider: SPARK_LING, model: 'ling-mini' },
          { provider: '', model: '' },
        ],
      },
    });
    const values = optionsOf(wrapper, 'agentFallbackProvider1').map((o) => o.value);
    expect(values).not.toContain(SPARK_LING);
    expect(values).toContain(SPARK_QWEN);
  });

  it('keeps the row\'s own custom selection in its option list', async () => {
    // Otherwise the select renders with a value absent from its options and
    // shows blank, which reads as "my configured tier vanished".
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] },
    });
    const values = optionsOf(wrapper, 'agentFallbackProvider0').map((o) => o.value);
    expect(values).toContain(SPARK_LING);
  });

  it('enables "Add fallback" when only a custom provider is left to choose', async () => {
    const { wrapper } = await mountTab({
      providers: ['Anthropic'],
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { provider: 'Anthropic', fallbackProviders: [] },
    });
    const addBtn = wrapper.find('.fallback-add');
    expect(addBtn.exists()).toBe(true);
    expect(addBtn.attributes('disabled')).toBeUndefined();
  });
});

describe('ConfigureTab — model options for a custom fallback tier', () => {
  it('does NOT offer "Provider default" for a custom provider', async () => {
    // buildProviderChain drops a custom tier with no model, so this option
    // would let the user configure a tier that can never fire.
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      allModels: { [SPARK_LING]: ['ling-mini'] },
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] },
    });
    const values = optionsOf(wrapper, 'agentFallbackModel0').map((o) => o.value);
    expect(values).not.toContain('');
  });

  it('still offers "Provider default" for a built-in provider', async () => {
    const { wrapper } = await mountTab({
      allModels: { OpenAI: ['gpt-4o'] },
      agent: { fallbackProviders: [{ provider: 'OpenAI', model: '' }] },
    });
    const opts = optionsOf(wrapper, 'agentFallbackModel0');
    expect(opts).toContainEqual({ value: '', label: 'Provider default' });
  });

  it('lists the custom provider\'s fetched models', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      allModels: { [SPARK_LING]: ['ling-mini', 'ling-large'] },
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] },
    });
    const values = optionsOf(wrapper, 'agentFallbackModel0').map((o) => o.value);
    expect(values).toEqual(['ling-mini', 'ling-large']);
  });

  it('does not tell the user a custom tier will use a provider default', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: '' }] },
    });
    expect(selectProp(wrapper, 'agentFallbackModel0', 'placeholder')).not.toBe('Provider default');
  });

  it('fetches models for a custom fallback provider', async () => {
    const { wrapper, dispatched } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: '', model: '' }] },
    });
    const select = wrapper
      .findAllComponents(BaseSelectStub)
      .find((c) => c.props('id') === 'agentFallbackProvider0');
    select.vm.$emit('update:modelValue', SPARK_LING);
    await flushPromises();
    const call = dispatched.find(
      (d) => d.type === 'aiProvider/fetchProviderModels' && d.payload?.provider === SPARK_LING,
    );
    expect(call).toBeTruthy();
  });

  it('loads the custom provider list on mount', async () => {
    const { dispatched } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    expect(dispatched.some((d) => d.type === 'aiProvider/fetchCustomProviders')).toBe(true);
  });
});

describe('ConfigureTab — saving a per-agent chain with custom tiers', () => {
  it('saves a complete custom tier verbatim', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      allModels: { [SPARK_LING]: ['ling-mini'] },
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] },
    });
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([{ provider: SPARK_LING, model: 'ling-mini' }]);
  });

  it('drops a custom tier with no model, because the backend would', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: '' }] },
    });
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([]);
  });

  it('tells the user which custom tier was dropped', async () => {
    // Dropping it silently is the same failure in a new place: the chain the
    // user configured is not the chain that gets saved, and nothing says so.
    // This component's channel for that is the terminal line it already emits
    // for other user-facing errors.
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: '' }] },
    });
    await saveAndGetPayload(wrapper);
    const lines = (wrapper.emitted('add-terminal-line') || []).map((e) => e[0]).join('\n');
    expect(lines).toMatch(/spark-ling/);
    expect(lines).toMatch(/model/i);
  });

  it('says nothing when every tier is complete', async () => {
    const { wrapper } = await mountTab({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      allModels: { [SPARK_LING]: ['ling-mini'] },
      agent: { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] },
    });
    await saveAndGetPayload(wrapper);
    const lines = (wrapper.emitted('add-terminal-line') || []).map((e) => e[0]).join('\n');
    expect(lines).not.toMatch(/spark-ling/);
  });

  it('still saves a built-in tier with no model as a provider default', async () => {
    const { wrapper } = await mountTab({
      agent: { fallbackProviders: [{ provider: 'OpenAI', model: '' }] },
    });
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([{ provider: 'OpenAI', model: null }]);
  });

  it('keeps a mixed chain in configured order, minus the incomplete custom tier', async () => {
    const { wrapper } = await mountTab({
      customProviders: [
        { id: SPARK_LING, provider_name: 'spark-ling' },
        { id: SPARK_QWEN, provider_name: 'spark-qwen' },
      ],
      allModels: { [SPARK_LING]: ['ling-mini'] },
      agent: {
        fallbackProviders: [
          { provider: SPARK_LING, model: 'ling-mini' },
          { provider: 'OpenAI', model: 'gpt-4o' },
          { provider: SPARK_QWEN, model: '' },
        ],
      },
    });
    const payload = await saveAndGetPayload(wrapper);
    expect(payload.fallbackProviders).toEqual([
      { provider: SPARK_LING, model: 'ling-mini' },
      { provider: 'OpenAI', model: 'gpt-4o' },
    ]);
  });
});
