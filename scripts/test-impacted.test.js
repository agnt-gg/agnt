/**
 * The selection policy of scripts/test-impacted.mjs. The runner itself is
 * vitest; what this file pins is the decision of WHAT to hand it, because a
 * wrong decision here is a green run that proved nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectChangedFiles, plan, resolveBase } from './test-impacted.mjs';

vi.setConfig({ testTimeout: 60_000 });

describe('plan', () => {
  it('hands module files to `related`, split by side', () => {
    const p = plan({ present: ['backend/src/utils/gitAttributes.js', 'frontend/src/utils/agentAvatar.js'], deleted: [] });
    expect(p.backend).toEqual({ mode: 'related', files: ['backend/src/utils/gitAttributes.js'], reasons: [] });
    expect(p.frontend).toEqual({ mode: 'related', files: ['frontend/src/utils/agentAvatar.js'], reasons: [] });
  });

  it('leaves an untouched side alone', () => {
    const p = plan({ present: ['backend/src/x.js'], deleted: [] });
    expect(p.frontend.mode).toBe('skip');
  });

  it('runs everything on a side when a non-module file changed there', () => {
    // A contract test reads this with fs; the import graph cannot see it.
    const p = plan({ present: ['.github/workflows/test.yml', 'backend/src/x.js'], deleted: [] });
    expect(p.backend.mode).toBe('full');
    expect(p.backend.reasons).toEqual(['.github/workflows/test.yml is not a module']);
    expect(p.backend.files).toEqual([]);
    expect(p.frontend.mode).toBe('skip');
  });

  it('treats JSON as text, not as a module', () => {
    // toolLibrary.json is imported by some tests and fs-read by others; only
    // a full run covers both.
    const p = plan({ present: ['backend/src/tools/toolLibrary.json'], deleted: [] });
    expect(p.backend.mode).toBe('full');
  });

  it('runs everything when the runner itself is reconfigured', () => {
    for (const rel of ['vitest.config.js', 'package.json', 'tests/setup/isolate-data-dir.mjs']) {
      expect(plan({ present: [rel], deleted: [] }).backend.mode, rel).toBe('full');
    }
    for (const rel of ['frontend/vitest.config.js', 'frontend/vitest.setup.js', 'frontend/build/aliases.js']) {
      const p = plan({ present: [rel], deleted: [] });
      expect(p.frontend.mode, rel).toBe('full');
      expect(p.backend.mode, rel).toBe('skip');
    }
  });

  it('runs everything when a module was deleted — its importers are the tests that break', () => {
    const p = plan({ present: [], deleted: ['backend/src/utils/gone.js'] });
    expect(p.backend.mode).toBe('full');
    expect(p.backend.reasons).toEqual(['backend/src/utils/gone.js was deleted']);
  });

  it('a deleted non-module does not escalate', () => {
    expect(plan({ present: [], deleted: ['docs/old.md'] }).backend.mode).toBe('skip');
  });

  it('full wins over related on the same side', () => {
    const p = plan({ present: ['backend/src/a.js', 'vitest.config.js', 'backend/src/b.js'], deleted: [] });
    expect(p.backend.mode).toBe('full');
    expect(p.backend.files).toEqual([]);
  });
});

describe('collectChangedFiles', () => {
  let root;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-impacted-')));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.mkdirSync(path.join(root, 'backend', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backend', 'src', 'keep.js'), '1');
    fs.writeFileSync(path.join(root, 'backend', 'src', 'edit.js'), '1');
    fs.writeFileSync(path.join(root, 'backend', 'src', 'gone.js'), '1');
    fs.writeFileSync(path.join(root, 'backend', 'src', 'stage.js'), '1');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
    git(['checkout', '-q', '-b', 'feature']);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('unions committed, staged, unstaged and untracked changes against the merge-base', () => {
    fs.writeFileSync(path.join(root, 'backend', 'src', 'edit.js'), '2'); // committed on the branch
    git(['commit', '-q', '-am', 'edit']);
    fs.writeFileSync(path.join(root, 'backend', 'src', 'stage.js'), '2'); // staged
    git(['add', 'backend/src/stage.js']);
    fs.rmSync(path.join(root, 'backend', 'src', 'gone.js')); // unstaged delete
    fs.writeFileSync(path.join(root, 'backend', 'src', 'new.js'), '1'); // untracked

    const r = collectChangedFiles(root, 'main');
    expect(r.present).toEqual(['backend/src/edit.js', 'backend/src/new.js', 'backend/src/stage.js']);
    expect(r.deleted).toEqual(['backend/src/gone.js']);
  });

  it('does not count what main did after the branch point', () => {
    // main moves on; the branch did nothing. Judged against the merge-base,
    // the branch changed nothing — a diff against main's tip would say
    // otherwise and run tests for someone else's work.
    git(['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(root, 'backend', 'src', 'keep.js'), '2');
    git(['commit', '-q', '-am', 'main moved']);
    git(['checkout', '-q', 'feature']);

    const r = collectChangedFiles(root, 'main');
    expect(r.present).toEqual([]);
    expect(r.deleted).toEqual([]);
  });

  it('prefers origin/main, falls back to main, and refuses to guess further', () => {
    expect(resolveBase(root)).toBe('main');
    expect(resolveBase(root, 'feature')).toBe('feature');
    git(['branch', '-m', 'main', 'trunk']);
    expect(() => resolveBase(root)).toThrow(/--base/);
  });
});
