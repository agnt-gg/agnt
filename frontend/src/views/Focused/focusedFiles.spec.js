import { describe, it, expect } from 'vitest';
import { sortFileItems, FILE_SORTS } from './focusedFiles.js';

const listing = [
  { name: 'b.md', type: 'file', modifiedAt: '2026-01-02T00:00:00Z' },
  { name: 'src', type: 'directory', modifiedAt: '2025-06-01T00:00:00Z' },
  { name: 'a10.txt', type: 'file', modifiedAt: '2026-03-01T00:00:00Z' },
  { name: 'A2.txt', type: 'file' },
  { name: 'assets', type: 'directory', modifiedAt: '2026-05-01T00:00:00Z' },
];
const names = (items) => items.map((i) => i.name);

describe('Files sort', () => {
  it('offers name and date', () => {
    expect(FILE_SORTS.map(([v]) => v)).toEqual(['name', 'date']);
  });

  it('by name: folders first, case-insensitive, numbers in number order', () => {
    expect(names(sortFileItems(listing, 'name'))).toEqual(['assets', 'src', 'A2.txt', 'a10.txt', 'b.md']);
  });

  it('by date: folders first, newest first, undated last', () => {
    expect(names(sortFileItems(listing, 'date'))).toEqual(['assets', 'src', 'a10.txt', 'b.md', 'A2.txt']);
  });

  it('accepts epoch ms and leaves the given listing untouched', () => {
    const input = [{ name: 'old', type: 'file', modifiedAt: 1 }, { name: 'new', type: 'file', modifiedAt: 2 }];
    expect(names(sortFileItems(input, 'date'))).toEqual(['new', 'old']);
    expect(names(input)).toEqual(['old', 'new']);
  });

  it('is safe on nothing', () => {
    expect(sortFileItems(null)).toEqual([]);
    expect(sortFileItems([null, { name: 'x', type: 'file' }])).toHaveLength(1);
  });
});
