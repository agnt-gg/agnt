import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import sqlite3 from 'sqlite3';
vi.mock('../models/database/index.js', () => ({ default: {}, dbReady: Promise.resolve() }));
import { PluginAccountStore } from './PluginAccountStore.js';
let db, store;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:'); store = new PluginAccountStore(db);
  await store.run('CREATE TABLE users(id TEXT PRIMARY KEY)');
  await store.run('CREATE TABLE agents(id TEXT PRIMARY KEY,user_id TEXT)');
  await store.run(`CREATE TABLE installed_plugin_assets(id INTEGER PRIMARY KEY,plugin_name TEXT,plugin_version TEXT,asset_type TEXT,asset_slug TEXT,local_id TEXT,installed_at TEXT,deprecated_at TEXT,UNIQUE(plugin_name,asset_type,asset_slug))`);
});
afterEach(() => new Promise((resolve,reject) => db.close(error => error ? reject(error) : resolve())));
describe('Per-account plugin installation registry', () => {
  it('migrates known asset owners without assigning the first database user', async () => {
    await store.run("INSERT INTO users VALUES('alice'),('bob')");
    await store.run("INSERT INTO agents VALUES('a-bob','bob')");
    await store.run("INSERT INTO installed_plugin_assets VALUES(1,'private-pack','1','agent','worker','a-bob','before',NULL)");
    await store.ready();
    expect(await store.names('alice')).toEqual([]);
    expect(await store.names('bob')).toEqual(['private-pack']);
    expect((await store.all('SELECT * FROM installed_plugin_assets'))[0]).toMatchObject({ id:1, local_id:'a-bob', user_id:'bob', installed_at:'before' });
    await expect(store.assert('private-pack','alice')).rejects.toMatchObject({status:404});
  });
  it('permits independent installs and matching slugs without crossing account IDs', async () => {
    await store.ready();await store.add('pack','alice');await store.add('pack','bob');
    for(const user of ['alice','bob']) await store.run("INSERT INTO installed_plugin_assets(plugin_name,plugin_version,asset_type,asset_slug,local_id,user_id) VALUES('pack','1','agent','worker',?,?)", ['agent-'+user,user]);
    expect((await store.all('SELECT * FROM installed_plugin_assets')).length).toBe(2);
    await store.remove('pack','alice');expect(await store.has('pack','bob')).toBe(true);expect(await store.names('alice')).toEqual([]);
  });
  it('keeps a legacy package visible to every account that already existed, never to later accounts', async () => {
    await store.run("INSERT INTO users VALUES('alice'),('bob')");await store.adoptLegacy('old-pack');
    expect((await store.owners('old-pack')).sort()).toEqual(['alice','bob']);
    await store.run("INSERT INTO users VALUES('carol')");await store.adoptLegacy('old-pack');
    expect(await store.has('old-pack','carol')).toBe(false);
  });
  it('adopts for the real account when the users table also holds id-less rows', async () => {
    // Regression: a desktop DB with one account plus junk rows stranded every tool-only plugin.
    await store.run("INSERT INTO users VALUES('nathan'),(NULL),(NULL)");await store.adoptLegacy('gmail-plugin');
    expect(await store.owners('gmail-plugin')).toEqual(['nathan']);
    await expect(store.assert('gmail-plugin','nathan')).resolves.toBeUndefined();
  });
  it('defers adoption while no account exists instead of recording an ownerless verdict', async () => {
    await store.adoptLegacy('early-pack');expect(await store.owners('early-pack')).toEqual([]);
    await store.run("INSERT INTO users VALUES('alice')");await store.adoptLegacy('early-pack');
    expect(await store.owners('early-pack')).toEqual(['alice']);
  });
  it('adopts sole-account legacy packages once, but never resurrects an uninstalled entitlement', async () => {
    await store.run("INSERT INTO users VALUES('alice')");await store.adoptLegacy('old-pack');
    expect(await store.owners('old-pack')).toEqual(['alice']);await store.remove('old-pack','alice');await store.adoptLegacy('old-pack');
    expect(await store.owners('old-pack')).toEqual([]);
  });
  it('rolls a failed migration back without losing the old asset registry', async () => {
    await store.run("INSERT INTO users VALUES('alice')");
    await store.run("INSERT INTO installed_plugin_assets VALUES(7,'legacy','1','tool','t','t','original',NULL)");
    const run = store.run.bind(store);
    store.run = async (sql, params) => { if (sql.startsWith('ALTER TABLE installed_plugin_assets_scoped')) throw new Error('migration interrupted'); return run(sql, params); };
    await expect(store.ready()).rejects.toThrow('migration interrupted');
    expect(await store.get('SELECT id,installed_at FROM installed_plugin_assets')).toEqual({ id: 7, installed_at: 'original' });
    expect(await store.get("SELECT name FROM sqlite_master WHERE name='installed_plugin_assets_scoped'")).toBeUndefined();
    store.run = run; await store.ready();
    expect(await store.get('SELECT id,installed_at FROM installed_plugin_assets')).toEqual({ id: 7, installed_at: 'original' });
  });
  it('takes legacy agent ownership from created_by, not another account', async () => {
    await store.run('ALTER TABLE agents ADD COLUMN created_by TEXT');
    await store.run("INSERT INTO users VALUES('alice'),('bob')");
    await store.run("INSERT INTO agents VALUES('a-bob',NULL,'bob')");
    await store.run("INSERT INTO installed_plugin_assets VALUES(9,'pack-bob','1','agent','a','a-bob','original',NULL)");
    await store.ready(); expect(await store.names('bob')).toEqual(['pack-bob']); expect(await store.names('alice')).toEqual([]);
  });
  it('filters installed lists and tool catalogs by authenticated account', async () => {
    await store.add('a','alice');await store.add('b','bob');
    expect(await store.filter([{name:'a'},{name:'b'}],'bob')).toEqual([{name:'b'}]);
    expect(await store.filter([{_plugin:'a'},{_plugin:'b'}],'alice',r=>r._plugin)).toEqual([{_plugin:'a'}]);
    expect(await store.names(null)).toEqual([]);
  });
});
