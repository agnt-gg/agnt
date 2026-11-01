import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeLegacyFileOperation } from './legacyFileOperation.js';
import { getWorkspaceRoot } from '../../utils/workspaceRoot.js';

/**
 * Bravo, 2026-10-31: file_operations listed `delete` but answered "Unknown file operation: delete", so a
 * test folder could not be cleaned up. Real workspace root (PathManager points it at a vitest temp dir).
 */
const call = async (args) => JSON.parse(await executeLegacyFileOperation(args, null, {}));
let root; let scratch;

beforeEach(async () => {
  root = await getWorkspaceRoot();
  scratch = path.join(root, `delete-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(scratch, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'a.txt'), 'a');
  fs.writeFileSync(path.join(scratch, 'nested', 'b.txt'), 'b');
});
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('file_operations delete', () => {
  it('deletes a file inside the workspace', async () => {
    expect(await call({ operation: 'delete', path: path.join(scratch, 'a.txt') })).toMatchObject({ success: true, deleted: true, type: 'file' });
    expect(fs.existsSync(path.join(scratch, 'a.txt'))).toBe(false);
  });

  it('deletes a folder and everything in it', async () => {
    expect(await call({ operation: 'delete', path: scratch })).toMatchObject({ success: true, type: 'directory' });
    expect(fs.existsSync(scratch)).toBe(false);
  });

  it('never deletes the workspace itself, or anything outside it', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    try {
      for (const target of [root, outside]) {
        expect(await call({ operation: 'delete', path: target }), target).toMatchObject({ success: false, error: expect.stringMatching(/inside the workspace/) });
      }
      expect(fs.existsSync(outside)).toBe(true);
      expect(fs.existsSync(root)).toBe(true);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('a missing path is an error, not a silent success', async () => {
    expect(await call({ operation: 'delete', path: path.join(scratch, 'nope.txt') })).toMatchObject({ success: false });
  });
});
