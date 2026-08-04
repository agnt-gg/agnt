import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { activityTime, sortOutputs } from './outputSort.js';
import { triageRail } from '@/utils/conversationAttention.js';

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

describe("sortOutputs — the 'attention' (Needs you) order", () => {
  // Rows carry the columns unread is DERIVED from; there is no unread flag.
  //
  // Unread means a watermark exists AND a later change overtook it. A NULL
  // watermark is NOT unread — it means none was ever recorded, the state of
  // every conversation predating the column. See conversationAttention.js.
  const unread = (id, updatedAt) => ({ id, updated_at: updatedAt, last_read_at: t('00:01') });
  const read = (id, updatedAt) => ({ id, updated_at: updatedAt, last_read_at: t('23:59') });
  const noWatermark = (id, updatedAt) => ({ id, updated_at: updatedAt, last_read_at: null });

  it('puts unread above read no matter how stale the unread item is', () => {
    const outputs = [read('fresh', t('12:00')), unread('ancient', t('01:00'))];
    expect(ids(sortOutputs(outputs, { sortKey: 'attention' }))).toEqual(['ancient', 'fresh']);
  });

  it('orders the unread partition longest-waiting first', () => {
    // This is the invariant the whole feature exists for: the longer
    // something has waited, the higher it sits. A recency order here would
    // rebuild the burial bug the rail was built to fix.
    const outputs = [unread('newer', t('11:00')), unread('oldest', t('02:00')), unread('mid', t('09:00'))];
    expect(ids(sortOutputs(outputs, { sortKey: 'attention' }))).toEqual(['oldest', 'mid', 'newer']);
  });

  it('orders the read partition most-recent first', () => {
    const outputs = [read('old', t('02:00')), read('new', t('11:00'))];
    expect(ids(sortOutputs(outputs, { sortKey: 'attention' }))).toEqual(['new', 'old']);
  });

  it('agrees with triageRail on the order of the same unread rows', () => {
    // Rail and list are two views of one ordering. If they disagree, the
    // same conversation appears in two different places in the same panel.
    const outputs = [unread('b', t('09:00')), unread('a', t('03:00')), unread('c', t('10:00'))];
    const railOrder = ids(triageRail(outputs));
    const listOrder = ids(sortOutputs(outputs, { sortKey: 'attention' }));
    expect(listOrder).toEqual(railOrder);
  });

  it('does not let a client bump reorder the unread partition', () => {
    // A manual "Mark as Unread" writes nothing server-side, so "waiting
    // since" is updated_at alone — otherwise the item would sink to the
    // bottom of the rail in the list and sit at the top of the rail proper.
    const outputs = [unread('marked', t('02:00')), unread('recent', t('10:00'))];
    const sorted = sortOutputs(outputs, { sortKey: 'attention', bumps: { marked: ms('23:00') } });
    expect(ids(sorted)).toEqual(['marked', 'recent']);
  });

  it('treats archived rows as read — archiving IS "done with this"', () => {
    const outputs = [
      { ...unread('archived-unread', t('01:00')), archived_at: t('01:30') },
      unread('live-unread', t('10:00')),
    ];
    expect(ids(sortOutputs(outputs, { sortKey: 'attention' }))[0]).toBe('live-unread');
  });

  it('does not float a conversation that merely has no watermark', () => {
    // REGRESSION GUARD for the reported bug. Sorting by "Needs you" must not
    // hoist a user's entire pre-feature history above everything else.
    const outputs = [
      noWatermark('legacy-a', t('02:00')),
      unread('waiting', t('09:00')),
      noWatermark('legacy-b', t('01:00')),
    ];
    expect(ids(sortOutputs(outputs, { sortKey: 'attention' }))[0]).toBe('waiting');
  });

  it('ignores sortOrder: there is no useful reverse of "needs you"', () => {
    const outputs = [read('fresh', t('12:00')), unread('ancient', t('01:00'))];
    const desc = ids(sortOutputs(outputs, { sortKey: 'attention', sortOrder: 'desc' }));
    const asc = ids(sortOutputs(outputs, { sortKey: 'attention', sortOrder: 'asc' }));
    expect(asc).toEqual(desc);
    expect(asc[0]).toBe('ancient');
  });

  it('does not mutate the input array', () => {
    const outputs = [read('a', t('01:00')), unread('b', t('02:00'))];
    const snapshot = ids(outputs);
    sortOutputs(outputs, { sortKey: 'attention' });
    expect(ids(outputs)).toEqual(snapshot);
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

  it('offers both sort modes and defaults to the attention order', () => {
    expect(source).toContain("sortBy('attention')");
    expect(source).toContain("sortBy('updated_at')");
    // The default lives in loadSortPreference's fallback.
    expect(source).toMatch(/return \{ key: 'attention', order: 'desc' \}/);
  });

  it('exposes a one-click clear for the whole rail', () => {
    // The rail is a queue; a queue with no drain is a guilt generator.
    expect(source).toContain('markAllNeedsYouRead');
    expect(source).toContain("contentOutputs/markAllRead");
  });

  it('lets the Date sort reach the rail too', () => {
    // A sort control that visibly skips a section of the list it controls is
    // a broken control; the rail must re-sort when Date is picked.
    expect(source).toMatch(/if \(sortKey\.value !== 'updated_at'\) return rail;/);
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
