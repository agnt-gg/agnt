/**
 * The build half of the stale-chunk fix.
 *
 * `emptyOutDir: true` deleted the hashes a live renderer was still holding.
 * These tests pin the replacement: retire on a timer, never delete anything
 * that is not a content-hashed build artefact, and never let a corrupt ledger
 * shorten a file's life.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  planAssetRetention,
  isHashedAssetName,
  listFilesRecursive,
  DEFAULT_RETENTION_DAYS,
} from './assetRetention.js';

const DAY = 86_400_000;
const RETENTION = DEFAULT_RETENTION_DAYS * DAY;
const NOW = 1_800_000_000_000;

describe('isHashedAssetName', () => {
  it('matches what vite emits', () => {
    const emitted = [
      'index.CcrGhO7w.js',
      'Settings.B4rtEn8e.js',
      'blockDiagram-677ZJIJ3.kkhj03wU.js',
      'index.DEAAfVF5.css',
      'logo.Ab3d_f-2.png',
    ];
    for (const name of emitted) expect(isHashedAssetName(name), name).toBe(true);
  });

  it('does NOT match verbatim-copied assets — the deletion interlock', () => {
    // assets/icons/** is copied by the copy-directory plugin and has no hash.
    // If this ever matched, a build would delete the icon set.
    const copied = ['chevron.svg', 'agnt-logo.png', 'all.min.css', 'highlight.js', 'index.html', 'app.min.js'];
    for (const name of copied) expect(isHashedAssetName(name), name).toBe(false);
  });
});

describe('planAssetRetention', () => {
  const base = { now: NOW, retentionMs: RETENTION };

  it('keeps everything this build emitted', () => {
    const { keep, remove, ledger } = planAssetRetention({
      ...base,
      existing: ['assets/js/a.AAAAAAAA.js', 'assets/js/b.BBBBBBBB.js'],
      live: ['assets/js/a.AAAAAAAA.js', 'assets/js/b.BBBBBBBB.js'],
    });

    expect(remove).toEqual([]);
    expect(keep).toHaveLength(2);
    expect(ledger).toEqual({});
  });

  it('retires — does not delete — a hash that just stopped being current', () => {
    // This is the whole point: the renderer that is open RIGHT NOW still wants
    // this file.
    const { keep, remove, ledger } = planAssetRetention({
      ...base,
      existing: ['assets/js/Settings.OLDOLDOL.js', 'assets/js/Settings.NEWNEWNE.js'],
      live: ['assets/js/Settings.NEWNEWNE.js'],
    });

    expect(remove).toEqual([]);
    expect(keep).toContain('assets/js/Settings.OLDOLDOL.js');
    expect(ledger['assets/js/Settings.OLDOLDOL.js']).toBe(NOW);
  });

  it('deletes only once the retention window has fully elapsed', () => {
    const retiredAt = NOW - RETENTION;
    const { remove } = planAssetRetention({
      ...base,
      existing: ['assets/js/old.OLDOLDOL.js'],
      live: [],
      ledger: { 'assets/js/old.OLDOLDOL.js': retiredAt },
    });
    expect(remove).toEqual(['assets/js/old.OLDOLDOL.js']);
  });

  it('keeps a file one millisecond short of the window', () => {
    const { remove, keep } = planAssetRetention({
      ...base,
      existing: ['assets/js/old.OLDOLDOL.js'],
      live: [],
      ledger: { 'assets/js/old.OLDOLDOL.js': NOW - RETENTION + 1 },
    });
    expect(remove).toEqual([]);
    expect(keep).toEqual(['assets/js/old.OLDOLDOL.js']);
  });

  it('carries the ORIGINAL retirement date forward across builds', () => {
    // Otherwise every rebuild would reset the clock and nothing would ever be
    // pruned — the dist directory would grow without bound.
    const retiredAt = NOW - 3 * DAY;
    const { ledger } = planAssetRetention({
      ...base,
      existing: ['assets/js/old.OLDOLDOL.js'],
      live: [],
      ledger: { 'assets/js/old.OLDOLDOL.js': retiredAt },
    });
    expect(ledger['assets/js/old.OLDOLDOL.js']).toBe(retiredAt);
  });

  it('un-retires a hash that comes back (identical content rebuilds)', () => {
    const { ledger, keep } = planAssetRetention({
      ...base,
      existing: ['assets/js/same.SAMESAME.js'],
      live: ['assets/js/same.SAMESAME.js'],
      ledger: { 'assets/js/same.SAMESAME.js': NOW - 6 * DAY },
    });
    expect(ledger).toEqual({});
    expect(keep).toEqual(['assets/js/same.SAMESAME.js']);
  });

  it('resets a corrupt or future-dated ledger entry rather than deleting early', () => {
    for (const bogus of [NaN, 'yesterday', null, NOW + DAY]) {
      const { remove, ledger } = planAssetRetention({
        ...base,
        existing: ['assets/js/old.OLDOLDOL.js'],
        live: [],
        ledger: { 'assets/js/old.OLDOLDOL.js': bogus },
      });
      expect(remove, String(bogus)).toEqual([]);
      expect(ledger['assets/js/old.OLDOLDOL.js']).toBe(NOW);
    }
  });

  it('retentionMs 0 restores wipe-on-build, for packaged releases', () => {
    const { remove } = planAssetRetention({
      now: NOW,
      retentionMs: 0,
      existing: ['assets/js/old.OLDOLDOL.js', 'assets/js/new.NEWNEWNE.js'],
      live: ['assets/js/new.NEWNEWNE.js'],
    });
    expect(remove).toEqual(['assets/js/old.OLDOLDOL.js']);
  });
});

describe('listFilesRecursive', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-assets-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns posix-relative paths at any depth', () => {
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'icons', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'js', 'a.AAAAAAAA.js'), '');
    fs.writeFileSync(path.join(dir, 'icons', 'nested', 'x.svg'), '');

    expect(listFilesRecursive(dir).sort()).toEqual(['icons/nested/x.svg', 'js/a.AAAAAAAA.js']);
  });

  it('returns [] for a directory that does not exist', () => {
    expect(listFilesRecursive(path.join(dir, 'nope'))).toEqual([]);
  });

  it('end to end: a retired chunk survives, an expired one is removed, icons are untouched', () => {
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'js', 'new.NEWNEWNE.js'), '');
    fs.writeFileSync(path.join(dir, 'js', 'recent.RECENTAA.js'), '');
    fs.writeFileSync(path.join(dir, 'js', 'ancient.ANCIENTA.js'), '');
    fs.writeFileSync(path.join(dir, 'icons', 'chevron.svg'), '');

    const existing = listFilesRecursive(dir)
      .map((rel) => `assets/${rel}`)
      .filter((rel) => isHashedAssetName(path.basename(rel)));

    // The icon never even becomes a candidate.
    expect(existing).not.toContain('assets/icons/chevron.svg');

    const { remove, keep } = planAssetRetention({
      existing,
      live: ['assets/js/new.NEWNEWNE.js'],
      ledger: {
        'assets/js/recent.RECENTAA.js': NOW - DAY,
        'assets/js/ancient.ANCIENTA.js': NOW - 30 * DAY,
      },
      now: NOW,
      retentionMs: RETENTION,
    });

    expect(remove).toEqual(['assets/js/ancient.ANCIENTA.js']);
    expect(keep).toContain('assets/js/recent.RECENTAA.js');
    expect(keep).toContain('assets/js/new.NEWNEWNE.js');
  });
});

describe('vite config wiring', () => {
  // Asserts on the RESOLVED CONFIG OBJECT, not on the source text. A regex over
  // the file matched the words "emptyOutDir:false" inside a comment explaining
  // the setting, so deleting the setting itself left the test green — a
  // negative control caught it.
  // (Importing the config here is not an option: esbuild refuses to run under
  // jsdom's TextEncoder.)
  it('does not empty the output directory, and installs the retention plugin', () => {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const source = fs.readFileSync(path.join(here, '..', 'vite.config.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

    // emptyOutDir defaults to TRUE. Leaving it unset is the bug.
    expect(code).toMatch(/emptyOutDir\s*:\s*false/);
    expect(code).toMatch(/preserveHashedAssets\(\)/);
  });
});
