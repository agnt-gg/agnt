import { describe, it, expect } from 'vitest';
import { sortItems, breadcrumbs, formatSize, formatAge, invalidName, kindOf, kindLabel, joinPath, parentOf, readLayout, writeLayout } from './filesBrowser.js';

const items = [
  { name: 'b.md', type: 'file', modifiedAt: 300 },
  { name: 'z-folder', type: 'directory', modifiedAt: 100 },
  { name: 'a.html', type: 'file', modifiedAt: 500 },
  { name: 'a-folder', type: 'directory', modifiedAt: 50 },
  { name: 'file10.txt', type: 'file' },
  { name: 'file2.txt', type: 'file' },
];

describe('files grid helpers', () => {
  it('keeps folders first, newest first by default, and never mutates', () => {
    const copy = JSON.stringify(items);
    expect(sortItems(items).map((i) => i.name)).toEqual(['z-folder', 'a-folder', 'a.html', 'b.md', 'file2.txt', 'file10.txt']);
    expect(sortItems(items, 'name').map((i) => i.name)).toEqual(['a-folder', 'z-folder', 'a.html', 'b.md', 'file2.txt', 'file10.txt']);
    expect(JSON.stringify(items)).toBe(copy);
  });

  it('builds breadcrumbs from a relative path', () => {
    expect(breadcrumbs('a/b')).toEqual([
      { name: 'Workspace', path: '' },
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ]);
    expect(breadcrumbs('')).toEqual([{ name: 'Workspace', path: '' }]);
  });

  it('formats sizes and ages compactly', () => {
    expect([formatSize(0), formatSize(1536), formatSize(5 * 1024 * 1024), formatSize(undefined)]).toEqual(['0 B', '1.5 KB', '5.0 MB', '']);
    const now = 10 * 86400e3;
    expect([formatAge(now - 30e3, now), formatAge(now - 7200e3, now), formatAge(now - 2 * 86400e3, now), formatAge(NaN, now)]).toEqual(['just now', '2h ago', '2d ago', '']);
  });

  it('rejects names the filesystem or the folder would refuse', () => {
    expect(invalidName('  ')).toBe('Enter a name.');
    expect(invalidName('a/b')).toMatch(/cannot contain/);
    expect(invalidName('..')).toMatch(/reserved/);
    expect(invalidName('A.HTML', items)).toMatch(/already exists/);
    expect(invalidName('new.md', items)).toBe('');
  });

  it('classifies and joins', () => {
    expect([kindOf({ type: 'directory', name: 'x' }), kindOf({ type: 'file', name: 'x.png' }), kindOf({ type: 'file', name: 'x.js' })]).toEqual(['directory', 'image', 'text']);
    expect([joinPath('', 'a'), joinPath('d', 'a')]).toEqual(['a', 'd/a']);
    expect([parentOf('a'), parentOf('d/e/a')]).toEqual(['', 'd/e']);
  });

  it('names every kind in words for the list view', () => {
    expect([kindLabel({ type: 'directory', name: 'x' }), kindLabel({ type: 'file', name: 'x.pdf' }), kindLabel({ type: 'file', name: 'x.md' })]).toEqual(['Folder', 'PDF', 'Document']);
  });

  it('remembers grid or list, and falls back to grid on anything else', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(readLayout(storage)).toBe('grid');
    writeLayout('list', storage);
    expect(readLayout(storage)).toBe('list');
    writeLayout('table', storage); // not a Files layout: ignored
    expect(readLayout(storage)).toBe('list');
    store.set('agnt.files.layout', 'garbage');
    expect(readLayout(storage)).toBe('grid');
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readLayout(blocked)).toBe('grid');
    expect(() => writeLayout('list', blocked)).not.toThrow();
  });
});
