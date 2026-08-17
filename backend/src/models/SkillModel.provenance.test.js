/**
 * Saving a skill must not forget what the row already knew.
 *
 * WHY THIS EXISTS
 * ---------------
 * Same defect as AgentModel, one table over. `SkillModel.createOrUpdate` wrote
 * the row with `INSERT OR REPLACE`, which in SQLite DELETEs the conflicting row
 * and INSERTs a new one, so every column the statement does not name reverts to
 * its schema DEFAULT. The statement named 14 of the 17 columns on `skills`. The
 * three it missed are the row's provenance, which no payload carries:
 *
 *   created_at       -> reset to now
 *   source_plugin    -> NULL, orphaning a plugin-installed skill
 *   is_user_modified -> 0, the PRD-057 "user has touched this" flag
 *
 * HERE IT IS WORSE THAN A LOST TIMESTAMP, because of the order SkillService
 * uses. `updateSkill` sets the flag BEFORE it saves:
 *
 *     if (existing.source_plugin) UPDATE skills SET is_user_modified = 1 ...
 *     ...
 *     await SkillModel.createOrUpdate(id, merged, userId);   // wipes it back to 0
 *
 * So the flag was set and then immediately erased, every single time. That flag
 * is not decoration: PluginAssetLoader._decideUpdate reads it to decide whether
 * a plugin upgrade may overwrite the row. With the flag stuck at 0 — and
 * source_plugin nulled a moment later — a user's edits to a plugin-installed
 * skill were silently discarded by the next upgrade of that plugin. Losing the
 * edit is the user-visible bug; losing the flag is why it happened.
 *
 * `user_id` was also being rewritten from the caller's argument on every update.
 * `SkillService.updateSkill` looks the row up with an UNSCOPED findById and then
 * passes the REQUESTER's id, so editing someone else's skill transferred it to
 * you. Preserving user_id on update closes the transfer. Note it does NOT close
 * the underlying authorization gap — a non-owner can still edit the row's
 * contents — which needs a fix in SkillService and is deliberately out of scope
 * here rather than half-addressed.
 *
 * THE FIX is the same UPSERT as AgentModel: ON CONFLICT DO UPDATE touches only
 * the columns it names, so unnamed columns are preserved by construction and a
 * future migration cannot re-open the hole. The last test is a ratchet over the
 * live schema.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let SkillModel;
let TMP;
const savedEnv = {};

const USER = 'user-skill-1';
const OTHER_USER = 'user-skill-2';

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM skills WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this.changes); });
});

const columnsOf = (table) => new Promise((resolve, reject) => {
  db.all(`PRAGMA table_info(${table})`, [], (err, rows) => (err ? reject(err) : resolve(rows.map((r) => r.name))));
});

const skillPayload = (over = {}) => ({
  name: 'pdf-tools',
  description: 'work with pdfs',
  instructions: 'Step one.',
  license: 'MIT',
  compatibility: '',
  metadata: {},
  allowedTools: ['read_file'],
  icon: 'fas fa-file-pdf',
  category: 'documents',
  slug: 'pdf-tools',
  ...over,
});

/** Create a row, then stamp the provenance a real install would carry. */
const seedSkill = async (id, provenance = {}) => {
  await SkillModel.createOrUpdate(id, skillPayload(), USER);
  const {
    created_at = '2026-07-26 14:18:07',
    source_plugin = null,
    is_user_modified = 0,
  } = provenance;
  await run(
    'UPDATE skills SET created_at = ?, source_plugin = ?, is_user_modified = ? WHERE id = ?',
    [created_at, source_plugin, is_user_modified, id]
  );
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-skillprov-'));
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

  SkillModel = (await import('./SkillModel.js')).default;

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
  it('keeps created_at — editing a skill is not creating one', async () => {
    const id = 'skill-created-at';
    await seedSkill(id, { created_at: '2026-07-26 14:18:07' });

    await SkillModel.createOrUpdate(id, skillPayload({ description: 'edited' }), USER);

    expect((await getRow(id)).created_at).toBe('2026-07-26 14:18:07');
  });

  it('keeps source_plugin — an edit does not orphan a plugin-installed skill', async () => {
    const id = 'skill-source-plugin';
    await seedSkill(id, { source_plugin: 'pdf-plugin' });

    await SkillModel.createOrUpdate(id, skillPayload({ name: 'renamed' }), USER);

    expect((await getRow(id)).source_plugin).toBe('pdf-plugin');
  });

  it('keeps the PRD-057 flag that SkillService sets just before saving', async () => {
    // The exact order SkillService.updateSkill uses: flag first, save second.
    // Under INSERT OR REPLACE the save erased the flag it had just been told
    // to set, so a user edit never registered as a user edit.
    const id = 'skill-prd057';
    await seedSkill(id, { source_plugin: 'pdf-plugin', is_user_modified: 0 });

    await run('UPDATE skills SET is_user_modified = 1 WHERE id = ?', [id]);
    await SkillModel.createOrUpdate(id, skillPayload({ instructions: 'user edited this' }), USER);

    expect((await getRow(id)).is_user_modified).toBe(1);
  });

  it('leaves an edited plugin skill protected from the next plugin upgrade', async () => {
    // What PluginAssetLoader._decideUpdate reads to choose skip vs overwrite.
    // Flag 0 means "untouched, safe to overwrite" — which is how a user's edits
    // to a plugin-installed skill were silently discarded on upgrade.
    const id = 'skill-upgrade-guard';
    await seedSkill(id, { source_plugin: 'pdf-plugin', is_user_modified: 0 });

    await run('UPDATE skills SET is_user_modified = 1 WHERE id = ?', [id]);
    await SkillModel.createOrUpdate(id, skillPayload({ instructions: 'my careful edits' }), USER);

    const row = await new Promise((resolve, reject) => {
      db.get('SELECT is_user_modified, source_plugin FROM skills WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r)));
    });
    expect(row.source_plugin).toBe('pdf-plugin');
    expect(row.is_user_modified).toBe(1);
  });

  it('does not transfer ownership when someone else saves the row', async () => {
    const id = 'skill-ownership';
    await seedSkill(id);

    await SkillModel.createOrUpdate(id, skillPayload({ description: 'edited by another user' }), OTHER_USER);

    expect((await getRow(id)).user_id).toBe(USER);
  });
});

describe('an edit still edits', () => {
  it('writes every field the caller supplied', async () => {
    const id = 'skill-still-writes';
    await seedSkill(id);

    await SkillModel.createOrUpdate(id, skillPayload({
      name: 'new-name',
      description: 'new description',
      instructions: 'new instructions',
      license: 'Apache-2.0',
      compatibility: 'agnt>=1',
      metadata: { a: 1 },
      allowedTools: ['x', 'y'],
      icon: 'fas fa-star',
      category: 'other',
      slug: 'new-name',
      isBuiltin: 1,
    }), USER);

    const row = await getRow(id);
    expect(row.name).toBe('new-name');
    expect(row.description).toBe('new description');
    expect(row.instructions).toBe('new instructions');
    expect(row.license).toBe('Apache-2.0');
    expect(row.compatibility).toBe('agnt>=1');
    expect(JSON.parse(row.metadata)).toEqual({ a: 1 });
    expect(JSON.parse(row.allowed_tools)).toEqual(['x', 'y']);
    expect(row.icon).toBe('fas fa-star');
    expect(row.category).toBe('other');
    expect(row.slug).toBe('new-name');
    expect(row.is_builtin).toBe(1);
  });

  it('moves updated_at', async () => {
    const id = 'skill-updated-at';
    await seedSkill(id);
    await run("UPDATE skills SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [id]);

    await SkillModel.createOrUpdate(id, skillPayload({ description: 'touched' }), USER);

    expect((await getRow(id)).updated_at).not.toBe('2020-01-01 00:00:00');
  });
});

describe('a brand new skill', () => {
  it('gets a created_at and the caller as owner', async () => {
    const id = 'skill-new';
    await SkillModel.createOrUpdate(id, skillPayload(), USER);

    const row = await getRow(id);
    expect(row.created_at).toBeTruthy();
    expect(row.user_id).toBe(USER);
  });

  it('starts with clean provenance', async () => {
    const id = 'skill-new-clean';
    await SkillModel.createOrUpdate(id, skillPayload(), USER);

    const row = await getRow(id);
    expect(row.source_plugin).toBeNull();
    expect(row.is_user_modified).toBe(0);
  });
});

/**
 * RATCHET — see AgentModel.provenance.test.js for the reasoning. A new column
 * on `skills` must be declared as written, insert-only, or preserved, so the
 * next migration cannot quietly re-open this hole.
 */
describe('every column is accounted for', () => {
  // Written from the caller's payload on both insert and update.
  const WRITTEN = new Set([
    'id', 'name', 'description', 'instructions', 'license', 'compatibility',
    'metadata', 'allowed_tools', 'icon', 'category', 'is_builtin', 'slug', 'updated_at',
  ]);

  // Set when the row is created and never rewritten by an edit.
  const INSERT_ONLY = new Set(['user_id']);

  // Belong to the row, not the payload. A save must leave them be.
  const PRESERVED = new Set(['created_at', 'is_user_modified', 'source_plugin']);

  it('skills: no column is neither written nor preserved', async () => {
    const unknown = (await columnsOf('skills'))
      .filter((c) => !WRITTEN.has(c) && !INSERT_ONLY.has(c) && !PRESERVED.has(c));
    expect(unknown, `New column(s) on 'skills' that SkillModel.createOrUpdate neither writes nor preserves: ${unknown.join(', ')}. Add each to WRITTEN (and to the UPSERT's SET list), INSERT_ONLY, or PRESERVED.`).toEqual([]);
  });
});
