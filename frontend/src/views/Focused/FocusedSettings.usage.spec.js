/**
 * Usage shows in Focused too: Studio's own Usage page, embedded under Billing,
 * so both modes show the numbers the services enforce.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const store = {
  dispatch: vi.fn(() => Promise.resolve()),
  getters: { 'theme/currentTheme': 'dark', 'aiProvider/filteredProviders': [], 'userAuth/userName': 'N', 'userAuth/userEmail': 'n@x.co', 'userAuth/planType': 'personal' },
  state: { aiProvider: { selectedProvider: '', selectedModel: '', allModels: {} }, userAuth: { planType: 'personal', subscription: null } },
};
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import FocusedSettings from './FocusedSettings.vue';

describe('Focused Settings', () => {
  it('shows Usage, below Billing', async () => {
    const w = mount(FocusedSettings, {
      global: {
        provide: { focusedNav: { studio: vi.fn(), toast: vi.fn(), confirm: vi.fn() } },
        stubs: { UiModeSetting: true, CustomSelect: true, UpgradeModal: true, ThemeSelector: { name: 'ThemeSelector', template: '<div class="theme-stub" />' }, UsageManager: { name: 'UsageManager', template: '<div class="usage-stub" />' } },
      },
    });
    await flushPromises();
    const heads = w.findAll('.focused-edit-block-head h3').map((h) => h.text());
    expect(heads).toContain('Usage');
    expect(heads.indexOf('Usage')).toBeGreaterThan(heads.indexOf('Billing'));
    expect(w.find('.focused-usage').findComponent({ name: 'UsageManager' }).exists()).toBe(true);
    w.unmount();
  });

  it('Appearance is Studio\'s full theme settings (backgrounds, opacity, blur, font, scale), not a theme dropdown', async () => {
    const studio = vi.fn();
    const w = mount(FocusedSettings, {
      global: {
        provide: { focusedNav: { studio, toast: vi.fn(), confirm: vi.fn() } },
        stubs: { UiModeSetting: true, CustomSelect: true, UpgradeModal: true, UsageManager: true, ThemeSelector: { name: 'ThemeSelector', template: '<div class="theme-stub" />' } },
      },
    });
    await flushPromises();
    expect(w.find('[data-section="theme"]').findComponent({ name: 'ThemeSelector' }).exists()).toBe(true);
    // The model's fallbacks and chat behaviour stay one click away.
    await w.find('[data-action="model-settings"]').trigger('click');
    expect(studio).toHaveBeenCalledWith('SettingsScreen', { section: 'providers' });
    // Every other Studio section is listed and opens in full.
    const listed = w.findAll('[data-settings-section]').map((b) => b.attributes('data-settings-section'));
    for (const id of ['sounds', 'security', 'browser', 'backup', 'reset', 'about', 'phone-access', 'api-keys']) expect(listed, id).toContain(id);
    w.unmount();
  });

  it('"Use an API key instead" opens the AI provider keys, not the plugin key vault', async () => {
    const studio = vi.fn();
    const go = vi.fn();
    const w = mount(FocusedSettings, {
      global: {
        provide: { focusedNav: { studio, go, toast: vi.fn(), confirm: vi.fn() } },
        stubs: { UiModeSetting: true, CustomSelect: true, UpgradeModal: true, UsageManager: true, ThemeSelector: true },
      },
    });
    await flushPromises();
    w.findComponent({ name: 'ConnectYourAi' }).vm.$emit('api-key');
    expect(studio).toHaveBeenCalledWith('SettingsScreen', { section: 'providers' });
    expect(go).not.toHaveBeenCalled();
    w.unmount();
  });
});
