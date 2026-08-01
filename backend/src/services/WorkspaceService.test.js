/**
 * WorkspaceService — validates the REAL service against a per-test sqlite3 db.
 *
 * The service binds the production db singleton (db.all/get/run, sqlite3's
 * callback API), so we vi.mock that module to hand back a throwaway sqlite3
 * connection wired to the same three methods. This exercises the actual SQL and
 * conflict rules the service ships — not a re-implementation — so the tests fail
 * if WorkspaceService.js drifts.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── throwaway db, swapped in per test ────────────────────────────────────────
let ROOT;
let rawDb;

// The mock exposes exactly what the service uses. It forwards to the current
// rawDb so beforeEach can rebind a fresh database each test.
vi.mock('../models/database/index.js', () => ({
  default: {
    all: (...a) => rawDb.all(...a),
    get: (...a) => rawDb.get(...a),
    run: (...a) => rawDb.run(...a),
  },
}));

// Import AFTER the mock is registered (vitest hoists vi.mock, but keep it explicit).
const { default: WorkspaceService } = await import('./WorkspaceService.js');

const run = (sql, params = []) =>
  new Promise((resolve, reject) => rawDb.run(sql, params, function (e) { e ? reject(e) : resolve(this); }));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => rawDb.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));

const CREATE_TABLE = `CREATE TABLE widget_layouts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_icon TEXT DEFAULT 'fas fa-th',
  page_order INTEGER DEFAULT 0,
  route TEXT,
  layout_data TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;
const CREATE_INDEX = 'CREATE UNIQUE INDEX ux_widget_layouts_user_route ON widget_layouts(user_id, route)';

// Minimal req/res doubles capturing status + json body.
function mockReq(userId, body = {}, params = {}) {
  return { user: userId ? { id: userId } : {}, body, params };
}
function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const put = async (userId, workspaces, deletedIds = []) => {
  const res = mockRes();
  await WorkspaceService.putWorkspaces(mockReq(userId, { workspaces, deletedIds }), res);
  return res;
};
const list = async (userId) => {
  const res = mockRes();
  await WorkspaceService.getWorkspaces(mockReq(userId), res);
  return res;
};
const del = async (userId, id) => {
  const res = mockRes();
  await WorkspaceService.deleteWorkspace(mockReq(userId, {}, { id }), res);
  return res;
};

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-wssvc-'));
  rawDb = new sqlite3.Database(path.join(ROOT, 'test.db'));
  await run('PRAGMA journal_mode = MEMORY');
  await run(CREATE_TABLE);
  await run(CREATE_INDEX);
});

afterEach(async () => {
  await new Promise((r) => rawDb.close(r));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('WorkspaceService — route namespacing & isolation', () => {
  it('stores workspaces under route workspace:<id> and lists only those', async () => {
    await run("INSERT INTO widget_layouts (id, user_id, page_id, page_name, route, layout_data) VALUES ('L1','u1','ChatScreen','Chat','ChatScreen','[]')");
    await put('u1', [{ id: 'w1', name: 'Coding', order: 0, updatedAt: 100 }]);
    const res = await list('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0]).toMatchObject({ id: 'w1', name: 'Coding' });
  });

  it('scopes workspaces per user', async () => {
    await put('u1', [{ id: 'w1', name: 'A', order: 0, updatedAt: 1 }]);
    await put('u2', [{ id: 'w1', name: 'B', order: 0, updatedAt: 1 }]);
    expect((await list('u1')).body.workspaces[0].name).toBe('A');
    expect((await list('u2')).body.workspaces[0].name).toBe('B');
  });

  it('rejects unauthenticated requests (null userId)', async () => {
    expect((await list(null)).statusCode).toBe(401);
    expect((await put(null, [])).statusCode).toBe(401);
    expect((await del(null, 'w1')).statusCode).toBe(401);
  });

  it('rejects a non-array deletedIds with 400', async () => {
    const res = mockRes();
    await WorkspaceService.putWorkspaces(mockReq('u1', { workspaces: [], deletedIds: 'nope' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('WorkspaceService — dedupe / idempotent upsert', () => {
  it('re-upserting the same id updates in place (no duplicate row)', async () => {
    await put('u1', [{ id: 'w1', name: 'v1', order: 0, updatedAt: 1 }]);
    await put('u1', [{ id: 'w1', name: 'v2', order: 0, updatedAt: 2 }]);
    const rows = await all("SELECT * FROM widget_layouts WHERE route = 'workspace:w1'");
    expect(rows).toHaveLength(1);
    expect(rows[0].page_name).toBe('v2');
  });
});

describe('WorkspaceService — last-write-wins', () => {
  it('newer updatedAt wins', async () => {
    await put('u1', [{ id: 'w1', name: 'old', order: 0, updatedAt: 100 }]);
    await put('u1', [{ id: 'w1', name: 'new', order: 0, updatedAt: 200 }]);
    expect((await list('u1')).body.workspaces[0].name).toBe('new');
  });

  it('stale write (older updatedAt) is ignored', async () => {
    await put('u1', [{ id: 'w1', name: 'current', order: 0, updatedAt: 200 }]);
    await put('u1', [{ id: 'w1', name: 'stale', order: 0, updatedAt: 100 }]);
    expect((await list('u1')).body.workspaces[0].name).toBe('current');
  });

  it('persists and round-trips the ai override', async () => {
    await put('u1', [{ id: 'w1', name: 'Trading', order: 0, updatedAt: 1, ai: { provider: 'groq', model: 'llama-3.1-70b' } }]);
    expect((await list('u1')).body.workspaces[0].ai).toEqual({ provider: 'groq', model: 'llama-3.1-70b' });
  });

  it('null ai is stored as null (inherit global default)', async () => {
    await put('u1', [{ id: 'w1', name: 'Gen', order: 0, updatedAt: 1, ai: null }]);
    expect((await list('u1')).body.workspaces[0].ai).toBeNull();
  });
});

describe('WorkspaceService — delete paths', () => {
  it('PUT deletedIds removes a workspace, user-scoped', async () => {
    await put('u1', [{ id: 'w1', name: 'A', order: 0, updatedAt: 1 }]);
    await put('u2', [{ id: 'w1', name: 'B', order: 0, updatedAt: 1 }]);
    await put('u1', [], ['w1']);
    expect((await list('u1')).body.workspaces).toHaveLength(0);
    expect((await list('u2')).body.workspaces).toHaveLength(1); // other user untouched
  });

  it('DELETE /:id removes a single workspace, user-scoped', async () => {
    await put('u1', [{ id: 'w1', name: 'A', order: 0, updatedAt: 1 }]);
    await put('u2', [{ id: 'w1', name: 'B', order: 0, updatedAt: 1 }]);
    expect((await del('u1', 'w1')).statusCode).toBe(200);
    expect((await list('u1')).body.workspaces).toHaveLength(0);
    expect((await list('u2')).body.workspaces).toHaveLength(1);
  });

  it('delete + re-upsert in the same sync resolves to the re-created row (no resurrection)', async () => {
    await put('u1', [{ id: 'w1', name: 'A', order: 0, updatedAt: 1 }]);
    await put('u1', [{ id: 'w1', name: 'A-again', order: 0, updatedAt: 2 }], ['w1']);
    const wss = (await list('u1')).body.workspaces;
    expect(wss).toHaveLength(1);
    expect(wss[0].name).toBe('A-again');
  });

  it('deleting a non-existent workspace is a no-op (200)', async () => {
    expect((await del('u1', 'ghost')).statusCode).toBe(200);
  });
});
