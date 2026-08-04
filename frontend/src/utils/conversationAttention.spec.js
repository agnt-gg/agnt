/**
 * Derived unread + archive semantics — the invariants the sidebar's
 * attention system stands on. See conversationAttention.js for the model.
 */

import { describe, it, expect } from 'vitest';
import { isUnread, unreadIdSet, triageRail, formatAge, groupUnreadCount } from './conversationAttention.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Fixed "now" so every assertion is deterministic.
const NOW = Date.parse('2026-08-04T12:00:00Z');

function output(overrides = {}) {
  return {
    id: 'out-1',
    updated_at: new Date(NOW - HOUR),
    last_read_at: new Date(NOW - MIN),
    archived_at: null,
    group_id: null,
    ...overrides,
  };
}

// An unread conversation: it HAS a watermark and a later change overtook it.
// `age` controls how long it has been waiting, for the rail's ordering.
function unreadOutput(overrides = {}, age = 0) {
  return output({
    updated_at: new Date(NOW - age),
    last_read_at: new Date(NOW - age - HOUR),
    ...overrides,
  });
}

describe('isUnread', () => {
  it('read after the last change → not unread', () => {
    expect(isUnread(output())).toBe(false);
  });

  it('changed after the last read → unread', () => {
    expect(isUnread(output({
      updated_at: new Date(NOW),
      last_read_at: new Date(NOW - HOUR),
    }))).toBe(true);
  });

  it('NO watermark → NOT unread — the defect that put a whole history in the rail', () => {
    // REGRESSION GUARD. This clause used to return true, so every
    // conversation predating the last_read_at column counted as "needs you".
    // Measured on a live install: 1624 of 1649 conversations in the rail.
    // Unread requires POSITIVE evidence: a watermark a later change overtook.
    expect(isUnread(output({ last_read_at: null }))).toBe(false);
    expect(isUnread(output({ last_read_at: undefined }))).toBe(false);
    expect(isUnread(output({ last_read_at: '' }))).toBe(false);
  });

  it('a legacy row stays quiet however old the change is', () => {
    // No watermark and a change from a year ago is not "waiting on you" — it
    // is a conversation from before the feature existed.
    expect(isUnread(output({ updated_at: new Date(NOW - 365 * DAY), last_read_at: null }))).toBe(false);
  });

  it('manual mark-unread is a watermark just before the change, and IS unread', () => {
    // How the server represents "Mark as Unread": read up to one second
    // before the last change. It must derive unread through the same single
    // predicate as everything else — no NULL, no sentinel, no special case.
    const updated = new Date(NOW - 3 * DAY);
    expect(isUnread(output({
      updated_at: updated,
      last_read_at: new Date(updated.getTime() - 1000),
    }))).toBe(true);
  });

  it('the epoch is a real watermark, not an absent one', () => {
    // parseServerTime collapses both "absent" and "the epoch" to 0. Reading
    // the parsed value instead of the raw one would make a row watermarked at
    // the epoch silently quiet.
    expect(isUnread(output({ last_read_at: new Date(0) }))).toBe(true);
    expect(isUnread(output({ last_read_at: '1970-01-01 00:00:00' }))).toBe(true);
  });

  it('archived is never unread, even when a change overtook the watermark', () => {
    expect(isUnread(unreadOutput({ archived_at: new Date(NOW) }))).toBe(false);
  });

  it('accepts naive server strings, not just Dates (boundary conversion may not have run)', () => {
    expect(isUnread(output({
      updated_at: '2026-08-04 11:00:00',
      last_read_at: '2026-08-04 10:00:00',
    }))).toBe(true);
    expect(isUnread(output({
      updated_at: '2026-08-04 10:00:00',
      last_read_at: '2026-08-04 11:00:00',
    }))).toBe(false);
  });

  it('null/undefined output → false, never a throw', () => {
    expect(isUnread(null)).toBe(false);
    expect(isUnread(undefined)).toBe(false);
  });
});

describe('unreadIdSet', () => {
  it('collects exactly the unread ids', () => {
    const set = unreadIdSet([
      output({ id: 'read' }),
      output({ id: 'no-watermark', last_read_at: null }),
      unreadOutput({ id: 'unread' }),
      unreadOutput({ id: 'archived', archived_at: new Date(NOW) }),
    ]);
    expect(set).toEqual(new Set(['unread']));
  });

  it('empty/null input → empty set', () => {
    expect(unreadIdSet([])).toEqual(new Set());
    expect(unreadIdSet(null)).toEqual(new Set());
  });
});

describe('triageRail', () => {
  it('returns only unread, sorted OLDEST first — the buried-conversation fix', () => {
    const rail = triageRail([
      unreadOutput({ id: 'newest' }, HOUR),
      output({ id: 'read' }),
      unreadOutput({ id: 'oldest' }, 3 * DAY),
      unreadOutput({ id: 'middle' }, DAY),
    ]);
    expect(rail.map((o) => o.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('holds only what actually needs attention, not the whole history', () => {
    // The shape of a real install after the fix: a long tail of conversations
    // that were never opened since the column shipped, and one thing waiting.
    const history = Array.from({ length: 200 }, (_, i) =>
      output({ id: `legacy-${i}`, updated_at: new Date(NOW - i * DAY), last_read_at: null }));
    const rail = triageRail([...history, unreadOutput({ id: 'waiting' }, DAY)]);
    expect(rail.map((o) => o.id)).toEqual(['waiting']);
  });

  it('does not mutate its input', () => {
    const list = [
      unreadOutput({ id: 'b' }, MIN),
      unreadOutput({ id: 'a' }, HOUR),
    ];
    triageRail(list);
    expect(list.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('formatAge', () => {
  it('buckets: now / minutes / hours / days', () => {
    expect(formatAge(new Date(NOW - 30 * 1000), NOW)).toBe('now');
    expect(formatAge(new Date(NOW - 5 * MIN), NOW)).toBe('5m');
    expect(formatAge(new Date(NOW - 59 * MIN), NOW)).toBe('59m');
    expect(formatAge(new Date(NOW - HOUR), NOW)).toBe('1h');
    expect(formatAge(new Date(NOW - 23 * HOUR), NOW)).toBe('23h');
    expect(formatAge(new Date(NOW - DAY), NOW)).toBe('1d');
    expect(formatAge(new Date(NOW - 12 * DAY), NOW)).toBe('12d');
  });

  it('clock skew (future timestamp) clamps to "now", never negative', () => {
    expect(formatAge(new Date(NOW + HOUR), NOW)).toBe('now');
  });

  it('unparseable input → empty string', () => {
    expect(formatAge(null, NOW)).toBe('');
    expect(formatAge('not a date', NOW)).toBe('');
  });
});

describe('groupUnreadCount', () => {
  const outputs = [
    unreadOutput({ id: '1', group_id: 'g1' }),
    output({ id: '2', group_id: 'g1' }), // read
    unreadOutput({ id: '3', group_id: 'g2' }),
    unreadOutput({ id: '4', group_id: 'g3' }), // outside the set
    unreadOutput({ id: '5', group_id: null }), // ungrouped
    unreadOutput({ id: '6', group_id: 'g1', archived_at: new Date(NOW) }),
    output({ id: '7', group_id: 'g1', last_read_at: null }), // no watermark
  ];

  it('counts unread inside the id set only (descendant rollup shape)', () => {
    expect(groupUnreadCount(outputs, new Set(['g1', 'g2']))).toBe(2);
    expect(groupUnreadCount(outputs, new Set(['g1']))).toBe(1);
    expect(groupUnreadCount(outputs, new Set(['g-empty']))).toBe(0);
  });

  it('archived and ungrouped conversations never count', () => {
    expect(groupUnreadCount(outputs, new Set(['g1', 'g2', 'g3']))).toBe(3);
  });
});
