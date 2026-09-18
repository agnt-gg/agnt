/**
 * Direct coverage for the two predicates split out of the matrix module.
 *
 * They were previously exercised only through assess.js and secretScan.js, so
 * a break showed up as a confusing failure two layers away. Now that they are
 * a module of their own they get their own tests.
 */
import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { canonicalPath, isNonPathToken } from './paths.js';

const HOME = '/Users/testuser';
const opts = { home: HOME, projectDir: '/project' };

describe('canonicalPath — one spelling per file', () => {
  it('expands ~ and $HOME', () => {
    expect(canonicalPath('~/.ssh/config', opts)).toBe(`${HOME}/.ssh/config`);
    expect(canonicalPath('$HOME/.ssh/config', opts)).toBe(`${HOME}/.ssh/config`);
    expect(canonicalPath('~', opts)).toBe(HOME);
    expect(canonicalPath('$HOME', opts)).toBe(HOME);
  });

  it('collapses //, /./ and resolves ..', () => {
    expect(canonicalPath('/a//b', opts)).toBe('/a/b');
    expect(canonicalPath('/a/./b', opts)).toBe('/a/b');
    expect(canonicalPath('/a/b/../c', opts)).toBe('/a/c');
  });

  it('gives every equivalent spelling of one file the same answer', () => {
    // The property the whole gate rests on: two spellings of one path must not
    // produce two different verdicts.
    const spellings = [
      '~/.ssh/id_ed25519',
      '$HOME/.ssh/id_ed25519',
      `${HOME}/.ssh/./id_ed25519`,
      `${HOME}//.ssh//id_ed25519`,
      `${HOME}/.ssh/../.ssh/id_ed25519`,
    ];
    const answers = new Set(spellings.map((s) => canonicalPath(s, opts)));
    expect(answers.size, `spellings diverged: ${[...answers].join(' | ')}`).toBe(1);
    expect([...answers][0]).toBe(`${HOME}/.ssh/id_ed25519`);
  });

  it('resolves a relative path against projectDir', () => {
    expect(canonicalPath('fixtures/key', opts)).toBe('/project/fixtures/key');
  });

  it('cannot escape above the root', () => {
    expect(canonicalPath('/../../etc/passwd', opts)).toBe('/etc/passwd');
  });

  it('returns empty for empty input rather than inventing a path', () => {
    for (const v of ['', null, undefined, '   ']) expect(canonicalPath(v, opts)).toBe('');
  });

  it('defaults home to the real homedir when none is given', () => {
    expect(canonicalPath('~/x')).toBe(`${homedir()}/x`);
  });

  it('defaults a relative path to the process cwd, not to this module', () => {
    // It used to default to the module's own directory. That was right where
    // this code lived before — the fixtures were beside it — and wrong here:
    // nothing a user names is relative to a source directory inside the app.
    expect(canonicalPath('notes.txt')).toBe(`${process.cwd()}/notes.txt`);
    expect(canonicalPath('notes.txt')).not.toContain('services/security/jev');
  });
});

describe('isNonPathToken — what is not a file', () => {
  it('rejects URLs of any scheme', () => {
    for (const t of [
      'https://api.example.test/v1',
      'http://127.0.0.1:3333/api',
      'file:///etc/passwd',
      's3://bucket/key',
    ]) {
      expect(isNonPathToken(t), t).toBe(true);
    }
  });

  it('rejects scp-style and scheme-only remotes', () => {
    expect(isNonPathToken('git@github.com:owner/repo.git')).toBe(true);
    expect(isNonPathToken('mailto:a@b.test')).toBe(true);
  });

  it('rejects a URL hiding behind an assignment prefix', () => {
    // The second half of the bug: the first guard only matched a scheme at
    // position 0, so `API=http://host/x` still canonicalised into a bogus
    // local path and reached Jev as a file.
    expect(isNonPathToken('API=http://127.0.0.1:3333/api')).toBe(true);
    expect(isNonPathToken('REPO=git@github.com:o/r.git')).toBe(true);
  });

  it('ACCEPTS real paths, including an assignment whose value IS a path', () => {
    for (const t of ['/etc/hosts', '~/.ssh/config', 'fixtures/key', './rel/path']) {
      expect(isNonPathToken(t), t).toBe(false);
    }
    expect(isNonPathToken('KEYFILE=~/.ssh/config')).toBe(false);
  });

  it('treats empty input as not-a-path', () => {
    for (const t of ['', null, undefined]) expect(isNonPathToken(t)).toBe(true);
  });
});
