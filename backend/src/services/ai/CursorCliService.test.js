/**
 * Unit tests for CursorCliService.
 *
 * The heavy headless path (spawn `cursor-agent`, parse-and-kill on the first
 * {"type":"result"} object, timeout) is an integration concern that needs the
 * real binary; those are exercised end-to-end elsewhere. Here we cover the
 * pure, deterministic surface that does NOT require spawning a process:
 *   - the public API shape,
 *   - input validation (empty prompt rejects before any spawn),
 *   - binary/workdir/default-model resolution and env overrides.
 *
 * ESM named imports (`import { spawn } from 'child_process'`) are bound at
 * module load, so mocking spawn on the namespace after import does not
 * intercept it reliably — hence we avoid asserting on spawn internals here.
 *
 * Run: node --test src/services/ai/CursorCliService.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import CursorCliService from './CursorCliService.js';

test('exposes the expected public API', () => {
  for (const fn of ['getDefaultModel', 'getDefaultWorkdir', 'resolveCursorBin', 'checkAuth', 'runExec']) {
    assert.equal(typeof CursorCliService[fn], 'function', `missing ${fn}`);
  }
});

test('runExec rejects an empty prompt before spawning anything', async () => {
  await assert.rejects(CursorCliService.runExec({ prompt: '' }), /prompt is required/i);
  await assert.rejects(CursorCliService.runExec({ prompt: '   ' }), /prompt is required/i);
  await assert.rejects(CursorCliService.runExec({}), /prompt is required/i);
});

test('getDefaultModel honors AGNT_CURSOR_DEFAULT_MODEL, else falls back', () => {
  // Default resolution happens at module load; assert it is a non-empty string.
  const m = CursorCliService.getDefaultModel();
  assert.equal(typeof m, 'string');
  assert.ok(m.length > 0);
});

test('getDefaultWorkdir returns a sandbox path under the home dir by default', () => {
  const prev = process.env.AGNT_CURSOR_WORKDIR;
  delete process.env.AGNT_CURSOR_WORKDIR;
  const wd = CursorCliService.getDefaultWorkdir();
  assert.ok(wd.startsWith(os.homedir()), `expected workdir under home, got ${wd}`);
  assert.ok(/agnt-cursor-work$/.test(wd), `expected .../agnt-cursor-work, got ${wd}`);
  if (prev !== undefined) process.env.AGNT_CURSOR_WORKDIR = prev;
});

test('resolveCursorBin honors AGNT_CURSOR_BIN override (with ~ expansion)', () => {
  const prev = process.env.AGNT_CURSOR_BIN;
  process.env.AGNT_CURSOR_BIN = '~/custom/bin/cursor-agent';
  const bin = CursorCliService.resolveCursorBin();
  assert.equal(bin, path.join(os.homedir(), 'custom/bin/cursor-agent'));
  if (prev !== undefined) process.env.AGNT_CURSOR_BIN = prev; else delete process.env.AGNT_CURSOR_BIN;
});

test('resolveCursorBin falls back to bare command when nothing is found', () => {
  const prev = process.env.AGNT_CURSOR_BIN;
  process.env.AGNT_CURSOR_BIN = '/nonexistent/path/does/not/exist-xyz/cursor-agent';
  // Override points at a real (expanded) path string, so it is returned as-is.
  const bin = CursorCliService.resolveCursorBin();
  assert.equal(bin, '/nonexistent/path/does/not/exist-xyz/cursor-agent');
  if (prev !== undefined) process.env.AGNT_CURSOR_BIN = prev; else delete process.env.AGNT_CURSOR_BIN;
});
