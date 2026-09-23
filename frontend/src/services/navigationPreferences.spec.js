import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_CHANGED_EVENT,
  addNavigationGroup,
  groupedNavigation,
  loadNavigationPreferences,
  navigationItemKey,
  renameNavigationGroup,
  reorderNavigationItem,
  resetNavigationPreferences,
  showAllNavigation,
  updateNavigationItem,
} from './navigationPreferences.js';
import { ONION_STORAGE_KEY } from './navigationOnion.js';

const unlock = (...ids) =>
  localStorage.setItem(ONION_STORAGE_KEY, JSON.stringify({ version: 1, unlocked: ids, seeded: ids, fresh: [] }));

describe('navigation preferences', () => {
  beforeEach(() => localStorage.clear());

  it('starts a new account on Chat alone while keeping every section configurable', () => {
    const items = groupedNavigation().flatMap((group) => group.items);
    expect(items.map((item) => item.id)).toEqual(['chat']);
    const all = groupedNavigation([], { includeHidden: true }).flatMap((g) => g.items);
    expect(all.some((i) => i.id === 'store')).toBe(true);
    expect(all.find((i) => i.id === 'store')).toMatchObject({ visible: false, unlocked: false, explicit: false });
  });

  it('puts a row on the rail once the account unlocks it, in its registry group and order', () => {
    unlock('apps', 'workflows');
    const items = groupedNavigation().flatMap((group) => group.items);
    expect(items.map((item) => item.id)).toEqual(['chat', 'workflows', 'apps']);
    expect(groupedNavigation().map((g) => g.name)).toEqual(['TODAY', 'ASSETS', 'CONNECTORS']);
  });

  it('lets an explicit choice in Settings beat the onion in both directions', () => {
    unlock('apps');
    updateNavigationItem('section:apps', { visible: false });
    updateNavigationItem('section:store', { visible: true });
    const ids = groupedNavigation().flatMap((group) => group.items).map((item) => item.id);
    expect(ids).not.toContain('apps');
    expect(ids).toContain('store');
  });

  it('shows everything in one step, and reset hands the rail back to the onion', () => {
    showAllNavigation();
    const shown = groupedNavigation().flatMap((group) => group.items);
    expect(shown.length).toBe(groupedNavigation([], { includeHidden: true }).flatMap((g) => g.items).length);
    resetNavigationPreferences();
    expect(groupedNavigation().flatMap((group) => group.items).map((item) => item.id)).toEqual(['chat']);
  });

  it('lists Library and Teams as configurable rows, not rail hardcoding', () => {
    // They own no screen, so they are not in MAIN_SECTIONS — but they are rows
    // the user sees, and the rail may not carry a row Settings cannot reach.
    unlock('library', 'teams');
    const library = groupedNavigation([], { includeHidden: true }).flatMap((group) => group.items).find((item) => item.id === 'library');
    expect(library).toMatchObject({ type: 'virtual', key: 'virtual:library', group: 'ASSETS', label: 'Library' });

    updateNavigationItem('virtual:teams', { visible: false, group: 'Focus' });
    const visible = groupedNavigation().flatMap((group) => group.items);
    expect(visible.some((item) => item.id === 'teams')).toBe(false);
    expect(groupedNavigation([], { includeHidden: true }).find((group) => group.name === 'FOCUS').items.map((item) => item.id)).toEqual(['teams']);
  });

  it('hiding every row leaves an empty rail rather than a silent fallback', () => {
    // The old bug was the reverse of a fallback: the rail dropped chat, goals
    // and artifacts unconditionally, so the three default-visible rows could
    // never appear and Settings described a sidebar nobody had.
    for (const key of ['section:chat', 'section:goals', 'section:artifacts', 'virtual:library', 'virtual:teams']) {
      updateNavigationItem(key, { visible: false });
    }
    expect(groupedNavigation().flatMap((group) => group.items)).toEqual([]);
    updateNavigationItem('section:chat', { visible: true });
    expect(groupedNavigation().flatMap((group) => group.items).map((item) => item.id)).toEqual(['chat']);
  });

  it('hides a built-in page without removing its route ownership', () => {
    unlock('goals');
    updateNavigationItem(navigationItemKey('section', 'goals'), { visible: false });
    expect(groupedNavigation().flatMap((group) => group.items).some((item) => item.id === 'goals')).toBe(false);
    expect(groupedNavigation([], { includeHidden: true }).flatMap((group) => group.items).find((item) => item.id === 'goals').visible).toBe(false);
  });

  it('moves custom and built-in pages into user groups and preserves their order', () => {
    const scratch = { id: 'scratch', name: 'Scratch', icon: 'fas fa-star', route: null };
    addNavigationGroup('Focus');
    updateNavigationItem('section:chat', { group: 'FOCUS' });
    updateNavigationItem('page:scratch', { group: 'FOCUS' });
    reorderNavigationItem('page:scratch', -1, [scratch]);
    const focus = groupedNavigation([scratch]).find((group) => group.name === 'FOCUS');
    expect(focus.items.map((item) => item.key)).toEqual(['page:scratch', 'section:chat']);
  });

  it('renames a group and every item assigned to it', () => {
    updateNavigationItem('section:chat', { group: 'FOCUS' });
    renameNavigationGroup('FOCUS', 'Daily');
    expect(loadNavigationPreferences().groups).toContain('DAILY');
    expect(groupedNavigation().find((group) => group.name === 'DAILY').items[0].id).toBe('chat');
  });

  it('recovers from corrupt storage and notifies the live rail on reset', () => {
    localStorage.setItem('agnt:sidebarNavigation:v1', '{broken');
    expect(loadNavigationPreferences().groups).toContain('WORK');
    const listener = vi.fn();
    window.addEventListener(NAVIGATION_CHANGED_EVENT, listener);
    resetNavigationPreferences();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(NAVIGATION_CHANGED_EVENT, listener);
  });
});
