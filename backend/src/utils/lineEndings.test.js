import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  countEol,
  classify,
  detectEol,
  dominantEol,
  applyEol,
  hasBinaryMarker,
  reconcile,
  reconcileAppend,
  prepareWrite,
  SNIFF_BYTES,
} from './lineEndings.js';
import { clearGitAttributesCache } from './gitAttributes.js';

const CRLF = (...lines) => lines.join('\r\n');
const LF = (...lines) => lines.join('\n');

describe('countEol', () => {
  it('counts CRLF and bare LF as disjoint sets', () => {
    expect(countEol('a\r\nb\nc')).toEqual({ crlf: 1, lf: 1 });
  });

  it('does not double-count the LF inside a CRLF', () => {
    expect(countEol('a\r\nb\r\nc')).toEqual({ crlf: 2, lf: 0 });
  });

  it('is safe on empty and non-string input', () => {
    expect(countEol('')).toEqual({ crlf: 0, lf: 0 });
    expect(countEol(null)).toEqual({ crlf: 0, lf: 0 });
    expect(countEol(undefined)).toEqual({ crlf: 0, lf: 0 });
  });

  it('counts a lone CR as neither', () => {
    // Classic Mac endings are not a case AGNT needs to support, but they must
    // not be silently miscounted as LF.
    expect(countEol('a\rb\rc')).toEqual({ crlf: 0, lf: 0 });
  });
});

describe('classify', () => {
  it('distinguishes all four states', () => {
    expect(classify(CRLF('a', 'b'))).toBe('crlf');
    expect(classify(LF('a', 'b'))).toBe('lf');
    expect(classify('a\r\nb\nc')).toBe('mixed');
    expect(classify('single line')).toBe('none');
  });

  it('reports an empty string as none, not lf', () => {
    expect(classify('')).toBe('none');
  });
});

describe('detectEol / dominantEol', () => {
  it('returns null when there is nothing to detect', () => {
    expect(detectEol('no breaks')).toBeNull();
    expect(dominantEol('no breaks')).toBeNull();
  });

  it('reports the majority ending for a mixed file', () => {
    expect(detectEol('a\r\nb\r\nc\r\nd\n')).toBe('\r\n');
    expect(detectEol('a\nb\nc\nd\r\n')).toBe('\n');
  });

  it('breaks a tie toward LF', () => {
    // Every AGNT repo declares eol=lf and every target platform reads LF, so a
    // coin-flip must land on the safe side rather than being arbitrary.
    expect(dominantEol('a\r\nb\n')).toBe('\n');
  });
});

describe('applyEol', () => {
  it('converts in both directions', () => {
    expect(applyEol(LF('a', 'b', 'c'), '\r\n')).toBe(CRLF('a', 'b', 'c'));
    expect(applyEol(CRLF('a', 'b', 'c'), '\n')).toBe(LF('a', 'b', 'c'));
  });

  it('is idempotent — the whole reason for the collapse-then-expand shape', () => {
    const once = applyEol(LF('a', 'b'), '\r\n');
    expect(applyEol(once, '\r\n')).toBe(once);
    expect(applyEol(applyEol(once, '\r\n'), '\r\n')).toBe(once);
  });

  it('never produces \\r\\r\\n from a mixed input', () => {
    const out = applyEol('a\r\nb\nc\r\nd', '\r\n');
    expect(out).not.toMatch(/\r\r/);
    expect(classify(out)).toBe('crlf');
  });

  it('passes through when no eol is given', () => {
    expect(applyEol('a\r\nb', null)).toBe('a\r\nb');
  });
});

describe('hasBinaryMarker', () => {
  it('detects a NUL byte', () => {
    expect(hasBinaryMarker('abc\u0000def')).toBe(true);
    expect(hasBinaryMarker('plain text')).toBe(false);
  });

  it('only inspects the prefix, so a huge string stays cheap', () => {
    expect(hasBinaryMarker('x'.repeat(20000) + '\u0000')).toBe(false);
  });
});

describe('reconcile — the contract', () => {
  it('EXISTING WINS: a CRLF file stays CRLF when handed LF content', () => {
    // This is the write_file defect. A one-line change used to restyle the
    // entire file.
    const r = reconcile(CRLF('a', 'b', 'c'), LF('a', 'CHANGED', 'c'));
    expect(classify(r.content)).toBe('crlf');
    expect(r.action).toBe('coerced-to-existing');
    expect(r.healed).toBe(false);
  });

  it('EXISTING WINS: an LF file stays LF when handed CRLF content', () => {
    const r = reconcile(LF('a', 'b'), CRLF('a', 'CHANGED'));
    expect(classify(r.content)).toBe('lf');
    expect(r.action).toBe('coerced-to-existing');
  });

  it('leaves content untouched when it already matches', () => {
    const incoming = CRLF('a', 'b');
    const r = reconcile(CRLF('x', 'y'), incoming);
    expect(r.content).toBe(incoming);
    expect(r.action).toBe('matched-existing');
  });

  it('existing convention beats repo policy for a uniform file', () => {
    // Otherwise `eol=lf` would turn every edit of a CRLF working file into a
    // whole-file restyle — the same bug with better manners.
    const r = reconcile(CRLF('a', 'b'), LF('a', 'b'), { policy: '\n' });
    expect(classify(r.content)).toBe('crlf');
  });

  it('HEALS a mixed file to its dominant ending', () => {
    const mixed = 'a\r\nb\r\nc\r\nd\ne\n';
    const r = reconcile(mixed, mixed.replace('b', 'B'));
    expect(classify(r.content)).toBe('crlf');
    expect(r.healed).toBe(true);
    expect(r.action).toBe('healed-mixed');
  });

  it('HEALS toward LF when LF is dominant', () => {
    const mixed = 'a\nb\nc\nd\r\n';
    const r = reconcile(mixed, mixed);
    expect(classify(r.content)).toBe('lf');
    expect(r.healed).toBe(true);
  });

  it('new file follows repo policy', () => {
    const r = reconcile(null, LF('a', 'b'), { policy: '\r\n' });
    expect(classify(r.content)).toBe('crlf');
    expect(r.action).toBe('new-file-policy');
  });

  it('new file with no policy keeps the caller bytes verbatim', () => {
    const incoming = CRLF('a', 'b');
    const r = reconcile(null, incoming);
    expect(r.content).toBe(incoming);
    expect(r.action).toBe('new-file-verbatim');
  });

  it('new file with self-inconsistent content is healed', () => {
    const r = reconcile(null, 'a\r\nb\nc\r\nd\r\n');
    expect(classify(r.content)).toBe('crlf');
    expect(r.healed).toBe(true);
  });

  it('an existing file with no line breaks falls back to policy', () => {
    const r = reconcile('single line', LF('a', 'b'), { policy: '\r\n' });
    expect(classify(r.content)).toBe('crlf');
    expect(r.action).toBe('no-signal-policy');
  });

  it('an empty existing file carries no convention', () => {
    const r = reconcile('', CRLF('a', 'b'));
    expect(r.action).toBe('no-signal-verbatim');
    expect(classify(r.content)).toBe('crlf');
  });

  it('NEVER touches binary content', () => {
    const bin = 'MZ\u0000\u0000\r\nPE\u0000';
    const r = reconcile(LF('a', 'b'), bin);
    expect(r.content).toBe(bin);
    expect(r.action).toBe('binary-untouched');
  });

  it('never touches a write whose EXISTING file is binary', () => {
    const r = reconcile('\u0000\u0000binary', LF('a', 'b'));
    expect(r.action).toBe('binary-untouched');
  });

  it('passes non-string content straight through', () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(reconcile(null, buf).content).toBe(buf);
  });

  it('is idempotent — reconciling its own output changes nothing', () => {
    const existing = CRLF('a', 'b', 'c');
    const first = reconcile(existing, LF('a', 'X', 'c')).content;
    const second = reconcile(existing, first).content;
    expect(second).toBe(first);
  });
});

describe('reconcileAppend', () => {
  it('coerces the chunk to the existing file ending', () => {
    const r = reconcileAppend(CRLF('line1', 'line2'), LF('new1', 'new2'));
    expect(classify(r.content)).toBe('crlf');
  });

  it('falls back to policy when the file has no ending yet', () => {
    const r = reconcileAppend('', LF('a', 'b'), { policy: '\r\n' });
    expect(classify(r.content)).toBe('crlf');
  });

  it('writes verbatim when there is no signal at all', () => {
    const incoming = LF('a', 'b');
    expect(reconcileAppend(null, incoming).content).toBe(incoming);
  });

  it('never touches binary', () => {
    const bin = 'a\u0000b';
    expect(reconcileAppend(CRLF('x', 'y'), bin).content).toBe(bin);
  });
});

describe('prepareWrite — the seam', () => {
  let dir;

  beforeEach(async () => {
    clearGitAttributesCache();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eol-seam-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('preserves an existing CRLF file it has to read itself', async () => {
    const f = path.join(dir, 'a.js');
    await fs.writeFile(f, CRLF('a', 'b', 'c'));
    const r = await prepareWrite(f, LF('a', 'CHANGED', 'c'));
    expect(classify(r.content)).toBe('crlf');
  });

  it('treats a missing file as new', async () => {
    const r = await prepareWrite(path.join(dir, 'nope.js'), LF('a', 'b'));
    expect(r.action).toBe('new-file-verbatim');
  });

  it('accepts caller-supplied existing content without re-reading', async () => {
    const f = path.join(dir, 'b.js');
    await fs.writeFile(f, LF('on', 'disk'));
    // Deliberately disagrees with the file: proves the passed value is used.
    const r = await prepareWrite(f, LF('x', 'y'), { existing: CRLF('a', 'b') });
    expect(classify(r.content)).toBe('crlf');
  });

  it('honours .gitattributes for a new file', async () => {
    await fs.writeFile(path.join(dir, '.gitattributes'), '* text=auto eol=crlf\n');
    const r = await prepareWrite(path.join(dir, 'new.js'), LF('a', 'b'));
    expect(classify(r.content)).toBe('crlf');
    expect(r.action).toBe('new-file-policy');
  });

  it('append mode sniffs the head and coerces the chunk', async () => {
    const f = path.join(dir, 'log.txt');
    await fs.writeFile(f, CRLF('one', 'two', ''));
    const r = await prepareWrite(f, LF('three', 'four', ''), { mode: 'append' });
    expect(classify(r.content)).toBe('crlf');
  });

  it('sniffs only the head of a very large file', async () => {
    const f = path.join(dir, 'big.txt');
    // > SNIFF_BYTES of CRLF, so the prefix alone settles it.
    await fs.writeFile(f, 'x'.repeat(4) .concat('\r\n').repeat(Math.ceil(SNIFF_BYTES / 6) + 10));
    const r = await prepareWrite(f, LF('a', 'b'), { mode: 'append' });
    expect(classify(r.content)).toBe('crlf');
  });

  it('degrades to the caller bytes when the path is unreadable', async () => {
    // A failed sniff must never fail the write.
    const r = await prepareWrite(path.join(dir, 'no', 'such', 'dir', 'f.js'), LF('a', 'b'));
    expect(r.content).toBe(LF('a', 'b'));
  });

  it('heals a real mixed file on disk', async () => {
    const f = path.join(dir, 'mixed.js');
    await fs.writeFile(f, 'a\r\nb\r\nc\r\nd\ne\n');
    const r = await prepareWrite(f, 'a\r\nb\r\nc\r\nd\ne\n');
    expect(r.healed).toBe(true);
    expect(classify(r.content)).toBe('crlf');
  });
});
