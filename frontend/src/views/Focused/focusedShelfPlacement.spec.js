/** Owned work comes first; marketplace discovery stays mounted underneath. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FocusedLibrary from './FocusedLibrary.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { LIBRARY_TABS } from './focusedModel.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const templateOf = (file) => {
  const src = readFileSync(join(DIR, file), 'utf8');
  return src.slice(src.indexOf('<template>'), src.indexOf('<script'));
};

function mountLibrary(tab, items) {
  const getters = Object.fromEntries(LIBRARY_TABS.filter(t => t.getter).map(t => [t.getter, () => t.id === tab ? items : []]));
  const store = createStore({ getters });
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue();
  const nav = { go: vi.fn(), openScreen: vi.fn() };
  const wrapper = mount(FocusedLibrary, {
    props: { location: { tab } },
    global: {
      plugins: [store], provide: { focusedNav: nav },
      stubs: { MarketplaceShelf: true, UpgradePrompt: true, FocusedGlyph: true },
    },
  });
  return { wrapper, dispatch, nav };
}

describe('Library Market shelf placement', () => {
  it.each(['agents', 'workflows', 'tools', 'skills', 'widgets'])('%s renders the owned list before its always-visible marketplace shelf', async tab => {
    const { wrapper, dispatch, nav } = mountLibrary(tab, [{ id: 'owned-one', name: 'My own work', title: 'My own work', description: 'Owned fixture' }]);
    await flushPromises();
    const list = wrapper.find('.focused-list');
    const shelf = wrapper.findComponent(MarketplaceShelf);
    expect(list.exists()).toBe(true);
    expect(list.text()).toContain('My own work');
    expect(list.element.compareDocumentPosition(shelf.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wrapper.findAllComponents(MarketplaceShelf)).toHaveLength(1);
    expect(shelf.props()).toMatchObject({ assetType: LIBRARY_TABS.find(t => t.id === tab).noun, dismissible: false, fallbackToAll: true });
    shelf.vm.$emit('browse', 'fixture-listing');
    expect(nav.openScreen).toHaveBeenCalledWith('MarketplaceScreen', { listing: 'fixture-listing' });
    shelf.vm.$emit('installed');
    expect(dispatch).toHaveBeenCalledWith(LIBRARY_TABS.find(t => t.id === tab).fetch);
    wrapper.unmount();
  });

  it('places discovery after the count note when the owned agent list is capped', () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}` }));
    const { wrapper } = mountLibrary('agents', items);
    expect(wrapper.findAll('.focused-list > li')).toHaveLength(200);
    const note = wrapper.find('.focused-foot-note');
    expect(note.element.compareDocumentPosition(wrapper.findComponent(MarketplaceShelf).element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    wrapper.unmount();
  });

  it('keeps suggestions available below the empty state', async () => {
    const { wrapper } = mountLibrary('agents', []);
    await flushPromises();
    const empty = wrapper.find('.focused-empty');
    expect(empty.exists()).toBe(true);
    expect(empty.element.compareDocumentPosition(wrapper.findComponent(MarketplaceShelf).element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    wrapper.unmount();
  });

  it('does not change the separate Files page layout', () => {
    const t = templateOf('FocusedFiles.vue');
    expect(t.indexOf('<MarketplaceShelf')).toBeLessThan(t.indexOf('class="focused-list"'));
    expect(t.match(/<MarketplaceShelf/g)).toHaveLength(1);
  });

  it('Studio desktop discovery follows the owned-agent grid and mobile uses the collection footer', () => {
    const t = templateOf('../Terminal/CenterPanel/screens/Agents/Agents.vue');
    const desktop = t.slice(t.indexOf('class="desktop-view-container"'));
    const shelf = desktop.indexOf('v-if="!ownsNothing"');
    expect(shelf).toBeGreaterThan(desktop.indexOf('class="card-grid agents-grid"'));
    expect(desktop.slice(shelf, desktop.indexOf('/>', shelf))).toContain(':dismissible="false"');
    const collection = t.slice(t.indexOf('<MobileCollection'), t.indexOf('</MobileCollection>'));
    expect(collection).toContain('<template #footer><MarketplaceShelf');
    expect(collection).toContain('@installed="onShelfInstalled"');
    expect(t.slice(0, t.indexOf('<MobileCollection'))).not.toContain('<MarketplaceShelf');
  });
});
