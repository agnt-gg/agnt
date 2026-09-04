/**
 * localFileResolve — a chat message's absolute path is a SNAPSHOT, and the
 * filesystem moves underneath it. These tests pin the recovery behaviour and,
 * just as importantly, the limits of it: recovery must never widen what the
 * caller was allowed to read, and must never guess from a basename alone.
 *
 * The headline case is real: a social card rendered from inside
 * `repos/agnt-server.wt/social-metadata/…` became unviewable the moment that
 * worktree was reaped, even though the committed file was sitting in the main
 * checkout the whole time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveLocalFile, clearResolveCache } from './localFileResolve.js';

let tmp;
const prevRoots = process.env.AGNT_LOCAL_FILE_ROOTS;

const write = (rel, body = 'bytes') => {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
};
const dead = (rel) => path.join(tmp, rel);

beforeEach(() => {
  delete process.env.AGNT_LOCAL_FILE_ROOTS;
  // realpath the tmp dir: macOS hands back /var/… which is a symlink to
  // /private/var, and assertWithinRoots compares real paths.
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lfr-'));
  clearResolveCache();
});

afterEach(() => {
  clearResolveCache();
  if (prevRoots === undefined) delete process.env.AGNT_LOCAL_FILE_ROOTS;
  else process.env.AGNT_LOCAL_FILE_ROOTS = prevRoots;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('tier 1 — the path as written', () => {
  it('returns the file untouched and reports an exact hit', () => {
    const real = write('repo/assets/card.png');
    expect(resolveLocalFile(real)).toEqual({ path: path.resolve(real), via: 'exact' });
  });

  it('does not mistake a directory for a file', () => {
    fs.mkdirSync(path.join(tmp, 'repo/assets'), { recursive: true });
    expect(resolveLocalFile(path.join(tmp, 'repo/assets'))).toBeNull();
  });
});

describe('tier 2 — a reaped git worktree', () => {
  it('THE BUG: recovers a card referenced from <repo>.wt/<slug> after the worktree is gone', () => {
    const real = write('repos/agnt-server/agnt.gg/public/assets/social/agnt-social-card.png');
    const stale = dead('repos/agnt-server.wt/social-metadata/agnt.gg/public/assets/social/agnt-social-card.png');

    expect(fs.existsSync(stale)).toBe(false);
    expect(resolveLocalFile(stale)).toEqual({ path: path.resolve(real), via: 'worktree' });
  });

  it('recovers the <repo>/.worktrees/<slug> layout too', () => {
    const real = write('agnt-pro/frontend/src/app.js');
    const stale = dead('agnt-pro/.worktrees/agnt-one/frontend/src/app.js');
    expect(resolveLocalFile(stale)).toEqual({ path: path.resolve(real), via: 'worktree' });
  });

  it('prefers the live worktree over the main checkout while it still exists', () => {
    write('repos/proj/notes.md', 'main');
    const inWorktree = write('repos/proj.wt/feature/notes.md', 'worktree');
    const hit = resolveLocalFile(inWorktree);
    expect(hit.via).toBe('exact');
    expect(fs.readFileSync(hit.path, 'utf8')).toBe('worktree');
  });
});

describe('tier 3 — the folder moved or was renamed', () => {
  it('finds the file under a renamed parent by matching trailing segments', () => {
    const real = write('client-acme-v2/assets/img/hero.png');
    const stale = dead('client-acme/assets/img/hero.png');
    expect(resolveLocalFile(stale)).toEqual({ path: path.resolve(real), via: 'search' });
  });

  it('picks the candidate sharing the LONGEST suffix when several match', () => {
    write('other/hero.png', 'shallow');
    const better = write('moved/assets/img/hero.png', 'deep');
    const stale = dead('original/assets/img/hero.png');
    const hit = resolveLocalFile(stale);
    expect(hit.path).toBe(path.resolve(better));
    expect(fs.readFileSync(hit.path, 'utf8')).toBe('deep');
  });

  it('finds a file reorganised into a sibling folder whose old directory still exists', () => {
    // The old directory survives, so the deepest-surviving-ancestor anchor
    // would start the search INSIDE it and miss. The lift is what covers this.
    const real = write('proj/static/img/hero.png');
    write('proj/assets/img/placeholder.txt');
    expect(fs.existsSync(path.join(tmp, 'proj/assets/img'))).toBe(true);

    expect(resolveLocalFile(dead('proj/assets/img/hero.png'))).toEqual({
      path: path.resolve(real),
      via: 'search',
    });
  });

  it('REFUSES a basename-only match — one shared segment is not evidence', () => {
    write('somewhere-else/report.pdf');
    expect(resolveLocalFile(dead('vanished/deeper/report.pdf'))).toBeNull();
  });

  it('returns null when the file is genuinely gone', () => {
    write('repo/other.png');
    expect(resolveLocalFile(dead('repo/assets/missing.png'))).toBeNull();
  });

  it('does not descend into node_modules', () => {
    write('proj/node_modules/pkg/assets/img/logo.png');
    expect(resolveLocalFile(dead('proj/gone/assets/img/logo.png'))).toBeNull();
  });
});

describe('recovery cannot widen what the caller may read', () => {
  it('never recovers a credential-shaped file', () => {
    write('repo/config/.env', 'JWT_SECRET=hunter2');
    expect(resolveLocalFile(dead('repo.wt/slug/config/.env'))).toBeNull();
  });

  it('never recovers a private key by suffix match', () => {
    write('deploy/keys/id_rsa', 'PRIVATE');
    expect(resolveLocalFile(dead('deploy-old/keys/id_rsa'))).toBeNull();
  });

  it('honours AGNT_LOCAL_FILE_ROOTS for the recovered path, not just the requested one', () => {
    const outside = write('outside/assets/img/secret-plan.png');
    const allowed = path.join(tmp, 'inside');
    fs.mkdirSync(allowed, { recursive: true });
    process.env.AGNT_LOCAL_FILE_ROOTS = allowed;

    expect(resolveLocalFile(dead('inside/assets/img/secret-plan.png'))).toBeNull();

    // …and the same lookup succeeds once that tree is in scope.
    clearResolveCache();
    process.env.AGNT_LOCAL_FILE_ROOTS = tmp;
    expect(resolveLocalFile(dead('inside/assets/img/secret-plan.png'))).toEqual({
      path: path.resolve(outside),
      via: 'search',
    });
  });
});

describe('caching', () => {
  it('a file that comes back resolves immediately despite a cached miss', () => {
    const stale = dead('repo/assets/card.png');
    expect(resolveLocalFile(stale)).toBeNull();

    write('repo/assets/card.png');
    const hit = resolveLocalFile(stale);
    expect(hit).toEqual({ path: path.resolve(stale), via: 'exact' });
  });
});
