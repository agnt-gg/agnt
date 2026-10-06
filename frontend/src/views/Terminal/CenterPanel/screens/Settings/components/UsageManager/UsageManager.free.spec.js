/**
 * A free account's Usage page. It used to be one locked "Hosted services"
 * card with no numbers: the free AGNT Flash allowance the account actually
 * has was invisible, and there was one generic Upgrade for everything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const getters = { 'userAuth/isPremium': false };
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters }) }));
vi.mock('@/tt.config', () => ({ API_CONFIG: { BASE_URL: 'http://local.test/api' } }));
const flashApi = vi.hoisted(() => ({ fetchFlashAccount: vi.fn(), startFlashTopUp: vi.fn() }));
vi.mock('@/services/agntFlash.js', async (importOriginal) => ({ ...(await importOriginal()), ...flashApi }));

import UsageManager from './UsageManager.vue';

const mountUsage = () =>
  mount(UsageManager, {
    global: {
      stubs: { UpgradeModal: { name: 'UpgradeModal', props: ['open', 'reason', 'suggest'], template: '<div class="upgrade-stub" />' } },
      directives: { tooltip: {} },
    },
  });

describe('UsageManager — free account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    getters['userAuth/isPremium'] = false;
    flashApi.fetchFlashAccount.mockResolvedValue({
      trial: true, usedCredits: 2_500_000, includedCredits: 10_000_000, remainingCredits: 7_500_000, balanceMicroUSD: 0,
    });
  });

  it('shows the free AGNT Flash allowance, measured', async () => {
    const w = mountUsage();
    await flushPromises();
    const card = w.find('[data-testid="free-flash"]');
    expect(card.text()).toContain('AGNT Flash');
    expect(card.text()).toContain('Free trial');
    expect(card.text()).toContain('2.5M');
    expect(card.text()).toContain('10M');
    expect(card.text()).toContain('7.5M credits left');
    expect(card.find('button').exists()).toBe(false);
    expect(card.find('.meter-fill').attributes('style')).toContain('width: 25%');
    expect(w.find('.pro-gate').exists()).toBe(false);
  });

  it('never asks the Pro-gated usage route for a free account', async () => {
    mountUsage();
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(flashApi.fetchFlashAccount).toHaveBeenCalledOnce();
  });

  // One quiet block, one button: an Upgrade per service crowded the page.
  it('lists what AGNT Pro adds as one dimmed list under a single Upgrade', async () => {
    const w = mountUsage();
    await flushPromises();
    const block = w.find('[data-testid="pro-services"]');
    expect(block.findAll('li').map((li) => li.find('.pro-name').text())).toEqual([
      'AGNT Flash', 'Search', 'Sandbox', 'Mail', 'Webhooks', 'Text Annie', 'Hosted instance',
    ]);
    // Allowances come from the plan table checkout sells from.
    expect(w.find('[data-testid="pro-search"]').text()).toContain('150 searches + 750 pages / mo');
    expect(w.find('[data-testid="pro-models"]').text()).toContain('100M credits / mo');
    expect(w.findAll('button').filter((b) => /upgrade/i.test(b.text()))).toHaveLength(1);
    expect(w.findAll('.usage-card')).toHaveLength(1);
  });

  it('opens the upgrade modal from that one button', async () => {
    const w = mountUsage();
    await flushPromises();
    await w.find('[data-testid="pro-services"] .card-btn.primary').trigger('click');
    expect(w.findComponent({ name: 'UpgradeModal' }).props('open')).toBe(true);
  });

  it('still shows every upgrade when the Flash balance cannot be read', async () => {
    flashApi.fetchFlashAccount.mockRejectedValue(new Error('offline'));
    const w = mountUsage();
    await flushPromises();
    expect(w.find('.usage-error').text()).toContain('offline');
    expect(w.findAll('[data-testid="pro-services"] li')).toHaveLength(7);
  });

  it('leaves a paid account on its measured usage view', async () => {
    getters['userAuth/isPremium'] = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ services: [], fetchedAt: 1 }) });
    const w = mountUsage();
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toContain('/agnt-services/usage');
    expect(w.find('[data-testid="free-flash"]').exists()).toBe(false);
    expect(flashApi.fetchFlashAccount).not.toHaveBeenCalled();
  });
});
