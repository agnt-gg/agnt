/**
 * WorkspaceService persistence semantics: route-namespaced upsert, last-write-
 * wins on updatedAt, delete-scoping, and dedupe recovery — all against the SAME
 * widget_layouts table the service reuses (no schema migration).
 *
 * The service module binds the production db singleton, so here we validate the
 * SQL contract directly against a throwaway sqlite3 db that mirrors production,
 * exercising the exact statements WorkspaceService issues.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let ROOT;
let db;

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

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

// The (user_id, route) unique index the service relies on for idempotent upsert.
const CREATE_INDEX =
  'CREATE UNIQUE INDEX ux_widget_layouts_user_route ON widget_layouts(user_id, route)';

const routeFor = (id) => `workspace:${id}`;

let rowSeq = 0;

/** Mirror of WorkspaceService.putWorkspaces upsert for one workspace. */
async function upsert(user, ws) {
  const route = routeFor(ws.id);
  const stamp = Number(ws.updatedAt) || 0;
  const layoutData = JSON.stringify({
    widgets: ws.widgets || [],
    ai: ws.ai && ws.ai.provider ? { provider: ws.ai.provider, model: ws.ai.model || null } : null,
    updatedAt: stamp,
  });
  const existing = await get(
    'SELECT id, layout_data FROM widget_layouts WHERE user_id = ? AND route = ?',
    [user, route],
  );
  if (existing) {
    let existingStamp = 0;
    try { existingStamp = Number(JSON.parse(existing.layout_data).updatedAt) || 0; } catch { existingStamp = 0; }
    if (stamp < existingStamp) return 'stale-ignored';
    await run(
      'UPDATE widget_layouts SET page_name = ?, page_order = ?, layout_data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND route = ?',
      [ws.name, Number(ws.order) || 0, layoutData, user, route],
    );
    return 'updated';
  }
  await run(
    'INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`row_${++rowSeq}`, user, ws.id, ws.name, 'fas fa-th', Number(ws.order) || 0, route, layoutData],
  );
  return 'inserted';
}

const listWorkspaces = async (user) =>
  (await all(
    "SELECT * FROM widget_layouts WHERE user_id = ? AND route LIKE 'workspace:%' ORDER BY page_order ASC, created_at ASC",
    [user],
  )).map((row) => {
    const p = JSON.parse(row.layout_data || '{}');
    return { id: row.page_id, name: row.page_name, order: row.page_order, ai: p.ai || null, updatedAt: p.updatedAt || 0 };
  });

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-wssvc-'));
  db = new sqlite3.Database(path.join(ROOT, 'test.db'));
  await run('PRAGMA journal_mode = MEMORY');
  await run(CREATE_TABLE);
  await run(CREATE_INDEX);
});

afterEach(async () => {
  await new Promise((r) => db.close(r));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('WorkspaceService — route namespacing & isolation', () => {
  it('stores workspaces under route workspace:<id> and lists only those', async () => {
    // A non-workspace layout row must be ignored by the workspace list.
    await run(
      "INSERT INTO widget_layouts (id, user_id, page_id, page_name, route, layout_data) VALUES ('L1','u1','ChatScreen','Chat','ChatScreen','[]')",
    );
    await upsert('u1', { id: 'w1', name: 'Coding', order: 0, updatedAt: 100 });
    const list = await listWorkspaces('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'w1', name: 'Coding' });
  });

  it('scopes workspaces per user', async () => {
    await upsert('u1', { id: 'w1', name: 'A', order: 0, updatedAt: 1 });
    await upsert('u2', { id: 'w1', name: 'B', order: 0, updatedAt: 1 });
    expect(await listWorkspaces('u1')).toHaveLength(1);
    expect((await listWorkspaces('u1'))[0].name).toBe('A');
    expect((await listWorkspaces('u2'))[0].name).toBe('B');
  });
});

describe('WorkspaceService — dedupe / idempotent upsert', () => {
  it('re-upserting the same id updates in place (no duplicate row)', async () => {
    await upsert('u1', { id: 'w1', name: 'v1', order: 0, updatedAt: 1 });
    await upsert('u1', { id: 'w1', name: 'v2', order: 0, updatedAt: 2 });
    const rows = await all('SELECT * FROM widget_layouts WHERE route = ?', [routeFor('w1')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].page_name).toBe('v2');
  });

  it('the (user_id, route) unique index forbids a second row for the same workspace', async () => {
    await upsert('u1', { id: 'w1', name: 'x', order: 0, updatedAt: 1 });
    await expect(
      run(
        "INSERT INTO widget_layouts (id, user_id, page_id, page_name, route, layout_data) VALUES ('dup','u1','w1','x','workspace:w1','{}')",
      ),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });
});

describe('WorkspaceService — last-write-wins', () => {
  it('newer updatedAt wins', async () => {
    await upsert('u1', { id: 'w1', name: 'old', order: 0, updatedAt: 100 });
    const r = await upsert('u1', { id: 'w1', name: 'new', order: 0, updatedAt: 200 });
    expect(r).toBe('updated');
    expect((await listWorkspaces('u1'))[0].name).toBe('new');
  });

  it('stale write (older updatedAt) is ignored', async () => {
    await upsert('u1', { id: 'w1', name: 'current', order: 0, updatedAt: 200 });
    const r = await upsert('u1', { id: 'w1', name: 'stale', order: 0, updatedAt: 100 });
    expect(r).toBe('stale-ignored');
    expect((await listWorkspaces('u1'))[0].name).toBe('current');
  });

  it('persists and round-trips the ai override', async () => {
    await upsert('u1', { id: 'w1', name: 'Trading', order: 0, updatedAt: 1, ai: { provider: 'groq', model: 'llama-3.1-70b' } });
    const list = await listWorkspaces('u1');
    expect(list[0].ai).toEqual({ provider: 'groq', model: 'llama-3.1-70b' });
  });

  it('null ai is stored as null (inherit global default)', async () => {
    await upsert('u1', { id: 'w1', name: 'Gen', order: 0, updatedAt: 1, ai: null });
    expect((await listWorkspaces('u1'))[0].ai).toBeNull();
  });
});

describe('WorkspaceService — delete paths', () => {
  it('deletes a workspace by route, user-scoped', async () => {
    await upsert('u1', { id: 'w1', name: 'A', order: 0, updatedAt: 1 });
    await upsert('u2', { id: 'w1', name: 'B', order: 0, updatedAt: 1 });
    await run('DELETE FROM widget_layouts WHERE user_id = ? AND route = ?', ['u1', routeFor('w1')]);
    expect(await listWorkspaces('u1')).toHaveLength(0);
    expect(await listWorkspaces('u2')).toHaveLength(1); // other user untouched
  });

  it('delete + re-upsert in the same sync resolves to the re-created row (no resurrection)', async () => {
    await upsert('u1', { id: 'w1', name: 'A', order: 0, updatedAt: 1 });
    await run('DELETE FROM widget_layouts WHERE user_id = ? AND route = ?', ['u1', routeFor('w1')]);
    await upsert('u1', { id: 'w1', name: 'A-again', order: 0, updatedAt: 2 });
    const list = await listWorkspaces('u1');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A-again');
  });

  it('deleting a non-existent workspace is a no-op', async () => {
    await expect(
      run('DELETE FROM widget_layouts WHERE user_id = ? AND route = ?', ['u1', routeFor('ghost')]),
    ).resolves.toBeTruthy();
  });
});
