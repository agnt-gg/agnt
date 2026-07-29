/**
 * grep_files / glob_files.
 *
 * WHY THESE TOOLS EXIST: 24.7% of every shell/JS call in production history —
 * 9,902 calls — contained a grep equivalent, because there was no search tool.
 * That means these two are on the hottest path in the whole file surface, and
 * the properties worth pinning are the ones that make them SAFE to be there:
 * generated trees skipped, binaries skipped, and every result bounded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { globToRegExp, matchesGlob, looksBinary, grepFiles, globFiles, DEFAULTS } from './fileSearch.js';

let ROOT;

beforeAll(async () => {
  ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-filesearch-'));
  const w = async (rel, content) => {
    const abs = path.join(ROOT, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  };
  await w('src/alpha.js', 'export function findMe() {\n  return 1;\n}\n');
  await w('src/deep/beta.js', '// findMe lives here too\nconst x = 2;\n');
  await w('src/gamma.test.js', 'describe("findMe", () => {});\n');
  await w('README.md', '# findMe\n');
  await w('node_modules/junk/index.js', 'findMe findMe findMe\n');
  await w('dist/bundle.js', 'findMe minified\n');
  await w('.hidden/secret.js', 'findMe hidden\n');
  await w('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x66, 0x69, 0x6e, 0x64, 0x4d, 0x65]));
});

afterAll(async () => {
  if (ROOT) await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {});
});

describe('globToRegExp', () => {
  const m = (pattern, subject) => {
    const re = globToRegExp(pattern);
    return matchesGlob(subject, re, pattern.includes('/'));
  };

  it('* does not cross a directory boundary', () => {
    expect(m('src/*.js', 'src/alpha.js')).toBe(true);
    expect(m('src/*.js', 'src/deep/beta.js')).toBe(false);
  });

  it('**/ crosses any number of directories, including zero', () => {
    expect(m('src/**/*.js', 'src/alpha.js')).toBe(true);
    expect(m('src/**/*.js', 'src/deep/beta.js')).toBe(true);
  });

  it('a pattern with no slash matches the BASENAME at any depth', () => {
    // Strict glob would match only the top level. Nobody writing "*.test.js"
    // means "top-level test files only", so the forgiving reading is correct.
    expect(m('*.test.js', 'src/gamma.test.js')).toBe(true);
    expect(m('*.test.js', 'src/alpha.js')).toBe(false);
  });

  it('supports ? and brace alternation', () => {
    expect(m('alph?.js', 'src/alpha.js')).toBe(true);
    expect(m('*.{js,md}', 'README.md')).toBe(true);
    expect(m('*.{js,md}', 'assets/logo.png')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(m('a+b.js', 'a+b.js')).toBe(true);
    expect(m('a+b.js', 'aaab.js')).toBe(false);
  });
});

describe('looksBinary', () => {
  it('flags a NUL byte', () => {
    expect(looksBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });
  it('passes plain text, including multi-byte UTF-8', () => {
    expect(looksBinary(Buffer.from('const x = "\u00a70.4 \u2014 ok";', 'utf8'))).toBe(false);
  });
  it('only inspects the head, so a huge text file stays cheap', () => {
    const buf = Buffer.concat([Buffer.alloc(8192, 0x41), Buffer.from([0x00])]);
    expect(looksBinary(buf)).toBe(false);
  });
});

describe('grepFiles', () => {
  it('finds matches with path and 1-based line number', async () => {
    const r = await grepFiles(ROOT, { pattern: 'findMe' });
    const hit = r.matches.find((m) => m.path === 'src/alpha.js');
    expect(hit.line).toBe(1);
    expect(hit.text).toContain('findMe');
  });

  it('skips node_modules, dist and dot-directories', async () => {
    const r = await grepFiles(ROOT, { pattern: 'findMe' });
    const paths = r.matches.map((m) => m.path);
    expect(paths).not.toContain('node_modules/junk/index.js');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths.some((p) => p.startsWith('.hidden'))).toBe(false);
    expect(paths.sort()).toEqual(['README.md', 'src/alpha.js', 'src/deep/beta.js', 'src/gamma.test.js']);
  });

  it('never returns a hit inside a binary file', async () => {
    // "findMe" is genuinely present in logo.png's bytes.
    const r = await grepFiles(ROOT, { pattern: 'findMe' });
    expect(r.matches.some((m) => m.path.endsWith('.png'))).toBe(false);
  });

  it('filters by glob', async () => {
    const r = await grepFiles(ROOT, { pattern: 'findMe', glob: '*.test.js' });
    expect(r.matches.map((m) => m.path)).toEqual(['src/gamma.test.js']);
  });

  it('treats the pattern as a regex by default and literally on request', async () => {
    const asRegex = await grepFiles(ROOT, { pattern: 'find(Me|You)' });
    expect(asRegex.matches.length).toBeGreaterThan(0);
    const asLiteral = await grepFiles(ROOT, { pattern: 'find(Me|You)', literal: true });
    expect(asLiteral.matches).toHaveLength(0);
  });

  it('honours ignore_case', async () => {
    expect((await grepFiles(ROOT, { pattern: 'FINDME' })).matches).toHaveLength(0);
    expect((await grepFiles(ROOT, { pattern: 'FINDME', ignoreCase: true })).matches.length).toBeGreaterThan(0);
  });

  it('returns surrounding context when asked', async () => {
    const r = await grepFiles(ROOT, { pattern: 'const x = 2', contextLines: 1 });
    expect(r.matches[0].before).toEqual(['// findMe lives here too']);
    expect(r.matches[0].after).toEqual(['']);
  });

  it('caps results and says it truncated', async () => {
    const r = await grepFiles(ROOT, { pattern: 'findMe', maxResults: 2 });
    expect(r.matches).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.stoppedBecause).toMatch(/result limit/);
  });

  it('clamps maxResults to the hard cap', async () => {
    const r = await grepFiles(ROOT, { pattern: 'findMe', maxResults: 10_000_000 });
    expect(r.matches.length).toBeLessThanOrEqual(DEFAULTS.maxResultsCap);
  });

  it('can search a single file', async () => {
    const r = await grepFiles(path.join(ROOT, 'src/alpha.js'), { pattern: 'findMe' });
    expect(r.matches).toHaveLength(1);
    expect(r.filesScanned).toBe(1);
  });

  it('reports zero matches without pretending to fail', async () => {
    const r = await grepFiles(ROOT, { pattern: 'thisStringIsNowhere' });
    expect(r.matches).toEqual([]);
    expect(r.filesScanned).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });
});

describe('globFiles', () => {
  it('finds files by path pattern', async () => {
    const r = await globFiles(ROOT, { pattern: 'src/**/*.js' });
    expect(r.files.map((f) => f.path).sort()).toEqual(['src/alpha.js', 'src/deep/beta.js', 'src/gamma.test.js']);
  });

  it('returns size and mtime so a follow-up read can be targeted', async () => {
    const r = await globFiles(ROOT, { pattern: 'alpha.js' });
    expect(r.files[0].size).toBeGreaterThan(0);
    expect(r.files[0].mtimeMs).toBeGreaterThan(0);
  });

  it('sorts most-recently-modified first', async () => {
    const fresh = path.join(ROOT, 'src/zeta.js');
    await fs.writeFile(fresh, '// newest\n');
    const now = Date.now();
    await fs.utimes(fresh, now / 1000, now / 1000);
    const r = await globFiles(ROOT, { pattern: 'src/*.js' });
    expect(r.files[0].path).toBe('src/zeta.js');
    await fs.rm(fresh, { force: true });
  });

  it('skips generated trees exactly like grep does', async () => {
    const r = await globFiles(ROOT, { pattern: '**/*.js' });
    expect(r.files.some((f) => f.path.includes('node_modules'))).toBe(false);
    expect(r.files.some((f) => f.path.startsWith('dist/'))).toBe(false);
  });

  it('caps results and reports it', async () => {
    const r = await globFiles(ROOT, { pattern: '**/*.js', maxResults: 1 });
    expect(r.files).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it('returns an empty list rather than throwing on no match', async () => {
    const r = await globFiles(ROOT, { pattern: '**/*.rs' });
    expect(r.files).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
