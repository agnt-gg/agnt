import { describe, it, expect } from 'vitest';
import { fileCard, sortFileItems, FILE_SORTS, newFilePath } from './focusedFiles.js';

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

describe('New file', () => {
  it('lands in the folder the user is in', () => {
    expect(newFilePath('', 'notes.md')).toBe('notes.md');
    expect(newFilePath('reports/q3', ' plan.md ')).toBe('reports/q3/plan.md');
    expect(newFilePath('/reports//q3/', 'plan.md')).toBe('reports/q3/plan.md');
  });
  it('takes a file name, never a path out of the folder', () => {
    expect(() => newFilePath('a', '')).toThrow('Give the file a name.');
    expect(() => newFilePath('a', '   ')).toThrow('Give the file a name.');
    for (const bad of ['../x.md', 'b/x.md', 'b\\x.md', '..', '.']) expect(() => newFilePath('a', bad), bad).toThrow('Use a file name, not a folder path.');
    for (const bad of ['a:b', 'x?.md', 'x*.md', 'x|y', 'x<y', 'x"y']) expect(() => newFilePath('', bad), bad).toThrow(/can.t contain/);
  });
});

describe('a file or folder as a Library card', () => {
  const ago = () => '2 days ago';
  it('names the kind, colours the tile, and gives size and last change', () => {
    expect(fileCard({ type: 'directory', name: 'Reports', path: 'Reports', modifiedAt: 1 }, ago)).toEqual({ kind: 'Folder', hue: 3, meta: 'Changed 2 days ago' });
    expect(fileCard({ type: 'file', name: 'Q3 plan.pdf', path: 'Q3 plan.pdf', size: 2048 }, ago)).toEqual({ kind: 'PDF', hue: 4, meta: '2.0 KB' });
    expect(fileCard({ type: 'file', name: 'hero.png', path: 'hero.png', size: 10, modifiedAt: 1 }, ago)).toMatchObject({ kind: 'Image', hue: 2, meta: '10 B · Changed 2 days ago' });
    // Everyday names for office files; anything else reads by its extension; no extension is a document.
    expect(fileCard({ type: 'file', name: 'Pricing.xlsx', path: 'Pricing.xlsx' }, ago).kind).toBe('Spreadsheet');
    expect(fileCard({ type: 'file', name: 'Plan.docx', path: 'Plan.docx' }, ago).kind).toBe('Word document');
    expect(fileCard({ type: 'file', name: 'scene.blend', path: 'scene.blend' }, ago).kind).toBe('BLEND file');
    expect(fileCard({ type: 'file', name: 'README', path: 'README' }, ago).kind).toBe('Document');
  });
});
