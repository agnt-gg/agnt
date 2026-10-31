import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceFileService } from './WorkspaceFileService.js';

// The teamspace Files tab lists what was uploaded to that teamspace, and nothing else.
it("lists a teamspace's own files, never another teamspace's, and needs read access", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-files-list-'));
  const grants = new Set(['files.read', 'files.write']);
  const service = new WorkspaceFileService({ root, authorize: async (_c, action) => { if (!grants.has(action)) throw Object.assign(Error('Denied'), { status: 403 }); } });
  const one = { teamId: 'team', tenantSlug: 'tenant', workspaceId: 'one' };
  try {
    expect(await service.list(one)).toEqual([]); // nothing uploaded yet, and listing creates nothing
    await service.write(one, 'brief.pdf', Buffer.from('pdf'));
    await service.write({ ...one, workspaceId: 'two' }, 'other.txt', Buffer.from('x'));
    const files = await service.list(one);
    expect(files.map((f) => f.name)).toEqual(['brief.pdf']);
    expect(files[0]).toMatchObject({ bytes: 3 });
    grants.delete('files.read');
    await expect(service.list(one)).rejects.toMatchObject({ status: 403 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
