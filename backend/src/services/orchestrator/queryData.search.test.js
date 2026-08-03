/**
 * query_data `search` — giant-single-line false-negative regression suite.
 *
 * PRODUCTION INCIDENT (2026-07-29, traces b42a73f7 / cb05cf0d): a 186 KB
 * single-line list_files JSON blob was offloaded; `search` for "nates eyes only"
 * MATCHED the line, then cap() dropped the (whole-line-sized) match to fit the
 * 15 KB output budget and rewrote matchCount to 0 — a true positive presented
 * as a confident "not found". The model concluded the directory did not exist
 * and searched the entire C: drive for 39 tool calls.
 *
 * Contract pinned here:
 *  1. A match on a giant line yields a windowed EXCERPT, never the whole line.
 *  2. cap() NEVER reports matchCount 0 when matches were found.
 *  3. matchCount always reports the TRUE count; returnedMatches says how many
 *     entries are actually included.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS } from './tools.js';

const queryData = TOOLS.query_data;

/** Build a realistic offloaded list_files payload: one giant JSON line. */
function buildListFilesBlob({ dirs = 1200, needleName = 'for-nates-eyes-only' } = {}) {
  const items = [];
  for (let i = 0; i < dirs; i++) {
    items.push({ name: `project-dir-${String(i).padStart(4, '0')}`, type: 'directory', path: `C:/Users/Studio/AppData/Roaming/AGNT/projects/project-dir-${String(i).padStart(4, '0')}` });
  }
  // Bury the needle mid-array, like production
  items.splice(Math.floor(dirs / 2), 0, { name: needleName, type: 'directory', path: `C:/Users/Studio/AppData/Roaming/AGNT/projects/${needleName}` });
  return JSON.stringify({ success: true, items, path: '/' });
}

function ctx(data, dataId = 'data-test-blob-1') {
  return { preservedContent: { [dataId]: data }, dataRefSummaries: {} };
}

async function search(data, args) {
  const raw = await queryData.execute(
    { operation: 'search', dataId: 'data-test-blob-1', ...args },
    null,
    ctx(data)
  );
  return JSON.parse(raw);
}

describe('query_data search on giant single-line JSON (production regression)', () => {
  const blob = buildListFilesBlob();

  it('reproduces the incident query: multi-word "nates eyes only" finds the directory', async () => {
    expect(blob.length).toBeGreaterThan(100_000); // must be in the same size class as production
    const r = await search(blob, { query: 'nates eyes only' });
    expect(r.success).toBe(true);
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
    expect(r.matches.length).toBeGreaterThanOrEqual(1);
    const excerpts = r.matches.map(m => m.excerpt || '').join('\n');
    expect(excerpts).toContain('for-nates-eyes-only');
  });

  it('single-word search on the blob finds it (was matchCount 0 in production)', async () => {
    const r = await search(blob, { query: 'nates' });
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
    expect(r.matches[0].excerpt).toContain('nates');
  });

  it('a ubiquitous term like "for" is never reported as zero matches', async () => {
    const r = await search(blob, { query: 'for' });
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('regex search works on giant lines', async () => {
    const r = await search(blob, { query: 'nates|zzznotthere', regex: true });
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
    expect(r.matches[0].excerpt).toMatch(/nates/i);
  });

  it('excerpts are windowed, never the whole line', async () => {
    const r = await search(blob, { query: 'nates' });
    for (const m of r.matches) {
      expect((m.excerpt || '').length).toBeLessThanOrEqual(500);
      expect(m.col).toBeGreaterThan(0);
    }
  });

  it('multiple occurrences on one giant line yield separate entries up to maxResults', async () => {
    const r = await search(blob, { query: 'project-dir-', maxResults: 5 });
    expect(r.matches.length).toBe(5);
    expect(r.matchCount).toBeGreaterThanOrEqual(5);
  });

  it('total output respects the 15 KB cap', async () => {
    const r = await search(blob, { query: 'directory', maxResults: 50 });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(15_000);
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('a genuinely absent term reports 0 without truncation flags', async () => {
    const r = await search(blob, { query: 'zzz-definitely-not-there' });
    expect(r.matchCount).toBe(0);
    expect(r._truncatedMatches).toBeFalsy();
  });
});

describe('query_data search on normal multi-line data (no regression)', () => {
  const multiline = ['alpha line one', 'beta line two', 'gamma target line', 'delta line four'].join('\n');

  it('keeps the original context-block shape', async () => {
    const r = await search(multiline, { query: 'target' });
    expect(r.matchCount).toBe(1);
    expect(r.matches[0].lineNumber).toBe(3);
    expect(Array.isArray(r.matches[0].context)).toBe(true);
    const matched = r.matches[0].context.find(c => c.match);
    expect(matched.text).toBe('gamma target line');
  });

  it('truncates oversized CONTEXT lines instead of inlining them whole', async () => {
    // Enough short lines to keep avgLineLength below the single-line-blob
    // heuristic, with one oversized neighbour adjacent to the match.
    const filler = Array.from({ length: 12 }, (_, i) => `filler line ${i}`);
    const data = ['short match line with needle', 'x'.repeat(3000), ...filler].join('\n');
    const r = await search(data, { query: 'needle', contextLines: 1 });
    expect(r.matchCount).toBe(1);
    for (const c of r.matches[0].context) {
      expect(c.text.length).toBeLessThanOrEqual(600);
    }
  });
});

describe('cap() safety net: found matches are never zeroed out', () => {
  it('when trimming, matchCount reports the TRUE count and at least one match survives', async () => {
    // Many distinct ~490-char lines that all match: big enough to trip the cap,
    // small enough to dodge the giant-line excerpt path.
    const line = i => `needle-${String(i).padStart(3, '0')} ${'y'.repeat(470)}`;
    const data = Array.from({ length: 100 }, (_, i) => line(i)).join('\n');
    const r = await search(data, { query: 'needle', maxResults: 100, contextLines: 1 });
    expect(r.matchCount).toBe(100);           // TRUE count, not trimmed count
    expect(r.matches.length).toBeGreaterThan(0); // never empty when matches exist
    expect(r.returnedMatches).toBe(r.matches.length);
    if (r.matches.length < r.matchCount) {
      expect(r._truncatedMatches).toBe(true);
    }
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(15_000);
  });
});

describe('not-found refs explain themselves (2026-08-03 "expiring ref" incident)', () => {
  // A real, well-formed ref whose backing bytes are gone must be
  // distinguishable from a typo'd id — the model's correct next move differs
  // (re-run the producing tool vs fix the id).
  it('a real-looking data- ref that is missing gets the "no longer resident" hint', async () => {
    const raw = await queryData.execute(
      { operation: 'search', dataId: 'data-toolu_abc123-1785769786358-0', query: 'x' },
      null,
      { preservedContent: {}, dataRefSummaries: {} }
    );
    const r = JSON.parse(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('not found');
    expect(r.hint).toContain('no longer resident');
    expect(r.hint).toContain('Re-run');
  });

  it('a malformed id gets the format hint instead', async () => {
    const raw = await queryData.execute(
      { operation: 'search', dataId: 'totally-wrong-id', query: 'x' },
      null,
      { preservedContent: {}, dataRefSummaries: {} }
    );
    const r = JSON.parse(raw);
    expect(r.success).toBe(false);
    expect(r.hint).toContain('operation="list"');
  });

  it('a missing ref still lists surviving refs so the model can recover', async () => {
    const raw = await queryData.execute(
      { operation: 'search', dataId: 'data-gone-1-0', query: 'x' },
      null,
      { preservedContent: { 'data-alive-2-0': 'hello world' }, dataRefSummaries: {} }
    );
    const r = JSON.parse(raw);
    expect(r.success).toBe(false);
    expect(r.available_refs).toEqual(['data-alive-2-0']);
  });
});
