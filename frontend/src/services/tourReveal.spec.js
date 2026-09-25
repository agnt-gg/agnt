import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONION_STORAGE_KEY, loadOnionState } from '@/services/navigationOnion.js';
import { NAVIGATION_CHANGED_EVENT, NAVIGATION_STORAGE_KEY, groupedNavigation, updateNavigationItem, navigationItemKey } from '@/services/navigationPreferences.js';
import { revealSidebarTargets, sidebarTargets } from './tourReveal.js';
import { useAITour } from '@/composables/useAITour.js';

const step = (id) => ({ title: id, content: 'x', targetSelector: `[data-tour-id="sidebar.${id}"]` });
const railIds = () => groupedNavigation([]).flatMap((g) => g.items.map((i) => i.id));

beforeEach(() => {
  localStorage.removeItem(ONION_STORAGE_KEY);
  localStorage.removeItem(NAVIGATION_STORAGE_KEY);
});

describe('a tour can point at a rail row the account has not unlocked', () => {
  it('a new account has only Chat, so a tour at Tools would point at nothing', () => {
    expect(railIds()).toEqual(['chat']);
  });

  it('reveals the rows the steps name, as earned unlocks, and says so', () => {
    const changed = vi.fn();
    window.addEventListener(NAVIGATION_CHANGED_EVENT, changed);
    expect(revealSidebarTargets([step('tools'), step('agents'), { title: 'no target' }])).toEqual(['tools', 'agents']);
    window.removeEventListener(NAVIGATION_CHANGED_EVENT, changed);
    expect(railIds()).toEqual(expect.arrayContaining(['chat', 'tools', 'agents']));
    expect(loadOnionState().unlocked).toEqual(expect.arrayContaining(['tools', 'agents']));
    // Not a Settings choice: "Reset defaults" still hands the rail back to the onion.
    expect(JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY) || '{"items":{}}').items).toEqual({});
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('never overrules a row the person hid in Settings', () => {
    updateNavigationItem(navigationItemKey('section', 'tools'), { visible: false });
    expect(revealSidebarTargets([step('tools')])).toEqual([]);
    expect(railIds()).not.toContain('tools');
  });

  it('leaves visible rows, unknown ids and non-sidebar targets alone', () => {
    expect(revealSidebarTargets([step('chat'), step('no-such-row'), { targetSelector: '#x' }])).toEqual([]);
    expect(sidebarTargets([step('tools'), step('tools'), { targetSelector: "[data-tour-id='sidebar.goals']" }])).toEqual(['tools', 'goals']);
  });

  it('starting a tour at a locked row puts the row on the rail', () => {
    const tour = useAITour();
    tour.start({ tourId: 't', steps: [step('workflows')] });
    expect(railIds()).toContain('workflows');
    tour.end('test');
  });
});
