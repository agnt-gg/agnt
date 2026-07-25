/**
 * Regression gate for the edit_file line-merge corruption.
 *
 * WHAT HAPPENED (2026-07-25)
 * --------------------------
 * edit_file silently welded the replacement text onto the END of the preceding
 * line, deleting the line break, while reporting `success: true` and
 * "Applied 1/1 edits". It hit twice in one session on real source files:
 *
 *   // Extract token usage ...      const inputTokens = tokenUsage?.inputTokens || 0;
 *
 * The statement became part of the comment. Still-valid JavaScript, so nothing
 * complained until it surfaced as a ReferenceError at runtime. The second
 * occurrence merged `db.serialize(() => {` into a comment and broke module
 * parsing outright.
 *
 * ROOT CAUSE — two bugs compounding:
 *
 *   1. Callers write search strings with "\n". On a CRLF file
 *      source.indexOf(search) can never match, so EVERY multi-line edit fell
 *      through to the fuzzy matcher.
 *
 *   2. The fuzzy matcher scanned forward from offset 0 and normalizeWS() trims,
 *      so a window starting on the whitespace run BEFORE the target normalized
 *      identically to one starting at the target. The first matching position
 *      was therefore the one including the preceding "\r\n" — and splicing
 *      there deleted the line break.
 *
 * A 2x2 fixture matrix isolated it: CRLF + multi-line search corrupted 100% of
 * the time; LF, CRLF-with-CRLF-search, and single-line searches were all clean.
 * Multi-byte UTF-8 upstream of the edit point was ruled out.
 *
 * Every test below asserts on the SEAM — the text between the previous line's
 * content and the replacement — because that is exactly where the corruption
 * appeared.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executeCodeFunction } from './codeTools.js';

// executeCodeFunction returns JSON.stringify(result) — a string, not an object.
const call = async (args) => JSON.parse(await executeCodeFunction('edit_file', args));

let TMP;

const HEADER = [
  '// top of file',
  '// PRD-084-R2 \u00A70.4: performance pack \u2014 documented-safe under WAL.',
];
const BODY = [
  'function demo() {',
  '  // A long explanatory comment that sits directly above the target line here',
  '  const alpha = 1;',
  '  const beta = 2;',
  '  return alpha + beta;',
  '}',
  '',
];

const ANCHOR = 'target line here';

/** Write a fixture with an explicit line ending and return its absolute path. */
async function fixture(name, eol) {
  TMP = TMP || (await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-editfile-')));
  const p = path.join(TMP, name);
  await fs.writeFile(p, [...HEADER, ...BODY].join(eol), 'utf8');
  return p;
}

const read = (p) => fs.readFile(p, 'utf8');

/** The text between the end of the preceding comment and the replacement. */
function seam(content, needle) {
  const i = content.indexOf(ANCHOR);
  const j = content.indexOf(needle);
  if (i === -1 || j === -1) return null;
  return content.slice(i + ANCHOR.length, j);
}

const eolStats = (s) => ({
  crlf: (s.match(/\r\n/g) || []).length,
  loneLf: (s.match(/(?<!\r)\n/g) || []).length,
});

beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-editfile-'));
});

afterAll(async () => {
  if (TMP) await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('edit_file — line-merge corruption (the 2026-07-25 bug)', () => {
  it('CRLF file + LF multi-line search must NOT eat the preceding newline', async () => {
    const p = await fixture('crlf.js', '\r\n');

    const res = await call({
      path: p,
      description: 'the exact shape that corrupted real source files',
      edits: [{
        search: '  const alpha = 1;\n  const beta = 2;',
        replace: '  const alpha = 10;\n  const beta = 20;\n  const gamma = 30;',
      }],
    });

    expect(res.success).toBe(true);
    const out = await read(p);

    // THE ASSERTION THAT WOULD HAVE CAUGHT IT: a line break must survive
    // between the comment and the replacement.
    expect(seam(out, 'const alpha = 10;')).toMatch(/\n/);
    expect(out).not.toContain('target line here  const alpha');
    expect(out).toContain('const gamma = 30;');
  });

  it('preserves the CRLF convention instead of injecting lone LFs', async () => {
    const p = await fixture('crlf-eol.js', '\r\n');
    const before = eolStats(await read(p));
    expect(before.loneLf).toBe(0);

    await call({
      path: p,
      description: 'replacement text carries LF newlines',
      edits: [{
        search: '  const alpha = 1;\n  const beta = 2;',
        replace: '  const alpha = 10;\n  const beta = 20;\n  const gamma = 30;',
      }],
    });

    // Mixed endings are what produced spurious whole-file diffs in git.
    expect(eolStats(await read(p)).loneLf).toBe(0);
  });

  it('LF file keeps LF and stays correct', async () => {
    const p = await fixture('lf.js', '\n');

    await call({
      path: p,
      description: 'LF baseline — always worked, must keep working',
      edits: [{
        search: '  const alpha = 1;\n  const beta = 2;',
        replace: '  const alpha = 10;\n  const beta = 20;',
      }],
    });

    const out = await read(p);
    expect(seam(out, 'const alpha = 10;')).toMatch(/\n/);
    expect(eolStats(out).crlf).toBe(0);
  });

  it('CRLF file + CRLF search still works (the manual workaround)', async () => {
    const p = await fixture('crlf-exact.js', '\r\n');

    await call({
      path: p,
      description: 'search supplied with CRLF — exact-match path',
      edits: [{
        search: '  const alpha = 1;\r\n  const beta = 2;',
        replace: '  const alpha = 10;\r\n  const beta = 20;',
      }],
    });

    const out = await read(p);
    expect(seam(out, 'const alpha = 10;')).toMatch(/\n/);
    expect(eolStats(out).loneLf).toBe(0);
  });

  it('single-line search on a CRLF file is unaffected', async () => {
    const p = await fixture('crlf-single.js', '\r\n');

    await call({
      path: p,
      description: 'no newline in the search string at all',
      edits: [{ search: '  const alpha = 1;', replace: '  const alpha = 10;' }],
    });

    const out = await read(p);
    expect(seam(out, 'const alpha = 10;')).toMatch(/\n/);
    expect(out).toContain('const beta = 2;');
  });

  it('multi-byte UTF-8 upstream of the edit does not shift the splice', async () => {
    // Ruled out as a cause, but it is a plausible future regression: the
    // header carries § (2 bytes) and — (3 bytes) above the edit point.
    const p = await fixture('utf8.js', '\r\n');

    await call({
      path: p,
      description: 'byte-vs-char offset drift',
      edits: [{
        search: '  const alpha = 1;\n  const beta = 2;',
        replace: '  const alpha = 10;\n  const beta = 20;',
      }],
    });

    const out = await read(p);
    expect(seam(out, 'const alpha = 10;')).toMatch(/\n/);
    expect(out).toContain('\u00A70.4');
    expect(out).toContain('\u2014 documented-safe');
  });
});

describe('edit_file — fuzzy fallback', () => {
  it('tolerates indentation drift without merging lines or double-indenting', async () => {
    const p = await fixture('fuzzy.js', '\r\n');

    // Search uses 4 spaces; the file uses 2. Only the fuzzy path can match.
    const res = await call({
      path: p,
      description: 'indentation drift',
      edits: [{
        search: '    const alpha = 1;\n    const beta = 2;',
        replace: '  const alpha = 99;\n  const beta = 98;',
      }],
    });

    expect(res.success).toBe(true);
    const out = await read(p);

    expect(seam(out, 'const alpha = 99;')).toMatch(/\n/);
    // Exactly two spaces of indentation — not four from double-application.
    expect(out).toMatch(/\n {2}const alpha = 99;/);
    expect(out).not.toMatch(/\n {4}const alpha = 99;/);
    expect(res.applied[0].fuzzy).toBe(true);
  });

  it('reports a missing search string instead of guessing', async () => {
    const p = await fixture('miss.js', '\r\n');

    const res = await call({
      path: p,
      description: 'no such text',
      edits: [{ search: 'const doesNotExist = 42;', replace: 'const nope = 1;' }],
    });

    expect(res.success).toBe(false);
    expect(res.failed).toHaveLength(1);
    expect(await read(p)).toContain('const alpha = 1;');
  });

  it('flags an ambiguous search rather than silently editing the first hit', async () => {
    const p = path.join(TMP, 'dupe.js');
    await fs.writeFile(p, ['a();', 'dup();', 'b();', 'dup();', ''].join('\r\n'), 'utf8');

    const res = await call({
      path: p,
      description: 'two identical candidates',
      edits: [{ search: 'dup();', replace: 'replaced();' }],
    });

    expect(res.success).toBe(true);
    expect(res.applied[0].occurrences).toBe(2);
    expect(res.applied[0].note).toMatch(/first occurrence/i);
  });
});

describe('edit_file — multiple edits in one call', () => {
  it('applies sequential edits without corrupting any seam', async () => {
    const p = await fixture('multi.js', '\r\n');

    const res = await call({
      path: p,
      description: 'three edits, one call — the safe alternative to parallel calls',
      edits: [
        { search: '  const alpha = 1;', replace: '  const alpha = 11;' },
        { search: '  const beta = 2;', replace: '  const beta = 22;' },
        { search: '  return alpha + beta;', replace: '  return alpha * beta;' },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.applied).toHaveLength(3);

    const out = await read(p);
    expect(out).toContain('const alpha = 11;');
    expect(out).toContain('const beta = 22;');
    expect(out).toContain('return alpha * beta;');
    expect(eolStats(out).loneLf).toBe(0);

    // Every statement still owns its own line.
    const lines = out.split('\r\n');
    expect(lines.filter((l) => l.includes('const alpha = 11;'))).toHaveLength(1);
    expect(lines.find((l) => l.includes('const alpha = 11;')).trim()).toBe('const alpha = 11;');
  });

  it('applies the good edits and reports the bad one', async () => {
    const p = await fixture('partial.js', '\r\n');

    const res = await call({
      path: p,
      description: 'one hit, one miss',
      edits: [
        { search: '  const alpha = 1;', replace: '  const alpha = 7;' },
        { search: 'totally absent text', replace: 'x' },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.applied).toHaveLength(1);
    expect(res.failed).toHaveLength(1);
    expect(await read(p)).toContain('const alpha = 7;');
  });
});

describe('edit_file — result contract', () => {
  it('does not write anything when every search misses', async () => {
    const p = await fixture('nowrite.js', '\r\n');
    const before = await read(p);

    const res = await call({
      path: p,
      description: 'all misses',
      edits: [{ search: 'nope-one', replace: 'x' }, { search: 'nope-two', replace: 'y' }],
    });

    expect(res.success).toBe(false);
    expect(await read(p)).toBe(before);
  });

  it('refuses to edit a file that does not exist', async () => {
    const res = await call({
      path: path.join(TMP, 'ghost.js'),
      description: 'missing file',
      edits: [{ search: 'a', replace: 'b' }],
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
