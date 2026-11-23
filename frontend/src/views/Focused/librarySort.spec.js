import { describe, it, expect, beforeEach } from 'vitest';
import { librarySortsFor, sortLibraryRows, libraryMeta, readLibrarySort, saveLibrarySort } from './librarySort.js';
import { libraryRows } from './focusedModel.js';

const NOW = Date.parse('2026-11-22T12:00:00');
const workflows = [
  { id: 'w1', name: 'Brief', created_at: '2026-01-01 09:00:00', updated_at: '2026-11-20 12:00:00' },
  { id: 'w2', name: 'Archive', created_at: '2026-06-01 09:00:00', updated_at: '2026-06-02 09:00:00' },
  { id: 'w3', name: 'Chase' },
];

describe('ordering the Library', () => {
  beforeEach(() => localStorage.clear());

  it('reads the server’s dates off each row', () => {
    const [archive] = libraryRows('workflows', workflows);
    expect(archive.label).toBe('Archive');
    expect(archive.createdAt).toBe(Date.parse('2026-06-01T09:00:00'));
    expect(archive.updatedAt).toBe(Date.parse('2026-06-02T09:00:00'));
  });

  it('offers only the orders the rows support', () => {
    expect(librarySortsFor(libraryRows('workflows', workflows)).map(([v]) => v)).toEqual(['name', 'recent', 'newest']);
    // Agents carry no dates, but they do carry credits used.
    expect(librarySortsFor(libraryRows('agents', [{ id: 'a1', name: 'Scout', creditsUsed: 4 }])).map(([v]) => v)).toEqual(['name', 'used']);
    expect(librarySortsFor(libraryRows('agents', [{ id: 'a1', name: 'Scout' }])).map(([v]) => v)).toEqual(['name']);
  });

  it('sorts by name, recently changed and newest, undated last', () => {
    const rows = libraryRows('workflows', workflows);
    expect(sortLibraryRows(rows, 'name').map((r) => r.label)).toEqual(['Archive', 'Brief', 'Chase']);
    expect(sortLibraryRows(rows, 'recent').map((r) => r.label)).toEqual(['Brief', 'Archive', 'Chase']);
    expect(sortLibraryRows(rows, 'newest').map((r) => r.label)).toEqual(['Archive', 'Brief', 'Chase']);
    expect(rows.map((r) => r.label)).toEqual(['Archive', 'Brief', 'Chase']);
  });

  it('describes a card by its tools and when it last changed', () => {
    const [agent] = libraryRows('agents', [{ id: 'a1', name: 'Scout', assignedTools: ['a', 'b'] }]);
    expect(libraryMeta(agent, NOW)).toBe('2 tools');
    const brief = libraryRows('workflows', workflows).find((r) => r.label === 'Brief');
    expect(libraryMeta(brief, NOW)).toBe('Changed 2 days ago');
  });

  it('remembers the order picked, falling back to Name where it does not apply', () => {
    saveLibrarySort('recent');
    expect(readLibrarySort(libraryRows('workflows', workflows))).toBe('recent');
    expect(readLibrarySort(libraryRows('agents', [{ id: 'a1', name: 'Scout' }]))).toBe('name');
  });
});
