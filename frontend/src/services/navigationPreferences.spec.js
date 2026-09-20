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
  updateNavigationItem,
} from './navigationPreferences.js';

describe('navigation preferences', () => {
  beforeEach(() => localStorage.clear());

  it('starts with a minimal rail while keeping all sections configurable', () => {
    const items = groupedNavigation().flatMap((group) => group.items);
    expect(items[0].id).toBe('chat');
    expect(items.map(item=>item.id)).toEqual(['chat','goals','artifacts','library','teams']);
    expect(groupedNavigation([], {includeHidden:true}).flatMap(g=>g.items).some(i=>i.id==='store')).toBe(true);
    expect(items.every((item) => item.visible)).toBe(true);
  });

  it('lists Library and Teams as configurable rows, not rail hardcoding', () => {
    // They own no screen, so they are not in MAIN_SECTIONS — but they are rows
    // the user sees, and the rail may not carry a row Settings cannot reach.
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
