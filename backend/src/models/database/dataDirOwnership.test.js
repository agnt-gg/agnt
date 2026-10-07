import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  acquireDataDirOwnership,
  isDataDirOwner,
  releaseDataDirOwnershipForTests,
} from './dataDirOwnership.js';

const MODULE_URL = pathToFileURL(path.resolve(__dirname, 'dataDirOwnership.js')).href;

/**
 * A separate OS process that tries to take ownership, prints the result, and
 * then either exits or holds the lock until killed. Ownership is a cross-process
 * property, so it is only meaningful to test it across real processes.
 */
function startContender(dir, { hold = false } = {}) {
  const script = `
    const { acquireDataDirOwnership } = await import(${JSON.stringify(MODULE_URL)});
    const result = await acquireDataDirOwnership(${JSON.stringify(dir)});
    process.stdout.write(JSON.stringify(result) + '\\n');
    if (${hold}) setInterval(() => {}, 1 << 30); else process.exit(0);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const firstLine = new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const nl = out.indexOf('\n');
      if (nl >= 0) resolve(JSON.parse(out.slice(0, nl)));
    });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('exit', (code) => { if (!out.includes('\n')) reject(new Error(`contender exited ${code}: ${err}`)); });
  });
  return { child, firstLine };
}

function waitForExit(child) {
  return new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.on('exit', resolve)));
}

describe('data-dir ownership', () => {
  const dirs = [];
  const children = [];
  const freshDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-owner-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(async () => {
    for (const child of children.splice(0)) { child.kill(); await waitForExit(child); }
    await releaseDataDirOwnershipForTests();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('grants ownership of an unclaimed data dir', async () => {
    const dir = freshDir();
    await expect(acquireDataDirOwnership(dir)).resolves.toEqual({ owner: true });
    await expect(isDataDirOwner()).resolves.toBe(true);
  });

  it('refuses a second process while the first is alive — the bug: a chat-run import swept the live app', async () => {
    const dir = freshDir();
    await expect(acquireDataDirOwnership(dir)).resolves.toEqual({ owner: true });

    const { child, firstLine } = startContender(dir);
    children.push(child);
    await expect(firstLine).resolves.toEqual({ owner: false, reason: 'held_by_another_process' });
  }, 20_000);

  it('the kernel releases ownership when the holder dies, however it dies', async () => {
    const dir = freshDir();
    const holder = startContender(dir, { hold: true });
    children.push(holder.child);
    await expect(holder.firstLine).resolves.toEqual({ owner: true });

    await expect(acquireDataDirOwnership(dir)).resolves.toMatchObject({ owner: false });
    await releaseDataDirOwnershipForTests();

    holder.child.kill('SIGKILL'); // no cleanup code runs: only the OS can release it
    await waitForExit(holder.child);
    await expect(acquireDataDirOwnership(dir)).resolves.toEqual({ owner: true });
  }, 20_000);

  it('waits out a predecessor that is still exiting — an app restart must not lose ownership to itself', async () => {
    const dir = freshDir();
    const holder = startContender(dir, { hold: true });
    children.push(holder.child);
    await expect(holder.firstLine).resolves.toEqual({ owner: true });

    const acquiring = acquireDataDirOwnership(dir, { waitMs: 10_000 });
    setTimeout(() => holder.child.kill('SIGKILL'), 500);
    await expect(acquiring).resolves.toEqual({ owner: true });
  }, 20_000);

  it('reports non-owner, without throwing, before ownership was ever requested', async () => {
    await expect(isDataDirOwner()).resolves.toBe(false);
  });

  it('fails closed when the data dir is unusable', async () => {
    const missing = path.join(freshDir(), 'does', 'not', 'exist');
    const result = await acquireDataDirOwnership(missing);
    expect(result.owner).toBe(false);
    await expect(isDataDirOwner()).resolves.toBe(false);
  });
});
