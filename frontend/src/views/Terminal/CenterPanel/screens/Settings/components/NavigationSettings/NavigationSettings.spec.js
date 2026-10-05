/**
 * Settings → Navigation is the ONLY place the sidebar is configured, so its
 * one hard contract is that it describes the rail the user is actually looking
 * at: same rows, same groups, same custom pages, plus the hidden ones it exists
 * to let you switch back on.
 *
 * It used to fail that twice over. The rail rendered a hardcoded cluster this
 * screen had never heard of, and this screen counted a custom page as one with
 * NO route at all while the rail counted any page no section owned — so routed
 * pages like custom:scratch sat on the rail with no way to reach them here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import NavigationSettings from './NavigationSettings.vue';
import { groupedNavigation, updateNavigationItem } from '@/services/navigationPreferences.js';

const PAGES = [
  { id: 'scratch', name: 'Scratch', route: 'custom:scratch' },
  { id: 'notes', name: 'Notes', route: null },
  { id: 'general', name: 'General', route: 'workspace:general' },
  { id: 'chat', name: 'Chat', route: 'ChatScreen' },
];

function setup() {
  const store = createStore({
    modules: {
      widgetLayout: {
        namespaced: true,
        getters: { allPages: () => PAGES },
        actions: { deletePage: vi.fn() },
      },
    },
  });
  return mount(NavigationSettings, {
    global: { plugins: [store], stubs: { CustomSelect: { props: ['modelValue'], template: '<span />' } } },
  });
}

describe('Settings → Navigation', () => {
  beforeEach(() => localStorage.clear());

  it('arranges the same custom pages the rail renders — routed ones included', () => {
    const labels = setup().findAll('.nav-row .item-copy strong').map((node) => node.text());
    expect(labels).toContain('Scratch');
    expect(labels).toContain('Notes');
    // Workspaces are a tab of Chat, owned by /api/workspaces. Chat is a section.
    expect(labels).not.toContain('General');
    expect(labels.filter((label) => label === 'Chat')).toHaveLength(1);
  });

  it('lists every rail row, hidden rows included, and calls them built-in', () => {
    const wrapper = setup();
    const listed = wrapper.findAll('.nav-row .item-copy strong').map((node) => node.text());
    const everyRow = groupedNavigation(PAGES.slice(0, 2), { includeHidden: true }).flatMap((group) => group.items);
    expect(listed).toEqual(everyRow.map((item) => item.label));
    // Members opens a panel rather than a screen, but the user sees it on the
    // rail, so it is configured here like anything else. Library is no longer
    // a Studio row (BUILD lists every kind of thing you made).
    expect(listed).toContain('Members');
    expect(listed).not.toContain('Library');
    const members = everyRow.find((item) => item.id === 'teams');
    expect(wrapper.findAll('.nav-row').at(listed.indexOf('Members')).text()).toContain('Built-in page');
    expect(members.key).toBe('virtual:teams');
    // Every BUILD row is configurable, Skills and Widgets included.
    for (const label of ['Plugins', 'Skills', 'Widgets']) expect(listed).toContain(label);
  });

  it('a toggle here changes what the rail will render', () => {
    const wrapper = setup();
    const goals = wrapper.findAll('.nav-row').at(
      wrapper.findAll('.nav-row .item-copy strong').map((node) => node.text()).indexOf('Goals'),
    );
    goals.find('input[type="checkbox"]').setValue(false);
    expect(groupedNavigation(PAGES.slice(0, 2)).flatMap((group) => group.items).some((item) => item.id === 'goals')).toBe(false);

    updateNavigationItem('section:dashboard', { visible: true });
    expect(groupedNavigation(PAGES.slice(0, 2)).flatMap((group) => group.items).some((item) => item.id === 'dashboard')).toBe(true);
  });
});
