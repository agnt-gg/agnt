import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMissingPackages, verifyDeps } from './verifyDeps.js';

const lockWith = (packages) => ({ lockfileVersion: 3, packages: { '': {}, ...packages } });

describe('findMissingPackages', () => {
  it('flags a package the lockfile requires but disk lacks', () => {
    const lock = lockWith({
      'node_modules/vue': {},
      'node_modules/@babel/core': { dev: true },
    });
    const onDisk = new Set(['node_modules/vue']);
    expect(findMissingPackages(lock, (p) => onDisk.has(p))).toEqual(['@babel/core']);
  });

  it('does NOT flag platform-skipped optional packages (npm omits them correctly)', () => {
    const lock = lockWith({
      'node_modules/@esbuild/linux-x64': { optional: true },
      'node_modules/fsevents': { dev: true, optional: true },
      'node_modules/@rollup/rollup-darwin-arm64': { devOptional: true },
    });
    expect(findMissingPackages(lock, () => false)).toEqual([]);
  });

  it('does NOT flag workspace links or the root entry', () => {
    const lock = lockWith({
      'node_modules/my-workspace-pkg': { link: true, resolved: '../somewhere' },
    });
    expect(findMissingPackages(lock, () => false)).toEqual([]);
  });

  it('dev (non-optional) packages ARE required — the build needs them', () => {
    const lock = lockWith({ 'node_modules/vite': { dev: true } });
    expect(findMissingPackages(lock, () => false)).toEqual(['vite']);
  });
});

describe('verifyDeps (against a real directory)', () => {
  const makeFixture = (lock, presentDirs) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-deps-'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    for (const d of presentDirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
    return dir;
  };

  it('passes silently on a tree that matches the lockfile', () => {
    const dir = makeFixture(lockWith({ 'node_modules/vue': {} }), ['node_modules/vue']);
    expect(() => verifyDeps(dir)).not.toThrow();
  });

  it('throws a self-naming error listing the missing package and the fix command', () => {
    const dir = makeFixture(lockWith({ 'node_modules/@babel/core': { dev: true } }), []);
    expect(() => verifyDeps(dir)).toThrow(/@babel\/core/);
    expect(() => verifyDeps(dir)).toThrow(/npm --prefix frontend ci/);
    expect(() => verifyDeps(dir)).toThrow(/another session or worktree/);
  });

  it('is silent when there is no lockfile at all — that is npm\u2019s complaint, not ours', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-deps-nolock-'));
    expect(() => verifyDeps(dir)).not.toThrow();
  });
});
