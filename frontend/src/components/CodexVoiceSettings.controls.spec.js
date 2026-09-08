import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import Settings from './CodexVoiceSettings.vue';
import CustomSelect from '../views/_components/common/CustomSelect.vue';
import { codexVoiceProfiles as p } from '../voice/codexVoiceSettings.js';
let wrapper;
const pick = (index, value) => {
  const control = wrapper.findAllComponents(CustomSelect)[index];
  control.vm.selectOption(control.props('options').find(o => o.value === value));
};
beforeEach(() => {
  p.setScope(null); p.setScope({ userId: 'voice-ui-batch18', installation: 'http://localhost:3333/api' });
  p.settings.engine = 'codex'; p.settings.provider = 'openai-codex';
  vi.stubGlobal('fetch', vi.fn(async url => {
    const provider = new URL(url, 'http://localhost').searchParams.get('provider');
    return new Response(JSON.stringify({ provider, registered: provider === 'openai-codex', voices: ['cove', 'vale'], fallback: 'none' }));
  }));
});
afterEach(() => { wrapper?.unmount(); wrapper = null; p.setScope(null); vi.unstubAllGlobals(); });
describe('production voice settings shared controls', () => {
  it('renders and persists explicit local input/output without changing text model or provider', async () => {
    wrapper = mount(Settings); await flushPromises();
    pick(0, 'local'); await nextTick();
    expect(wrapper.text()).toContain('pauses never submit');
    expect(wrapper.find('[role="combobox"][aria-label="Local voice output"]').exists()).toBe(true);
    pick(1, 'local-stream'); await nextTick(); expect(p.settings.output).toBeUndefined();
    pick(2, 'pocket-tts-cpu'); await nextTick();
    pick(1, 'local-stream'); await nextTick();
    expect(p.settings.provider).toBe('openai-codex');
    p.setScope(null); p.setScope({userId:'voice-ui-batch18',installation:'http://localhost:3333/api'});
    expect(p.settings.engine).toBe('local'); expect(p.settings.output).toBe('local-stream'); expect(p.settings.providerEngine).toBe('pocket-tts-cpu');
  });
  it('renders five named shared controls and persists actual selection before save', async () => {
    wrapper = mount(Settings); await flushPromises();
    expect(wrapper.findAllComponents(CustomSelect)).toHaveLength(5);
    expect(wrapper.find('[role="combobox"][aria-label="Audio engine"]').exists()).toBe(true);
    pick(2, 'vale'); await nextTick(); expect(p.settings.voice).toBe('vale');
    p.setScope(null); p.setScope({ userId: 'voice-ui-batch18', installation: 'http://localhost:3333/api' });
    expect(p.settings.voice).toBe('vale');
  });
  it('unavailable account cannot be selected by shared control or forged update event', async () => {
    wrapper = mount(Settings); await flushPromises();
    pick(1, 'openai-codex-2'); await nextTick(); expect(p.settings.provider).toBe('openai-codex');
    wrapper.findAllComponents(CustomSelect)[1].vm.$emit('update:modelValue', 'openai-codex-2');
    await nextTick(); expect(p.settings.provider).toBe('openai-codex');
  });
  it('logout disables the remaining engine control without writing preferences', async () => {
    wrapper = mount(Settings); await flushPromises(); p.setScope(null); await nextTick();
    const engine = wrapper.findComponent(CustomSelect);
    expect(engine.props('disabled')).toBe(true);
    engine.vm.$emit('update:modelValue', 'codex'); await nextTick(); expect(p.settings.engine).toBe('legacy');
  });
});
