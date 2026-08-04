import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import MarketplaceShelf from './MarketplaceShelf.vue';

const handleInstall = vi.fn(() => Promise.resolve({ success: true }));
vi.mock('@/composables/useMarketplaceInstall', () => ({
  useMarketplaceInstall: () => ({ handleInstall, isInstalling: { value: false } }),
}));

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

const AGENTS = [
  { id: 'a1', asset_type: 'agent', title: 'Koder Kai', tagline: 'Expert engineer', category: 'Technology', publisher_pseudonym: 'AcuteBeigeDolphin', price: 0, downloads: 50, rating: 5, rating_count: 1, published_at: day(190) },
  { id: 'a2', asset_type: 'agent', title: 'Social Media Manager', tagline: 'Schedules posts', category: 'Marketing', publisher_pseudonym: 'Nathan', price: 0, downloads: 50, rating: 0, rating_count: 0, published_at: day(259) },
  { id: 'a3', asset_type: 'agent', title: 'Data Analysis Agent', tagline: 'Analyses datasets', category: 'Analytics', publisher_pseudonym: 'Nathan', price: 0, downloads: 38, rating: 0, rating_count: 0, published_at: day(259) },
  { id: 'a4', asset_type: 'agent', title: 'Research Assistant', tagline: 'Searches and cites', category: 'Analytics', publisher_pseudonym: 'Culy', price: 4.5, downloads: 3, rating: 0, rating_count: 0, published_at: day(190) },
];
const TOOLS = [{ id: 't1', asset_type: 'tool', title: 'URL Fetcher', tagline: 'Custom API caller', category: 'Technology', price: 0, downloads: 27, rating_count: 0, published_at: day(259) }];

const fetchShelfItems = vi.fn(() => Promise.resolve());

const makeStore = ({ items = [...AGENTS, ...TOOLS], status = 'ready' } = {}) =>
  createStore({
    modules: {
      marketplace: {
        namespaced: true,
        state: { shelfItems: items, shelfStatus: status, filters: { assetType: 'all', search: '' } },
        getters: {
          shelfItems: (s) => s.shelfItems,
          shelfStatus: (s) => s.shelfStatus,
          shelfItemsByType: (s) => (t) => s.shelfItems.filter((i) => i.asset_type === t),
        },
        actions: { fetchShelfItems },
      },
    },
  });

const mountShelf = async (props = {}, storeOpts = {}) => {
  const store = makeStore(storeOpts);
  const wrapper = mount(MarketplaceShelf, {
    props: { assetType: 'agent', createLabel: 'Create Agent', ...props },
    global: { plugins: [store], stubs: { SimpleModal: true, Tooltip: { template: '<div><slot/></div>' } } },
  });
  await flushPromises();
  return { wrapper, store };
};

beforeEach(() => {
  handleInstall.mockClear();
  fetchShelfItems.mockClear();
  localStorage.clear();
});

describe('MarketplaceShelf — Create survives everything', () => {
  // This is the whole safety argument: the shelf may not remove the only
  // affordance that works offline.
  it('renders the Create CTA when the shelf is full', async () => {
    const { wrapper } = await mountShelf();
    expect(wrapper.find('.ms-start-cta').text()).toContain('Create Agent');
  });

  it('still renders Create when the marketplace fetch failed', async () => {
    const { wrapper } = await mountShelf({}, { status: 'error', items: [] });
    expect(wrapper.find('.ms-start-cta').exists()).toBe(true);
    expect(wrapper.findAll('.ms-card')).toHaveLength(0);
    expect(wrapper.find('.ms-head').exists()).toBe(false);
  });

  it('still renders Create for an asset type the marketplace does not serve', async () => {
    const { wrapper } = await mountShelf({ assetType: 'skill', createLabel: 'Create Skill' });
    expect(wrapper.find('.ms-start-cta').text()).toContain('Create Skill');
    expect(wrapper.findAll('.ms-card')).toHaveLength(0);
  });

  it('emits create when the CTA is clicked', async () => {
    const { wrapper } = await mountShelf();
    await wrapper.find('.ms-start-cta').trigger('click');
    expect(wrapper.emitted('create')).toHaveLength(1);
  });

  it('uses the right article for a vowel-initial noun', async () => {
    const { wrapper } = await mountShelf({ assetType: 'agent' });
    expect(wrapper.find('.ms-start-txt h2').text()).toBe('Start with an agent');
    const { wrapper: w2 } = await mountShelf({ assetType: 'tool' });
    expect(w2.find('.ms-start-txt h2').text()).toBe('Start with a tool');
  });
});

describe('MarketplaceShelf — degraded paths announce themselves', () => {
  const cases = [
    ['an ineligible asset type', { assetType: 'skill' }, {}],
    ['an ineligible widget type', { assetType: 'widget' }, {}],
    ['a failed fetch', {}, { status: 'error', items: [] }],
    ['a catalogue with none of this type', {}, { items: TOOLS }],
    ['a fetch still in flight', {}, { status: 'loading', items: [] }],
  ];

  it.each(cases)('hides the marketplace section for %s', async (_label, props, storeOpts) => {
    const { wrapper } = await mountShelf(props, storeOpts);
    expect(wrapper.find('.ms-head').exists()).toBe(false);
    expect(wrapper.findAll('.ms-card')).toHaveLength(0);
    // The parent needs this to know not to hijack the search box.
    expect(wrapper.emitted('availability').at(-1)).toEqual([false]);
  });

  it('emits availability true only when there is something to show', async () => {
    const { wrapper } = await mountShelf();
    expect(wrapper.emitted('availability').at(-1)).toEqual([true]);
  });
});

describe('MarketplaceShelf — the card conventions', () => {
  it('never renders a fake 0.0 rating; unrated items say Unrated', async () => {
    const { wrapper } = await mountShelf();
    expect(wrapper.text()).not.toMatch(/\b0\.0\b/);
    expect(wrapper.findAll('.ms-m-unrated').length).toBeGreaterThan(0);
  });

  it('shows a real rating when one exists', async () => {
    const { wrapper } = await mountShelf();
    expect(wrapper.find('.ms-m-star').text()).toContain('5.0');
  });

  it('omits the redundant type badge — every card on this screen is that type', async () => {
    const { wrapper } = await mountShelf();
    // Scoped to the art-band tags: the Create CTA legitimately says "Create Agent",
    // so asserting on the whole subtree tests the wrong thing.
    const tags = wrapper.findAll('.ms-tag').map((n) => n.text());
    expect(tags).not.toContain('Agent');
    expect(tags.filter((t) => t === 'FREE').length).toBeGreaterThan(0);
  });

  it('labels free and paid items distinctly', async () => {
    const { wrapper } = await mountShelf();
    const prices = wrapper.findAll('.ms-tag.price').map((n) => n.text());
    expect(prices).toContain('FREE');
  });

  // jsdom performs no layout, so the measured column count stays at 1 and the
  // grid renders one whole row's worth. Assert the ORDER of what renders, not a
  // card count that depends on a real layout engine.
  it('orders by installs, most first, with a stable alphabetical tiebreak', async () => {
    const { wrapper } = await mountShelf();
    const titles = wrapper.findAll('.ms-card-title').map((n) => n.text());
    const expectedOrder = ['Koder Kai', 'Social Media Manager', 'Data Analysis Agent', 'Research Assistant'];
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).toEqual(expectedOrder.slice(0, titles.length));
  });

  it('renders whole rows only, never a ragged tail', async () => {
    const { wrapper } = await mountShelf();
    // 4 items, 1 measured column, max 2 rows -> 2 cards, and never 3.
    expect(wrapper.findAll('.ms-card')).toHaveLength(2);
    expect(wrapper.find('.ms-count').text()).toBe('2 of 4');
  });
});

describe('MarketplaceShelf — search stays local', () => {
  // If the shelf wrote to the marketplace store's global `filters`, searching on
  // the Agents screen would silently re-scope the Marketplace screen.
  it('does not touch the global marketplace filters', async () => {
    const { wrapper, store } = await mountShelf({ query: 'data' });
    expect(store.state.marketplace.filters).toEqual({ assetType: 'all', search: '' });
    expect(wrapper.findAll('.ms-card').length).toBeGreaterThan(0);
  });

  it('filters the grid by the borrowed query', async () => {
    const { wrapper } = await mountShelf({ query: 'data' });
    const titles = wrapper.findAll('.ms-card-title').map((n) => n.text());
    expect(titles).toEqual(['Data Analysis Agent']);
  });

  it('answers a no-match query with a reset, not a wall of unrelated cards', async () => {
    const { wrapper } = await mountShelf({ query: 'kubernetes' });
    expect(wrapper.findAll('.ms-card')).toHaveLength(0);
    expect(wrapper.find('.ms-empty').text()).toContain('kubernetes');
    await wrapper.find('.ms-empty-cta').trigger('click');
    expect(wrapper.emitted('clear-search')).toHaveLength(1);
  });

  it('hides the category chips while searching so the two filters cannot disagree', async () => {
    const { wrapper } = await mountShelf({ query: 'data' });
    expect(wrapper.find('.ms-chips').exists()).toBe(false);
  });
});

describe('MarketplaceShelf — install', () => {
  it('installs with the screen’s asset type, not the item’s, and reports success', async () => {
    const { wrapper } = await mountShelf();
    await wrapper.find('.ms-inst').trigger('click');
    await flushPromises();
    expect(handleInstall).toHaveBeenCalledTimes(1);
    expect(handleInstall.mock.calls[0][1]).toBe('agent');
    expect(wrapper.emitted('installed')).toHaveLength(1);
  });

  it('does not emit installed when the install is cancelled or fails', async () => {
    handleInstall.mockResolvedValueOnce({ success: false, cancelled: true });
    const { wrapper } = await mountShelf();
    await wrapper.find('.ms-inst').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('installed')).toBeUndefined();
  });

  it('ignores a double click rather than installing twice', async () => {
    let resolve;
    handleInstall.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { wrapper } = await mountShelf();
    const btn = wrapper.find('.ms-inst');
    await btn.trigger('click');
    await btn.trigger('click');
    expect(handleInstall).toHaveBeenCalledTimes(1);
    resolve({ success: true });
    await flushPromises();
  });

  it('clicking install does not also navigate away', async () => {
    const { wrapper } = await mountShelf();
    await wrapper.find('.ms-inst').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('browse')).toBeUndefined();
  });

  it('clicking the card body browses to that item', async () => {
    const { wrapper } = await mountShelf();
    await wrapper.find('.ms-card').trigger('click');
    expect(wrapper.emitted('browse')[0][0].id).toBe('a1');
  });
});

describe('MarketplaceShelf — strip variant', () => {
  it('renders compact rows, not full cards, so the user’s own work stays dominant', async () => {
    const { wrapper } = await mountShelf({ variant: 'strip' });
    expect(wrapper.findAll('.ms-row')).toHaveLength(4);
    expect(wrapper.findAll('.ms-card')).toHaveLength(0);
    expect(wrapper.find('.ms-start').exists()).toBe(false); // Create belongs to the empty state only
  });

  it('pluralises the install count correctly', async () => {
    const { wrapper } = await mountShelf({ variant: 'strip' });
    const counts = wrapper.findAll('.ms-row-txt p').map((n) => n.text());
    expect(counts).toContain('50 installs');
    expect(counts).not.toContain('1 installs');
  });

  it('can be dismissed, and stays dismissed per asset type', async () => {
    const { wrapper } = await mountShelf({ variant: 'strip' });
    await wrapper.find('.ms-dismiss').trigger('click');
    expect(wrapper.findAll('.ms-row')).toHaveLength(0);
    expect(localStorage.getItem('marketplaceShelf.dismissed.agent')).toBe('1');

    const { wrapper: reopened } = await mountShelf({ variant: 'strip' });
    expect(reopened.findAll('.ms-row')).toHaveLength(0);
  });

  it('dismissing agents does not dismiss tools', async () => {
    const { wrapper } = await mountShelf({ variant: 'strip' });
    await wrapper.find('.ms-dismiss').trigger('click');
    const { wrapper: tools } = await mountShelf({ assetType: 'tool', variant: 'strip' });
    expect(tools.findAll('.ms-row')).toHaveLength(1);
  });
});

describe('MarketplaceShelf — fetching', () => {
  it('asks the store for the catalogue on mount', async () => {
    await mountShelf();
    expect(fetchShelfItems).toHaveBeenCalledTimes(1);
  });
});
