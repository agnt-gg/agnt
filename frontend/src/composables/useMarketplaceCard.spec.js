import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_ASSET_TYPES,
  isShelfEligible,
  assetIcon,
  assetTypeLabel,
  hueFor,
  artStyle,
  iconStyle,
  daysSince,
  isNew,
  buildTrendingIds,
  buildCategoryRankMap,
  formatCount,
  installsLabel,
  matchesQuery,
  byPopularity,
  trimToWholeRows,
} from './useMarketplaceCard';

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const item = (o = {}) => ({ id: 'i1', title: 'Thing', asset_type: 'agent', downloads: 10, published_at: day(100), ...o });

describe('useMarketplaceCard — the closed asset-type set', () => {
  it('is exactly the four types the server serves', () => {
    expect([...MARKETPLACE_ASSET_TYPES].sort()).toEqual(['agent', 'plugin', 'tool', 'workflow']);
  });

  // This is the guard behind the whole degraded path: Skills and WidgetManager
  // mount a shelf, and it MUST stay empty until the backend serves those types.
  it('rejects skill and widget, so their shelves cannot render a bogus grid', () => {
    expect(isShelfEligible('skill')).toBe(false);
    expect(isShelfEligible('widget')).toBe(false);
    expect(isShelfEligible('agent')).toBe(true);
  });

  it('cannot be mutated by a caller', () => {
    expect(() => MARKETPLACE_ASSET_TYPES.push('skill')).toThrow();
  });
});

describe('useMarketplaceCard — icons and labels', () => {
  it('maps every known type, and falls back to workflow for unknown/missing', () => {
    expect(assetIcon(item({ asset_type: 'agent' }))).toBe('fas fa-robot');
    expect(assetIcon(item({ asset_type: 'tool' }))).toBe('fas fa-wrench');
    expect(assetIcon(item({ asset_type: 'plugin' }))).toBe('fas fa-puzzle-piece');
    expect(assetIcon(item({ asset_type: 'workflow' }))).toBe('fas fa-project-diagram');
    expect(assetIcon(item({ asset_type: undefined }))).toBe('fas fa-project-diagram');
    expect(assetTypeLabel(item({ asset_type: 'plugin' }))).toBe('Plugin');
    expect(assetTypeLabel(item({ asset_type: 'nonsense' }))).toBe('Workflow');
  });
});

describe('useMarketplaceCard — deterministic art', () => {
  // A card that changes colour between renders reads as a bug, and the shelf
  // and the Marketplace screen must agree on the same item.
  it('gives the same item the same hue every time', () => {
    const a = item({ id: 'abc-123' });
    expect(hueFor(a)).toBe(hueFor({ ...a }));
    expect(artStyle(a)).toEqual(artStyle({ ...a }));
    expect(iconStyle(a)).toEqual(iconStyle({ ...a }));
  });

  it('separates types even for identical ids, so a grid is not monochrome', () => {
    expect(hueFor({ id: 'x', asset_type: 'agent' })).not.toBe(hueFor({ id: 'x', asset_type: 'tool' }));
  });

  it('always produces a hue in range, including for an item with no id or title', () => {
    for (const t of MARKETPLACE_ASSET_TYPES) {
      const h = hueFor({ asset_type: t });
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('useMarketplaceCard — dates never produce NaN', () => {
  it('treats a missing or unparseable date as infinitely old rather than NaN', () => {
    expect(daysSince({})).toBe(Infinity);
    expect(daysSince({ published_at: 'not-a-date' })).toBe(Infinity);
    expect(isNew({})).toBe(false);
  });

  it('marks <=30 days as new and older as not', () => {
    expect(isNew(item({ published_at: day(5) }))).toBe(true);
    expect(isNew(item({ published_at: day(45) }))).toBe(false);
  });

  it('falls back through published_at -> created_at -> updated_at', () => {
    expect(isNew({ created_at: day(2) })).toBe(true);
    expect(isNew({ updated_at: day(2) })).toBe(true);
  });
});

describe('useMarketplaceCard — badges stay meaningful on a small catalogue', () => {
  // Badging 2 of 4 items "trending" is noise. The real catalogue has 4 workflows.
  it('awards no trending badge when the pool is too small to rank', () => {
    const small = [1, 2, 3, 4].map((n) => item({ id: 'w' + n, downloads: n * 10, published_at: day(10) }));
    expect(buildTrendingIds(small).size).toBe(0);
  });

  it('awards trending to roughly the top 15% once the pool is big enough', () => {
    const pool = Array.from({ length: 20 }, (_, n) => item({ id: 'w' + n, downloads: n + 1, published_at: day(10) }));
    const ids = buildTrendingIds(pool);
    expect(ids.size).toBe(3);
    expect(ids.has('w19')).toBe(true); // most installed, same age -> highest velocity
  });

  it('ignores items with zero installs entirely', () => {
    const pool = Array.from({ length: 20 }, (_, n) => item({ id: 'z' + n, downloads: 0, published_at: day(10) }));
    expect(buildTrendingIds(pool).size).toBe(0);
  });

  it('ranks #1 only in categories with at least three entrants', () => {
    const twoInCat = [item({ id: 'a', category: 'X', downloads: 9 }), item({ id: 'b', category: 'X', downloads: 1 })];
    expect(buildCategoryRankMap(twoInCat)).toEqual({});

    const threeInCat = [...twoInCat, item({ id: 'c', category: 'X', downloads: 5 })];
    expect(buildCategoryRankMap(threeInCat)).toEqual({ a: 1 });
  });

  it('never ranks an item nobody installed', () => {
    const none = ['a', 'b', 'c'].map((id) => item({ id, category: 'X', downloads: 0 }));
    expect(buildCategoryRankMap(none)).toEqual({});
  });

  it('ignores items with no category', () => {
    expect(buildCategoryRankMap([item({ id: 'a', category: null })])).toEqual({});
  });
});

describe('useMarketplaceCard — counts', () => {
  it('abbreviates thousands and millions the way the Marketplace screen does', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1200)).toBe('1.2K');
    expect(formatCount(2500000)).toBe('2.5M');
  });

  it('coerces junk to 0 rather than rendering NaN', () => {
    expect(formatCount(undefined)).toBe('0');
    expect(formatCount(null)).toBe('0');
  });

  // Regression: the strip rendered "1 installs".
  it('pluralises off the raw number, not the abbreviation', () => {
    expect(installsLabel(1)).toBe('1 install');
    expect(installsLabel(0)).toBe('0 installs');
    expect(installsLabel(2)).toBe('2 installs');
    expect(installsLabel(1000)).toBe('1.0K installs');
  });
});

describe('useMarketplaceCard — local search', () => {
  const it1 = item({ title: 'Koder Kai', tagline: 'Expert software engineer', category: 'Technology', publisher_pseudonym: 'AcuteBeigeDolphin' });

  it('matches everything on an empty or whitespace query', () => {
    expect(matchesQuery(it1, '')).toBe(true);
    expect(matchesQuery(it1, '   ')).toBe(true);
  });

  it('matches case-insensitively across title, tagline, category and publisher', () => {
    expect(matchesQuery(it1, 'koder')).toBe(true);
    expect(matchesQuery(it1, 'ENGINEER')).toBe(true);
    expect(matchesQuery(it1, 'technology')).toBe(true);
    expect(matchesQuery(it1, 'dolphin')).toBe(true);
    expect(matchesQuery(it1, 'kubernetes')).toBe(false);
  });

  it('does not throw on items with missing fields', () => {
    expect(() => matchesQuery({ title: 'x' }, 'x')).not.toThrow();
    expect(matchesQuery({ title: 'x' }, 'x')).toBe(true);
  });
});

describe('useMarketplaceCard — ordering', () => {
  it('sorts most-installed first with a stable title tiebreak', () => {
    const list = [
      item({ id: 'b', title: 'Beta', downloads: 5 }),
      item({ id: 'a', title: 'Alpha', downloads: 5 }),
      item({ id: 'c', title: 'Gamma', downloads: 50 }),
    ];
    expect([...list].sort(byPopularity).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('useMarketplaceCard — the shelf never ends on a ragged row', () => {
  // 6 agents in a 4-column grid rendered 4 + 2 and left 659px of dead space.
  it('drops the partial row', () => {
    expect(trimToWholeRows([1, 2, 3, 4, 5, 6], 4)).toEqual([1, 2, 3, 4]);
  });

  it('keeps an exact fit intact', () => {
    expect(trimToWholeRows([1, 2, 3, 4], 4)).toEqual([1, 2, 3, 4]);
    expect(trimToWholeRows([1, 2, 3, 4, 5, 6, 7, 8], 4)).toHaveLength(8);
  });

  it('caps at maxRows so the shelf cannot swallow the screen', () => {
    const many = Array.from({ length: 40 }, (_, i) => i);
    expect(trimToWholeRows(many, 4, 2)).toHaveLength(8);
  });

  // A 4-item catalogue in a 5-column grid must still render 4 cards, not zero.
  it('never returns an empty shelf just because the row is short', () => {
    expect(trimToWholeRows([1, 2, 3], 4)).toEqual([1, 2, 3]);
    expect(trimToWholeRows([1], 4)).toEqual([1]);
  });

  it('survives a nonsense column count rather than dividing by zero', () => {
    expect(trimToWholeRows([1, 2, 3], 0)).toHaveLength(2);
    expect(() => trimToWholeRows([1, 2, 3], NaN)).not.toThrow();
    expect(trimToWholeRows([], 4)).toEqual([]);
  });
});
