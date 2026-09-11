import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import CodexSpeedControl from './CodexSpeedControl.vue';
import aiProvider from '@/store/app/aiProvider.js';

let wrapper;
beforeEach(() => localStorage.clear());
afterEach(() => wrapper?.unmount());

function render(provider = 'openai-codex') {
  const store = createStore({ modules: { aiProvider: {
    ...aiProvider,
    state: { ...aiProvider.state, codexPriority: false, reasoningValue: 'max' },
  } } });
  wrapper = mount(CodexSpeedControl, { props: { provider }, global: { plugins: [store] } });
  return store;
}

describe('Codex service tier, not reasoning effort', () => {
  it('shows turtle Standard selected and rabbit Fast off by default', () => {
    // ChatGPT is the rendered label; selectors pass the canonical/legacy key.
    render('OpenAI-Codex');
    const [standard, fast] = wrapper.findAll('button');
    expect(standard.text()).toBe('🐢 Standard');
    expect(fast.text()).toBe('🐇 Fast');
    expect(standard.attributes('aria-pressed')).toBe('true');
    expect(fast.attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('may use more quota or cost more');
  });

  it('toggles independently, persists, and restores after reload', async () => {
    const store = render();
    await wrapper.findAll('button')[1].trigger('click');
    expect(store.state.aiProvider.codexPriority).toBe(true);
    expect(store.state.aiProvider.reasoningValue).toBe('max');
    expect(wrapper.text()).toContain('Priority requested');
    expect(wrapper.findAll('button')[1].attributes('aria-pressed')).toBe('true');
    expect(localStorage.getItem('codexPriority')).toBe('true');
    vi.resetModules();
    expect((await import('@/store/app/aiProvider.js')).default.state.codexPriority).toBe(true);
    await wrapper.findAll('button')[0].trigger('click');
    expect(store.state.aiProvider.codexPriority).toBe(false);
    expect(store.state.aiProvider.reasoningValue).toBe('max');
    expect(localStorage.getItem('codexPriority')).toBeNull();
  });

  it.each(['openai', 'anthropic', null])('is absent for %s', (provider) => {
    render(provider);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('keeps the Codex preference when switching away and back', async () => {
    render();
    await wrapper.findAll('button')[1].trigger('click');
    await wrapper.setProps({ provider: 'openai' });
    expect(wrapper.find('button').exists()).toBe(false);
    await wrapper.setProps({ provider: 'openai-codex' });
    expect(wrapper.findAll('button')[1].attributes('aria-pressed')).toBe('true');
  });

  it('does not treat arbitrary truthy stored settings as priority consent', async () => {
    localStorage.setItem('codexPriority', 'yes');
    vi.resetModules();
    const mod = (await import('@/store/app/aiProvider.js')).default;
    expect(mod.state.codexPriority).toBe(false);
    mod.mutations.SET_CODEX_PRIORITY(mod.state, 'false');
    expect(mod.state.codexPriority).toBe(false);
  });
});
