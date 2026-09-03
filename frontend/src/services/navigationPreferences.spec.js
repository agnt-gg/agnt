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

  it('starts from every built-in section in registry order', () => {
    const items = groupedNavigation().flatMap((group) => group.items);
    expect(items[0].id).toBe('chat');
    expect(items.some((item) => item.id === 'store')).toBe(true);
    expect(items.every((item) => item.visible)).toBe(true);
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
    expect(loadNavigationPreferences().groups).toContain('MY WORK');
    const listener = vi.fn();
    window.addEventListener(NAVIGATION_CHANGED_EVENT, listener);
    resetNavigationPreferences();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(NAVIGATION_CHANGED_EVENT, listener);
  });
});
