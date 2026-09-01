import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveEolPolicy, clearGitAttributesCache } from './gitAttributes.js';

let root;

beforeEach(async () => {
  clearGitAttributesCache();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitattr-'));
  // A .git marker stops the walk here, so the developer's real repo above
  // tmpdir can never leak into a result.
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = async (rel, body) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
  return abs;
};

describe('resolveEolPolicy', () => {
  it('returns null when there is no .gitattributes', async () => {
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBeNull();
  });

  it('reads eol=lf', async () => {
    await write('.gitattributes', '* text=auto eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
  });

  it('reads eol=crlf', async () => {
    await write('.gitattributes', '* text=auto eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\r\n');
  });

  it('ignores comments and blank lines', async () => {
    await write('.gitattributes', '# a comment\n\n   \n* eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
  });

  it('lets the LAST matching rule win, as git does', async () => {
    await write('.gitattributes', '* eol=lf\n*.bat eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
    expect(await resolveEolPolicy(path.join(root, 'run.bat'))).toBe('\r\n');
  });

  it('treats -text and binary as "no policy"', async () => {
    await write('.gitattributes', '* eol=lf\n*.png -text\n*.zip binary\n');
    expect(await resolveEolPolicy(path.join(root, 'i.png'))).toBeNull();
    expect(await resolveEolPolicy(path.join(root, 'a.zip'))).toBeNull();
  });

  it('honours a negation', async () => {
    await write('.gitattributes', '* eol=crlf\n!vendor/* eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'vendor', 'x.js'))).toBeNull();
  });

  it('matches an unanchored pattern at any depth', async () => {
    await write('.gitattributes', '*.sh eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'deep', 'er', 'x.sh'))).toBe('\n');
  });

  it('anchors a pattern containing a slash', async () => {
    await write('.gitattributes', 'scripts/*.js eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'scripts', 'a.js'))).toBe('\r\n');
    expect(await resolveEolPolicy(path.join(root, 'other', 'a.js'))).toBeNull();
  });

  it('supports ** across directories', async () => {
    await write('.gitattributes', '**/generated/*.ts eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'a', 'b', 'generated', 'x.ts'))).toBe('\n');
  });

  it('supports a ? wildcard and a character class', async () => {
    await write('.gitattributes', 'v?.txt eol=crlf\nlog[0-9].txt eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'v1.txt'))).toBe('\r\n');
    expect(await resolveEolPolicy(path.join(root, 'log7.txt'))).toBe('\r\n');
    expect(await resolveEolPolicy(path.join(root, 'logX.txt'))).toBeNull();
  });

  it('* does not cross a directory separator', async () => {
    await write('.gitattributes', '/*.js eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'top.js'))).toBe('\r\n');
    expect(await resolveEolPolicy(path.join(root, 'sub', 'deep.js'))).toBeNull();
  });

  it('the NEAREST .gitattributes wins', async () => {
    await write('.gitattributes', '* eol=lf\n');
    await write('sub/.gitattributes', '* eol=crlf\n');
    expect(await resolveEolPolicy(path.join(root, 'sub', 'a.js'))).toBe('\r\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
  });

  it('walks up to a parent .gitattributes', async () => {
    await write('.gitattributes', '* eol=lf\n');
    await fs.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true });
    expect(await resolveEolPolicy(path.join(root, 'a', 'b', 'c', 'x.js'))).toBe('\n');
  });

  it('stops at the repo boundary', async () => {
    // .git is at `root`; a rule ABOVE it must never be consulted.
    await fs.writeFile(path.join(path.dirname(root), '.gitattributes'), '* eol=crlf\n');
    try {
      expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBeNull();
    } finally {
      await fs.rm(path.join(path.dirname(root), '.gitattributes'), { force: true });
    }
  });

  it('ignores rules that declare no ending', async () => {
    await write('.gitattributes', '*.js diff=javascript\n*.md text\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBeNull();
  });

  it('survives a malformed pattern instead of throwing', async () => {
    await write('.gitattributes', '[unclosed eol=lf\n* eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
  });

  it('picks up an edit to .gitattributes without a restart', async () => {
    const f = await write('.gitattributes', '* eol=lf\n');
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\n');
    // mtime resolution can be coarse; force a distinct stamp.
    await fs.writeFile(f, '* eol=crlf\n');
    const future = new Date(Date.now() + 2000);
    await fs.utimes(f, future, future);
    expect(await resolveEolPolicy(path.join(root, 'a.js'))).toBe('\r\n');
  });

  it('never throws on a nonsense path, and never answers for the cwd instead', async () => {
    await expect(resolveEolPolicy('')).resolves.toBeNull();
    await expect(resolveEolPolicy(null)).resolves.toBeNull();
    await expect(resolveEolPolicy(undefined)).resolves.toBeNull();

    // `path.resolve('')` is `process.cwd()`, so an empty path used to walk up
    // from wherever the suite ran and borrow that directory's policy. The null
    // above was therefore an accident of location, not a promise: it held in
    // the main checkout and broke in every linked worktree, where the parent
    // of the cwd is the repo root.
    //
    // Asserting the cwd HAS a policy is what stops the rest passing vacuously
    // — this repo declares `* text=auto eol=lf`, so a path inside the cwd
    // resolves to '\n' while the empty path must still refuse to borrow it.
    const cwdPolicy = await resolveEolPolicy(path.join(process.cwd(), 'probe.js'));
    expect(cwdPolicy, 'the suite must run inside a repo that declares a policy').not.toBeNull();
    await expect(resolveEolPolicy('')).resolves.toBeNull();
  });
});
