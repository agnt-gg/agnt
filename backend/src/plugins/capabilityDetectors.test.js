import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { scanCapabilities } from '../../plugins/lib/validate-core.js';

// `fileURLToPath`, not `new URL(...).pathname`. On Windows the pathname of a
// file URL is `/C:/Users/...` — a URL path, not a filesystem path — and the
// leading slash makes `path.resolve` treat it as drive-relative, producing
// `C:\C:\Users\...` and an ENOENT on all three reads below. Linux CI cannot
// see this because there the two forms happen to coincide.
//
// This is the form server.js and every script in plugins/cli/ already uses;
// sign-plugin.js carries a hand-rolled `.replace(/^\/([A-Za-z]:)/, '$1')` for
// the same reason, which is the workaround this avoids needing.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILL_MD = path.join(REPO_ROOT, 'backend/skills/agnt-plugin-builder/SKILL.md');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'backend/plugins/cli/build-plugin.js');
const VALIDATE_CORE = path.join(REPO_ROOT, 'backend/plugins/lib/validate-core.js');

/**
 * Capability disclosure must not depend on how a builtin is spelled.
 *
 * WHY THIS EXISTS
 * ---------------
 * `node:child_process` and `child_process` are the same module. The scanner
 * detected only the second. The filesystem detectors already accepted both
 * spellings (`fs` and `node:fs`), so the inconsistency was internal to one
 * object literal — one rule written two ways, which is exactly the kind of
 * thing nothing notices.
 *
 * It was not theoretical. A plugin built on this machine imports
 * `node:child_process` and shells out to python3, and the build reported:
 *
 *     Detected: filesystem, env-access
 *
 * with no `spawn-process`. The two call-shape patterns did not cover it
 * either — `execFile(...)` only matches when the first argument is a quoted
 * literal, and a plugin resolving its binary from a variable or `process.env`
 * never has one. That plugin declared spawn-process by hand, so the union
 * model granted it; a plugin that stayed quiet would have shipped
 * undisclosed.
 *
 * The parity test at the bottom is a ratchet: it fails when a NEW builtin is
 * added to any detector in only one of its two spellings.
 */

/** Builtins the import detectors claim to recognise, in either spelling. */
const DETECTED_BUILTINS = [
  ['child_process', 'spawn-process'],
  ['fs', 'filesystem'],
  ['fs/promises', 'filesystem'],
  ['http', 'network'],
  ['https', 'network'],
];

let dir;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-capscan-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** Write one source file into the scan directory and return the capabilities found. */
async function scan(source, filename = 'index.js') {
  await fsp.writeFile(path.join(dir, filename), source, 'utf8');
  const result = await scanCapabilities(dir);
  return {
    caps: Object.keys(result.capabilities).sort(),
    detail: result.capabilities,
    filesScanned: result.filesScanned,
    scanFailed: result.scanFailed,
  };
}

describe('spawn-process — the node: prefix', () => {
  it.each([
    ['static import', "import { execFile } from 'node:child_process';"],
    ['require', "const cp = require('node:child_process');"],
    ['dynamic import', "const cp = await import('node:child_process');"],
  ])('detects a %s of node:child_process', async (_label, source) => {
    const { caps } = await scan(source);
    expect(caps).toContain('spawn-process');
  });

  it.each([
    ['static import', "import { execFile } from 'child_process';"],
    ['require', "const cp = require('child_process');"],
    ['dynamic import', "const cp = await import('child_process');"],
  ])('still detects a %s of bare child_process', async (_label, source) => {
    const { caps } = await scan(source);
    expect(caps).toContain('spawn-process');
  });

  it('reports evidence with a file and a line number', async () => {
    const source = ['// header', '', "import { execFile } from 'node:child_process';"].join('\n');
    const { detail } = await scan(source);

    const hits = detail['spawn-process'];
    expect(Array.isArray(hits)).toBe(true);
    expect(hits[0].file).toBe('index.js');
    // The consent modal renders this; an unlocatable finding is not evidence.
    expect(hits[0].line).toBe(3);
  });
});

describe('the real shape that evaded disclosure', () => {
  it('detects a prefixed import whose exec call takes a variable', async () => {
    // Reduced from a plugin that actually shipped: the binary is resolved at
    // call time, so no call-shape pattern can see a quoted literal.
    const source = [
      "import { execFile } from 'node:child_process';",
      '',
      'export function run(args) {',
      "  const python = process.env.GROKBOT_PYTHON || 'python3';",
      '  return new Promise((resolve) => execFile(python, args, resolve));',
      '}',
    ].join('\n');

    const { caps } = await scan(source);

    expect(caps).toContain('spawn-process');
    // env-access comes along for the ride; the point is spawn-process is there.
    expect(caps).toContain('env-access');
  });

  it('would not have been caught by the call-shape patterns alone', async () => {
    // Same call, no import line: proves the import detector is what does the
    // work here, rather than the test passing for an incidental reason.
    const source = [
      'export function run(python, args) {',
      '  return execFile(python, args, () => {});',
      '}',
    ].join('\n');

    const { caps } = await scan(source);
    expect(caps).not.toContain('spawn-process');
  });
});

describe('other detectors are unchanged', () => {
  it.each([
    ['node:fs', 'filesystem'],
    ['fs', 'filesystem'],
    ['node:fs/promises', 'filesystem'],
    ['node:https', 'network'],
    ['https', 'network'],
  ])('still detects an import of %s as %s', async (specifier, capability) => {
    const { caps } = await scan(`import x from '${specifier}';`);
    expect(caps).toContain(capability);
  });

  it('detects nothing in a file that does nothing', async () => {
    const { caps, filesScanned } = await scan('export const answer = 42;\n');
    expect(caps).toEqual([]);
    expect(filesScanned).toBe(1);
  });

  it('skips full-line comments, so a mention is not a usage', async () => {
    const source = ["// we deliberately avoid require('node:child_process') here", 'export const x = 1;'].join(
      '\n'
    );
    const { caps } = await scan(source);
    expect(caps).not.toContain('spawn-process');
  });
});

describe('spelling parity — ratchet', () => {
  /**
   * Every builtin the import detectors recognise must be recognised in BOTH
   * spellings. This is the test that fails when someone adds a new builtin in
   * one form only, which is how the child_process gap arrived.
   */
  it.each(DETECTED_BUILTINS)('%s discloses %s whether or not it is node:-prefixed', async (mod, capability) => {
    const bare = await scan(`import x from '${mod}';`, 'bare.js');
    const prefixed = await scan(`import x from 'node:${mod}';`, 'prefixed.js');

    expect(bare.caps).toContain(capability);
    expect(prefixed.caps).toContain(capability);
    // Not just "both non-empty" — the same conclusion from the same fact.
    expect(prefixed.caps).toEqual(bare.caps);
  });

  it('documents net as a known gap rather than leaving it silent', async () => {
    // `net` has a method-shape detector (`net.connect(...)`) but no import
    // detector in EITHER spelling, so this is a missing module rather than a
    // missing prefix — out of scope here, asserted so it stays visible.
    const { caps } = await scan("import net from 'node:net';");
    expect(caps).not.toContain('network');
  });
});

describe('the plugin-builder skill matches the code it documents', () => {
  /**
   * The skill is the instructions an agent follows to build a plugin, and it
   * described a manifest the build script rejects: `permissions` became
   * mandatory and the skill never mentioned it, so every plugin built from
   * these instructions failed at the build step until someone read the source.
   *
   * Documentation drifts silently. These assertions make it drift loudly.
   */
  it('documents every capability the scanner can detect', async () => {
    const source = await fsp.readFile(VALIDATE_CORE, 'utf8');
    const block = source.match(/const CAPABILITY_DETECTORS = \{([\s\S]*?)\n\};/);
    expect(block).not.toBeNull();

    const capabilities = [...block[1].matchAll(/^\s{2}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
    expect(capabilities.length).toBeGreaterThan(0);

    const doc = await fsp.readFile(SKILL_MD, 'utf8');
    const undocumented = capabilities.filter((c) => !doc.includes(`\`${c}\``));
    expect(undocumented).toEqual([]);
  });

  it('quotes the build failure verbatim, so the message can be searched for', async () => {
    const build = await fsp.readFile(BUILD_SCRIPT, 'utf8');
    const doc = await fsp.readFile(SKILL_MD, 'utf8');

    const message = 'manifest.json must contain structured permissions.capabilities and permissions.domains arrays';
    expect(build).toContain(message);

    // Scope to the fenced block that shows the failure. Searching the whole
    // document would let a paraphrase here pass on the strength of the pitfalls
    // table further down, which is how this assertion first survived a mutant.
    const errorBlock = doc.match(/```\n(\u274c[\s\S]*?)```/);
    expect(errorBlock, 'SKILL.md must show the build failure in a fenced block').not.toBeNull();

    // The doc wraps the sentence across lines; flatten before comparing so the
    // test pins the words, not the line breaks.
    expect(errorBlock[1].replace(/\s+/g, ' ').trim()).toContain(message);

    // ...and because it wraps, that block cannot be found by anyone pasting the
    // error into a search box. Somewhere in the document an unbroken fragment
    // has to exist — today the pitfalls table carries it. Deliberately
    // unscoped: the contract is "findable", not "findable in one place".
    expect(doc).toContain('must contain structured permissions');
  });

  it('shows a permissions block in the manifest example', async () => {
    const doc = await fsp.readFile(SKILL_MD, 'utf8');

    // The example an agent copies is the FIRST json block under this heading.
    // Asserting against the whole document passed even with the block deleted
    // from the example, because the explanatory section further down has one
    // too — the test named a place it never looked at.
    const section = doc.split('### `manifest.json` essentials')[1];
    expect(section, 'SKILL.md must keep the manifest.json essentials section').toBeDefined();

    const example = section.match(/```json\n([\s\S]*?)```/);
    expect(example, 'that section must contain a json example').not.toBeNull();

    expect(example[1]).toMatch(/"permissions":\s*\{/);
    expect(example[1]).toContain('"capabilities"');
    expect(example[1]).toContain('"domains"');
  });
});
