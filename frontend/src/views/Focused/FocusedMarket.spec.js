import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const handleInstall = vi.fn(() => Promise.resolve({ success: true }));
const state = reactive({ marketplace: { myInstalls: [] } });
const getters = reactive({ 'marketplace/shelfStatus': 'ready', 'marketplace/shelfItems': [] });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
vi.mock('@/composables/useMarketplaceInstall', () => ({ useMarketplaceInstall: () => ({ handleInstall }) }));
// The Plugins page's detail, stubbed: these tests are about which view the Market picks.
vi.mock('@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue', () => ({ default: { name: 'AppsSection', props: { selectedPlugin: String, detailOnly: Boolean, backLabel: String }, emits: ['close-app'], template: '<div class="apps-stub" :data-plugin="selectedPlugin" :data-detail-only="String(detailOnly)" @click="$emit(\'close-app\')" />' } }));
import FocusedMarket from './FocusedMarket.vue';

const nav = { go: vi.fn(), studio: vi.fn(), toast: vi.fn() };
const listings = [
  { id: 'a1', title: 'Research assistant', tagline: 'Read and summarize', asset_type: 'agent', publisher_pseudonym: 'AGNT', price: '0.00', downloads: 50 },
  { id: 'w1', title: 'Weekly report', asset_type: 'workflow', price: '12.50', downloads: 10 },
];
function mountMarket(item = null) {
  return mount(FocusedMarket, { props: { item }, global: { provide: { focusedNav: nav }, stubs: { SimpleModal: true } } });
}
beforeEach(() => {
  vi.clearAllMocks();
  getters['marketplace/shelfStatus'] = 'ready';
  getters['marketplace/shelfItems'] = listings;
  getters['apps/available'] = [];
  getters['apps/installed'] = [];
  state.marketplace.myInstalls = [];
  handleInstall.mockResolvedValue({ success: true });
});

describe('Focused Market', () => {
  it('uses the shared catalog, no Studio panels, and real route navigation', async () => {
    const w = mountMarket();
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchShelfItems', { force: false });
    expect(w.findAll('.focused-market-card')).toHaveLength(2);
    expect(w.find('.three-panel-container').exists()).toBe(false);
    await w.find('.focused-market-card-open').trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'market', item: 'a1' });
    w.unmount();
  });

  it('filters by type and search without changing Studio filters', async () => {
    const w = mountMarket();
    await w.findAll('.focused-tab')[2].trigger('click');
    expect(w.findAll('.focused-market-card')).toHaveLength(1);
    expect(w.find('.focused-market-card').text()).toContain('Weekly report');
    await w.find('input').setValue('nothing matches');
    expect(w.findAll('.focused-market-card')).toHaveLength(0);
    expect(w.text()).toContain('Nothing matches yet');
    expect(dispatch).not.toHaveBeenCalledWith('marketplace/updateFilters', expect.anything());
    w.unmount();
  });

  it('normalizes prices, installs through the shared flow, and marks success only after it returns', async () => {
    const w = mountMarket('w1');
    expect(w.find('[data-action="install"]').text()).toBe('Get · $12.50');
    await w.find('[data-action="install"]').trigger('click');
    await flushPromises();
    expect(handleInstall).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', price: 12.5 }));
    expect(w.find('[data-action="install"]').text()).toBe('Installed');
    expect(nav.toast).toHaveBeenCalledWith('Weekly report installed');
    w.unmount();
  });

  it('blocks duplicate installs while pending and after installation', async () => {
    let finish;
    handleInstall.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const w = mountMarket('a1');
    await w.find('[data-action="install"]').trigger('click');
    expect(w.find('[data-action="install"]').attributes('disabled')).toBeDefined();
    expect(handleInstall).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await flushPromises();
    expect(w.find('[data-action="install"]').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('cancelled/failed installs never claim success', async () => {
    handleInstall.mockResolvedValue({ success: false, error: 'Could not save locally' });
    const w = mountMarket('a1');
    await w.find('[data-action="install"]').trigger('click');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain('Could not save locally');
    expect(w.find('[data-action="install"]').text()).toBe('Get agent');
    expect(nav.toast).not.toHaveBeenCalled();
    w.unmount();
  });

  it('offers retry for catalog failure and handles missing deep links', async () => {
    getters['marketplace/shelfStatus'] = 'error';
    const w = mountMarket('missing');
    await w.find('[role="alert"] button').trigger('click');
    expect(dispatch).toHaveBeenLastCalledWith('marketplace/fetchShelfItems', { force: true });
    getters['marketplace/shelfStatus'] = 'ready';
    await w.vm.$nextTick();
    expect(w.text()).toContain('no longer available');
    w.unmount();
  });

  it('reads installed state on the listing page', async () => {
    state.marketplace.myInstalls = [{ marketplace_item_id: 'a1' }];
    const w = mountMarket('a1');
    expect(w.find('[data-action="install"]').text()).toBe('Installed');
    expect(w.find('[data-action="install"]').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  // Shelves and agnt:// links name a listing by its asset id; this page used
  // to match only the listing id, so those links found nothing.
  it('opens a listing named by its asset id or its listing id', () => {
    getters['marketplace/shelfItems'] = [{ id: 'row-9', asset_id: 'agnt-usecase-triage', title: 'Inbox triage', asset_type: 'agent', price: '0.00', downloads: 3 }];
    for (const key of ['agnt-usecase-triage', 'row-9']) {
      const w = mountMarket(key);
      expect(w.find('.focused-listing-detail').text(), key).toContain('Inbox triage');
      w.unmount();
    }
  });

  it('opening a card links by the stable asset id', async () => {
    getters['marketplace/shelfItems'] = [{ id: 'row-9', asset_id: 'agnt-usecase-triage', title: 'Inbox triage', asset_type: 'agent', price: '0.00', downloads: 3 }];
    const w = mountMarket();
    await w.find('.focused-market-card-open').trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'market', item: 'agnt-usecase-triage' });
    w.unmount();
  });
});

// Requested 2026-10-21: a plugin in the Market shows what it is and does, in the
// Plugins page's own format (what's inside, access it declares, trust, package).
describe('a plugin listing', () => {
  const plugin = { id: 'p1', asset_type: 'plugin', asset_id: 'atlas-cloud', title: 'Atlas Cloud', price: '0.00', downloads: 9 };
  it('shows the Plugins page detail for that plugin, and Back returns to the Market', async () => {
    getters['marketplace/shelfItems'] = [...listings, plugin];
    getters['apps/available'] = [{ name: 'atlas-cloud' }];
    const w = mountMarket('p1');
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('apps/fetchAvailable');
    const detail = w.find('.apps-stub');
    expect(detail.attributes('data-plugin')).toBe('atlas-cloud');
    expect(detail.attributes('data-detail-only')).toBe('true');
    expect(w.find('.focused-market-detail').exists()).toBe(false);
    await detail.trigger('click');
    // Back returns to where the listing's section lives (no Market page, 2026-10-23).
    expect(nav.go).toHaveBeenCalledWith({ page: 'connectors' });
    w.unmount();
  });
  it('a plugin the catalog does not have keeps the Market view; an agent gets its own listing page', async () => {
    getters['marketplace/shelfItems'] = [...listings, plugin];
    const missing = mountMarket('p1');
    await flushPromises();
    expect(missing.find('.apps-stub').exists()).toBe(false);
    expect(missing.find('.focused-market-detail').exists()).toBe(true);
    missing.unmount();
    getters['apps/available'] = [{ name: 'atlas-cloud' }];
    const agent = mountMarket('a1');
    await flushPromises();
    expect(agent.find('.apps-stub').exists()).toBe(false);
    expect(agent.find('.focused-listing-detail').exists()).toBe(true);
    agent.unmount();
  });
});

// Requested 2026-10-21: agents, workflows, tools and skills show what they
// contain and do, in the Plugins page's layout (FocusedListingDetail).
describe('an agent, workflow, tool or skill listing', () => {
  it('shows what it contains and the access it uses, and Back returns to the Market', async () => {
    getters['marketplace/shelfItems'] = [{ id: 'k1', asset_type: 'agent', title: 'Koder Kai', price: '0.00', trust_tier: 'official', publisher_pseudonym: 'someone', metadata: JSON.stringify({ assignedTools: ['execute_shell_command', 'web_search'], systemPrompt: 'You code.' }) }];
    const w = mountMarket('k1');
    const page = w.find('.focused-listing-detail');
    expect(page.find('[data-group="tools"]').text()).toContain('Execute shell command');
    expect(page.findAll('[data-access]').map((a) => a.attributes('data-access'))).toEqual(['programs', 'internet']);
    expect(page.find('[data-section="instructions"] pre').text()).toBe('You code.');
    expect(page.text()).toContain('by AGNT');
    await page.find('[data-action="back"]').trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'library', tab: 'agents' });
    w.unmount();
  });
});
