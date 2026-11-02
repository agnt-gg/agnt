import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceFileService } from './WorkspaceFileService.js';

// bravo smoke test, Nov 2026: the team files API could write and read, but had no delete.
let root, grants, service;
const context = { teamId: 'team', tenantSlug: 'tenant', workspaceId: 'sales' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-files-remove-'));
  grants = new Set(['files.read', 'files.write']);
  service = new WorkspaceFileService({ root, authorize: async (_context, capability) => { if (!grants.has(capability)) throw Object.assign(Error('Denied'), { status: 403 }); } });
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

it('deletes a file the teamspace wrote', async () => {
  await service.write(context, '_smoketest.txt', Buffer.from('hello'));
  expect(await service.remove(context, '_smoketest.txt')).toEqual({ deleted: true });
  expect(await service.list(context)).toEqual([]);
  await expect(service.read(context, '_smoketest.txt')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('needs files.write, exactly as writing does', async () => {
  await service.write(context, 'keep.txt', Buffer.from('x'));
  grants.delete('files.write');
  await expect(service.remove(context, 'keep.txt')).rejects.toMatchObject({ status: 403 });
  expect((await service.list(context)).map((file) => file.name)).toEqual(['keep.txt']);
});

it("never reaches outside its own teamspace", async () => {
  await service.write(context, 'mine.txt', Buffer.from('x'));
  for (const relative of ['../mine.txt', '/mine.txt', 'C:\\mine.txt', 'a/../mine.txt', '']) {
    await expect(service.remove(context, relative)).rejects.toMatchObject({ status: 400 });
  }
  await expect(service.remove({ ...context, workspaceId: 'product' }, 'mine.txt')).rejects.toBeTruthy();
  expect((await service.list(context)).map((file) => file.name)).toEqual(['mine.txt']);
});

it('refuses a directory and reports a missing file as missing', async () => {
  await service.write(context, 'file.txt', Buffer.from('x'));
  await fs.mkdir(await service.resolve(context, 'folder'));
  await expect(service.remove(context, 'folder')).rejects.toMatchObject({ status: 400 });
  expect((await fs.stat(await service.resolve(context, 'folder'))).isDirectory()).toBe(true);
  await expect(service.remove(context, 'absent.txt')).rejects.toMatchObject({ code: 'ENOENT' });
});
