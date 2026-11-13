import { describe, it, expect, vi } from 'vitest';
import {
  buildCards,
  calendarGeometry,
  deriveYear,
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
import { yearFixture } from './wrapped.fixture.js';

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

  it('finds the longest run of days, and says when it is not the whole year', () => {
    expect(year.streak).toEqual({ length: 43, start: '2026-10-01', end: '2026-11-12', unbroken: false });
    const unbroken = deriveYear(yearFixture({ days: yearFixture().days.slice(1) }));
    expect(unbroken.streak.unbroken).toBe(true);
  });

  it('finds the busiest day, the peak month, the first month and a partial last month', () => {
    expect(year.busiest).toEqual({ date: '2026-10-28', calls: 400 });
    expect(year.peakMonth).toMatchObject({ key: '2026-10', calls: 3400 });
    expect(year.firstMonth).toMatchObject({ key: '2026-03', calls: 50 });
    expect(year.partialKey).toBe('2026-11');
    expect(deriveYear(yearFixture({ window: { from: '2026-01-01', through: '2026-12-31', complete: true } })).partialKey).toBe(null);
  });

  it('weighs weekdays by calls, on calendar dates in any time zone', () => {
    expect(year.busiestWeekday).toBe(3); // Wednesday: October 28 is one
  });

  it('names the persona from who started the calls', () => {
    expect(year.persona.name).toBe('Conductor');
    expect(year.persona.line).toContain('55% of your calls came from chats with Annie, 36% from workflows and goals');
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

  it('the month chart gives a dot per 500 calls, at least one, two wide', () => {
    const y = deriveYear(yearFixture());
    const geo = monthDotsGeometry(y.months, y.peakMonth.key, y.partialKey);
    expect(geo.dots).toHaveLength(1 + 7 + 3);
    expect(geo.dots.filter((d) => d.kind === 'peak')).toHaveLength(7);
    expect(geo.dots.filter((d) => d.kind === 'partial')).toHaveLength(3);
    expect(geo.labels.map((l) => l.text)).toEqual(['M', 'O', 'N']);
    expect(geo.peakLabel.text).toBe('3.4K');
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
    expect(card(cards, 'streak')).toMatchObject({ length: 43, busiest: { date: 'Oct 28', calls: '400' }, firstDay: 'Mar 3' });
    expect(card(cards, 'streak').sentence).toBe('Your longest run went from October 1 to November 12.');
    expect(card(cards, 'volume')).toMatchObject({ calls: 4200, models: '30', providers: '6', peak: { name: 'October', calls: '3,400' }, growth: '68× March', partialMonth: 'November' });
    expect(card(cards, 'words')).toMatchObject({ written: '47M', books: '60 copies', read: '90M', cachePct: 90, perSpine: null });
    expect(card(cards, 'model')).toMatchObject({ name: 'claude-opus-5-5', calls: '1,900', share: 'More than a third', modelCount: '30', providerCount: '6' });
    expect(card(cards, 'model').rest.map((m) => m.rank)).toEqual([2, 3, 4, 5]);
    expect(card(cards, 'goals')).toMatchObject({ passed: '10 of the 12' });
    expect(card(cards, 'built').peak).toEqual({ month: 'September', parts: '30 skills and 12 agents' });
    expect(card(cards, 'money')).toMatchObject({ notional: true, amount: 640, uncached: '$2,401', saved: '$1,761', charged: '$12.50', unpriced: '3' });
    expect(card(cards, 'learning')).toMatchObject({ applied: 120, rejected: '7', memories: '900' });
    expect(card(cards, 'persona').badges).toEqual([
      { key: 'Busiest day', value: 'Wednesdays' },
      { key: 'Peak month', value: 'October' },
      { key: 'Explorer', value: '30 models' },
    ]);
    expect(card(cards, 'summary')).toMatchObject({ year: 2026, streak: '43', calls: '4,200', topModel: 'claude-opus-5-5', topGoal: 'Morning digest', built: { count: '35', kind: 'skills' }, saved: '$1.8K', persona: 'Conductor' });
  });

  it('no story until there are a week of active days', () => {
    const short = yearFixture({ days: yearFixture().days.slice(0, 6) });
    expect(hasStory(short)).toBe(false);
    expect(buildCards(short)).toEqual([]);
    expect(buildCards(null)).toEqual([]);
  });

  it('leaves out a card whose numbers are empty, rather than showing zeros', () => {
    const lean = buildCards(yearFixture({
      totals: { ...yearFixture().totals, outputTokens: 0, notionalUsd: 0, costUsd: 0, notionalSavedUsd: 0, savedUsd: 0 },
      goals: { top: [], created: 0, validated: 0 },
      built: { skills: {}, agents: {}, widgets: {}, goals: {}, workflows: {} },
      learning: { insightsApplied: 0, insightsRejected: 0, skillTrials: 0, skillsKept: 0, skillsPromoted: 0, memories: 0 },
      split: { conversation: 0, automation: 0 },
    }));
    expect(lean.map((c) => c.id)).toEqual(['intro', 'streak', 'volume', 'model', 'summary']);
    expect(card(lean, 'summary')).toMatchObject({ topGoal: null, built: null, saved: null, persona: null, modelCount: '30' });
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
