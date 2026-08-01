/**
 * The retention window exists for live renderers, not for installers. If this
 * hook stops running, every packaged build silently carries a week of dead
 * chunks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pruneRetiredAssets } from './prune-retired-assets.js';

describe('pruneRetiredAssets', () => {
  let dist;
  let ledgerFile;
  const log = () => {};

  const write = (rel, body = 'x') => {
    const full = path.join(dist, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    return full;
  };

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-prune-'));
    ledgerFile = path.join(dist, '.asset-retention.json');
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('removes exactly the retired files and nothing else', () => {
    write('assets/js/current.NEWNEWNE.js');
    write('assets/js/retired.OLDOLDOL.js');
    write('assets/icons/chevron.svg');
    write('index.html');
    fs.writeFileSync(ledgerFile, JSON.stringify({ 'assets/js/retired.OLDOLDOL.js': 1 }));

    const { removed } = pruneRetiredAssets({ dist, ledgerFile, log });

    expect(removed).toEqual(['assets/js/retired.OLDOLDOL.js']);
    expect(fs.existsSync(path.join(dist, 'assets/js/retired.OLDOLDOL.js'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'assets/js/current.NEWNEWNE.js'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'assets/icons/chevron.svg'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'index.html'))).toBe(true);
  });

  it('empties the ledger so a re-pack is a no-op', () => {
    write('assets/js/retired.OLDOLDOL.js');
    fs.writeFileSync(ledgerFile, JSON.stringify({ 'assets/js/retired.OLDOLDOL.js': 1 }));

    pruneRetiredAssets({ dist, ledgerFile, log });
    expect(JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))).toEqual({});

    const second = pruneRetiredAssets({ dist, ledgerFile, log });
    expect(second.removed).toEqual([]);
  });

  it('is a no-op when there is no ledger (fresh clone, first build)', () => {
    expect(() => pruneRetiredAssets({ dist, ledgerFile, log })).not.toThrow();
  });

  it('survives a corrupt ledger without destroying the build', () => {
    write('assets/js/current.NEWNEWNE.js');
    fs.writeFileSync(ledgerFile, '{not json');

    const { removed } = pruneRetiredAssets({ dist, ledgerFile, log });

    expect(removed).toEqual([]);
    expect(fs.existsSync(path.join(dist, 'assets/js/current.NEWNEWNE.js'))).toBe(true);
  });

  it('refuses to follow a ledger entry that escapes dist', () => {
    // The key and the victim file must be the SAME path, or the test passes
    // for the wrong reason.
    const key = `../escape-${path.basename(dist)}.js`;
    const outside = path.join(dist, key);
    fs.writeFileSync(outside, 'do not delete me');
    expect(fs.existsSync(outside)).toBe(true);
    fs.writeFileSync(ledgerFile, JSON.stringify({ [key]: 1 }));

    try {
      const { removed } = pruneRetiredAssets({ dist, ledgerFile, log });
      expect(removed).toEqual([]);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('is wired as a beforePack hook, so every target gets it', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'package.json'), 'utf8'),
    );
    expect(pkg.build.beforePack).toBe('./scripts/prune-retired-assets.js');
  });
});
