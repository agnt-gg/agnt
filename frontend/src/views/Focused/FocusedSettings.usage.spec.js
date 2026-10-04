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
        stubs: { UiModeSetting: true, CustomSelect: true, UpgradeModal: true, UsageManager: { name: 'UsageManager', template: '<div class="usage-stub" />' } },
      },
    });
    await flushPromises();
    const heads = w.findAll('.focused-edit-block-head h3').map((h) => h.text());
    expect(heads).toContain('Usage');
    expect(heads.indexOf('Usage')).toBeGreaterThan(heads.indexOf('Billing'));
    expect(w.find('.focused-usage').findComponent({ name: 'UsageManager' }).exists()).toBe(true);
    w.unmount();
  });
});
