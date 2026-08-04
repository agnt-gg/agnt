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

  it('never read (NULL watermark) → unread; this is also manual mark-unread', () => {
    expect(isUnread(output({ last_read_at: null }))).toBe(true);
  });

  it('archived is never unread, even with a NULL watermark', () => {
    expect(isUnread(output({ last_read_at: null, archived_at: new Date(NOW) }))).toBe(false);
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
      output({ id: 'unread', last_read_at: null }),
      output({ id: 'archived', last_read_at: null, archived_at: new Date(NOW) }),
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
      output({ id: 'newest', updated_at: new Date(NOW - HOUR), last_read_at: null }),
      output({ id: 'read' }),
      output({ id: 'oldest', updated_at: new Date(NOW - 3 * DAY), last_read_at: null }),
      output({ id: 'middle', updated_at: new Date(NOW - DAY), last_read_at: null }),
    ]);
    expect(rail.map((o) => o.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('does not mutate its input', () => {
    const list = [
      output({ id: 'b', updated_at: new Date(NOW - MIN), last_read_at: null }),
      output({ id: 'a', updated_at: new Date(NOW - HOUR), last_read_at: null }),
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
    output({ id: '1', group_id: 'g1', last_read_at: null }),
    output({ id: '2', group_id: 'g1' }), // read
    output({ id: '3', group_id: 'g2', last_read_at: null }),
    output({ id: '4', group_id: 'g3', last_read_at: null }), // outside the set
    output({ id: '5', group_id: null, last_read_at: null }), // ungrouped
    output({ id: '6', group_id: 'g1', last_read_at: null, archived_at: new Date(NOW) }),
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
