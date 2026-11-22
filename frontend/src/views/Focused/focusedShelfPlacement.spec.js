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
  const nav = { go: vi.fn(), openScreen: vi.fn(), ask: vi.fn() };
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
    // A tab's picks are its own kind only (agents on the Widgets tab read as a mistake).
    expect(shelf.props()).toMatchObject({ assetType: LIBRARY_TABS.find(t => t.id === tab).noun, dismissible: false, fallbackToAll: false });
    // A pick opens its listing; "Browse all" shows more picks here (no Market page, 2026-10-23).
    shelf.vm.$emit('browse', { id: 'row-1', asset_id: 'fixture-listing' });
    expect(nav.go).toHaveBeenCalledWith({ page: 'market', item: 'fixture-listing' });
    expect(shelf.props('maxItems')).toBe(6);
    shelf.vm.$emit('browse');
    await flushPromises();
    expect(wrapper.findComponent(MarketplaceShelf).props('maxItems')).toBe(60);
    expect(nav.openScreen).not.toHaveBeenCalled();
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

  it.each([['agents', 'Make me an agent that '], ['workflows', 'Make me a workflow that '], ['skills', 'Make me a skill that ']])(
    'an empty %s tab says what goes there and starts it by asking Annie',
    async (tab, prompt) => {
      const { wrapper, nav } = mountLibrary(tab, []);
      await flushPromises();
      const empty = wrapper.find('[data-testid="library-empty"]');
      expect(empty.find('p').text().length).toBeGreaterThan(20);
      await empty.find('[data-action="ask-make"]').trigger('click');
      expect(nav.ask).toHaveBeenCalledWith(prompt);
      wrapper.unmount();
    },
  );

  it('offers no upgrade among your own work', () => {
    expect(templateOf('FocusedLibrary.vue')).not.toContain('<UpgradePrompt');
  });

  // Reported 2026-10-21: on Files the list sat under the Market; every other
  // Library tab puts the Market last. Files follows them now.
  it('the Files page puts the Market last too: after the list, the empty and loading states, and the count', () => {
    const t = templateOf('FocusedFiles.vue');
    const folder = t.slice(t.indexOf('<FocusedPage'));
    const shelf = folder.indexOf('<MarketplaceShelf');
    for (const before of ['class="focused-list"', 'This folder is empty', 'class="focused-foot-note"']) {
      expect(folder.indexOf(before), before).toBeGreaterThan(-1);
      expect(folder.indexOf(before), before).toBeLessThan(shelf);
    }
    expect(folder.slice(shelf, folder.indexOf('/>', shelf))).toContain(':dismissible="false"');
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
