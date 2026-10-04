/**
 * "Open this listing" must open THAT listing, from every entry point.
 *
 * A listing has two ids (asset_id, the listing row id). Shelves sent one, Focused
 * the other, most shelves sent nothing, and each Market screen matched only one
 * kind. These pin the shared key and the matcher, and scan the shelves so a
 * new one cannot quietly drop the clicked item again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketplaceItemKey, matchesMarketplaceKey } from './marketplaceLink.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('marketplace link key', () => {
  it('prefers the stable asset id, falls back to the listing id', () => {
    expect(marketplaceItemKey({ id: 'row-1', asset_id: 'agnt-usecase-triage' })).toBe('agnt-usecase-triage');
    expect(marketplaceItemKey({ id: 42 })).toBe('42');
    for (const none of [null, undefined, 'str', {}]) expect(marketplaceItemKey(none)).toBe('');
  });

  it('a key finds its listing by either id, and nothing else', () => {
    const listing = { id: 'row-1', asset_id: 'agnt-usecase-triage' };
    expect(matchesMarketplaceKey(listing, 'agnt-usecase-triage')).toBe(true);
    expect(matchesMarketplaceKey(listing, 'row-1')).toBe(true);
    expect(matchesMarketplaceKey({ id: 7 }, '7')).toBe(true);
    expect(matchesMarketplaceKey(listing, 'other')).toBe(false);
    expect(matchesMarketplaceKey(listing, '')).toBe(false);
    expect(matchesMarketplaceKey(listing, null)).toBe(false);
    expect(matchesMarketplaceKey(null, 'row-1')).toBe(false);
    // A listing with no asset id never matches the key "undefined".
    expect(matchesMarketplaceKey({ id: 'r' }, 'undefined')).toBe(false);
  });
});

describe('every Market shelf passes the clicked listing', () => {
  const vueFiles = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : vueFiles(full);
      return name.endsWith('.vue') ? [full] : [];
    });
  const handlers = vueFiles(join(SRC, 'views')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/@(?:browse|market)="([^"]*MarketplaceScreen[^"]*)"/g)].map((m) => ({ file: relative(SRC, file), handler: m[1] })),
  );

  it('finds the shelves (anti-vacuity)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(12);
  });

  it('none of them drops the item it was given', () => {
    const dropping = handlers.filter(({ handler }) => !/\{\s*listing\s*\}/.test(handler));
    expect(dropping, dropping.map((d) => `${d.file}: ${d.handler}`).join('\n')).toEqual([]);
  });
});
