import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { isSecretPath, assertWithinRoots, getRoots } from './localFileScope.js';

describe('isSecretPath', () => {
  it.each([
    'C:/proj/.env',
    'C:/proj/.env.local',
    'C:/proj/.env.production',
    '/home/u/.env',
    'C:/certs/server.pem',
    'C:/certs/private.key',
    'C:/certs/bundle.pfx',
    'C:/certs/store.p12',
    'C:/u/.ssh/id_rsa',
    'C:/u/.ssh/id_ed25519.pub',
    'C:/u/.aws/credentials',
    'C:/u/.gnupg/secring.gpg',
    'C:/u/.npmrc',
    'C:/u/.netrc',
    'C:/u/.git-credentials',
    'C:/u/.kube/config',
    '/home/u/secrets.json',
  ])('refuses %s', (p) => {
    expect(isSecretPath(p)).toBe(true);
  });

  it.each([
    'C:/proj/art.png',
    'C:/proj/clip.mp4',
    'C:/proj/report.pdf',
    'C:/proj/index.html',
    // Near-misses that must NOT be caught — a blocklist that over-fires is a
    // blocklist users route around.
    'C:/proj/environment.js',
    'C:/proj/env.md',
    'C:/proj/keyboard.png',
    'C:/proj/monkey.jpg',
    'C:/proj/src/keys.js',
    'C:/proj/credentials-guide.md',
  ])('allows %s', (p) => {
    expect(isSecretPath(p)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSecretPath('C:/proj/.ENV')).toBe(true);
    expect(isSecretPath('C:/U/.SSH/known')).toBe(true);
  });

  it('handles backslash paths', () => {
    expect(isSecretPath('C:\\Users\\me\\.ssh\\id_rsa')).toBe(true);
  });

  it('tolerates junk input', () => {
    expect(isSecretPath('')).toBe(false);
    expect(isSecretPath(null)).toBe(false);
    expect(isSecretPath(undefined)).toBe(false);
  });
});

describe('assertWithinRoots', () => {
  let prev;
  beforeEach(() => {
    prev = process.env.AGNT_LOCAL_FILE_ROOTS;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.AGNT_LOCAL_FILE_ROOTS;
    else process.env.AGNT_LOCAL_FILE_ROOTS = prev;
  });

  it('permits everything when unset (auth is the boundary)', () => {
    delete process.env.AGNT_LOCAL_FILE_ROOTS;
    expect(getRoots()).toEqual([]);
    expect(assertWithinRoots(path.resolve('/anywhere/at/all')).ok).toBe(true);
  });

  it('permits a path inside a root', () => {
    const root = path.resolve('/data/agnt');
    process.env.AGNT_LOCAL_FILE_ROOTS = root;
    expect(assertWithinRoots(path.join(root, 'projects', 'x.png')).ok).toBe(true);
  });

  it('permits the root itself', () => {
    const root = path.resolve('/data/agnt');
    process.env.AGNT_LOCAL_FILE_ROOTS = root;
    expect(assertWithinRoots(root).ok).toBe(true);
  });

  it('refuses a sibling that merely shares a prefix (/data must not match /database)', () => {
    process.env.AGNT_LOCAL_FILE_ROOTS = path.resolve('/data');
    expect(assertWithinRoots(path.resolve('/database/secret.txt')).ok).toBe(false);
  });

  it('supports multiple roots', () => {
    const a = path.resolve('/one');
    const b = path.resolve('/two');
    process.env.AGNT_LOCAL_FILE_ROOTS = [a, b].join(path.delimiter);
    expect(assertWithinRoots(path.join(b, 'f.png')).ok).toBe(true);
    expect(assertWithinRoots(path.resolve('/three/f.png')).ok).toBe(false);
  });

  it('ignores blank entries', () => {
    process.env.AGNT_LOCAL_FILE_ROOTS = `${path.delimiter}${path.resolve('/one')}${path.delimiter}`;
    expect(getRoots()).toHaveLength(1);
  });
});
