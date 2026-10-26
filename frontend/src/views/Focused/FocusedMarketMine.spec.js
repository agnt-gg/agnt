import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, defineComponent, h } from 'vue';

const dispatch = vi.fn();
const state = reactive({ marketplace: { myPublishedItems: [], myEarnings: null } });
const getters = reactive({
  'agents/allAgents': [{ id: 'a1', name: 'Kai', avatar: 'data:kai' }],
  'workflows/allWorkflows': [{ id: 'w1', name: 'Digest' }],
  'tools/customTools': [],
  'skills/allSkills': [],
  'agents/agentCategories': ['Dev'],
});
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
vi.mock('@/services/marketplacePublish.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchStripeConnected: vi.fn(async () => false),
}));
// The listing form is its own component with its own spec; here it only has to
// open with the chosen item and emit what the user filled in.
vi.mock('@/views/_components/common/MarketplaceFormModal.vue', () => ({
  default: defineComponent({
    name: 'MarketplaceFormModal',
    props: ['isOpen', 'mode', 'itemType', 'item', 'categories', 'stripeConnected', 'showPreviewImage'],
    emits: ['submit', 'close'],
    setup: (p) => () => (p.isOpen ? h('div', { class: 'form-stub', 'data-type': p.itemType }, p.item?.name) : null),
  }),
}));

const { default: FocusedMarketMine } = await import('./FocusedMarketMine.vue');
const nav = { go: vi.fn(), toast: vi.fn(), confirm: vi.fn(async () => true), studio: vi.fn() };
let w;
const mountMine = () => (w = mount(FocusedMarketMine, { global: { provide: { focusedNav: nav } } }));

beforeEach(() => {
  vi.clearAllMocks();
  state.marketplace.myPublishedItems = [
    { id: 'L1', title: 'Kai', asset_type: 'agent', asset_id: 'a1', status: 'published', price: 0, downloads: 40 },
    { id: 'L2', title: 'Old', asset_type: 'workflow', status: 'unpublished', price: 4.5, downloads: 2 },
  ];
  state.marketplace.myEarnings = { totalNetEarnings: 81, thisMonthNetEarnings: 9.5, totalSales: 18 };
  dispatch.mockResolvedValue(undefined);
});
afterEach(() => w?.unmount());

describe('Your listings & earnings', () => {
  it('shows what you earned, this month, sales and installs', async () => {
    mountMine(); await flushPromises();
    const stat = (id) => w.find(`[data-stat="${id}"] strong`).text();
    expect(stat('net')).toBe('$81.00');
    expect(stat('month')).toBe('$9.50');
    expect(stat('sales')).toBe('18');
    expect(stat('installs')).toBe('42');
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchMyEarnings', { force: true });
  });

  it('lists every listing with its state; an unlisted one offers List again', async () => {
    mountMine(); await flushPromises();
    expect(w.findAll('[data-testid="my-listings"] [data-listing]')).toHaveLength(2);
    expect(w.find('[data-listing="L1"] [data-action="unshare"]').exists()).toBe(true);
    expect(w.find('[data-listing="L2"]').text()).toContain('$4.50');
    expect(w.find('[data-listing="L2"]').text()).toContain('Not listed now');
    await w.find('[data-listing="L2"] [data-action="reshare"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/republishMarketplaceItem', 'L2');
    expect(nav.toast).toHaveBeenCalledWith('Listed again.');
  });

  it('publishes in two clicks to the form, sending the asset the server needs', async () => {
    mountMine(); await flushPromises();
    await w.find('[data-action="publish"]').trigger('click');
    // Already-listed items are marked so nothing is listed twice by mistake.
    expect(w.find('[data-pick="a1"]').text()).toContain('Listed');
    await w.find('[data-pick="a1"]').trigger('click');
    const form = w.findComponent({ name: 'MarketplaceFormModal' });
    expect(form.props()).toMatchObject({ isOpen: true, itemType: 'agent', categories: ['Dev'], stripeConnected: false });
    form.vm.$emit('submit', { title: 'Kai', description: 'Codes', category: 'Dev', price: 0, preview_image: '' });
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/publishWorkflow', expect.objectContaining({
      title: 'Kai', asset_data: getters['agents/allAgents'][0], preview_image: 'data:kai',
    }));
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchMyPublishedItems', { force: true });
    expect(nav.toast).toHaveBeenCalledWith('Kai is listed on the Market.');
    expect(w.find('.form-stub').exists()).toBe(false);
  });

  it('a refused publish keeps the form open and says why', async () => {
    dispatch.mockImplementation(async (action) => { if (action === 'marketplace/publishWorkflow') throw new Error('Title already used'); });
    mountMine(); await flushPromises();
    await w.find('[data-action="publish"]').trigger('click');
    await w.find('[data-pick="a1"]').trigger('click');
    w.findComponent({ name: 'MarketplaceFormModal' }).vm.$emit('submit', { title: 'Kai' });
    await flushPromises();
    expect(nav.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Couldn’t publish', message: 'Title already used' }));
    expect(nav.toast).not.toHaveBeenCalledWith(expect.stringContaining('is listed'));
    expect(w.find('.form-stub').exists()).toBe(true);
  });

  it('with nothing listed, says what goes here', async () => {
    state.marketplace.myPublishedItems = [];
    mountMine(); await flushPromises();
    expect(w.find('[data-testid="no-listings"]').exists()).toBe(true);
  });
});
