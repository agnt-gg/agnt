/**
 * The file-tool contract, as fixed by the 2026-07-28 audit.
 *
 * Each describe block below corresponds to a probe that FAILED against the
 * previous implementation. The probe ids (T1, T3, T4, T6, T9, T10, T11, T14)
 * are kept so this file and the audit read against each other.
 *
 * The through-line of every fix: the tools were PERMISSIVE where they should
 * have been strict (ambiguity, staleness, partial success, binaries) and SILENT
 * where they should have been informative (failure messages, diffs, line
 * numbers, truncation). Every assertion here pins one of those two directions.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executeCodeFunction, getCodeToolSchemas, MAX_READ_CHARS } from './codeTools.js';
import { _resetObservations } from './fileObservations.js';

const call = async (name, args) => JSON.parse(await executeCodeFunction(name, args));
const read = (p) => fs.readFile(p, 'utf8');

let TMP;
let n = 0;
const uniq = (base) => path.join(TMP, `${base}-${++n}.js`);

beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-contract-'));
  _resetObservations();
});

afterAll(async () => {
  if (TMP) await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------- T1 / T14 ---

describe('read_file is bounded and self-describing (T1, T14)', () => {
  it('caps a huge file and says exactly how to continue', async () => {
    // Production max was an 822,617-char read. The orchestrator was already
    // truncating it at toolOutputCap with no marker and no way to page — the cap
    // existed, it was just invisible. Making it explicit is the whole fix.
    const p = uniq('big');
    await fs.writeFile(p, `${'x'.repeat(120)}\n`.repeat(5000));
    const r = await call('read_file', { path: p });

    expect(r.success).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.totalLines).toBe(5000);
    expect(r.note).toMatch(/offset: \d+/);
  });

  it('truncates on a line boundary, so the text stays usable as a search string', async () => {
    const p = uniq('boundary');
    await fs.writeFile(p, `${'x'.repeat(120)}\n`.repeat(5000));
    const r = await call('read_file', { path: p });
    // A half-line would be silently unusable in an edit_file search.
    expect(r.content.endsWith('x'.repeat(120))).toBe(true);
    expect(r.content).not.toMatch(/x{121}/);
  });

  it('pages with offset/limit', async () => {
    const p = uniq('paged');
    await fs.writeFile(p, Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n'));
    const r = await call('read_file', { path: p, offset: 10, limit: 3 });
    expect(r.content).toBe('line 10\nline 11\nline 12');
    expect(r.startLine).toBe(10);
    expect(r.endLine).toBe(12);
    expect(r.totalLines).toBe(100);
    expect(r.truncated).toBe(true);
  });

  it('a full read is byte-exact and not flagged truncated', async () => {
    const p = uniq('exact');
    const body = 'const a = 1;\r\nconst b = 2;\r\n';
    await fs.writeFile(p, body);
    const r = await call('read_file', { path: p });
    expect(r.content).toBe(body);
    expect(r.truncated).toBe(false);
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(2);
  });

  it('returns size and a content hash — nothing else could build a staleness check', async () => {
    const p = uniq('meta');
    await fs.writeFile(p, 'hello\n');
    const r = await call('read_file', { path: p });
    expect(r.bytes).toBe(6);
    expect(r.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not add a line-number gutter to the content', async () => {
    // Deliberate divergence from Anthropic's text editor, which returns
    // `cat -n` style output. Here the SAME text is fed straight back into
    // edit_file, so a gutter would make every copied search string wrong.
    // Line numbers live in the metadata instead.
    const p = uniq('gutter');
    await fs.writeFile(p, 'alpha\nbeta\n');
    const r = await call('read_file', { path: p });
    expect(r.content).toBe('alpha\nbeta\n');
  });
});

// ---------------------------------------------------------------------- T3 ---

describe('binary files are refused, not mangled (T3)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0xff, 0xfe]);

  it('read_file refuses instead of returning replacement characters', async () => {
    const p = path.join(TMP, 'logo.png');
    await fs.writeFile(p, PNG);
    const r = await call('read_file', { path: p });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[Bb]inary file/);
    expect(JSON.stringify(r)).not.toContain('\ufffd');
  });

  it('edit_file refuses, because writing the decoded text back would destroy it', async () => {
    const p = path.join(TMP, 'logo2.png');
    await fs.writeFile(p, PNG);
    const before = await fs.readFile(p);
    const r = await call('edit_file', { path: p, edits: [{ search: 'PNG', replace: 'JPG' }] });
    expect(r.success).toBe(false);
    expect(Buffer.compare(await fs.readFile(p), before)).toBe(0);
  });
});

// ---------------------------------------------------------------------- T4 ---

describe('write_file reports what it destroyed (T4)', () => {
  it('flags an overwrite of an existing file', async () => {
    const p = uniq('precious');
    await fs.writeFile(p, 'export const CRITICAL = 42;\n');
    const r = await call('write_file', { path: p, content: 'oops\n' });
    expect(r.success).toBe(true);
    expect(r.created).toBe(false);
    expect(r.overwrote).toBe(true);
    expect(r.previousBytes).toBe(28);
    expect(r.note).toMatch(/edit_file/);
  });

  it('does not cry wolf on a genuinely new file', async () => {
    const r = await call('write_file', { path: uniq('brand-new'), content: 'x' });
    expect(r.created).toBe(true);
    expect(r.overwrote).toBeUndefined();
    expect(r.note).toBeUndefined();
  });

  it('still creates nested directories', async () => {
    const p = path.join(TMP, 'a/b/c/deep.js');
    const r = await call('write_file', { path: p, content: 'ok' });
    expect(r.success).toBe(true);
    expect(await read(p)).toBe('ok');
  });
});

// ---------------------------------------------------------------------- T6 ---

describe('edit_file refuses a stale edit (T6)', () => {
  it('blocks an edit when the file changed on disk after being read', async () => {
    const p = uniq('racy');
    await fs.writeFile(p, 'const VERSION = 1;\nconst OTHER = 0;\n');
    await call('read_file', { path: p });

    // Someone else — an editor, a shell command, another agent — writes.
    await fs.writeFile(p, 'const VERSION = 1;\nconst OTHER = 99;\n');

    const r = await call('edit_file', { path: p, edits: [{ search: 'const VERSION = 1;', replace: 'const VERSION = 2;' }] });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/changed on disk/i);
    expect(r.stale.observedHash).not.toBe(r.stale.currentHash);
    expect(r.message).toMatch(/read_file/);
    // The other writer's work must survive intact.
    expect(await read(p)).toBe('const VERSION = 1;\nconst OTHER = 99;\n');
  });

  it('re-reading clears it and the same edit then lands', async () => {
    const p = uniq('recover');
    await fs.writeFile(p, 'const A = 1;\n');
    await call('read_file', { path: p });
    await fs.writeFile(p, 'const A = 1;\nconst B = 2;\n');

    expect((await call('edit_file', { path: p, edits: [{ search: 'const A = 1;', replace: 'const A = 9;' }] })).success).toBe(false);
    await call('read_file', { path: p });
    const retry = await call('edit_file', { path: p, edits: [{ search: 'const A = 1;', replace: 'const A = 9;' }] });

    expect(retry.success).toBe(true);
    expect(await read(p)).toBe('const A = 9;\nconst B = 2;\n');
  });

  it('an UNOBSERVED file is not stale — unknown and changed are different answers', async () => {
    // 42% of production edits were issued against a file this process had never
    // read. Treating "no record" as stale would have hard-failed all of them.
    const p = uniq('unobserved');
    await fs.writeFile(p, 'const A = 1;\n');
    const r = await call('edit_file', { path: p, edits: [{ search: 'const A = 1;', replace: 'const A = 2;' }] });
    expect(r.success).toBe(true);
  });

  it('the tool\'s own successive edits never trip the guard', async () => {
    const p = uniq('sequential');
    await fs.writeFile(p, 'a();\nb();\nc();\n');
    await call('read_file', { path: p });
    expect((await call('edit_file', { path: p, edits: [{ search: 'a();', replace: 'A();' }] })).success).toBe(true);
    expect((await call('edit_file', { path: p, edits: [{ search: 'b();', replace: 'B();' }] })).success).toBe(true);
    expect((await call('edit_file', { path: p, edits: [{ search: 'c();', replace: 'C();' }] })).success).toBe(true);
    expect(await read(p)).toBe('A();\nB();\nC();\n');
  });

  it('write_file is never blocked by staleness — a full rewrite is a declared intent', async () => {
    const p = uniq('rewrite');
    await fs.writeFile(p, 'v1\n');
    await call('read_file', { path: p });
    await fs.writeFile(p, 'v2-external\n');
    const r = await call('write_file', { path: p, content: 'v3\n' });
    expect(r.success).toBe(true);
    expect(await read(p)).toBe('v3\n');
  });
});

// ---------------------------------------------------------------------- T9 ---

describe('edit_file returns evidence, so verification costs no round trip (T9)', () => {
  it('reports the line, tier and a unified diff', async () => {
    const p = uniq('diff');
    await fs.writeFile(p, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const r = await call('edit_file', { path: p, edits: [{ search: 'const b = 2;', replace: 'const b = 22;' }] });

    expect(r.applied[0].line).toBe(2);
    expect(r.applied[0].tier).toBe('exact');
    expect(r.diff).toBe('@@ line 2 @@\n-const b = 2;\n+const b = 22;');
    expect(r.bytesBefore).toBe(39);
    expect(r.bytesAfter).toBe(40);
  });

  it('line numbers stay exact across multiple edits that shift each other', async () => {
    // Splices change the offsets of everything after them, so a naive
    // implementation reports line numbers that drift as the batch progresses.
    const p = uniq('multi-diff');
    await fs.writeFile(p, ['one', 'two', 'three', 'four', 'five'].join('\n'));
    const r = await call('edit_file', {
      path: p,
      edits: [
        { search: 'two', replace: 'TWO\nEXTRA' }, // inserts a line
        { search: 'five', replace: 'FIVE' },
      ],
    });
    expect(r.success).toBe(true);
    expect(await read(p)).toBe('one\nTWO\nEXTRA\nthree\nfour\nFIVE');
    // 'five' was line 5 before the insert and is line 6 in the final file.
    expect(r.diff).toContain('@@ line 6 @@');
    expect(r.diff).toContain('-five');
    expect(r.diff).toContain('+FIVE');
  });
});

// --------------------------------------------------------------- T10 / T11 ---

describe('edit_file is atomic (T10, T11)', () => {
  it('writes nothing when any edit misses', async () => {
    const p = uniq('atomic');
    const before = 'const a = 1;\nconst b = 2;\n';
    await fs.writeFile(p, before);
    const r = await call('edit_file', {
      path: p,
      edits: [
        { search: 'const a = 1;', replace: 'const a = 9;' },
        { search: 'const NOPE = 0;', replace: 'x' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.wouldHaveApplied).toHaveLength(1);
    expect(await read(p)).toBe(before);
  });

  it('leaves no temp file behind on success', async () => {
    const p = uniq('tmp-clean');
    await fs.writeFile(p, 'const a = 1;\n');
    await call('edit_file', { path: p, edits: [{ search: 'const a = 1;', replace: 'const a = 2;' }] });
    expect((await fs.readdir(TMP)).filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });

  it('leaves no temp file behind on failure', async () => {
    const p = uniq('tmp-clean-fail');
    await fs.writeFile(p, 'const a = 1;\n');
    await call('edit_file', { path: p, edits: [{ search: 'nope', replace: 'x' }] });
    expect((await fs.readdir(TMP)).filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });

  // SOURCE CONTRACT. A torn write cannot be provoked from a unit test — it needs
  // a crash or a full disk mid-fs.writeFile — so behaviour alone cannot pin
  // this. What CAN be pinned is that no mutating path bypasses the atomic
  // helper, which is the property that makes a torn write impossible. Same
  // family as routeSecurity.test.js: the bug being guarded against is a wiring
  // failure, and wiring is not observable from the outside.
  it('every mutating path goes through writeFileAtomic', async () => {
    const src = await fs.readFile(new URL('./codeTools.js', import.meta.url), 'utf8');

    // Exactly one temp+rename implementation.
    expect(src).toMatch(/async function writeFileAtomic\(/);
    expect(src.match(/fs\.rename\(/g)).toHaveLength(1);

    // Both case bodies call it.
    expect(src.match(/await writeFileAtomic\(absPath/g)).toHaveLength(2);

    // The ONLY direct writes to the destination live inside writeFileAtomic
    // (the temp file, and the documented transient-lock fallback).
    const helper = src.slice(src.indexOf('async function writeFileAtomic('), src.indexOf('async function readTextFile('));
    const directWrites = src.match(/fs\.writeFile\(absPath/g) || [];
    const directWritesInHelper = helper.match(/fs\.writeFile\(absPath/g) || [];
    expect(directWrites.length).toBe(directWritesInHelper.length);
  });
});

// ------------------------------------------------------------ did-you-mean ---

describe('a failed search comes back with the file\'s real text', () => {
  const SOURCE = [
    'function boot() {',
    '  // rm-then-extract order, section 3.1 gotcha G2',
    '  const cfg = loadConfig({ retries: 3 });',
    '  return cfg;',
    '}',
    '',
  ].join('\n');

  it('names the nearest real line and tells the caller to copy it verbatim', async () => {
    const p = uniq('nearmiss');
    await fs.writeFile(p, SOURCE);
    const r = await call('edit_file', {
      path: p,
      edits: [{ search: '  // rt-then-extract order, section 3.1 gotcha G2', replace: '  // fixed' }],
    });

    expect(r.success).toBe(false);
    const cand = r.failed[0].didYouMean[0];
    expect(cand.startLine).toBe(2);
    expect(cand.actual).toContain('rm-then-extract');
    expect(r.failed[0].hint).toMatch(/verbatim/i);
    expect(r.totalLines).toBe(5);
  });

  it('does not fabricate a candidate when nothing is close', async () => {
    const p = uniq('nocand');
    await fs.writeFile(p, SOURCE);
    const r = await call('edit_file', {
      path: p,
      edits: [{ search: 'const quantumFlux = new Reactor({ core: true });', replace: 'x' }],
    });
    expect(r.failed[0].didYouMean).toBeUndefined();
    expect(r.failed[0].hint).toMatch(/Re-read the file/i);
  });

  // Found by the live suite, not by a unit test: the batch message told the
  // caller to "use didYouMean below" on a failure that had no didYouMean at all.
  // Pointing at an absent field costs the exact round trip this diagnostic
  // exists to save, so the remedy sentence has to track what is really there.
  it('the remedy sentence names didYouMean only when candidates exist', async () => {
    const p = uniq('remedy-with');
    await fs.writeFile(p, SOURCE);
    const r = await call('edit_file', {
      path: p,
      edits: [{ search: '  // rt-then-extract order, section 3.1 gotcha G2', replace: 'x' }],
    });
    expect(r.failed[0].didYouMean).toBeDefined();
    expect(r.message).toMatch(/didYouMean/);
    expect(r.message).toMatch(/verbatim/i);
  });

  it('the remedy sentence says re-read when there is nothing to suggest', async () => {
    const p = uniq('remedy-without');
    await fs.writeFile(p, SOURCE);
    const r = await call('edit_file', {
      path: p,
      edits: [{ search: 'const quantumFlux = new Reactor({ core: true });', replace: 'x' }],
    });
    expect(r.failed[0].didYouMean).toBeUndefined();
    expect(r.message).not.toMatch(/didYouMean/);
    expect(r.message).toMatch(/nothing to suggest/i);
    expect(r.message).toMatch(/right path/i);
  });

  it('a mixed batch still points at the candidates it does have', async () => {
    const p = uniq('remedy-mixed');
    await fs.writeFile(p, SOURCE);
    const r = await call('edit_file', {
      path: p,
      edits: [
        { search: '  // rt-then-extract order, section 3.1 gotcha G2', replace: 'x' },
        { search: 'const quantumFlux = new Reactor({ core: true });', replace: 'y' },
      ],
    });
    expect(r.failed).toHaveLength(2);
    expect(r.message).toMatch(/didYouMean/);
  });
});

// ------------------------------------------------------------- grounding ----

describe('a failure names the unread-file condition when it applies', () => {
  // MEASURED, full production history: an edit against a file the execution had
  // never read failed at 7.4%; one against a file it had read failed at 4.9%.
  // A 1.51x lift is worth naming on the failure path — but only there. Forcing
  // a read before every edit would cap out at 17% of failures (the other 50%
  // occur on files that WERE read) at a cost of ~40 extra reads per failure
  // prevented, which is why this is a hint and not a gate.
  it('says so when the file has never been read in this session', async () => {
    const p = uniq('ungrounded');
    await fs.writeFile(p, 'const alpha = 1;\n');
    const r = await call('edit_file', { path: p, edits: [{ search: 'const beta = 2;', replace: 'x' }] });

    expect(r.success).toBe(false);
    expect(r.grounding).toMatch(/has not been read/i);
    expect(r.message).toMatch(/from memory/i);
    expect(r.message).toMatch(/read_file/);
  });

  it('stays SILENT when the file was already read — a false nag is worse than a missed one', async () => {
    const p = uniq('grounded');
    await fs.writeFile(p, 'const alpha = 1;\n');
    await call('read_file', { path: p });
    const r = await call('edit_file', { path: p, edits: [{ search: 'const beta = 2;', replace: 'x' }] });

    expect(r.success).toBe(false);
    expect(r.grounding).toBeUndefined();
    expect(r.message).not.toMatch(/from memory/i);
  });

  it('a prior write also counts as grounding', async () => {
    // A file this session just wrote is known perfectly; nagging about it would
    // be noise on a path that is already correct.
    const p = uniq('written');
    await call('write_file', { path: p, content: 'const alpha = 1;\n' });
    const r = await call('edit_file', { path: p, edits: [{ search: 'const beta = 2;', replace: 'x' }] });

    expect(r.success).toBe(false);
    expect(r.grounding).toBeUndefined();
  });

  it('never appears on a successful edit', async () => {
    const p = uniq('happy');
    await fs.writeFile(p, 'const alpha = 1;\n');
    const r = await call('edit_file', { path: p, edits: [{ search: 'const alpha = 1;', replace: 'const alpha = 2;' }] });

    expect(r.success).toBe(true);
    expect(r.grounding).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/from memory/i);
  });
});

// ------------------------------------------------------- argument validation --

describe('edit_file validates the shape of its own arguments', () => {
  it('accepts a JSON-stringified edits array (7 real production calls)', async () => {
    const p = uniq('stringified');
    await fs.writeFile(p, 'const a = 1;\n');
    const r = await call('edit_file', {
      path: p,
      edits: JSON.stringify([{ search: 'const a = 1;', replace: 'const a = 5;' }]),
    });
    expect(r.success).toBe(true);
    expect(await read(p)).toBe('const a = 5;\n');
  });

  it('rejects a non-array edits parameter with a message naming the problem', async () => {
    const p = uniq('badshape');
    await fs.writeFile(p, 'const a = 1;\n');
    const r = await call('edit_file', { path: p, edits: { search: 'a', replace: 'b' } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/must be an array/);
  });

  it('rejects an empty search rather than splicing at an arbitrary offset', async () => {
    const p = uniq('emptysearch');
    const before = 'const a = 1;\n';
    await fs.writeFile(p, before);
    const r = await call('edit_file', { path: p, edits: [{ search: '', replace: 'INJECTED' }] });
    expect(r.success).toBe(false);
    expect(await read(p)).toBe(before);
  });

  it('rejects an empty edits array', async () => {
    const p = uniq('emptyarray');
    await fs.writeFile(p, 'x');
    const r = await call('edit_file', { path: p, edits: [] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least one/i);
  });

  it('allows an empty replace — deletion is a legitimate edit', async () => {
    const p = uniq('deletion');
    await fs.writeFile(p, 'keep\nDELETE_ME\nkeep2\n');
    const r = await call('edit_file', { path: p, edits: [{ search: 'DELETE_ME\n', replace: '' }] });
    expect(r.success).toBe(true);
    expect(await read(p)).toBe('keep\nkeep2\n');
  });
});

// ------------------------------------------------------------ search tools ---

describe('grep_files and glob_files are wired into the tool surface', () => {
  it('are exposed as schemas so the dispatcher and validator can see them', () => {
    const names = getCodeToolSchemas().map((s) => s.function.name);
    expect(names).toContain('grep_files');
    expect(names).toContain('glob_files');
  });

  it('grep_files returns structured hits', async () => {
    await fs.mkdir(path.join(TMP, 'proj/src'), { recursive: true });
    await fs.writeFile(path.join(TMP, 'proj/src/a.js'), 'export function target() {}\n');
    const r = await call('grep_files', { path: path.join(TMP, 'proj'), pattern: 'function target' });
    expect(r.success).toBe(true);
    expect(r.matches[0]).toMatchObject({ path: 'src/a.js', line: 1 });
  });

  it('grep_files explains an invalid regex instead of throwing', async () => {
    const r = await call('grep_files', { path: TMP, pattern: '(' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/literal: true/);
  });

  it('grep_files requires a pattern', async () => {
    const r = await call('grep_files', { path: TMP });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/'pattern'/);
  });

  it('glob_files finds files recursively and reports a helpful miss', async () => {
    await fs.mkdir(path.join(TMP, 'g/src/deep'), { recursive: true });
    await fs.writeFile(path.join(TMP, 'g/src/deep/x.vue'), '<template/>');
    const hit = await call('glob_files', { path: path.join(TMP, 'g'), pattern: '**/*.vue' });
    expect(hit.files.map((f) => f.path)).toEqual(['src/deep/x.vue']);
    expect(hit.count).toBe(1);

    const miss = await call('glob_files', { path: path.join(TMP, 'g'), pattern: '**/*.rs' });
    expect(miss.success).toBe(true);
    expect(miss.files).toEqual([]);
    expect(miss.message).toMatch(/match the file name at any depth/);
  });

  it('both refuse to escape the workspace via a relative path', async () => {
    for (const tool of ['grep_files', 'glob_files']) {
      let threw = null;
      try {
        await executeCodeFunction(tool, { path: '../../../..', pattern: 'x' });
      } catch (err) { threw = err.message; }
      expect(threw).toMatch(/traversal/i);
    }
  });
});
