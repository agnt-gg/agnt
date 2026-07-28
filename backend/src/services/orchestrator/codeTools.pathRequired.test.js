/**
 * Regression gate: a missing path must never resolve to the workspace root.
 *
 * WHAT HAPPENED (measured 2026-07-28)
 * -----------------------------------
 * `validatePath` read `path.resolve(workspaceRoot, inputPath || '')`. When the
 * caller supplied no path, `''` resolved to the workspace ROOT DIRECTORY, and
 * `fs.readFile` on a directory raised:
 *
 *     EISDIR: illegal operation on a directory, read
 *
 * That error names the symptom (something read a directory) and hides the
 * cause (no path was given). It is the same sentinel-collision shape as
 * treating `0` as "unset": the empty string is a legitimate value that happens
 * to mean something catastrophic here, so it must be rejected explicitly
 * rather than defaulted.
 *
 * The upstream truncation that produced the empty arguments is fixed in the
 * adapter, and the orchestrator gate blocks schema-invalid calls. This is the
 * last line of defence: even with both bypassed, the file tools must fail with
 * a sentence that tells the truth.
 *
 * NOTE ON `list_files`: it is deliberately exempt. A directory listing with no
 * argument coherently means "the workspace root"; reading a file with no name
 * does not. That distinction is pinned below — the first version of this fix
 * applied the rule blanket-wide and broke `list_files`, which these tests
 * caught.
 *
 * CONTRACT: `executeCodeFunction` returns a JSON STRING, and `validatePath`
 * throws rather than returning a failure object. Both are asserted as-is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { executeCodeFunction } from './codeTools.js';

let tmpDir;
let realFile;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-pathreq-'));
  realFile = path.join(tmpDir, 'real.txt');
  await fs.writeFile(realFile, 'line one\nline two\n', 'utf-8');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

/** Run a code tool and capture EITHER the parsed result or the thrown message. */
async function attempt(name, args) {
  try {
    const raw = await executeCodeFunction(name, args);
    return { result: JSON.parse(raw), raw, threw: null };
  } catch (err) {
    return { result: null, raw: '', threw: err.message };
  }
}

const MISSING_PATHS = [
  ['undefined', undefined],
  ['null', null],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['tab only', '\t'],
];

describe('file tools reject a missing path instead of reading the workspace directory', () => {
  for (const [label, value] of MISSING_PATHS) {
    it(`edit_file fails with a truthful message when path is ${label}`, async () => {
      const { raw, threw } = await attempt('edit_file', {
        path: value,
        edits: [{ search: 'a', replace: 'b' }],
        description: 'x',
      });

      const blob = raw + String(threw || '');
      expect(blob).not.toMatch(/EISDIR/i);
      expect(blob).not.toMatch(/illegal operation on a directory/i);
      expect(blob).toMatch(/Missing required parameter 'path'/);
    });
  }

  it('reproduces the exact production call shape — edit_file with {} — without EISDIR', async () => {
    // Verbatim what 73 production calls looked like.
    const { raw, threw } = await attempt('edit_file', {});
    const blob = raw + String(threw || '');
    expect(blob).not.toMatch(/EISDIR/i);
    expect(blob).toMatch(/Missing required parameter 'path'/);
  });

  it('read_file rejects a missing path', async () => {
    const { raw, threw } = await attempt('read_file', {});
    expect(raw + String(threw || '')).toMatch(/Missing required parameter 'path'/);
    expect(raw + String(threw || '')).not.toMatch(/EISDIR/i);
  });

  it('write_file rejects a missing path (never writes into the workspace root)', async () => {
    const { raw, threw } = await attempt('write_file', { content: 'x' });
    expect(raw + String(threw || '')).toMatch(/Missing required parameter 'path'/);
  });

  it('the message tells the caller what to supply, not what went wrong internally', async () => {
    const { threw } = await attempt('read_file', {});
    expect(threw).toMatch(/relative to the workspace/i);
    expect(threw).toMatch(/absolute path/i);
  });
});

describe('no regression: real paths still work exactly as before', () => {
  it('read_file reads an absolute path', async () => {
    const { result } = await attempt('read_file', { path: realFile });
    expect(result.success).toBe(true);
    expect(result.content).toBe('line one\nline two\n');
  });

  it('edit_file still applies edits to an absolute path', async () => {
    const target = path.join(tmpDir, 'edit-me.txt');
    await fs.writeFile(target, 'alpha\nbeta\n', 'utf-8');

    const { result } = await attempt('edit_file', {
      path: target,
      edits: [{ search: 'beta', replace: 'gamma' }],
      description: 'swap',
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(target, 'utf-8')).toBe('alpha\ngamma\n');
  });

  it('write_file still creates nested files under a relative path', async () => {
    const stamp = `__pathreq_probe_${Date.now()}__`;
    const rel = `${stamp}/nested/out.txt`;

    const { result: written } = await attempt('write_file', { path: rel, content: 'hello' });
    expect(written.success).toBe(true);

    const { result: read } = await attempt('read_file', { path: rel });
    expect(read.success).toBe(true);
    expect(read.content).toBe('hello');

    // Clean up the probe tree from the real workspace using the absolute path
    // the tool itself reported (never a reconstructed guess).
    const probeRoot = path.resolve(path.dirname(read.absolutePath), '..');
    expect(path.basename(probeRoot)).toBe(stamp);
    await fs.rm(probeRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('still refuses path traversal outside the workspace', async () => {
    const { raw, threw } = await attempt('read_file', { path: '../../../../etc/passwd' });
    expect(raw + String(threw || '')).toMatch(/traversal/i);
  });

  it('read_file on a real directory still reports the underlying error (not swallowed)', async () => {
    // The guard must not mask genuine EISDIR from an explicitly-named directory.
    const { raw, threw } = await attempt('read_file', { path: tmpDir });
    expect(raw + String(threw || '')).toMatch(/EISDIR/i);
  });
});

describe('`required` means execution-impossible, not merely-useful', () => {
  // FOUND EMPIRICALLY, NOT THEORETICALLY. Replaying 87,843 historical tool
  // calls surfaced 3 real `edit_file` calls that COMPLETED SUCCESSFULLY in
  // production without a `description` — which the schema declared required.
  //
  // `description` is read only to label the success message (codeTools.js
  // ~482/484); the edit itself does not depend on it, and these tests pin
  // that. The guard was subsequently narrowed to block only calls where EVERY
  // required parameter is absent, so an omitted description is no longer at
  // risk of being blocked either way — but a `required` array should still
  // describe what execution actually depends on.
  it('edit_file succeeds without a description (the 3 production calls)', async () => {
    const target = path.join(tmpDir, 'no-description.txt');
    await fs.writeFile(target, 'alpha\nbeta\n', 'utf-8');

    const { result } = await attempt('edit_file', {
      path: target,
      edits: [{ search: 'beta', replace: 'gamma' }],
      // description deliberately absent
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(target, 'utf-8')).toBe('alpha\ngamma\n');
  });

  it('edit_file no longer declares description required', async () => {
    const { getCodeToolSchemas } = await import('./codeTools.js');
    const schema = getCodeToolSchemas().find((s) => s.function.name === 'edit_file');

    expect(schema.function.parameters.required).toEqual(['path', 'edits']);
    // Still offered to the model — optional, not absent.
    expect(schema.function.parameters.properties.description).toBeDefined();
  });

  it('path and edits remain required — those genuinely block execution', async () => {
    const { getCodeToolSchemas } = await import('./codeTools.js');
    const schema = getCodeToolSchemas().find((s) => s.function.name === 'edit_file');
    expect(schema.function.parameters.required).toContain('path');
    expect(schema.function.parameters.required).toContain('edits');
  });
});

describe('list_files keeps its documented workspace-root default', () => {
  // The first version of this fix applied the required-path rule to every
  // path-taking tool and broke list_files, whose schema marks `path` optional
  // and documents "Defaults to workspace root". This pins the exemption.
  it('lists the workspace root when called with no path at all', async () => {
    const { result, threw } = await attempt('list_files', {});
    expect(threw).toBeNull();
    expect(result.success).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('lists the workspace root for an empty-string path', async () => {
    const { result } = await attempt('list_files', { path: '' });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('still lists a real subdirectory', async () => {
    const { result } = await attempt('list_files', { path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.items.some((i) => i.name === 'real.txt')).toBe(true);
  });

  it('still refuses traversal', async () => {
    const { raw, threw } = await attempt('list_files', { path: '../../../..' });
    expect(raw + String(threw || '')).toMatch(/traversal/i);
  });
});
