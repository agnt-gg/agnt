/**
 * A skill belongs to somebody. The by-id routes did not check who.
 *
 * WHY THIS EXISTS
 * ---------------
 * `SkillModel.findAll` already states the ownership rule, in SQL:
 *
 *     SELECT * FROM skills WHERE user_id = ? OR is_builtin = 1
 *
 * So the list endpoint has always been scoped, and the intended policy is not
 * in doubt: you see your own skills, plus built-ins. Every by-id route then
 * reached for `SkillModel.findById`, which is `WHERE id = ?` and nothing else,
 * and none of them compared the row's owner to the caller. The rule was
 * declared in one query and ignored in four handlers.
 *
 * What that allowed, for any authenticated user holding another user's skill id:
 *
 *   GET    /api/skills/:id          read the full instructions
 *   GET    /api/skills/:id/export   download it as SKILL.md
 *   PUT    /api/skills/:id          rewrite it
 *   DELETE /api/skills/:id          destroy it, permanently
 *
 * The delete is the sharp one, and it hid behind a signature that promised the
 * opposite. `SkillModel.delete(id, userId)` accepts a userId and never uses it:
 *
 *     static delete(id, userId) {
 *       db.run(`DELETE FROM skills WHERE id = ?`, [id], ...)
 *
 * `SkillService.deleteSkill` then reads `changes === 0` as "not yours", and
 * answers 404. That reasoning is only sound if the statement were scoped. It
 * was not, so `changes` was 1 for anybody, and the 404 branch could only ever
 * mean "no such row". A hard DELETE, with no soft-delete column to recover
 * from — compare `AgentModel.delete`, which is both scoped (`AND created_by =
 * ?`) and soft (`SET deleted_at = ...`). Skills was the outlier on both counts.
 *
 * THE SHAPE OF THE FIX
 * --------------------
 * The check belongs in the service, not in `findById`. Eight internal callers
 * legitimately fetch a skill by id with no requester in scope at all —
 * OrchestratorService, SkillEvolver (x3), chatConfigs, PluginBundler,
 * EvalDatasetService, ExperimentService — and scoping the model method would
 * break every one of them. `SkillModel.delete` is different: its signature
 * already claims to scope, so it is fixed where it lies.
 *
 * Reads honour the built-in exception exactly as `findAll` grants it. Writes do
 * not: a row that everyone can see must not be a row that anyone can edit.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

const SECRET = 'skill-ownership-test-secret';
const OWNER = 'user-skill-owner';
const INTRUDER = 'user-skill-intruder';

let db;
let SkillModel;
let server;
let base;
let TMP;
const savedEnv = {};

const tok = (uid) => jwt.sign({ id: uid, email: `${uid}@test.local` }, SECRET, { expiresIn: '1h' });

const call = (method, p, { body, as } = {}) =>
  fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${tok(as)}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this.changes); });
});

const row = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM skills WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r || null)));
});

const skillPayload = (over = {}) => ({
  name: 'pdf-tools',
  description: 'work with pdfs',
  instructions: 'SECRET STEPS the owner wrote',
  license: 'MIT',
  compatibility: '',
  metadata: {},
  allowedTools: ['read_file'],
  icon: 'fas fa-file-pdf',
  category: 'documents',
  slug: 'pdf-tools',
  ...over,
});

/** Seed a skill owned by `owner`, bypassing the routes. */
const seed = async (id, owner, over = {}) => {
  await SkillModel.createOrUpdate(id, skillPayload(over), owner);
  return row(id);
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-skillauthz-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER', 'JWT_SECRET', 'TRUST_REMOTE_AUTH']) {
    savedEnv[k] = process.env[k];
  }
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  delete process.env.TRUST_REMOTE_AUTH;
  process.env.AGNT_HOME = TMP;
  process.env.JWT_SECRET = SECRET;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  SkillModel = (await import('../models/SkillModel.js')).default;
  const { default: SkillRoutes } = await import('./SkillRoutes.js');

  for (const uid of [OWNER, INTRUDER]) {
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
  }

  const app = express();
  app.use(express.json());
  app.use('/api/skills', SkillRoutes);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 120000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  await run('DELETE FROM skills');
});

describe('authentication is still required', () => {
  it('refuses an unauthenticated read', async () => {
    await seed('s-anon', OWNER);
    expect((await call('GET', '/api/skills/s-anon')).status).toBe(401);
  });
});

describe('reading someone else\'s skill', () => {
  it('lets the owner read it', async () => {
    await seed('s-read', OWNER);
    const res = await call('GET', '/api/skills/s-read', { as: OWNER });
    expect(res.status).toBe(200);
    expect((await res.json()).skill.instructions).toBe('SECRET STEPS the owner wrote');
  });

  it('refuses a stranger — the instructions are not theirs to read', async () => {
    await seed('s-read2', OWNER);
    const res = await call('GET', '/api/skills/s-read2', { as: INTRUDER });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET STEPS');
  });

  it('refuses a stranger the SKILL.md export', async () => {
    await seed('s-export', OWNER);
    const res = await call('GET', '/api/skills/s-export/export', { as: INTRUDER });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET STEPS');
  });

  it('still lets the owner export', async () => {
    await seed('s-export2', OWNER);
    const res = await call('GET', '/api/skills/s-export2/export', { as: OWNER });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('SECRET STEPS');
  });

  it('a missing skill is 404, not 403 — absent and forbidden are different answers', async () => {
    expect((await call('GET', '/api/skills/no-such-id', { as: INTRUDER })).status).toBe(404);
  });
});

describe('built-in skills stay shared for reading', () => {
  // findAll grants this with `OR is_builtin = 1`. The by-id read must agree,
  // or a skill would be listable and then unreadable.
  it('a non-owner may read a built-in', async () => {
    await seed('s-builtin', OWNER, { isBuiltin: 1 });
    expect((await call('GET', '/api/skills/s-builtin', { as: INTRUDER })).status).toBe(200);
  });

  it('but a non-owner may NOT edit one — shared to read is not shared to write', async () => {
    await seed('s-builtin-w', OWNER, { isBuiltin: 1 });
    const res = await call('PUT', '/api/skills/s-builtin-w', {
      as: INTRUDER, body: { skill: { instructions: 'hijacked' } },
    });
    expect(res.status).toBe(403);
    expect((await row('s-builtin-w')).instructions).toBe('SECRET STEPS the owner wrote');
  });

  it('and a non-owner may NOT delete one', async () => {
    await seed('s-builtin-d', OWNER, { isBuiltin: 1 });
    expect((await call('DELETE', '/api/skills/s-builtin-d', { as: INTRUDER })).status).toBe(403);
    expect(await row('s-builtin-d')).not.toBeNull();
  });
});

describe('editing someone else\'s skill', () => {
  it('lets the owner edit', async () => {
    await seed('s-edit', OWNER);
    const res = await call('PUT', '/api/skills/s-edit', {
      as: OWNER, body: { skill: { instructions: 'my own revision' } },
    });
    expect(res.status).toBe(200);
    expect((await row('s-edit')).instructions).toBe('my own revision');
  });

  it('refuses a stranger, and leaves the row untouched', async () => {
    await seed('s-edit2', OWNER);
    const res = await call('PUT', '/api/skills/s-edit2', {
      as: INTRUDER, body: { skill: { instructions: 'hijacked', name: 'hijacked-name' } },
    });
    expect(res.status).toBe(403);
    const after = await row('s-edit2');
    expect(after.instructions).toBe('SECRET STEPS the owner wrote');
    expect(after.name).toBe('pdf-tools');
  });

  it('a stranger cannot flip the PRD-057 flag as a side effect', async () => {
    // updateSkill stamps is_user_modified BEFORE it saves. That write must not
    // happen either — a refused request should leave no trace at all.
    await seed('s-edit3', OWNER, {});
    await run("UPDATE skills SET source_plugin = 'pdf-plugin', is_user_modified = 0 WHERE id = 's-edit3'");

    const res = await call('PUT', '/api/skills/s-edit3', {
      as: INTRUDER, body: { skill: { instructions: 'hijacked' } },
    });

    expect(res.status).toBe(403);
    expect((await row('s-edit3')).is_user_modified).toBe(0);
  });
});

describe('a malformed update payload', () => {
  // Raised in review of #68. Pre-existing: `skill.name` threw a TypeError into
  // the catch, so a client error was reported as a server fault.
  it('is a 400, not a 500', async () => {
    await seed('s-bad', OWNER);
    const res = await call('PUT', '/api/skills/s-bad', { as: OWNER, body: {} });
    expect(res.status).toBe(400);
  });

  it('is still a 403 for a stranger — authorisation is decided first', async () => {
    await seed('s-bad2', OWNER);
    const res = await call('PUT', '/api/skills/s-bad2', { as: INTRUDER, body: {} });
    expect(res.status).toBe(403);
  });

  it('leaves no trace on the row', async () => {
    await seed('s-bad3', OWNER);
    await run("UPDATE skills SET source_plugin = 'pdf-plugin', is_user_modified = 0 WHERE id = 's-bad3'");

    expect((await call('PUT', '/api/skills/s-bad3', { as: OWNER, body: {} })).status).toBe(400);

    expect((await row('s-bad3')).is_user_modified).toBe(0);
  });
});

describe('deleting someone else\'s skill', () => {
  it('lets the owner delete', async () => {
    await seed('s-del', OWNER);
    expect((await call('DELETE', '/api/skills/s-del', { as: OWNER })).status).toBe(200);
    expect(await row('s-del')).toBeNull();
  });

  it('refuses a stranger AND the skill survives', async () => {
    // The destructive one. This is a hard DELETE with no soft-delete column,
    // so before the fix a stranger could permanently destroy a skill they had
    // never been able to legitimately see.
    await seed('s-del2', OWNER);

    const res = await call('DELETE', '/api/skills/s-del2', { as: INTRUDER });

    expect(res.status).toBe(403);
    expect(await row('s-del2'), 'the skill must still exist').not.toBeNull();
  });

  it('deleting a missing skill is 404', async () => {
    expect((await call('DELETE', '/api/skills/no-such-id', { as: OWNER })).status).toBe(404);
  });
});

describe('SkillModel.delete honours its own signature', () => {
  // It has always taken (id, userId). It has never used userId. Any future
  // caller reading that signature would reasonably assume it scopes.
  it('does not delete a row belonging to someone else', async () => {
    await seed('s-model', OWNER);

    const changes = await SkillModel.delete('s-model', INTRUDER);

    expect(changes).toBe(0);
    expect(await row('s-model')).not.toBeNull();
  });

  it('still deletes the caller\'s own row', async () => {
    await seed('s-model2', OWNER);

    const changes = await SkillModel.delete('s-model2', OWNER);

    expect(changes).toBe(1);
    expect(await row('s-model2')).toBeNull();
  });
});

describe('the routes that were already scoped still work', () => {
  it('the list shows own skills and built-ins, and nobody else\'s', async () => {
    await seed('s-mine', OWNER);
    await seed('s-theirs', INTRUDER, { slug: 'theirs', name: 'theirs' });
    await seed('s-shared', OWNER, { isBuiltin: 1, slug: 'shared', name: 'shared' });

    const res = await call('GET', '/api/skills', { as: INTRUDER });
    expect(res.status).toBe(200);
    const ids = (await res.json()).skills.map((s) => s.id);

    expect(ids).toContain('s-theirs');
    expect(ids).toContain('s-shared');
    expect(ids).not.toContain('s-mine');
  });

  it('creating a skill still works and belongs to the creator', async () => {
    const res = await call('POST', '/api/skills', {
      as: INTRUDER, body: { skill: { name: 'brand-new', description: 'mine' } },
    });
    expect(res.status).toBe(201);
    const { skillId } = await res.json();
    expect((await row(skillId)).user_id).toBe(INTRUDER);
  });
});
