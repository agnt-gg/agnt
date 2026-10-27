/**
 * Saving a page for a route that already has one never fails.
 *
 * Measured on genii 2026-10-27: members' dashboard saves answered 500 with
 * "UNIQUE constraint failed: widget_layouts.user_id, widget_layouts.route".
 * On a team instance every teammate's pages live under the team's owner, so a
 * second teammate's page for the same route (a different page id) collided
 * with the first. Runs the REAL service on a throwaway sqlite3 db with the
 * real unique index (widgetLayoutDedupe.js).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT;
let rawDb;
vi.mock('../models/database/index.js', () => ({
  default: { all: (...a) => rawDb.all(...a), get: (...a) => rawDb.get(...a), run: (...a) => rawDb.run(...a) },
}));
const { default: LayoutService } = await import('./LayoutService.js');

const run = (sql, params = []) => new Promise((resolve, reject) => rawDb.run(sql, params, (e) => (e ? reject(e) : resolve())));
const all = (sql, params = []) => new Promise((resolve, reject) => rawDb.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
const call = async (userId, pageId, body) => {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  await LayoutService.updateLayout({ user: { id: userId }, body, params: { pageId } }, res);
  return res;
};

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-layoutroute-'));
  rawDb = new sqlite3.Database(path.join(ROOT, 'test.db'));
  await run(`CREATE TABLE widget_layouts (id TEXT PRIMARY KEY, user_id TEXT, page_id TEXT NOT NULL, page_name TEXT NOT NULL,
    page_icon TEXT DEFAULT 'fas fa-th', page_order INTEGER DEFAULT 0, route TEXT, layout_data TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run('CREATE UNIQUE INDEX idx_widget_layouts_user_route ON widget_layouts(user_id, route)');
});
afterEach(async () => {
  await new Promise((r) => rawDb.close(r));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('LayoutService.updateLayout on a route that already has a page', () => {
  it('saves into the existing page instead of failing, and says which page it is', async () => {
    expect((await call('team-owner', 'pg_amber', { route: 'dashboard', page_name: 'Dashboard', layout_data: '["clock"]' })).statusCode).toBe(200);
    const second = await call('team-owner', 'pg_john', { route: 'dashboard', page_name: 'Dashboard', layout_data: '["weather"]' });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ page_id: 'pg_amber', deduplicated: true });
    const rows = await all('SELECT page_id, layout_data FROM widget_layouts WHERE route = ?', ['dashboard']);
    expect(rows).toEqual([{ page_id: 'pg_amber', layout_data: '["weather"]' }]);
  });

  it('a different person\'s page for the same route is untouched (they are different rows)', async () => {
    await call('alice', 'pg_a', { route: 'dashboard', layout_data: '["a"]' });
    await call('bob', 'pg_b', { route: 'dashboard', layout_data: '["b"]' });
    expect(await all('SELECT user_id, layout_data FROM widget_layouts ORDER BY user_id')).toEqual([
      { user_id: 'alice', layout_data: '["a"]' },
      { user_id: 'bob', layout_data: '["b"]' },
    ]);
  });
});
