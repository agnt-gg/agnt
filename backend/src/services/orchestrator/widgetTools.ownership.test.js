import { it, expect, vi, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';

// bravo retest, Nov 2026: generated widgets were saved under the caller while the REST API reads the team
// library (two "stores"), had no delete, and the widget tools updated or loaded ANY widget by id.
const memory = vi.hoisted(() => ({ db: null }));
vi.mock('../../models/database/index.js', async () => {
  const sqlite = (await import('sqlite3')).default;
  memory.db = new sqlite.Database(':memory:');
  return { default: memory.db, dbReady: Promise.resolve() };
});
vi.mock('../authorization/teamAssetOwner.js', () => ({ assetOwnersFor: async (userId) => [userId, 'scope:team'] }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcast: () => {}, broadcastToUser: () => {}, RealtimeEvents: {} }));
const { executeWidgetTool } = await import('./widgetTools.js');
const run = (sql, args = []) => new Promise((resolve, reject) => memory.db.run(sql, args, (e) => (e ? reject(e) : resolve())));
const get = (sql, args = []) => new Promise((resolve, reject) => memory.db.get(sql, args, (e, row) => (e ? reject(e) : resolve(row))));
const call = async (name, args, userId = 'member-2', extra = {}) => JSON.parse(await executeWidgetTool(name, args, null, { userId, ...extra }));

beforeEach(async () => {
  await run('DROP TABLE IF EXISTS widget_definitions');
  await run(`CREATE TABLE widget_definitions (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, description TEXT, icon TEXT, category TEXT, widget_type TEXT, source_code TEXT, config TEXT, data_bindings TEXT, default_size TEXT, min_size TEXT, thumbnail TEXT, is_shared INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`);
  await run("INSERT INTO widget_definitions (id,user_id,name,source_code) VALUES ('cw_owner','owner-1','Owner widget','<b>owner</b>'),('cw_team','scope:team','Team widget','<b>team</b>'),('cw_mine','member-2','My widget','<b>mine</b>')");
});

it("lists the caller's and the team library's widgets, never someone else's", async () => {
  const listed = await call('list_widgets', {});
  expect(listed.widgets.map((w) => w.id).sort()).toEqual(['cw_mine', 'cw_team']);
});

it("cannot load, edit, reconfigure, overwrite or delete another person's widget", async () => {
  expect((await call('load_widget', { widgetId: 'cw_owner' })).success).toBe(false);
  await call('update_widget_config', { name: 'hijacked' }, 'member-2', { widgetState: { id: 'cw_owner' } });
  await call('edit_widget_code', { edits: [{ search: 'owner', replace: 'hijacked' }], description: 'x' }, 'member-2', { widgetState: { id: 'cw_owner', source_code: '<b>owner</b>' } });
  expect((await call('save_widget', { widgetData: { id: 'cw_owner', name: 'hijacked', source_code: 'x' } })).success).toBe(false);
  expect((await call('delete_widget', { widgetId: 'cw_owner' })).success).toBe(false);
  expect(await get("SELECT name, source_code FROM widget_definitions WHERE id='cw_owner'")).toEqual({ name: 'Owner widget', source_code: '<b>owner</b>' });
});

it('deletes a widget from its own or the team library, and saves new ones to the team library', async () => {
  expect((await call('delete_widget', { widgetId: 'cw_team' })).success).toBe(true);
  expect((await call('delete_widget', { widgetId: 'cw_mine' })).success).toBe(true);
  expect(await get("SELECT COUNT(*) n FROM widget_definitions WHERE id IN ('cw_team','cw_mine')")).toEqual({ n: 0 });
  const saved = await call('save_widget', { widgetData: { id: 'cw_new', name: 'New', source_code: '<i>new</i>' } });
  expect(saved.success).toBe(true);
  expect(await get("SELECT user_id FROM widget_definitions WHERE id='cw_new'")).toEqual({ user_id: 'scope:team' });
});
