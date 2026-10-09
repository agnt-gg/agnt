import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';
vi.mock('@/composables/useElectron', () => ({ useElectron: () => ({ isElectron: { value: false } }), electronUtils: { window: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() } } }));
import CanvasScreen from './CanvasScreen.vue';
import { ONION_STORAGE_KEY } from '@/services/navigationOnion.js';

// An account that has already earned these rows (see navigationOnion.js).
const EARNED = ['goals', 'artifacts', 'library', 'teams'];

function setup(width = 390) {
  let listener;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: width <= 800, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: vi.fn() }));
  const dispatch = vi.fn();
  const store = createStore({ modules: {
    userAuth: { namespaced: true, getters: { isAuthenticated: () => true } },
    aiProvider: { namespaced: true, state: () => ({ selectedProvider: 'openai', selectedModel: 'example' }) },
    widgetLayout: { namespaced: true, getters: { allPages: () => [{ id: 'custom', name: 'Custom test', route: 'custom-test' }], activePageId: () => 'chat', activePage: () => null, pageForRoute: () => () => ({ id: 'chat', route: 'ChatScreen' }), isLoaded: () => true }, actions: { createPageFromDefault: dispatch, setActivePage: dispatch } },
  } });
  const wrapper = mount(CanvasScreen, { props: { screenName: 'ChatScreen' }, slots: { default: '<input class="stateful" value="Draft survives" />' }, attachTo: document.body, global: { plugins: [store], stubs: { Tooltip: { template: '<span><slot /></span>' }, JumpPalette: true, PanelBackdrop: true, WidgetCanvas: true, WidgetCatalog: true, ChatProviderSelector: true, SimpleModal: true }, directives: { tooltip: {} } } });
  return { wrapper, resize: async value => { listener({ matches: value <= 800 }); await nextTick(); } };
}
describe('AGNT-One mobile navigation', () => {
 beforeEach(() => {
   localStorage.clear();
   localStorage.setItem(ONION_STORAGE_KEY, JSON.stringify({ version: 1, unlocked: EARNED, seeded: EARNED, fresh: [] }));
 });
 it('uses the source navigation including custom pages and Settings', async () => {
   const { wrapper } = setup(); expect(wrapper.find('.cv-mobile-menu').exists()).toBe(true);
   expect(wrapper.find('.cv-sidebar').attributes('inert')).toBeDefined(); await wrapper.find('.cv-mobile-menu').trigger('click');
   const labels = wrapper.findAll('.cv-sidebar .cv-sb-page').map(b => b.text());
   for(const label of ['Chat','Goals','Files','Settings','Custom test'])expect(labels.some(t=>t.includes(label))).toBe(true);
   // Library is not a Studio row: BUILD already lists every kind of thing you made.
   expect(labels.some(t=>t.includes('Library'))).toBe(false);
   expect(labels.some(t=>t.includes('Members'))).toBe(false);
   expect(wrapper.findAll('.cv-sb-cap-text').map(c=>c.text())).not.toContain('SYSTEM');
   // The drawer mirrors the rail, and the rail carries destinations only:
   // search is reached from the jump bar, not from a nav row.
   expect(labels.some(t=>t.includes('Search'))).toBe(false);
   expect(wrapper.find('.cv-sidebar').attributes('aria-modal')).toBe('true'); wrapper.unmount();
 });
 it('keeps the Focused mode action within a phone viewport', async () => {
   const originalWidth = window.innerWidth;
   window.innerWidth = 390;
   const { wrapper } = setup();
   await wrapper.find('.cv-mobile-menu').trigger('click');
   const button = wrapper.find('.cv-sb-profile');
   button.element.getBoundingClientRect = () => ({ left: 12, right: 300, top: 700, bottom: 740, width: 288, height: 40 });
   await button.trigger('click'); await nextTick();
   const menu = document.querySelector('.cv-profile-menu');
   expect(menu).not.toBeNull();
   expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(12);
   expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(378);
   expect(menu.querySelector('[data-testid="switch-to-focused"]')).not.toBeNull();
   wrapper.unmount(); window.innerWidth = originalWidth;
 });
 it('navigation closes the drawer and emits the original screen intent', async () => {
   const { wrapper } = setup(); await wrapper.find('.cv-mobile-menu').trigger('click');await wrapper.find('[data-tour-id="sidebar.goals"]').trigger('click');
   expect(wrapper.emitted('screen-change').at(-1)[0]).toBe('GoalsScreen'); expect(wrapper.find('.cv-sidebar').attributes('aria-hidden')).toBe('true'); wrapper.unmount();
 });
 it('resizing does not replace screen content or persist sidebar expansion', async () => {
   const { wrapper, resize } = setup();const original = wrapper.find('.stateful').element;
   await wrapper.find('.cv-mobile-menu').trigger('click');await resize(1300);
   expect(wrapper.find('.stateful').element).toBe(original);expect(wrapper.find('.cv-sidebar').attributes('inert')).toBeUndefined();expect(localStorage.getItem('agnt:canvasSidebar:expanded')).toBeNull();
   await resize(390);expect(wrapper.find('.stateful').element).toBe(original);expect(wrapper.find('.cv-sidebar').attributes('aria-hidden')).toBe('true');wrapper.unmount();
 });
});
