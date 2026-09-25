import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';

// A real workspace on disk, so the route stats real files.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-tree-'));
vi.mock('../utils/workspaceRoot.js', () => ({
  DEFAULT_WORKSPACE_ROOT: ROOT,
  getWorkspaceRoot: async () => ROOT,
  saveWorkspaceRoot: async () => {},
  ensureWorkspaceRoot: async () => ROOT,
  warnIfWorkspaceUnsafe: () => {},
}));

const SECRET = 'tree-test-secret';
let server;
let base;
let prevSecret;

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, 'site'));
  fs.writeFileSync(path.join(ROOT, 'report.md'), 'hello world');
  prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const { default: FileSystemRoutes } = await import('./FileSystemRoutes.js');
  const app = express();
  app.use('/api/filesystem', FileSystemRoutes);
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  process.env.JWT_SECRET = prevSecret;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

const get = async (query) => {
  const token = jwt.sign({ id: 'u1', userId: 'u1', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });
  const res = await fetch(`${base}/api/filesystem/tree${query}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

describe('GET /filesystem/tree', () => {
  it('lists without stats by default, so the tree panel stays cheap', async () => {
    const { status, body } = await get('');
    expect(status).toBe(200);
    expect(body.items.map((i) => [i.name, i.type])).toEqual([
      ['site', 'directory'],
      ['report.md', 'file'],
    ]);
    expect(body.items.every((i) => i.size === undefined && i.modifiedAt === undefined)).toBe(true);
  });

  it('adds size and modified time with details=1', async () => {
    const { body } = await get('?details=1');
    const file = body.items.find((i) => i.name === 'report.md');
    const dir = body.items.find((i) => i.name === 'site');
    expect(file.size).toBe(11);
    expect(Math.abs(file.modifiedAt - Date.now())).toBeLessThan(60_000);
    expect(dir.modifiedAt).toBeGreaterThan(0);
    expect(dir.size).toBeUndefined();
  });

  it('still refuses to leave the workspace', async () => {
    const { status } = await get('?dir=..&details=1');
    expect(status).toBe(403);
  });
});
