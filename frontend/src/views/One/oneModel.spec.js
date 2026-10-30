import { describe, it, expect, vi } from 'vitest';
import {
  ONE_STEPS,
  flagsKey,
  greetingFor,
  loadOneFlags,
  oneSummary,
  partOfDay,
  railItems,
  ringOffset,
  saveOneFlags,
} from './oneModel.js';
import { SETUP_STEPS } from '@/services/firstRunSetup.js';

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
};
const linked = { phones: [{ id: 'p1', state: 'active' }], plan: { eligible: true } };
const noTexting = { phones: [], plan: { eligible: false } };

describe('the setup the capsule tracks', () => {
  // The capsule and the first-run setup must never disagree about the steps.
  it('is the first-run setup\'s three steps, in its order, each opening the setup there', () => {
    expect(ONE_STEPS.map((s) => s.id)).toEqual(SETUP_STEPS.map((s) => s.id));
    expect(ONE_STEPS.map((s) => s.action)).toEqual(SETUP_STEPS.map((s) => ({ kind: 'setup', step: s.id })));
    expect(ONE_STEPS.find((s) => s.id === 'ai')).toMatchObject({ title: 'Connect your AI' });
    expect(ONE_STEPS.find((s) => s.id === 'phone').pro).toBe(true);
  });

  it('starts at 0 of 3, with your AI next', () => {
    const fresh = oneSummary();
    expect(fresh).toMatchObject({ done: 0, total: 3, complete: false });
    expect(fresh.next.id).toBe('ai');
  });

  it('reads each step from the account it describes', () => {
    const s = oneSummary({ facts: { aiModels: 1 }, apps: ['Google'], phone: linked });
    expect(Object.fromEntries(s.steps.map((step) => [step.id, step.done]))).toEqual({ ai: true, google: true, phone: true });
    expect(s.complete).toBe(true);
    expect(s.next).toBe(null);
  });

  // It used to be optional and offered last, so first chats ran on AGNT Flash.
  it('Connect your AI stays next until an AI is connected, even after chatting on Flash', () => {
    const onFlash = oneSummary({ facts: { chats: 3 }, apps: ['google'], phone: linked });
    expect(onFlash.next.id).toBe('ai');
    expect(onFlash.complete).toBe(false);
  });

  it('a phone waiting for its code is not linked yet', () => {
    const s = oneSummary({ facts: { aiModels: 1 }, apps: ['google'], phone: { phones: [{ state: 'pending' }], plan: { eligible: true } } });
    expect(s.next.id).toBe('phone');
    expect(s.complete).toBe(false);
  });

  // Texting needs a paid plan: on one without it, setup is done without a phone.
  it('does not wait for a phone the plan cannot text from', () => {
    const s = oneSummary({ facts: { aiModels: 1 }, apps: ['google'], phone: noTexting });
    expect(s.steps.find((step) => step.id === 'phone')).toMatchObject({ optional: true, done: false });
    expect(s.complete).toBe(true);
    // Unknown (the service has not answered) is not a "no".
    expect(oneSummary({ facts: { aiModels: 1 }, apps: ['google'] }).complete).toBe(false);
  });

  it('treats garbage facts as zero rather than as progress', () => {
    const s = oneSummary({ facts: { aiModels: -1 }, apps: 'google', phone: 'yes' });
    expect(s.done).toBe(0);
  });

  it('marks exactly one step current', () => {
    const s = oneSummary({ facts: { aiModels: 1 } });
    expect(s.steps.filter((step) => step.current).map((step) => step.id)).toEqual(['google']);
  });

  it('draws the ring from progress, clamped', () => {
    expect(ringOffset(0, 3)).toBe(50.27);
    expect(ringOffset(3, 3)).toBe(0);
    expect(ringOffset(9, 3)).toBe(0);
    expect(ringOffset(1, 3)).toBeCloseTo(33.51, 2);
    expect(ringOffset(1, 0)).toBe(50.27);
  });
});

describe('first-run flags', () => {
  it('are kept per account', () => {
    const storage = memoryStorage();
    saveOneFlags('maya@example.com', { setup: true }, storage);
    expect(loadOneFlags('maya@example.com', storage)).toEqual({ setup: true, hidden: false });
    expect(loadOneFlags('someone@else.com', storage)).toEqual({ setup: false, hidden: false });
    expect(flagsKey(null)).toBe('agnt:one-journey');
  });

  it('keep only known booleans', () => {
    const storage = memoryStorage({ [flagsKey('a')]: JSON.stringify({ setup: 'yes', hidden: true, aha: true, extra: 1 }) });
    expect(loadOneFlags('a', storage)).toEqual({ setup: false, hidden: true });
    expect(saveOneFlags('a', { setup: 1, hidden: true, extra: 'x' }, storage)).toEqual({ setup: false, hidden: true });
    expect(JSON.parse(storage.data.get(flagsKey('a')))).toEqual({ setup: false, hidden: true });
  });

  it('survive corrupt JSON and storage that throws', () => {
    expect(loadOneFlags('a', memoryStorage({ [flagsKey('a')]: '{not json' }))).toEqual({ setup: false, hidden: false });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadOneFlags('a', broken)).toEqual({ setup: false, hidden: false });
    expect(saveOneFlags('a', { hidden: true }, broken)).toEqual({ setup: false, hidden: true });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('the rail', () => {
  const ids = (items) => items.map((i) => i.id);

  // Reported 2026-10-21: the rail grew with the account, so the Chats drawer
  // carried the same links again, two navigations side by side. The rail is
  // the one navigation: every place, always, for every account.
  it('lists every place, always, whatever the account holds', () => {
    // New chat is in the Chats drawer's header, not on the rail (2026-10-21).
    // 2026-10-23: no Market (its listings are Library and Apps sections); Activity and Memories under More.
    // 2026-10-26: the Market is back on the rail, after the Library.
    // Teamspaces: Home and Inbox lead the rail (the team workspace's two front doors).
    const every = ['home', 'inbox', 'chats', 'apps', 'routines', 'library', 'market', 'more'];
    expect(ids(railItems())).toEqual(every);
    expect(ids(railItems({ facts: { apps: 3, workflows: 2 } }))).toEqual(every);
    expect(railItems().every((i) => i.icon && i.label)).toBe(true);
  });

  it('teamspaces: Inbox lights for the inbox, Home for every other team page, and Inbox carries the unread count', () => {
    const active = (teamView) => railItems({ activePage: 'team', teamView }).filter((i) => i.active).map((i) => i.id);
    expect(active('inbox')).toEqual(['inbox']);
    for (const view of ['home', 'space', 'mine', 'doc']) expect(active(view)).toEqual(['home']);
    const inbox = (n) => railItems({ inboxUnread: n }).find((i) => i.id === 'inbox');
    expect(inbox(0).badge).toBeUndefined();
    expect(inbox(3).badge).toBe('3');
    expect(inbox(250).badge).toBe('99+');
  });

  it('marks the page that is open; Activity and Memories light More and their own entry', () => {
    const active = (activePage) => railItems({ activePage }).filter((i) => i.active).map((i) => i.id);
    expect(active('connectors')).toEqual(['apps']);
    expect(active('market')).toEqual(['market']);
    expect(active('memory')).toEqual(['more']);
    expect(active('activity')).toEqual(['more']);
    const more = railItems({ activePage: 'activity' }).find((i) => i.id === 'more');
    expect(more.menu.map((m) => [m.id, m.label, m.active])).toEqual([
      ['activity', 'Activity', true], ['memory', 'Memories', false], ['dashboard', 'Dashboard', false],
      ['goals', 'Goals', false], ['approvals', 'Approvals', false], ['find', 'Find anything', false],
    ]);
    // A Studio screen opened from More lights More and its entry.
    const onDash = railItems({ activeScreen: 'DashboardScreen' });
    expect(onDash.filter((i) => i.active).map((i) => i.id)).toEqual(['more']);
    expect(onDash.find((i) => i.id === 'more').menu.find((m) => m.id === 'dashboard').active).toBe(true);
  });

  // Reported 2026-10-21: with the Chats drawer left open, every page lit up
  // Chats instead of itself. The page wins; an open drawer is shown as `open`.
  it('marks one icon active: the page, then an open drawer, then a blank chat', () => {
    const active = (opts) => railItems(opts).filter((i) => i.active).map((i) => i.id);
    expect(active({ drawerOpen: true, activePage: 'connectors' })).toEqual(['apps']);
    expect(active({ drawerOpen: true, activePage: 'memory' })).toEqual(['more']);
    expect(active({ drawerOpen: true })).toEqual(['chats']);
    expect(active({ drawerOpen: true, onBlankChat: true })).toEqual(['chats']);
    const chats = (opts) => railItems(opts).find((i) => i.id === 'chats');
    expect(chats({ drawerOpen: true, activePage: 'connectors' })).toMatchObject({ active: false, open: true });
    expect(chats({ drawerOpen: false })).toMatchObject({ active: false, open: false });
    expect(active({ activePage: 'scheduled' })).toEqual(['routines']);
    expect(active({ onBlankChat: true })).toEqual(['chats']);
    expect(active({})).toEqual([]);
  });
});

describe('the greeting', () => {
  const at = (hour) => new Date(2026, 0, 1, hour, 0, 0);

  it('follows the time of day, at the boundaries', () => {
    expect([0, 11, 12, 17, 18, 23].map((h) => partOfDay(at(h)))).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });

  it('names the person when it can', () => {
    expect(greetingFor('Maya', at(15))).toBe('Good afternoon, Maya.');
    expect(greetingFor('  ', at(9))).toBe('Good morning.');
    expect(greetingFor(null, at(20))).toBe('Good evening.');
  });
});
