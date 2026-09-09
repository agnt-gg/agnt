import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import Control from './CodexSpeedControl.vue';
import aiProvider from '@/store/app/aiProvider.js';
let wrapper;
beforeEach(()=>localStorage.clear());
afterEach(()=>{wrapper?.unmount();vi.unstubAllGlobals();});
function render(provider='openai-codex') {
  const store=createStore({modules:{aiProvider:{...aiProvider,state:{...aiProvider.state,codexPriority:false,codexImages:{},selectedModel:'gpt-6-astra'}}}});
  wrapper=mount(Control,{props:{provider},global:{plugins:[store]}});return store;
}
describe('Feature: compact independent Codex generation controls',()=>{
  it('Given a Codex account, Then text and image generation have separate rows',()=>{
    render();expect(wrapper.text()).toContain('Text generation');expect(wrapper.text()).toContain('Image generation');
    expect(wrapper.find('[data-test="image-policy-latest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="image-policy-latest-fast"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('unverified');
  });
  it('Given image consent, When choosing latest-fast, Then persist it without changing text speed or dispatching',async()=>{
    vi.stubGlobal('fetch',vi.fn());const store=render();
    await wrapper.find('[data-test="images-enabled"]').setValue(true);
    await wrapper.find('[data-test="image-policy-latest-fast"]').trigger('click');
    expect(store.state.aiProvider.codexImages['openai-codex']).toEqual({enabled:true,policy:'latest-fast'});
    expect(store.state.aiProvider.codexPriority).toBe(false);
    expect(JSON.parse(localStorage.getItem('codexImages'))['openai-codex'].policy).toBe('latest-fast');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('Given account1 preference, When switching account2 and back, Then do not borrow consent',async()=>{
    render();await wrapper.find('[data-test="images-enabled"]').setValue(true);
    await wrapper.find('[data-test="image-policy-latest-fast"]').trigger('click');
    await wrapper.setProps({provider:'openai-codex-2'});
    expect(wrapper.find('[data-test="images-enabled"]').element.checked).toBe(false);
    await wrapper.setProps({provider:'openai-codex'});
    expect(wrapper.find('[data-test="images-enabled"]').element.checked).toBe(true);
    expect(wrapper.find('[data-test="image-policy-latest-fast"]').attributes('aria-pressed')).toBe('true');
  });
  it('Given user turns images off, Then keep the preferred tier but revoke consent',async()=>{
    const store=render();await wrapper.find('[data-test="images-enabled"]').setValue(true);
    await wrapper.find('[data-test="image-policy-latest-fast"]').trigger('click');
    await wrapper.find('[data-test="images-enabled"]').setValue(false);
    expect(store.state.aiProvider.codexImages['openai-codex']).toEqual({enabled:false,policy:'latest-fast'});
  });
  it('Given a model override, When showing cost, Then use that model not global state',async()=>{
    render();await wrapper.setProps({model:'gpt-5.4'});expect(wrapper.text()).toContain('2× credit usage');expect(wrapper.text()).not.toContain('2.5× credit usage');
    await wrapper.setProps({model:'unknown-model'});expect(wrapper.text()).not.toContain('× credit usage');
  });
  it('Given no save has happened, Then do not claim saved',()=>{render();expect(wrapper.text()).not.toContain('Preference saved');});
  it('Given corrupted stored preference, Then restore safe defaults',async()=>{
    localStorage.setItem('codexImages','{"openai-codex":{"enabled":"yes","policy":"provider-default"}}');
    vi.resetModules();const mod=(await import('@/store/app/aiProvider.js')).default;
    expect(mod.state.codexImages['openai-codex']).toEqual({enabled:false,policy:'latest'});
  });
});
