import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const handleInstall = vi.fn(() => Promise.resolve({ success: true }));
const state = reactive({ marketplace: { myInstalls: [] } });
const getters = reactive({ 'marketplace/shelfStatus': 'ready', 'marketplace/shelfItems': [] });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
vi.mock('@/composables/useMarketplaceInstall', () => ({ useMarketplaceInstall: () => ({ handleInstall }) }));
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
    expect(w.find('.focused-market-get').text()).toBe('$12.50');
    await w.find('.focused-market-get').trigger('click');
    await flushPromises();
    expect(handleInstall).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', price: 12.5 }));
    expect(w.find('.focused-market-get').text()).toBe('Installed');
    expect(nav.toast).toHaveBeenCalledWith('Weekly report installed');
    w.unmount();
  });

  it('blocks duplicate installs while pending and after installation', async () => {
    let finish;
    handleInstall.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const w = mountMarket('a1');
    await w.find('.focused-market-get').trigger('click');
    expect(w.find('.focused-market-get').attributes('disabled')).toBeDefined();
    expect(handleInstall).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await flushPromises();
    expect(w.find('.focused-market-get').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('cancelled/failed installs never claim success', async () => {
    handleInstall.mockResolvedValue({ success: false, error: 'Could not save locally' });
    const w = mountMarket('a1');
    await w.find('.focused-market-get').trigger('click');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain('Could not save locally');
    expect(w.find('.focused-market-get').text()).toBe('Get');
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

  it('recovers broken preview art and reads installed state', async () => {
    getters['marketplace/shelfItems'] = [{ ...listings[0], preview_image: 'bad.png' }];
    state.marketplace.myInstalls = [{ marketplace_item_id: 'a1' }];
    const w = mountMarket('a1');
    expect(w.find('.focused-market-get').text()).toBe('Installed');
    await w.find('.focused-market-detail-art img').trigger('error');
    expect(w.find('.focused-market-detail-art img').exists()).toBe(false);
    expect(w.find('.focused-market-detail-art i').exists()).toBe(true);
    w.unmount();
  });

  // Shelves and agnt:// links name a listing by its asset id; this page used
  // to match only the listing id, so those links found nothing.
  it('opens a listing named by its asset id or its listing id', () => {
    getters['marketplace/shelfItems'] = [{ id: 'row-9', asset_id: 'agnt-usecase-triage', title: 'Inbox triage', asset_type: 'agent', price: '0.00', downloads: 3 }];
    for (const key of ['agnt-usecase-triage', 'row-9']) {
      const w = mountMarket(key);
      expect(w.find('.focused-market-detail').text(), key).toContain('Inbox triage');
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
