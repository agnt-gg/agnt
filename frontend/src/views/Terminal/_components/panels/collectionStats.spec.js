import { describe, it, expect } from 'vitest';
import { ageLabel, recentItems, statusIs } from './collectionStats.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');

describe('collectionStats', () => {
  it('labels ages compactly and says nothing for an unknown date', () => {
    expect(ageLabel(NOW - 30e3, NOW)).toBe('now');
    expect(ageLabel(NOW - 5 * 60e3, NOW)).toBe('5m');
    expect(ageLabel(NOW - 3 * 3600e3, NOW)).toBe('3h');
    expect(ageLabel(NOW - 2 * 86400e3, NOW)).toBe('2d');
    expect(ageLabel(undefined, NOW)).toBe('');
    expect(ageLabel('not a date', NOW)).toBe('');
  });

  it('lists the newest first, drops undated items, and caps the list', () => {
    const items = [
      { id: 'old', name: 'Old', at: '2026-09-01T00:00:00Z' },
      { id: 'none', name: 'Undated' },
      { id: 'new', name: 'New', at: '2026-09-24T11:00:00Z' },
      { id: 'mid', name: 'Mid', at: '2026-09-20T00:00:00Z' },
    ];
    const rows = recentItems(items, { date: (i) => i.at, label: (i) => i.name, limit: 2, now: NOW });
    expect(rows.map((r) => [r.id, r.meta])).toEqual([
      ['new', '1h'],
      ['mid', '4d'],
    ]);
  });

  it('matches status case-insensitively', () => {
    expect(statusIs({ status: 'ACTIVE' }, 'active')).toBe(true);
    expect(statusIs({ status: 'idle' }, 'active', 'listening')).toBe(false);
    expect(statusIs({}, 'active')).toBe(false);
  });
});
