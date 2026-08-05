/**
 * UPGRADE BOOT — a database that predates a migration must still boot clean.
 *
 * This is the behavioural half of the guard pair (schemaOrder.test.js holds
 * the structural half). It seeds a REAL sqlite file in the shape a returning
 * user actually has — content_outputs WITHOUT the columns that later
 * migrations add — and boots the real database module against it.
 *
 * Before the fix this run printed
 *   Uncaught Exception: SQLITE_ERROR: no such column: channel_key
 * and left idx_content_outputs_channel unbuilt, because createTables() built
 * the index before runMigrations() added the column. See schemaOrder.test.js
 * for the full history.
 *
 * The assertions are deliberately about OUTCOMES, not about call order:
 *   - boot completes,
 *   - nothing was thrown where nobody could catch it,
 *   - the migrated column exists,
 *   - the index that names it exists.
 * That keeps the test true even if the mechanism is rewritten later.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';

// Isolate every AGNT path BEFORE the database module is imported. These are
// read at module-evaluation time, so this must happen at file scope.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-schema-upgrade-'));
process.env.AGNT_HOME = testRoot;
process.env.USER_DATA_PATH = testRoot;
process.env.APPDATA = testRoot;
process.env.LOCALAPPDATA = testRoot;
process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
process.env.IS_WORKFLOW_PROCESS = 'false';
process.env.REMOTE_URL = 'http://127.0.0.1:1';
fs.mkdirSync(path.join(testRoot, 'projects'), { recursive: true });

const dataDir = path.join(testRoot, 'Data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'agnt.db');

/**
 * content_outputs exactly as it existed BEFORE the last_read_at / archived_at /
 * channel_key migrations. Written by hand rather than copied from the current
 * CREATE TABLE, so it cannot drift back into being up to date and stop
 * exercising the upgrade path.
 */
const LEGACY_SCHEMA = `
  CREATE TABLE content_outputs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workflow_id TEXT,
    tool_id TEXT,
    content TEXT NOT NULL,
    content_type TEXT DEFAULT 'html',
    conversation_id TEXT,
    title TEXT,
    is_shareable INTEGER DEFAULT 0,
    group_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`;

const uncaught = [];
const onUncaught = (err) => uncaught.push(err);

function seedLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const seed = new sqlite3.Database(dbPath);
    seed.serialize(() => {
      seed.run(LEGACY_SCHEMA, (err) => (err ? reject(err) : null));
      seed.run(
        `INSERT INTO content_outputs (id, user_id, content, content_type, title)
         VALUES ('legacy-row', 'legacy-user', '{}', 'conversation', 'a chat from before the migration')`,
        (err) => (err ? reject(err) : null)
      );
      seed.close((err) => (err ? reject(err) : resolve()));
    });
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    handle.all(sql, params, (err, rows) => {
      handle.close();
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

describe('booting a pre-migration database', () => {
  beforeAll(async () => {
    process.on('uncaughtException', onUncaught);
    await seedLegacyDatabase();

    // Sanity: the fixture really is legacy. If this ever passes trivially the
    // rest of the file proves nothing.
    const cols = await query(`PRAGMA table_info(content_outputs)`);
    expect(cols.map((c) => c.name)).not.toContain('channel_key');

    const { dbReady } = await import('../src/models/database/index.js');
    await dbReady;
    // Let any late fire-and-forget work land before we judge the boot.
    await new Promise((r) => setTimeout(r, 250));
  }, 120_000);

  afterAll(() => {
    process.removeListener('uncaughtException', onUncaught);
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Windows keeps sqlite handles until process teardown; harmless.
    }
  });

  it('throws nothing where nobody can catch it', () => {
    expect(
      uncaught.map((e) => e.message),
      'Boot threw an uncaught exception. A callback-less db.run emits on the Statement,\n' +
        'so this is fatal in production and no db.on("error") will save it.'
    ).toEqual([]);
  });

  it('adds the columns the migrations own', async () => {
    const names = (await query(`PRAGMA table_info(content_outputs)`)).map((c) => c.name);
    expect(names).toContain('channel_key');
    expect(names).toContain('last_read_at');
    expect(names).toContain('archived_at');
  });

  it('builds the index that names a migrated column', async () => {
    // The actual regression: this index silently did not exist on upgraded
    // installs, so the sidebar query (user_id = ? AND channel_key IS NULL)
    // ran unindexed.
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_content_outputs_channel'`
    );
    expect(rows.length, 'idx_content_outputs_channel was not created').toBe(1);
  });

  it('keeps the pre-existing row intact', async () => {
    const rows = await query(`SELECT id, title, channel_key FROM content_outputs WHERE id = 'legacy-row'`);
    expect(rows.length).toBe(1);
    // NULL channel_key means "belongs to the main chat list" — a legacy row
    // must degrade to the old behaviour, not vanish from the sidebar.
    expect(rows[0].channel_key).toBeNull();
  });
});
