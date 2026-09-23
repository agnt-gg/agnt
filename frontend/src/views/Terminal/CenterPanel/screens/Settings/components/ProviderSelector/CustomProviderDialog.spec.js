import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import source from './CustomProviderDialog.vue?raw';
import CustomProviderDialog from './CustomProviderDialog.vue';

let wrapper;
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); });
describe('custom provider template menu', () => {
  it('opens above the dialog and selecting Atlas fills the existing form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ templates: [
      { key: 'atlascloud', name: 'Atlas Cloud', baseURL: 'https://api.atlascloud.ai/v1', defaultModel: 'qwen/qwen3.5-397b-a17b', supportsTools: true, supportsVision: true, supportsStreaming: true },
    ] }) }));
    wrapper = mount(CustomProviderDialog, { attachTo: document.body, props: { isOpen: true }, global: { plugins: [createStore({})], directives: { tooltip: {} } } });
    await flushPromises();
    const trigger = document.querySelector('.template-select .selected');
    trigger.click();
    await flushPromises();
    const menu = document.querySelector('.options-container');
    expect(menu).not.toBeNull();
    const overlayZ = Number(source.match(/\.dialog-overlay\s*\{[^}]*z-index:\s*(\d+)/s)[1]);
    expect(Number(menu.style.zIndex)).toBeGreaterThan(overlayZ);
    expect(menu.textContent).toContain('Atlas Cloud');
    menu.querySelector('[role="option"]').click();
    await flushPromises();
    expect(document.querySelector('#provider-name').value).toBe('Atlas Cloud');
    expect(document.querySelector('#base-url').value).toBe('https://api.atlascloud.ai/v1');
    await vi.waitFor(() => expect(document.querySelector('.options-container')).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
