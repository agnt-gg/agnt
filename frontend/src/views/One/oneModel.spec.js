import { describe, it, expect, vi } from 'vitest';
import {
  AHA_PROMPT,
  ONE_STEPS,
  flagsKey,
  greetingFor,
  isAhaRequest,
  loadOneFlags,
  oneSummary,
  partOfDay,
  railItems,
  ringOffset,
  saveOneFlags,
} from './oneModel.js';

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
};

describe('the first ten minutes', () => {
  it('has the seven goals, in order, and the first two are always done', () => {
    // Connect your AI is the first real step (2026-10-21).
    expect(ONE_STEPS.map((s) => s.id)).toEqual(['get', 'open', 'brain', 'chat', 'google', 'aha', 'autopilot']);
    expect(ONE_STEPS.find((s) => s.id === 'brain')).toMatchObject({ title: 'Connect your AI' });
    expect(ONE_STEPS.some((s) => s.optional)).toBe(false);
    const fresh = oneSummary();
    expect(fresh.done).toBe(2);
    expect(fresh.total).toBe(7);
    expect(fresh.next.id).toBe('brain');
    expect(fresh.complete).toBe(false);
  });

  it('reads each goal from the account it describes', () => {
    const s = oneSummary({ facts: { chats: 1, aiModels: 1, workflows: 0, schedules: 1 }, apps: ['Google'], flags: { aha: true } });
    expect(Object.fromEntries(s.steps.map((step) => [step.id, step.done]))).toEqual({
      get: true, open: true, chat: true, brain: true, google: true, aha: true, autopilot: true,
    });
    expect(s.complete).toBe(true);
    expect(s.next).toBe(null);
  });

  // It used to be optional and offered last, so first chats ran on AGNT Flash.
  it('Connect your AI stays next until an AI is connected, even after chatting on Flash', () => {
    const onFlash = oneSummary({ facts: { chats: 3 } });
    expect(onFlash.next.id).toBe('brain');
    expect(onFlash.steps.find((s) => s.id === 'brain')).toMatchObject({ optional: false, done: false, current: true });
    const rest = oneSummary({ facts: { chats: 3, workflows: 2 }, apps: ['google'], flags: { aha: true } });
    expect(rest.complete).toBe(false);
    expect(rest.next.id).toBe('brain');
    expect(oneSummary({ facts: { chats: 3, workflows: 2, aiModels: 1 }, apps: ['google'], flags: { aha: true } }).complete).toBe(true);
  });

  it('treats garbage facts as zero rather than as progress', () => {
    const s = oneSummary({ facts: { chats: NaN, aiModels: -1, workflows: '3' }, apps: 'google', flags: null });
    expect(s.done).toBe(2);
  });

  it('marks exactly one step current', () => {
    const s = oneSummary({ facts: { chats: 1, aiModels: 1 } });
    expect(s.steps.filter((step) => step.current).map((step) => step.id)).toEqual(['google']);
  });

  it('a tap asks in plain words, except the model, which never goes through the chat', () => {
    const actions = Object.fromEntries(ONE_STEPS.map((s) => [s.id, s.action?.kind || null]));
    expect(actions).toEqual({ get: null, open: null, chat: 'ask', brain: 'models', google: 'ask', aha: 'ask', autopilot: 'ask' });
  });

  it('recognises the ah-ha however it was phrased', () => {
    expect(isAhaRequest(AHA_PROMPT)).toBe(true);
    expect(isAhaRequest('ok, PREP ME FOR TOMORROW please')).toBe(true);
    expect(isAhaRequest('prep me for tomorrows standup')).toBe(false);
    expect(isAhaRequest(undefined)).toBe(false);
  });

  it('draws the ring from progress, clamped', () => {
    expect(ringOffset(0, 7)).toBe(50.27);
    expect(ringOffset(7, 7)).toBe(0);
    expect(ringOffset(9, 7)).toBe(0);
    expect(ringOffset(2, 7)).toBeCloseTo(35.91, 2);
    expect(ringOffset(1, 0)).toBe(50.27);
  });
});

describe('first-run flags', () => {
  it('are kept per account', () => {
    const storage = memoryStorage();
    saveOneFlags('maya@example.com', { aha: true }, storage);
    expect(loadOneFlags('maya@example.com', storage)).toEqual({ aha: true, hidden: false });
    expect(loadOneFlags('someone@else.com', storage)).toEqual({ aha: false, hidden: false });
    expect(flagsKey(null)).toBe('agnt:one-journey');
  });

  it('keep only known booleans', () => {
    const storage = memoryStorage({ [flagsKey('a')]: JSON.stringify({ aha: 'yes', hidden: true, extra: 1 }) });
    expect(loadOneFlags('a', storage)).toEqual({ aha: false, hidden: true });
    expect(saveOneFlags('a', { aha: 1, hidden: true, extra: 'x' }, storage)).toEqual({ aha: false, hidden: true });
    expect(JSON.parse(storage.data.get(flagsKey('a')))).toEqual({ aha: false, hidden: true });
  });

  it('survive corrupt JSON and storage that throws', () => {
    expect(loadOneFlags('a', memoryStorage({ [flagsKey('a')]: '{not json' }))).toEqual({ aha: false, hidden: false });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadOneFlags('a', broken)).toEqual({ aha: false, hidden: false });
    expect(saveOneFlags('a', { hidden: true }, broken)).toEqual({ aha: false, hidden: true });
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
    const every = ['chats', 'apps', 'routines', 'library', 'more'];
    expect(ids(railItems())).toEqual(every);
    expect(ids(railItems({ facts: { apps: 3, workflows: 2 } }))).toEqual(every);
    expect(railItems().every((i) => i.icon && i.label)).toBe(true);
  });

  it('marks the page that is open; Activity and Memories light More and their own entry', () => {
    const active = (activePage) => railItems({ activePage }).filter((i) => i.active).map((i) => i.id);
    expect(active('connectors')).toEqual(['apps']);
    expect(active('market')).toEqual(['library']);
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
