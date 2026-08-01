/**
 * LayoutService must not reach rows owned by WorkspaceService.
 *
 * THE BUG THIS PINS:
 * Both services share the widget_layouts table. WorkspaceService namespaces its
 * rows with route='workspace:<id>' and uses page_id = the workspace id;
 * LayoutService keys every mutation on page_id ALONE. Only the LISTING query
 * excluded workspace rows, so a custom page whose page_id collided with a
 * workspace id let /api/layouts silently UPDATE, RESET or DELETE a user's
 * synced workspace through an endpoint with no business touching it — and the
 * workspace would then vanish from every other device on the next sync.
 *
 * Runs the REAL service against a throwaway sqlite3 db, same pattern as
 * WorkspaceService.test.js, so the tests fail if the SQL drifts.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT;
let rawDb;

vi.mock('../models/database/index.js', () => ({
  default: {
    all: (...a) => rawDb.all(...a),
    get: (...a) => rawDb.get(...a),
    run: (...a) => rawDb.run(...a),
  },
}));

const { default: LayoutService } = await import('./LayoutService.js');

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

function mockReq(userId, body = {}, params = {}) {
  return { user: userId ? { id: userId } : {}, body, params };
}
function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const call = async (method, userId, params = {}, body = {}) => {
  const res = mockRes();
  await LayoutService[method](mockReq(userId, body, params), res);
  return res;
};

/** A workspace row exactly as WorkspaceService writes it. */
const seedWorkspaceRow = () =>
  run(
    `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data)
     VALUES ('L-ws', 'u1', 'ws_1', 'Trading', 'fas fa-th', 0, 'workspace:ws_1', ?)`,
    [JSON.stringify({ widgets: [{ instanceId: 'w_1' }], updatedAt: 900 })],
  );

const seedCustomPage = () =>
  run(
    `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data)
     VALUES ('L-pg', 'u1', 'pg_1', 'Dashboard', 'fas fa-th', 0, 'custom/pg_1', '[{"widgetId":"clock"}]')`,
  );

const workspaceRow = async () => (await all("SELECT * FROM widget_layouts WHERE route = 'workspace:ws_1'"))[0];

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-layoutiso-'));
  rawDb = new sqlite3.Database(path.join(ROOT, 'test.db'));
  await run('PRAGMA journal_mode = MEMORY');
  await run(CREATE_TABLE);
});

afterEach(async () => {
  await new Promise((r) => rawDb.close(r));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('LayoutService — workspace rows are invisible to the custom-page API', () => {
  it('does not list workspace rows', async () => {
    await seedWorkspaceRow();
    await seedCustomPage();

    const res = await call('getAllLayouts', 'u1');

    expect(res.body.pages.map((p) => p.page_id)).toEqual(['pg_1']);
  });

  it('updateLayout cannot modify a workspace row that shares its page_id', async () => {
    await seedWorkspaceRow();
    const before = await workspaceRow();

    await call('updateLayout', 'u1', { pageId: 'ws_1' }, { page_name: 'Hijacked', layout_data: '[]' });

    const after = await workspaceRow();
    expect(after.page_name).toBe('Trading');
    expect(after.layout_data).toBe(before.layout_data);
  });

  it('deleteLayout cannot delete a workspace row that shares its page_id', async () => {
    await seedWorkspaceRow();

    await call('deleteLayout', 'u1', { pageId: 'ws_1' });

    expect(await workspaceRow()).toBeDefined();
  });

  it('resetLayout cannot blank a workspace row that shares its page_id', async () => {
    await seedWorkspaceRow();
    const before = await workspaceRow();

    await call('resetLayout', 'u1', { pageId: 'ws_1' }, { layout_data: '[]' });

    expect((await workspaceRow()).layout_data).toBe(before.layout_data);
  });
});

describe('LayoutService — ordinary custom pages still work', () => {
  // The isolation predicate is on every mutating query, so these prove it did
  // not also lock out the rows the service is actually for.
  it('updateLayout still updates a custom page', async () => {
    await seedCustomPage();

    await call('updateLayout', 'u1', { pageId: 'pg_1' }, { page_name: 'Renamed' });

    const rows = await all("SELECT * FROM widget_layouts WHERE page_id = 'pg_1'");
    expect(rows).toHaveLength(1);
    expect(rows[0].page_name).toBe('Renamed');
  });

  it('resetLayout still resets a custom page', async () => {
    await seedCustomPage();

    await call('resetLayout', 'u1', { pageId: 'pg_1' }, { layout_data: '[]' });

    const rows = await all("SELECT * FROM widget_layouts WHERE page_id = 'pg_1'");
    expect(rows[0].layout_data).toBe('[]');
  });

  it('deleteLayout still deletes a custom page', async () => {
    await seedCustomPage();

    await call('deleteLayout', 'u1', { pageId: 'pg_1' });

    expect(await all("SELECT * FROM widget_layouts WHERE page_id = 'pg_1'")).toHaveLength(0);
  });

  it('a page with a NULL route is still treated as a custom page', async () => {
    // NOT LIKE 'workspace:%' is NULL-valued for a NULL route, so the predicate
    // needs its explicit "route IS NULL OR" arm. Without it every legacy row
    // silently became unreachable.
    await run(
      `INSERT INTO widget_layouts (id, user_id, page_id, page_name, route, layout_data)
       VALUES ('L-null', 'u1', 'pg_null', 'Legacy', NULL, '[]')`,
    );

    await call('updateLayout', 'u1', { pageId: 'pg_null' }, { page_name: 'Still Editable' });

    const rows = await all("SELECT * FROM widget_layouts WHERE page_id = 'pg_null'");
    expect(rows).toHaveLength(1);
    expect(rows[0].page_name).toBe('Still Editable');
  });
});
