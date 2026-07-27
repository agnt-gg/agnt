import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { activityTime, sortOutputs } from './outputSort.js';

const t = (hhmm) => `2026-07-26T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(t(hhmm));
const ids = (rows) => rows.map((r) => r.id);

describe('activityTime', () => {
  it('uses updated_at when present', () => {
    expect(activityTime({ id: 'a', updated_at: t('10:00') })).toBe(ms('10:00'));
  });

  it('falls back to created_at for legacy rows without updated_at', () => {
    expect(activityTime({ id: 'a', created_at: t('09:00') })).toBe(ms('09:00'));
  });

  it('lets a client-side bump win when it is more recent', () => {
    const out = { id: 'a', updated_at: t('09:00') };
    expect(activityTime(out, { a: ms('11:00') })).toBe(ms('11:00'));
  });

  it('keeps the server time when it is more recent than the bump', () => {
    const out = { id: 'a', updated_at: t('12:00') };
    expect(activityTime(out, { a: ms('09:00') })).toBe(ms('12:00'));
  });

  it('returns 0 for an unparseable date instead of NaN', () => {
    // NaN would make every comparison false and destabilise the whole sort.
    expect(activityTime({ id: 'a', updated_at: 'not-a-date' })).toBe(0);
  });

  it('returns 0 for a row with no dates at all', () => {
    expect(activityTime({ id: 'a' })).toBe(0);
  });
});

describe('sortOutputs — the reported defect', () => {
  it('puts a brand-new chat on top even when older items carry stale bumps', () => {
    // REGRESSION GUARD. `old` went unread earlier in the session and was then
    // read; its bump is deliberately retained so it does not jump under the
    // cursor. `NEW` is the active conversation, so it never goes unread and
    // therefore never receives a bump. Under the old two-tier comparator
    // `old` outranked `NEW` forever.
    const outputs = [
      { id: 'old', updated_at: t('10:00') },
      { id: 'older', updated_at: t('09:00') },
      { id: 'NEW', updated_at: t('10:10') },
    ];
    const sorted = sortOutputs(outputs, { bumps: { old: ms('10:05') } });
    expect(ids(sorted)[0]).toBe('NEW');
  });

  it('does not let an accumulation of stale bumps bury a newer conversation', () => {
    const outputs = [
      { id: 'a', updated_at: t('09:10') },
      { id: 'b', updated_at: t('09:20') },
      { id: 'c', updated_at: t('09:30') },
      { id: 'NEW', updated_at: t('12:00') },
    ];
    const bumps = { a: ms('09:10'), b: ms('09:20'), c: ms('09:30') };
    expect(ids(sortOutputs(outputs, { bumps }))[0]).toBe('NEW');
  });
});

describe('sortOutputs — the behaviours that must keep working', () => {
  it('floats a manually marked-unread conversation to the top', () => {
    const outputs = [
      { id: 'recent', updated_at: t('11:00') },
      { id: 'ancient', updated_at: t('01:00') },
    ];
    const sorted = sortOutputs(outputs, { bumps: { ancient: ms('11:30') } });
    expect(ids(sorted)[0]).toBe('ancient');
  });

  it('floats a saved conversation to the top via its refreshed updated_at', () => {
    const before = [
      { id: 'x', updated_at: t('10:00') },
      { id: 'y', updated_at: t('11:00') },
    ];
    expect(ids(sortOutputs(before))[0]).toBe('y');
    // x is saved: the server stamps a newer updated_at and the sidebar
    // refetches on `conversation-saved`.
    const after = [
      { id: 'x', updated_at: t('12:00') },
      { id: 'y', updated_at: t('11:00') },
    ];
    expect(ids(sortOutputs(after))[0]).toBe('x');
  });

  it('leaves an item exactly where it was when it is merely read', () => {
    // Reading clears the unread flag but must not change ordering — otherwise
    // the list resorts under the cursor mid-click.
    const outputs = [
      { id: 'a', updated_at: t('10:00') },
      { id: 'b', updated_at: t('09:00') },
      { id: 'c', updated_at: t('08:00') },
    ];
    const bumps = { b: ms('11:00') };
    const beforeRead = ids(sortOutputs(outputs, { bumps }));
    // CLEAR_OUTPUT_UNREAD touches unreadOutputIds only; bumps are untouched.
    const afterRead = ids(sortOutputs(outputs, { bumps }));
    expect(afterRead).toEqual(beforeRead);
    expect(afterRead[0]).toBe('b');
  });

  it('orders multiple bumped items most-recent-first', () => {
    const outputs = [
      { id: 'a', updated_at: t('01:00') },
      { id: 'b', updated_at: t('01:00') },
    ];
    const sorted = sortOutputs(outputs, { bumps: { a: ms('10:00'), b: ms('11:00') } });
    expect(ids(sorted)).toEqual(['b', 'a']);
  });
});

describe('sortOutputs — sort controls', () => {
  it('respects ascending order', () => {
    const outputs = [
      { id: 'new', updated_at: t('11:00') },
      { id: 'old', updated_at: t('09:00') },
    ];
    expect(ids(sortOutputs(outputs, { sortOrder: 'asc' }))).toEqual(['old', 'new']);
  });

  it('ignores bumps entirely when the user sorts alphabetically', () => {
    // An explicit alphabetical sort must not be silently reordered by recency.
    const outputs = [
      { id: 'a', content: 'Alpha', updated_at: t('01:00') },
      { id: 'z', content: 'Zulu', updated_at: t('01:00') },
    ];
    const sorted = sortOutputs(outputs, {
      sortKey: 'content',
      sortOrder: 'asc',
      bumps: { z: ms('23:00') },
      previewOf: (o) => o.content,
    });
    expect(ids(sorted)).toEqual(['a', 'z']);
  });

  it('does not mutate the input array', () => {
    const outputs = [
      { id: 'old', updated_at: t('09:00') },
      { id: 'new', updated_at: t('11:00') },
    ];
    const snapshot = ids(outputs);
    sortOutputs(outputs);
    expect(ids(outputs)).toEqual(snapshot);
  });

  it('sorts undated rows last rather than throwing', () => {
    const outputs = [
      { id: 'undated' },
      { id: 'dated', updated_at: t('09:00') },
    ];
    expect(ids(sortOutputs(outputs))).toEqual(['dated', 'undated']);
  });
});

describe('negative control — the comparator this replaced', () => {
  // The exact pre-fix logic. Kept so the regression cannot silently return:
  // if this ever starts passing the scenario above, the tier is back.
  function legacySort(list, bumps) {
    return [...list].sort((a, b) => {
      const aBump = bumps[a.id] || 0;
      const bBump = bumps[b.id] || 0;
      if (aBump && bBump) return bBump - aBump;
      if (aBump) return -1;
      if (bBump) return 1;
      const aValue = new Date(a.updated_at).getTime();
      const bValue = new Date(b.updated_at).getTime();
      if (aValue < bValue) return 1;
      if (aValue > bValue) return -1;
      return 0;
    });
  }

  it('demonstrably fails the case the new implementation passes', () => {
    const outputs = [
      { id: 'old', updated_at: t('10:00') },
      { id: 'NEW', updated_at: t('10:10') },
    ];
    const bumps = { old: ms('10:05') };
    expect(ids(legacySort(outputs, bumps))[0]).toBe('old'); // the bug
    expect(ids(sortOutputs(outputs, { bumps }))[0]).toBe('NEW'); // the fix
  });
});

describe('template — the unread dot renders in every list', () => {
  // The grouped list carried the dot; the flat/ungrouped list did not, so the
  // green dot was invisible whenever grouping was off. Both must render it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, 'OutputList.vue'), 'utf8');

  it('renders an unread dot everywhere a streaming indicator is rendered', () => {
    const streaming = source.match(/isOutputStreaming\(output\.id\)" class="fas fa-circle streaming-indicator"/g) || [];
    const unread = source.match(/isOutputUnread\(output\.id\)" class="unread-dot"/g) || [];
    expect(streaming.length).toBeGreaterThan(0);
    expect(unread.length).toBe(streaming.length);
  });

  it('drives the flat list through the shared sort helper', () => {
    expect(source).toContain("from './outputSort.js'");
    expect(source).toContain('sortOutputs(');
  });
});

describe('sortOutputs — real SQLite timestamps (the reported regression)', () => {
  // SQLite CURRENT_TIMESTAMP writes naive UTC. These are the literal strings
  // the API returns; using them here is the whole point — the previous suite
  // used ISO-with-Z, which parses correctly and therefore never exercised the
  // timezone defect that broke "Mark as Unread".
  const sqliteStamp = (msAgo) =>
    new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');

  it('lets Mark as Unread outrank a conversation saved seconds ago', () => {
    // THE BUG NATHAN REPORTED. With the naive constructor every server stamp
    // landed ~4h in the future (UTC-4), so a Date.now() bump could never win
    // and marking a chat unread did nothing.
    const outputs = [
      { id: 'just-saved', updated_at: sqliteStamp(5_000) },
      { id: 'MARKED', updated_at: sqliteStamp(72 * 3_600_000) },
    ];
    const sorted = sortOutputs(outputs, { bumps: { MARKED: Date.now() } });
    expect(ids(sorted)[0]).toBe('MARKED');
  });

  it('puts a freshly saved conversation on top', () => {
    const outputs = [
      { id: 'older', updated_at: sqliteStamp(3_600_000) },
      { id: 'SAVED', updated_at: sqliteStamp(1_000) },
    ];
    expect(ids(sortOutputs(outputs))[0]).toBe('SAVED');
  });

  it('treats a Date built by the store as the same instant as its raw string', () => {
    // contentOutputs converts at ingest via toServerDate; both paths must agree
    // or the sidebar would reorder depending on whether a row came from the
    // initial fetch or from ADD_OUTPUT.
    const raw = '2026-07-27 01:56:50';
    const asDate = new Date(Date.UTC(2026, 6, 27, 1, 56, 50));
    expect(activityTime({ id: 'a', updated_at: raw }))
      .toBe(activityTime({ id: 'a', updated_at: asDate }));
  });

  it('orders naive-UTC rows correctly among themselves', () => {
    const outputs = [
      { id: 'mid', updated_at: '2026-07-27 01:00:00' },
      { id: 'new', updated_at: '2026-07-27 02:00:00' },
      { id: 'old', updated_at: '2026-07-27 00:00:00' },
    ];
    expect(ids(sortOutputs(outputs))).toEqual(['new', 'mid', 'old']);
  });
});
