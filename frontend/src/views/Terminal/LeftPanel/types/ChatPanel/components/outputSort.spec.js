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

describe("sortOutputs — the 'attention' (Unread) order", () => {
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
    // triageRail() still backs the Unread count badge and the clear-all
    // button. If the two orderings drift, the number on the badge stops
    // describing the rows the sort actually lifts to the top, and clear-all
    // stops clearing exactly what the user was looking at.
    const outputs = [unread('b', t('09:00')), unread('a', t('03:00')), unread('c', t('10:00'))];
    const railOrder = ids(triageRail(outputs));
    const listOrder = ids(sortOutputs(outputs, { sortKey: 'attention' }));
    expect(listOrder).toEqual(railOrder);
  });

  it('does not let a client bump reorder the unread partition', () => {
    // "Waiting since" is updated_at alone inside this partition. A manual
    // "Mark as Unread" moves updated_at server-side, so it needs no bump to
    // hold its place — and letting bumps in here would let a client-side
    // timestamp disagree with the count badge about the same rows.
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
    // REGRESSION GUARD for the reported bug. Sorting by Unread must not
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

describe('mark-as-unread lifecycle — the conversation keeps the place it was given', () => {
  // Row SHAPES as the store and server now write them (the write itself is
  // covered in contentOutputs.attention.spec.js and
  // ContentOutputModel.attention.test.js). What is asserted here is the
  // consequence Nathan actually sees: where the row lands in the list.
  //
  // Marking unread sets updated_at = now, watermark one second behind.
  const queuedUnread = { id: 'queued', updated_at: t('20:00'), last_read_at: t('19:59') };
  // Then opening it stamps the watermark up to that same activity.
  const queuedRead = { id: 'queued', updated_at: t('20:00'), last_read_at: t('20:00') };

  // How the OLD implementation wrote the same two steps: the watermark moved
  // but updated_at never did, so the row kept its original date.
  const STALE = t('01:00');
  const legacyUnread = { id: 'queued', updated_at: STALE, last_read_at: t('00:59') };
  const legacyRead = { id: 'queued', updated_at: STALE, last_read_at: STALE };

  const neighbours = [
    { id: 'other-a', updated_at: t('12:00'), last_read_at: t('12:00') },
    { id: 'other-b', updated_at: t('15:00'), last_read_at: t('15:00') },
  ];

  // A conversation that went unread on its own (a background agent changed
  // it) rather than by a click: watermark older than the change.
  const unreadAt = (id, updatedAt) => ({ id, updated_at: updatedAt, last_read_at: t('00:01') });

  it('sorts to the top by Date once queued, and STAYS there when read', () => {
    const queued = sortOutputs([...neighbours, queuedUnread], { sortKey: 'updated_at' });
    expect(ids(queued)[0]).toBe('queued');

    const opened = sortOutputs([...neighbours, queuedRead], { sortKey: 'updated_at' });
    expect(ids(opened)[0]).toBe('queued');
  });

  it('sits at the top of the Unread sort in both states', () => {
    // Unread: it is the only unread row, so it leads outright.
    expect(ids(sortOutputs([...neighbours, queuedUnread], { sortKey: 'attention' }))[0]).toBe('queued');
    // Read: it is the most recently active, so it leads the read partition.
    expect(ids(sortOutputs([...neighbours, queuedRead], { sortKey: 'attention' }))[0]).toBe('queued');
  });

  it('is the LAST unread row while it waits — zero seconds is the shortest wait', () => {
    // A deliberate consequence of dating it "now", not an accident: the
    // partition is longest-waiting-first, and this one has waited no time at
    // all. It still outranks every read conversation, and reading it moves it
    // to the head of the read partition — the very next row down.
    const waiting = [unreadAt('old-unread', t('02:00')), queuedUnread];
    expect(ids(sortOutputs(waiting, { sortKey: 'attention' }))).toEqual(['old-unread', 'queued']);
  });

  it('THE BUG: the old write let it fall back to its original position', () => {
    // Regression control. Under the previous shape the row was unread at the
    // top of the list, and the click that read it dropped it to the bottom —
    // out from under the cursor that had just reached it.
    const legacyQueued = sortOutputs([...neighbours, legacyUnread], { sortKey: 'updated_at' });
    expect(ids(legacyQueued)[0]).not.toBe('queued');

    const legacyOpened = sortOutputs([...neighbours, legacyRead], { sortKey: 'attention' });
    expect(ids(legacyOpened).at(-1)).toBe('queued');

    // The same two steps under the current shape keep it where it was put.
    expect(ids(sortOutputs([...neighbours, queuedRead], { sortKey: 'attention' }))[0]).toBe('queued');
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

  it('labels the attention mode "Unread"', () => {
    // "Needs you" named a card that no longer exists. The mode does exactly
    // one describable thing — unread first — so it says that.
    expect(source).toMatch(/<span>Unread<\/span>/);
    expect(source).not.toMatch(/>Needs you</);
  });

  it('exposes a one-click clear for the unread set', () => {
    // Unread is a queue; a queue with no drain is a guilt generator.
    //
    // Assert the CLICK WIRING, not the bare name: 'markAllUnreadRead' also
    // appears in the function definition and the setup() return, so deleting
    // the button entirely would leave a name-only assertion green. A negative
    // control caught exactly that. The handler attribute exists in one place.
    expect(source).toMatch(/@click\.stop="markAllUnreadRead"/);
    expect(source).toContain('contentOutputs/markAllRead');
  });

  it('shows how many are waiting without a separate card', () => {
    // The count was the one piece of information the card carried that the
    // list itself cannot express. It moved to a badge on the button.
    //
    // Assert the rendered binding: the class name alone also matches the
    // <style> rule, so it survives deleting the element it styles.
    expect(source).toMatch(/class="sort-unread-count">\{\{ unreadConversations\.length \}\}/);
  });

  it('does NOT re-introduce a pinned duplicate of the unread rows', () => {
    // THE REGRESSION THIS FILE NOW EXISTS TO PREVENT. A "Needs you" card
    // above the groups rendered the same conversations the Unread sort
    // already lifts to the top — the same row, twice, in one panel, a few
    // pixels apart. Two copies means two click targets, two pieces of state
    // that can disagree, and permanent vertical cost for zero new
    // information. The list IS the queue.
    expect(source).not.toContain('triage-rail');
    expect(source).not.toContain('triage-item');
    // A second v-for over an unread-only collection is the shape of the
    // mistake, whatever it ends up being called.
    expect(source).not.toMatch(/v-for="output in (needsYou|unreadConversations)"/);
  });

  it('has no orphaned rail machinery left behind', () => {
    // The age labels were the rail's alone, and their 60s repaint timer with
    // them. Dead timers are how a component quietly keeps costing.
    expect(source).not.toContain('formatAgeLabel');
    expect(source).not.toContain('ageTick');
    expect(source).not.toContain('triage-age');
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
