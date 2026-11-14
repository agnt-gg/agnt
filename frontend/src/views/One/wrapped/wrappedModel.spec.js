import { describe, it, expect, vi } from 'vitest';
import {
  buildCards,
  calendarGeometry,
  deriveYear,
  dotStep,
  formatCompact,
  funnelGeometry,
  hasStory,
  listing,
  loadSeenYears,
  monthDotsGeometry,
  novelCopies,
  saveSeenYear,
  seenKey,
  shelfGeometry,
  wrappedSeason,
} from './wrappedModel.js';
import { fixtureDays, withDays, yearFixture } from './wrapped.fixture.js';

const card = (cards, id) => cards.find((c) => c.id === id);

describe('wrappedSeason: December 1 to January 31, for the year that is ending', () => {
  it.each([
    ['mid-November', new Date(2026, 10, 13), { year: 2026, inSeason: false }],
    ['December 1', new Date(2026, 11, 1), { year: 2026, inSeason: true }],
    ['New Year\'s Eve', new Date(2026, 11, 31, 23, 59), { year: 2026, inSeason: true }],
    ['January 31, for last year', new Date(2027, 0, 31, 22), { year: 2026, inSeason: true }],
    ['February 1, a new year so far', new Date(2027, 1, 1), { year: 2027, inSeason: false }],
  ])('%s', (_name, now, expected) => {
    expect(wrappedSeason(now)).toEqual(expected);
  });
});

describe('the years a person has opened', () => {
  const memory = () => {
    const store = new Map();
    return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), store };
  };

  it('are kept per account, as whole years only', () => {
    const storage = memory();
    expect(loadSeenYears('a@b.c', storage)).toEqual([]);
    expect(saveSeenYear('a@b.c', 2026, storage)).toEqual([2026]);
    expect(saveSeenYear('a@b.c', 2025, storage)).toEqual([2025, 2026]);
    expect(saveSeenYear('a@b.c', 2026, storage)).toEqual([2025, 2026]);
    expect(loadSeenYears('someone@else', storage)).toEqual([]);
    storage.setItem(seenKey('x'), JSON.stringify([2026, '2025', 2024.5, null]));
    expect(loadSeenYears('x', storage)).toEqual([2026]);
  });

  it('a corrupt value or a failed write never breaks the frame', () => {
    const storage = memory();
    storage.setItem(seenKey('x'), '{not json');
    expect(loadSeenYears('x', storage)).toEqual([]);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(saveSeenYear('x', 2026, full)).toEqual([2026]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('numbers in words', () => {
  it.each([
    [999, '999'],
    [13423, '13.4K'],
    [272761301, '273M'],
    [59121190028, '59.1B'],
    [2000000, '2M'],
  ])('formatCompact(%d) = %s', (n, text) => {
    expect(formatCompact(n)).toBe(text);
  });

  it('lists with commas and a final "and"', () => {
    expect(listing([])).toBe('');
    expect(listing(['52 goals'])).toBe('52 goals');
    expect(listing(['52 goals', '51 skills', '50 agents'])).toBe('52 goals, 51 skills and 50 agents');
  });

  it.each([
    [272761301, '350 copies', 350],
    [47000000, '60 copies', 60],
    [2350000, '3 copies', 3],
    [783000, 'one copy', 1],
    [313000, '40% of a copy', 1],
  ])('novelCopies(%d) reads %s, never a rounded-up shelf', (tokens, words, count) => {
    expect(novelCopies(tokens)).toEqual({ words, count });
  });
});

describe('deriveYear', () => {
  const year = deriveYear(yearFixture());
  const without = (date) => fixtureDays().map((d) => (d.date === date ? { ...d, active: false } : d));

  it('tells the dashboard streak when it reaches into the year, even from the year before', () => {
    expect(year.streak).toEqual({ length: 500, start: '2025-07-02', end: '2026-11-13', current: true });
  });

  it('a current streak that began in the year and is its longest run is still the dashboard streak', () => {
    const y = deriveYear(withDays(without('2026-02-10'), { streak: { days: 276, since: '2026-02-11', lastActiveDate: '2026-11-13' } }));
    expect(y.streak).toEqual({ length: 276, start: '2026-02-11', end: '2026-11-13', current: true });
  });

  it("a current streak shorter than an earlier run gives way to the year's longest run", () => {
    const y = deriveYear(withDays(without('2026-07-01'), { streak: { days: 135, since: '2026-07-02', lastActiveDate: '2026-11-13' } }));
    expect(y.streak).toEqual({ length: 181, start: '2026-01-01', end: '2026-06-30', current: false });
    const none = deriveYear(withDays(without('2026-07-01'), { streak: { days: 0, since: null, lastActiveDate: null } }));
    expect(none.streak).toMatchObject({ length: 181, current: false });
  });

  it('a run that did no work counts as a run, not as an active day', () => {
    const y = deriveYear(withDays(without('2026-03-05')));
    expect(y.activeCount).toBe(315);
    expect(y.daysInWindow).toBe(316);
    expect(y.months.find((m) => m.key === '2026-03').runs).toBe(3100);
  });

  it('finds the busiest day, the peak month, the first month and a partial last month', () => {
    expect(year.busiest).toEqual({ date: '2026-10-28', runs: 900 });
    expect(year.peakMonth).toMatchObject({ key: '2026-10', runs: 6900 });
    expect(year.firstMonth).toMatchObject({ key: '2026-01', runs: 3100 });
    expect(year.partialKey).toBe('2026-11');
    expect(deriveYear(yearFixture({ window: { from: '2026-01-01', through: '2026-12-31', complete: true } })).partialKey).toBe(null);
  });

  it('keeps a quiet month in the year rather than dropping it', () => {
    const y = deriveYear(withDays(fixtureDays().filter((d) => !d.date.startsWith('2026-04'))));
    expect(y.months.map((m) => m.key)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map((m) => `2026-${m}`));
    expect(y.months.find((m) => m.key === '2026-04').runs).toBe(0);
  });

  it('weighs weekdays by runs, on calendar dates in any time zone', () => {
    expect(year.busiestWeekday).toBe(3); // Wednesday: October 28 is one
  });

  it('labels a source with the day it starts, when that is after January 1', () => {
    expect(year.ledgerSince).toBe('2026-03-03');
    expect(year.tokensSince).toBe('2026-03-03');
    const fromJanuary = deriveYear(yearFixture({ ledger: { from: '2026-01-01' }, activity: { ...yearFixture().activity, tokensFrom: '2026-01-01' } }));
    expect(fromJanuary.ledgerSince).toBe(null);
    expect(fromJanuary.tokensSince).toBe(null);
  });

  it('names the persona from who started the model calls', () => {
    expect(year.persona.name).toBe('Conductor');
    expect(year.persona.line).toContain('55% of your model calls came from chats with Annie, 36% from workflows and goals');
    const operator = deriveYear(yearFixture({ split: { conversation: 900, automation: 3000 } }));
    expect(operator.persona.name).toBe('Operator');
    expect(deriveYear(yearFixture({ split: { conversation: 0, automation: 0 } })).persona).toBe(null);
  });

  it('ranks what was built and finds the biggest build month', () => {
    expect(year.builtKinds).toEqual([{ kind: 'skills', count: 35 }, { kind: 'agents', count: 12 }, { kind: 'goals', count: 12 }, { kind: 'workflows', count: 2 }]);
    expect(year.peakBuild).toEqual({ month: 8, parts: [{ kind: 'skills', n: 30 }, { kind: 'agents', n: 12 }] });
  });
});

describe('pictures made of dots', () => {
  it('the calendar puts each day in its week column, Monday first', () => {
    const geo = calendarGeometry([['2026-03-11', 10], ['2026-03-16', 40]], '2026-03-16');
    expect(geo.dots[0]).toMatchObject({ cx: 5, cy: 25, k: 0 }); // a Wednesday: first column, third row
    expect(geo.dots[1]).toMatchObject({ cx: 15, cy: 5, k: 5, o: 1 }); // the next Monday, the busiest
    expect(geo.ring).toEqual({ cx: 15, cy: 5 });
    expect(geo.labels).toEqual([{ x: 1.4, text: 'Mar' }]);
    expect(geo.width).toBe(20);
  });

  it('the month chart gives a dot per step of runs, two wide; a month with runs gets one, a quiet month none', () => {
    const y = deriveYear(yearFixture());
    const geo = monthDotsGeometry(y.months, y.peakMonth.key, y.partialKey, 200);
    expect(geo.dots).toHaveLength(183);
    expect(geo.dots.filter((d) => d.kind === 'peak')).toHaveLength(35);
    expect(geo.dots.filter((d) => d.kind === 'partial')).toHaveLength(9);
    expect(geo.labels.map((l) => l.text)).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N']);
    expect(geo.peakLabel.text).toBe('6.9K');
    const quiet = monthDotsGeometry([{ key: '2026-01', month: 0, runs: 0 }, { key: '2026-02', month: 1, runs: 30 }], '2026-02', null, 200);
    expect(quiet.dots).toHaveLength(1);
  });

  it.each([[6900, 200], [68650, 2000], [1000000, 50000], [40, 1], [0, 1]])('dotStep(%d) is %d: the tallest month stays within 40 dots', (max, step) => {
    expect(dotStep(max)).toBe(step);
    expect(Math.round(max / step)).toBeLessThanOrEqual(40);
  });

  it('the shelf has one spine per copy and draws the same every time', () => {
    const shelf = shelfGeometry(60);
    expect(shelf.spines).toHaveLength(60);
    expect(shelfGeometry(60)).toEqual(shelf);
    expect(shelf.shelves).toHaveLength(5);
  });

  it('the funnel has a dot per trial, kept skill and promotion', () => {
    const funnel = funnelGeometry({ skillTrials: 40, skillsKept: 11, skillsPromoted: 4 });
    expect(funnel.dots).toHaveLength(55);
    expect(funnel.labels.map((l) => `${l.top} ${l.sub}`)).toEqual(['40 skill trials', '11 skills kept', '4 promoted']);
    expect(funnel.arrows).toHaveLength(2);
  });
});

describe('buildCards', () => {
  const cards = buildCards(yearFixture());

  it('tells the year in eleven cards, alternating dark and light, the last waiting for the reader', () => {
    expect(cards.map((c) => c.id)).toEqual(['intro', 'streak', 'volume', 'words', 'model', 'goals', 'built', 'money', 'learning', 'persona', 'summary']);
    expect(cards.map((c) => c.tone)).toEqual(['dark', 'light', 'dark', 'light', 'dark', 'light', 'dark', 'light', 'dark', 'light', 'dark']);
    expect(cards.slice(0, -1).every((c) => c.duration > 0)).toBe(true);
    expect(cards.at(-1).duration).toBe(0);
    expect(cards.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
  });

  it('says every figure in words, never NaN, undefined or null', () => {
    const text = JSON.stringify(cards);
    for (const bad of ['NaN', 'undefined', 'Infinity']) expect(text).not.toContain(bad);
    expect(card(cards, 'intro')).toMatchObject({ year: 2026, from: 'Jan 1', through: 'Nov 12' });
    expect(card(cards, 'streak')).toMatchObject({ length: 500, busiest: { date: 'Oct 28', runs: '900' }, activeLine: '316 of 316 days active in 2026' });
    expect(card(cards, 'streak').sentence).toBe('You and your agents haven’t missed a day since July 2, 2025. That’s every day of 2026 so far.');
    expect(card(cards, 'streak').calendar.dots).toHaveLength(316);
    expect(card(cards, 'volume')).toMatchObject({ runs: 36000, calls: '4,200', models: '30', providers: '6', ledgerSince: 'Mar 3', peak: { name: 'October', runs: '6,900' }, growth: '2× January', partialMonth: 'November', perDot: '200' });
    expect(card(cards, 'words')).toMatchObject({ tokens: '59B', written: '47M', books: '60 copies', cachePct: 90, perSpine: null, tokensSince: 'Mar 3' });
    expect(card(cards, 'model')).toMatchObject({ name: 'claude-opus-5-5', calls: '1,900', share: 'More than a third', modelCount: '30', providerCount: '6', ledgerSince: 'Mar 3' });
    expect(card(cards, 'model').rest.map((m) => m.rank)).toEqual([2, 3, 4, 5]);
    expect(card(cards, 'goals')).toMatchObject({ passed: '10 of the 12' });
    expect(card(cards, 'built').peak).toEqual({ month: 'September', parts: '30 skills and 12 agents' });
    expect(card(cards, 'money')).toMatchObject({ notional: true, amount: 640, uncached: '$2,401', saved: '$1,761', charged: '$12.50', unpriced: '3', ledgerSince: 'Mar 3' });
    expect(card(cards, 'learning')).toMatchObject({ applied: 120, rejected: '7', memories: '900' });
    expect(card(cards, 'persona').badges).toEqual([
      { key: 'Busiest day', value: 'Wednesdays' },
      { key: 'Peak month', value: 'October' },
      { key: 'Explorer', value: '30 models' },
    ]);
    expect(card(cards, 'summary')).toMatchObject({ year: 2026, streak: '500', runs: '36,000', tokens: '59B', topModel: 'claude-opus-5-5', topGoal: 'Morning digest', built: { count: '35', kind: 'skills' }, saved: '$1.8K', modelCount: '30', persona: 'Conductor' });
  });

  it('the streak card says when the run is the year\'s own, or began inside it', () => {
    const inside = buildCards(withDays(fixtureDays().map((d) => (d.date === '2026-02-10' ? { ...d, active: false } : d)), { streak: { days: 276, since: '2026-02-11', lastActiveDate: '2026-11-13' } }));
    expect(card(inside, 'streak').sentence).toBe('You and your agents have shown up every day since February 11.');
    const earlier = buildCards(withDays(fixtureDays().map((d) => (d.date === '2026-07-01' ? { ...d, active: false } : d)), { streak: { days: 0, since: null, lastActiveDate: null } }));
    expect(card(earlier, 'streak')).toMatchObject({ length: 181, activeLine: '315 of 316 days active in 2026' });
    expect(card(earlier, 'streak').sentence).toBe('Your longest run this year went from January 1 to June 30.');
  });

  it('no story until there is a week of active days; runs that did no work do not count', () => {
    expect(hasStory(withDays(fixtureDays().slice(0, 6)))).toBe(false);
    expect(buildCards(withDays(fixtureDays().slice(0, 6)))).toEqual([]);
    expect(hasStory(withDays(fixtureDays().slice(0, 30).map((d, i) => ({ ...d, active: i < 6 }))))).toBe(false);
    expect(hasStory(withDays(fixtureDays().slice(0, 7)))).toBe(true);
    expect(buildCards(null)).toEqual([]);
  });

  it('a year the ledger never saw still tells its runs, streak and tokens', () => {
    const zero = Object.fromEntries(Object.keys(yearFixture().totals).map((k) => [k, 0]));
    const quiet = buildCards(yearFixture({
      totals: zero,
      ledger: { from: null },
      models: { count: 0, top: [] },
      providers: { count: 0 },
      conversations: { count: 0 },
      origins: {},
      split: { conversation: 0, automation: 0 },
      goals: { top: [], created: 0, validated: 0 },
      built: { skills: {}, agents: {}, widgets: {}, goals: {}, workflows: {} },
      learning: { insightsApplied: 0, insightsRejected: 0, skillTrials: 0, skillsKept: 0, skillsPromoted: 0, memories: 0 },
    }));
    expect(quiet.map((c) => c.id)).toEqual(['intro', 'streak', 'volume', 'words', 'summary']);
    for (const bad of ['NaN', 'undefined', 'Infinity']) expect(JSON.stringify(quiet)).not.toContain(bad);
    expect(card(quiet, 'volume')).toMatchObject({ runs: 36000, calls: null, ledgerSince: null });
    expect(card(quiet, 'words')).toMatchObject({ tokens: '59B', written: null, books: null, shelf: null, cachePct: null });
    expect(card(quiet, 'summary')).toMatchObject({ streak: '500', runs: '36,000', tokens: '59B', topModel: null, modelCount: null, persona: null });
  });

  it('leaves out a card whose numbers are empty, rather than showing zeros', () => {
    const lean = buildCards(yearFixture({
      activity: { ...yearFixture().activity, tokens: 0, tokensFrom: null },
      totals: { ...yearFixture().totals, outputTokens: 0, notionalUsd: 0, costUsd: 0, notionalSavedUsd: 0, savedUsd: 0 },
      goals: { top: [], created: 0, validated: 0 },
      built: { skills: {}, agents: {}, widgets: {}, goals: {}, workflows: {} },
      learning: { insightsApplied: 0, insightsRejected: 0, skillTrials: 0, skillsKept: 0, skillsPromoted: 0, memories: 0 },
      split: { conversation: 0, automation: 0 },
    }));
    expect(lean.map((c) => c.id)).toEqual(['intro', 'streak', 'volume', 'model', 'summary']);
    expect(card(lean, 'summary')).toMatchObject({ topGoal: null, built: null, saved: null, persona: null, tokens: null, modelCount: '30' });
  });

  it('a pay-as-you-go year reads metered spend, and caching against it', () => {
    const metered = card(buildCards(yearFixture({ totals: { ...yearFixture().totals, notionalUsd: 0, notionalUncachedUsd: 0, notionalSavedUsd: 0, costUsd: 312.4, uncachedCostUsd: 500, savedUsd: 187.6 } })), 'money');
    expect(metered).toMatchObject({ notional: false, amount: 312, uncached: '$500', saved: '$188', label: '$312 in metered spend' });
  });

  it('a very long year still draws a bounded shelf, and says what a spine stands for', () => {
    const words = card(buildCards(yearFixture({ totals: { ...yearFixture().totals, outputTokens: 2000000000 } })), 'words');
    expect(words.books).toBe('2,550 copies');
    expect(words.perSpine).toBe('8');
    expect(words.shelf.spines.length).toBeLessThanOrEqual(350);
  });

  it('the model card never claims more than half for exactly half', () => {
    const half = card(buildCards(yearFixture({ models: { count: 30, top: [{ name: 'm', calls: 2100 }] } })), 'model');
    expect(half.share).toBe('Exactly half');
  });
});
