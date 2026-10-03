import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSearchBudget, cacheKey, BUDGET } from './searchBudget.js';

const HOUR = 60 * 60_000;

function clock(start = Date.UTC(2026, 9, 3, 12)) {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

describe('rate', () => {
  it('allows a burst, then one search per refill interval', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    for (let i = 0; i < BUDGET.BURST; i++) expect(budget.take()).toEqual({ ok: true });
    expect(budget.take()).toMatchObject({ ok: false, reason: 'rate_limited' });
    time.advance(BUDGET.REFILL_MS - 1);
    expect(budget.take().ok).toBe(false);
    time.advance(1);
    expect(budget.take().ok).toBe(true);
    expect(budget.take().ok).toBe(false);
  });

  it('never banks more than one burst, however long it was idle', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    time.advance(24 * HOUR);
    let granted = 0;
    while (budget.take().ok) granted++;
    expect(granted).toBe(BUDGET.BURST);
  });

  it('holds the sustained rate at 20 per 10 minutes', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    let granted = 0;
    for (let step = 0; step < 600; step++) {
      if (budget.take().ok) granted++;
      time.advance(1000);
    }
    expect(granted).toBe(BUDGET.BURST + 600_000 / BUDGET.REFILL_MS - 1);
    expect(granted).toBeLessThanOrEqual(25);
  });

  it('caps a day, and starts over the next day', () => {
    const time = clock(Date.UTC(2026, 9, 3, 0, 0));
    const budget = createSearchBudget({ now: time.now });
    for (let i = 0; i < BUDGET.DAILY_CAP; i++) {
      expect(budget.take().ok).toBe(true);
      time.advance(BUDGET.REFILL_MS);
    }
    expect(budget.take()).toMatchObject({ ok: false, reason: 'daily_cap' });
    time.advance(24 * HOUR);
    expect(budget.take().ok).toBe(true);
  });
});

describe('breaker', () => {
  it('pauses 1 h, then 6 h, then 24 h for every refusal that follows a pause', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    const expectPause = (hours) => {
      const until = budget.recordBlock();
      expect(until - time.now()).toBe(hours * HOUR);
      expect(budget.take()).toMatchObject({ ok: false, reason: 'cooling_down', retryAt: until });
      time.advance(hours * HOUR);
      expect(budget.take().ok).toBe(true);
    };
    expectPause(1);
    expectPause(6);
    expectPause(24);
    expectPause(24);
  });

  it('starts over at 1 h after a clean day following the pause', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    budget.recordBlock();
    budget.recordBlock();
    time.advance(6 * HOUR + BUDGET.STRIKE_WINDOW_MS - 1);
    expect(budget.recordBlock() - time.now()).toBe(24 * HOUR);
    time.advance(24 * HOUR + BUDGET.STRIKE_WINDOW_MS);
    expect(budget.recordBlock() - time.now()).toBe(HOUR);
  });
});

describe('persistence', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-search-budget-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps a cooldown and the day count across a restart', () => {
    const time = clock();
    const statePath = path.join(dir, 'search-state.json');
    const first = createSearchBudget({ statePath, now: time.now });
    first.take();
    first.take();
    const until = first.recordBlock();
    const second = createSearchBudget({ statePath, now: time.now });
    expect(second.take()).toMatchObject({ ok: false, reason: 'cooling_down', retryAt: until });
    expect(second.snapshot().dayCount).toBe(2);
  });

  it('never writes a query to disk', () => {
    const statePath = path.join(dir, 'search-state.json');
    const budget = createSearchBudget({ statePath });
    budget.take();
    budget.remember(cacheKey('my secret medical question', 5), [{ title: 't' }]);
    budget.recordBlock();
    expect(fs.readFileSync(statePath, 'utf8')).not.toMatch(/secret|medical|question/);
  });

  it('starts fresh from a corrupt state file', () => {
    const statePath = path.join(dir, 'search-state.json');
    fs.writeFileSync(statePath, '{not json');
    expect(createSearchBudget({ statePath }).take().ok).toBe(true);
  });
});

describe('cache', () => {
  it('answers the same query, however it is spaced or cased, for six hours', () => {
    const time = clock();
    const budget = createSearchBudget({ now: time.now });
    budget.remember(cacheKey('Best  Pizza ', 5), ['r']);
    expect(budget.cached(cacheKey('best pizza', 5))).toEqual(['r']);
    expect(budget.cached(cacheKey('best pizza', 10))).toBeNull();
    time.advance(BUDGET.CACHE_TTL_MS + 1);
    expect(budget.cached(cacheKey('best pizza', 5))).toBeNull();
  });

  it('is bounded, dropping the oldest entry', () => {
    const budget = createSearchBudget();
    for (let i = 0; i <= BUDGET.CACHE_MAX; i++) budget.remember(cacheKey('q' + i, 5), [i]);
    expect(budget.snapshot().cached).toBe(BUDGET.CACHE_MAX);
    expect(budget.cached(cacheKey('q0', 5))).toBeNull();
    expect(budget.cached(cacheKey('q' + BUDGET.CACHE_MAX, 5))).toEqual([BUDGET.CACHE_MAX]);
  });
});
