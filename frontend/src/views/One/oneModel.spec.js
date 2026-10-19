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
    expect(ONE_STEPS.map((s) => s.id)).toEqual(['get', 'open', 'chat', 'brain', 'google', 'aha', 'autopilot']);
    const fresh = oneSummary();
    expect(fresh.done).toBe(2);
    expect(fresh.total).toBe(7);
    expect(fresh.next.id).toBe('chat');
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

  it('never blocks on the optional bigger brain: it is next only when nothing required is left', () => {
    const skipping = oneSummary({ facts: { chats: 3 } });
    expect(skipping.next.id).toBe('google');
    expect(skipping.steps.find((s) => s.id === 'brain')).toMatchObject({ optional: true, done: false, current: false });
    const rest = oneSummary({ facts: { chats: 3, workflows: 2 }, apps: ['google'], flags: { aha: true } });
    expect(rest.complete).toBe(true);
    expect(rest.next.id).toBe('brain');
  });

  it('treats garbage facts as zero rather than as progress', () => {
    const s = oneSummary({ facts: { chats: NaN, aiModels: -1, workflows: '3' }, apps: 'google', flags: null });
    expect(s.done).toBe(2);
  });

  it('marks exactly one step current', () => {
    const s = oneSummary({ facts: { chats: 1 } });
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

  it('starts with only New chat and Chats', () => {
    expect(ids(railItems())).toEqual(['new', 'chats']);
  });

  it('gains an icon once there is something behind it', () => {
    expect(ids(railItems({ facts: { apps: 1 } }))).toEqual(['new', 'chats', 'apps']);
    expect(ids(railItems({ facts: { schedules: 1 } }))).toEqual(['new', 'chats', 'routines']);
    expect(ids(railItems({ facts: { skills: 2, apps: 1, workflows: 1 } }))).toEqual(['new', 'chats', 'apps', 'routines', 'library']);
  });

  it('shows an icon while its page is open, even before there is anything in it', () => {
    const items = railItems({ activePage: 'connectors' });
    expect(ids(items)).toEqual(['new', 'chats', 'apps']);
    expect(items.find((i) => i.id === 'apps').active).toBe(true);
  });

  it('marks one icon active: the drawer wins, then the page, then a blank chat', () => {
    const active = (opts) => railItems(opts).filter((i) => i.active).map((i) => i.id);
    expect(active({ drawerOpen: true, activePage: 'connectors' })).toEqual(['chats']);
    expect(active({ activePage: 'scheduled' })).toEqual(['routines']);
    expect(active({ onBlankChat: true })).toEqual(['new']);
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
