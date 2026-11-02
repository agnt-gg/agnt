import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sqlite3 from 'sqlite3';
import pathManager from '../../utils/PathManager.js';
import { isWorkspacePrincipal } from '../authorization/runActor.js';
import { isNonOwnerMember } from './memberIsolation.js';

/**
 * The database step's virtual tables, kept OUT of the instance database for a teamspace or a teammate.
 *
 * database-operation builds SQL around a caller-written condition, so for anyone but the owner it was
 * refused outright: one bad condition away from the instance database, where every account's keys live.
 * Here each data owner (a teamspace, or a teammate's own data) gets its own SQLite file holding only its
 * own `user_data`, opened with ATTACH disabled (SQLITE_LIMIT_ATTACHED = 0). The worst any query can reach
 * is that owner's own rows. The owner's personal data stays in the instance database, as before.
 *
 * On first open the owner's existing rows are copied over once, so nothing a teamspace already stored
 * disappears from its workflows.
 */
const stores = new Map();

/** Does this run's database step use an isolated store? A teamspace's data, or anyone but the owner acting. */
export function usesIsolatedUserData(dataOwner, actor) {
  return isWorkspacePrincipal(dataOwner) || isNonOwnerMember(actor);
}

const call = (database, method, sql, args = []) => new Promise((resolve, reject) => {
  database[method](sql, args, function done(error, rows) { if (error) reject(error); else resolve(method === 'run' ? this : rows); });
});

async function open(dataOwner, { root, instanceDb }) {
  const dir = root || pathManager.getDataPath('user-data');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, createHash('sha256').update(String(dataOwner)).digest('hex').slice(0, 40) + '.db');
  const database = new sqlite3.Database(file);
  if (typeof sqlite3.LIMIT_ATTACHED !== 'number') throw new Error('Isolated user data needs SQLite attach limits; refusing to open');
  database.configure('limit', sqlite3.LIMIT_ATTACHED, 0);
  await call(database, 'run', 'PRAGMA journal_mode=WAL');
  await call(database, 'run', `CREATE TABLE IF NOT EXISTS user_data (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, table_name TEXT NOT NULL, data JSON NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await call(database, 'run', 'CREATE INDEX IF NOT EXISTS user_data_owner_table ON user_data(user_id, table_name)');
  await call(database, 'run', 'CREATE TABLE IF NOT EXISTS isolation_meta (key TEXT PRIMARY KEY, value TEXT)');
  const migrated = await call(database, 'all', "SELECT value FROM isolation_meta WHERE key='migrated'");
  if (!migrated.length && instanceDb) {
    const rows = await call(instanceDb, 'all', 'SELECT id, user_id, table_name, data, created_at, updated_at FROM user_data WHERE user_id = ?', [dataOwner]);
    for (const row of rows) {
      await call(database, 'run', 'INSERT OR IGNORE INTO user_data (id, user_id, table_name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', [row.id, row.user_id, row.table_name, row.data, row.created_at, row.updated_at]);
    }
    await call(database, 'run', "INSERT INTO isolation_meta (key, value) VALUES ('migrated', ?)", [String(rows.length)]);
  }
  return {
    file,
    all: (sql, args) => call(database, 'all', sql, args),
    run: (sql, args) => call(database, 'run', sql, args),
    close: () => new Promise((resolve) => database.close(() => resolve())),
  };
}

/** The isolated store for a data owner (one connection per owner, shared by its runs). */
export function isolatedUserDataFor(dataOwner, options = {}) {
  if (!dataOwner) return Promise.reject(new Error('Isolated user data needs an owner'));
  const key = (options.root || '') + '\n' + dataOwner;
  if (!stores.has(key)) {
    const pending = open(dataOwner, options).catch((error) => { stores.delete(key); throw error; });
    stores.set(key, pending);
  }
  return stores.get(key);
}

/** Test seam: close every store. */
export async function closeIsolatedUserData() {
  const all = [...stores.values()]; stores.clear();
  for (const pending of all) { try { await (await pending).close(); } catch { /* already gone */ } }
}
