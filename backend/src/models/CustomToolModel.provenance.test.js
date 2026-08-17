/**
 * Saving a custom tool must not forget when it was created, or who owns it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The third instance of the same defect. `CustomToolModel.createOrUpdate` wrote
 * the row with `INSERT OR REPLACE`, which in SQLite DELETEs the conflicting row
 * and INSERTs a new one, so every column the statement does not name reverts to
 * its schema DEFAULT.
 *
 * `tools` carries no provenance flags — no source_plugin, no is_user_modified —
 * so the blast radius is smaller than `agents` or `skills`: nothing here is
 * DISABLED by the bug, it only loses data. Two columns were affected:
 *
 *   created_at  -> reset to now on every edit
 *   created_by  -> rewritten from the caller's argument
 *
 * created_by mattered less than it looks, because ToolService already forks to a
 * new id when the editor is not the creator — so the transfer was unreachable
 * through that route. It is preserved anyway: a model should not depend on one
 * caller's guard for a property this basic, and every OTHER caller of this
 * method now inherits the guarantee for free.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let CustomToolModel;
let TMP;
const savedEnv = {};

const USER = 'user-tool-1';
const OTHER_USER = 'user-tool-2';

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM tools WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this.changes); });
});

const columnsOf = (table) => new Promise((resolve, reject) => {
  db.all(`PRAGMA table_info(${table})`, [], (err, rows) => (err ? reject(err) : resolve(rows.map((r) => r.name))));
});

const toolPayload = (over = {}) => ({
  title: 'Summarize',
  category: 'text',
  type: 'ai',
  icon: 'fas fa-align-left',
  description: 'summarize some text',
  parameters: [{ name: 'text', type: 'string' }],
  outputs: [{ name: 'summary', type: 'string' }],
  isShareable: false,
  base: 'AI',
  code: null,
  config: null,
  ...over,
});

const seedTool = async (id, { created_at = '2026-07-26 14:18:07' } = {}) => {
  await CustomToolModel.createOrUpdate(id, toolPayload(), USER);
  await run('UPDATE tools SET created_at = ? WHERE id = ?', [created_at, id]);
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-toolprov-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  CustomToolModel = (await import('./CustomToolModel.js')).default;

  for (const uid of [USER, OTHER_USER]) {
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
  }
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('an edit preserves the row provenance', () => {
  it('keeps created_at — editing a tool is not creating one', async () => {
    const id = 'tool-created-at';
    await seedTool(id, { created_at: '2026-07-26 14:18:07' });

    await CustomToolModel.createOrUpdate(id, toolPayload({ description: 'edited' }), USER);

    expect((await getRow(id)).created_at).toBe('2026-07-26 14:18:07');
  });

  it('does not transfer ownership when someone else saves the row', async () => {
    const id = 'tool-ownership';
    await seedTool(id);

    await CustomToolModel.createOrUpdate(id, toolPayload({ title: 'Edited' }), OTHER_USER);

    expect((await getRow(id)).created_by).toBe(USER);
  });
});

describe('an edit still edits', () => {
  it('writes every field the caller supplied', async () => {
    const id = 'tool-still-writes';
    await seedTool(id);

    await CustomToolModel.createOrUpdate(id, toolPayload({
      title: 'New Title',
      category: 'data',
      type: 'code',
      icon: 'fas fa-code',
      description: 'new description',
      parameters: [{ name: 'a' }],
      outputs: [{ name: 'b' }],
      isShareable: true,
      base: 'CODE',
      code: 'return 1;',
      config: { k: 'v' },
    }), USER);

    const row = await getRow(id);
    expect(row.title).toBe('New Title');
    expect(row.category).toBe('data');
    expect(row.type).toBe('code');
    expect(row.icon).toBe('fas fa-code');
    expect(row.description).toBe('new description');
    expect(JSON.parse(row.parameters)).toEqual([{ name: 'a' }]);
    expect(JSON.parse(row.outputs)).toEqual([{ name: 'b' }]);
    expect(row.is_shareable).toBe(1);
    expect(row.base).toBe('CODE');
    expect(row.code).toBe('return 1;');
    expect(JSON.parse(row.config)).toEqual({ k: 'v' });
  });

  it('moves updated_at', async () => {
    const id = 'tool-updated-at';
    await seedTool(id);
    await run("UPDATE tools SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [id]);

    await CustomToolModel.createOrUpdate(id, toolPayload({ title: 'touched' }), USER);

    expect((await getRow(id)).updated_at).not.toBe('2020-01-01 00:00:00');
  });
});

describe('a brand new tool', () => {
  it('gets a created_at and the caller as owner', async () => {
    const id = 'tool-new';
    await CustomToolModel.createOrUpdate(id, toolPayload(), USER);

    const row = await getRow(id);
    expect(row.created_at).toBeTruthy();
    expect(row.created_by).toBe(USER);
  });
});

/**
 * RATCHET — see AgentModel.provenance.test.js for the reasoning.
 */
describe('every column is accounted for', () => {
  const WRITTEN = new Set([
    'id', 'base', 'title', 'category', 'type', 'icon', 'description', 'config',
    'code', 'parameters', 'outputs', 'is_shareable', 'updated_at',
  ]);
  const INSERT_ONLY = new Set(['created_by']);
  const PRESERVED = new Set(['created_at']);

  it('tools: no column is neither written nor preserved', async () => {
    const unknown = (await columnsOf('tools'))
      .filter((c) => !WRITTEN.has(c) && !INSERT_ONLY.has(c) && !PRESERVED.has(c));
    expect(unknown, `New column(s) on 'tools' that CustomToolModel.createOrUpdate neither writes nor preserves: ${unknown.join(', ')}. Add each to WRITTEN (and to the UPSERT's SET list), INSERT_ONLY, or PRESERVED.`).toEqual([]);
  });
});
