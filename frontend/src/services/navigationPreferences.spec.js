import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_CHANGED_EVENT,
  addNavigationGroup,
  groupedNavigation,
  loadNavigationPreferences,
  migrateLegacyGroups,
  migrateMembersNavigation,
  navigationItemKey,
  NAVIGATION_STORAGE_KEY,
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

  it.each(['TODAY', 'SYSTEM', 'CREATE', 'MY WORK'])('keeps explicitly added %s groups on reload', (name) => {
    addNavigationGroup(name);
    expect(loadNavigationPreferences().groups).toContain(name);
    expect(groupedNavigation([], { includeHidden: true }).map((group) => group.name)).toContain(name);
  });

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
    // Apps leads BUILD: it is the box the rest arrive in.
    expect(items.map((item) => item.id)).toEqual(['chat', 'apps', 'workflows']);
    expect(groupedNavigation().map((g) => g.name)).toEqual(['WORK', 'BUILD']);
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

  it('Members no longer occupies a rail row even with saved visibility or unlocks', () => {
    unlock('library', 'teams');
    updateNavigationItem('virtual:teams', { visible: true, group: 'SYSTEM' });
    const groups = groupedNavigation([], { includeHidden: true });
    expect(groups.flatMap(g => g.items).some(i => ['library', 'teams'].includes(i.id))).toBe(false);
    expect(groups.map(g => g.name)).not.toContain('SYSTEM');
    expect(loadNavigationPreferences().items['virtual:teams']).toBeUndefined();
  });

  it('migration removes only the retired Members row, preserving custom group order and items', () => {
    const before = { version: 1, groups: ['WORK', 'SYSTEM', 'FOCUS'], items: { 'virtual:teams': { visible: true }, 'section:goals': { group: 'FOCUS', order: 7, visible: false } } };
    const after = migrateMembersNavigation(before);
    expect(after.groups).toEqual(['WORK', 'FOCUS']);
    expect(after.items).toEqual({ 'section:goals': { group: 'FOCUS', order: 7, visible: false } });
    expect(migrateMembersNavigation(after)).toBe(after);
    expect(before.items['virtual:teams']).toBeDefined();
    const custom = { ...before, items: { ...before.items, 'page:mine': { group: 'SYSTEM', order: 3 } } };
    expect(migrateMembersNavigation(custom).groups).toContain('SYSTEM');
    expect(migrateMembersNavigation(custom).items['page:mine']).toEqual({ group: 'SYSTEM', order: 3 });
  });

  it('hiding every row leaves an empty rail rather than a silent fallback', () => {
    // The old bug was the reverse of a fallback: the rail dropped chat, goals
    // and artifacts unconditionally, so the three default-visible rows could
    // never appear and Settings described a sidebar nobody had.
    for (const key of ['section:chat', 'section:goals', 'section:artifacts', 'virtual:teams']) {
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

  describe('layouts saved under the old captions (TODAY · ASSETS · CONNECTORS)', () => {
    const legacy = {
      version: 1,
      groups: ['TODAY', 'WORK', 'ASSETS', 'CONNECTORS', 'PERSONAL', 'FOCUS'],
      items: {
        'section:tools': { visible: true, order: 2 },
        'section:goals': { visible: false, order: 0 },
        'section:store': { group: 'CONNECTORS', order: 1 },
        'section:chat': { group: 'FOCUS', order: 0 },
      },
    };

    it('moves onto the new captions, keeping visibility and the groups the person made', () => {
      localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(legacy));
      const prefs = loadNavigationPreferences();
      expect(prefs.groups).toEqual(['WORK', 'PLAN', 'BUILD', 'PERSONAL', 'FOCUS']);
      expect(prefs.items['section:goals']).toEqual({ visible: false });
      // Parked under an old caption → back to its built-in group.
      expect(prefs.items['section:store']).toEqual({});
      // A group the person made survives; old within-group orders do not.
      expect(prefs.items['section:chat']).toEqual({ group: 'FOCUS' });
    });

    it('renders the rail in the new order, with no empty legacy caption', () => {
      localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(legacy));
      unlock('apps', 'tools', 'store', 'dashboard');
      const names = groupedNavigation().map((g) => g.name);
      expect(names).toEqual(['WORK', 'PLAN', 'BUILD', 'FOCUS']);
      expect(groupedNavigation().find((g) => g.name === 'BUILD').items.map((i) => i.id)).toEqual(['apps', 'tools']);
    });

    it('is idempotent: a migrated or new layout is returned unchanged', () => {
      const once = migrateLegacyGroups(legacy);
      expect(migrateLegacyGroups(once)).toBe(once);
      const fresh = { version: 1, groups: ['WORK', 'PERSONAL'], items: { 'section:chat': { order: 3 } } };
      expect(migrateLegacyGroups(fresh)).toBe(fresh);
    });
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
