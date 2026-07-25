/**
 * Regression gate for concurrent file-tool dispatch.
 *
 * WHAT HAPPENED (2026-07-25)
 * --------------------------
 * Two `edit_file` calls issued in the SAME assistant message raced, and the
 * second silently clobbered the first. Four edits vanished; the tool reported
 * "Applied 1/1 edits" and `success: true` for both calls.
 *
 * ROOT CAUSE
 * ----------
 * The orchestrator runs every tool call in a message concurrently:
 *
 *     const toolPromises = toolCalls.map(async (toolCall) => { ... });
 *     const toolResponses = await Promise.all(toolPromises);
 *
 * `edit_file` is a read-modify-write with no lock, so two calls on one path
 * interleave:
 *
 *     A:  read v0 ----------> write v0+A
 *     B:  ....... read v0 -------------------> write v0+B      A is gone
 *
 * Both succeed truthfully — each found its search string in the copy it read.
 * Nothing anywhere reports a problem. That silence is the whole danger.
 *
 * THE FIX
 * -------
 * A per-resolved-path lock around the path-scoped tools. Same file serializes;
 * different files stay fully parallel.
 *
 * The load-bearing assertion in this file is "BOTH markers survive". Remove the
 * lock and `lands both concurrent edits` fails immediately and deterministically.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executeCodeFunction } from './codeTools.js';

const edit = async (args) => JSON.parse(await executeCodeFunction('edit_file', args));
const write = async (args) => JSON.parse(await executeCodeFunction('write_file', args));
const readTool = async (args) => JSON.parse(await executeCodeFunction('read_file', args));

let TMP;
const read = (p) => fs.readFile(p, 'utf8');

/**
 * Fixture carrying several independent, uniquely-named anchors so each
 * concurrent call can target its own line and any lost update is unambiguous.
 */
const LINES = [
  '// top of file',
  'function demo() {',
  '  const ALPHA_MARKER = 1;',
  '  const BETA_MARKER = 2;',
  '  const GAMMA_MARKER = 3;',
  '  const DELTA_MARKER = 4;',
  '  const EPSILON_MARKER = 5;',
  '  return 0;',
  '}',
  '',
];

async function fixture(name, eol = '\r\n') {
  TMP = TMP || (await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-concurrency-')));
  const p = path.join(TMP, name);
  await fs.writeFile(p, LINES.join(eol), 'utf8');
  return p;
}

let n = 0;
const uniq = (base) => `${base}-${++n}.js`;

afterAll(async () => {
  if (TMP) await fs.rm(TMP, { recursive: true, force: true });
});

describe('edit_file — concurrent dispatch on one path', () => {
  it('lands both concurrent edits (the lost-update gate)', async () => {
    const p = await fixture(uniq('lost-update'));

    const [a, b] = await Promise.all([
      edit({ path: p, description: 'alpha', edits: [{ search: 'ALPHA_MARKER', replace: 'ALPHA_APPLIED' }] }),
      edit({ path: p, description: 'beta', edits: [{ search: 'BETA_MARKER', replace: 'BETA_APPLIED' }] }),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);

    const out = await read(p);
    // Without the lock exactly one of these two is missing, at random.
    expect(out).toContain('ALPHA_APPLIED');
    expect(out).toContain('BETA_APPLIED');
    expect(out).not.toContain('ALPHA_MARKER');
    expect(out).not.toContain('BETA_MARKER');
  });

  it('lands all five edits when five calls race', async () => {
    const p = await fixture(uniq('five-way'));
    const names = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'];

    const results = await Promise.all(
      names.map((nm) =>
        edit({ path: p, description: nm, edits: [{ search: `${nm}_MARKER`, replace: `${nm}_APPLIED` }] })
      )
    );

    for (const r of results) expect(r.success).toBe(true);

    const out = await read(p);
    for (const nm of names) {
      expect(out).toContain(`${nm}_APPLIED`);
      expect(out).not.toContain(`${nm}_MARKER`);
    }
  });

  it('preserves the file structure — no line count drift under concurrency', async () => {
    const p = await fixture(uniq('structure'));
    const before = (await read(p)).split(/\r\n|\n/).length;

    await Promise.all([
      edit({ path: p, description: 'a', edits: [{ search: 'ALPHA_MARKER', replace: 'ALPHA_APPLIED' }] }),
      edit({ path: p, description: 'b', edits: [{ search: 'GAMMA_MARKER', replace: 'GAMMA_APPLIED' }] }),
      edit({ path: p, description: 'c', edits: [{ search: 'EPSILON_MARKER', replace: 'EPSILON_APPLIED' }] }),
    ]);

    const after = await read(p);
    expect(after.split(/\r\n|\n/).length).toBe(before);
    // A welded line break would leave two statements on ONE line. The class is
    // deliberately horizontal-only: `\s` spans the legitimate CRLF separating
    // every statement in the fixture, so `/;\s{2,}const /` matches clean output.
    expect(after).not.toMatch(/;[ \t]{2,}const /);
  });

  it('reports a stale search LOUDLY rather than discarding the other edit', async () => {
    const p = await fixture(uniq('stale-search'));

    // Both target the same line. Whichever runs second cannot match, and must
    // say so — the failure mode being fixed is it silently winning instead.
    const [a, b] = await Promise.all([
      edit({ path: p, description: 'first', edits: [{ search: 'const ALPHA_MARKER = 1;', replace: 'const ALPHA_ONE = 1;' }] }),
      edit({ path: p, description: 'second', edits: [{ search: 'const ALPHA_MARKER = 1;', replace: 'const ALPHA_TWO = 1;' }] }),
    ]);

    const ok = [a, b].filter((r) => r.success);
    const bad = [a, b].filter((r) => !r.success);
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].failed?.[0]?.reason).toBe('Search string not found');

    const out = await read(p);
    // Exactly one winner, and the original is gone.
    expect(/ALPHA_ONE|ALPHA_TWO/.test(out)).toBe(true);
    expect(out).not.toContain('ALPHA_MARKER');
  });

  it('releases the lock after a failed edit', async () => {
    const p = await fixture(uniq('release-on-failure'));

    const miss = await edit({ path: p, description: 'miss', edits: [{ search: 'NOT_PRESENT_ANYWHERE', replace: 'x' }] });
    expect(miss.success).toBe(false);

    // If the lock leaked on the failure path this would hang and time out.
    const hit = await edit({ path: p, description: 'hit', edits: [{ search: 'BETA_MARKER', replace: 'BETA_APPLIED' }] });
    expect(hit.success).toBe(true);
    expect(await read(p)).toContain('BETA_APPLIED');
  });

  it('releases the lock after a missing-file error', async () => {
    const ghost = path.join(TMP || os.tmpdir(), 'does-not-exist.js');
    const r = await edit({ path: ghost, description: 'ghost', edits: [{ search: 'a', replace: 'b' }] });
    expect(r.success).toBe(false);

    // Same path, now created: proves the earlier error did not wedge the key.
    const w = await write({ path: ghost, content: 'const GHOST_MARKER = 1;\n' });
    expect(w.success).toBe(true);
    await fs.rm(ghost, { force: true });
  });
});

describe('file tools — cross-path independence', () => {
  it('does not cross-contaminate concurrent edits to different files', async () => {
    const files = await Promise.all([fixture(uniq('iso')), fixture(uniq('iso')), fixture(uniq('iso'))]);
    const tags = ['ONE', 'TWO', 'THREE'];

    await Promise.all(
      files.map((p, i) =>
        edit({ path: p, description: tags[i], edits: [{ search: 'ALPHA_MARKER', replace: `ALPHA_${tags[i]}` }] })
      )
    );

    for (let i = 0; i < files.length; i++) {
      const out = await read(files[i]);
      expect(out).toContain(`ALPHA_${tags[i]}`);
      for (const other of tags.filter((t) => t !== tags[i])) {
        expect(out).not.toContain(`ALPHA_${other}`);
      }
    }
  });

  it('serializes a write against a concurrent edit on the same path', async () => {
    const p = await fixture(uniq('write-vs-edit'));

    const [w, e] = await Promise.all([
      write({ path: p, content: LINES.join('\r\n').replace('ALPHA_MARKER', 'ALPHA_FROM_WRITE') }),
      edit({ path: p, description: 'edit', edits: [{ search: 'BETA_MARKER', replace: 'BETA_FROM_EDIT' }] }),
    ]);

    expect(w.success).toBe(true);
    expect(e.success).toBe(true);

    // Whichever order they ran in, the file must be a whole, parseable document
    // — never a torn interleave of the two buffers.
    const out = await read(p);
    expect(out).toContain('function demo() {');
    expect(out.match(/function demo\(\) \{/g)).toHaveLength(1);
    expect(out.endsWith('\r\n') || out.endsWith('\n')).toBe(true);
  });

  it('never returns a torn read while a write is in flight', async () => {
    const p = await fixture(uniq('torn-read'));
    const full = LINES.join('\r\n');

    const results = await Promise.all([
      write({ path: p, content: full }),
      readTool({ path: p }),
      write({ path: p, content: full }),
      readTool({ path: p }),
    ]);

    for (const r of results) expect(r.success).toBe(true);
    for (const r of results.filter((x) => typeof x.content === 'string')) {
      // Any read must see a complete document, opening and closing brace intact.
      expect(r.content).toContain('function demo() {');
      expect(r.content.trimEnd().endsWith('}')).toBe(true);
    }
  });
});

describe('lock scoping', () => {
  it('treats the same file reached by different path casing as one lock (win32)', async () => {
    if (process.platform !== 'win32') return;
    const p = await fixture(uniq('casing'));

    const [a, b] = await Promise.all([
      edit({ path: p.toUpperCase(), description: 'upper', edits: [{ search: 'ALPHA_MARKER', replace: 'ALPHA_APPLIED' }] }),
      edit({ path: p.toLowerCase(), description: 'lower', edits: [{ search: 'BETA_MARKER', replace: 'BETA_APPLIED' }] }),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);

    const out = await read(p);
    expect(out).toContain('ALPHA_APPLIED');
    expect(out).toContain('BETA_APPLIED');
  });

  it('leaves non-path tools untouched', async () => {
    const r = JSON.parse(await executeCodeFunction('definitely_not_a_tool', {}));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown function/);
  });
});
