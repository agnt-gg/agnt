/**
 * The escalation queue: what Annie was not allowed to do alone, waiting for
 * the user to accept or reject.
 *
 * The queue had lost its screen, so the "N actions waiting for you" count led
 * nowhere you could act. These routes back the Learning page's "Waiting for
 * you" tab: list, accept (one, a batch) and reject (one, a batch, all).
 *
 * Pinned here:
 *   - the list is filtered in SQL, so a page limit never changes the count;
 *   - bulk reject touches only the caller's pending, escalated rows;
 *   - bulk accept is bounded, applies each id independently, and reports
 *     applied / skipped / failed instead of failing the batch;
 *   - every by-id route is scoped to the caller.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// Applying a tool insight is the applicator's business, tested elsewhere; here
// it only has to behave like an applicator: mark the row applied.
vi.mock('../services/evolution/applicators/ToolApplicator.js', async () => {
  const { default: InsightModel } = await import('../models/InsightModel.js');
  return {
    default: {
      apply: vi.fn(async (insightId) => {
        await InsightModel.updateStatus(insightId, 'applied', { type: 'test' });
        return { applied: true };
      }),
    },
  };
});

const SECRET = 'insight-escalation-test-secret';
const OWNER = 'user-insight-owner';
const INTRUDER = 'user-insight-intruder';

let db;
let InsightModel;
let server;
let base;
let TMP;
const savedEnv = {};

const tok = (uid) => jwt.sign({ id: uid, email: `${uid}@test.local` }, SECRET, { expiresIn: '1h' });

const call = async (method, p, { body, as } = {}) => {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tok(as)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
};

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this.changes);
    });
  });

const statusOf = (id) =>
  new Promise((resolve, reject) => {
    db.get('SELECT status FROM insights WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r?.status ?? null)));
  });

/** Seed an insight for `owner`; escalated unless `decision` says otherwise. */
async function seed(owner, { title = 't', targetType = 'tool', decision = 'escalate', status = 'pending' } = {}) {
  const id = await InsightModel.create({
    userId: owner, sourceType: 'execution', sourceId: 'run', targetType, targetId: 'x', category: 'improvement', title, description: 'd',
  });
  if (decision) await InsightModel.updateAutonomyMeta(id, { decision, reason: 'needs a human' });
  if (status !== 'pending') await InsightModel.updateStatus(id, status);
  return id;
}

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-insightq-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER', 'JWT_SECRET', 'TRUST_REMOTE_AUTH']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  delete process.env.TRUST_REMOTE_AUTH;
  process.env.AGNT_HOME = TMP;
  process.env.JWT_SECRET = SECRET;
  // An empty agnt.db stops the bootstrap adopting the developer's real one.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  InsightModel = (await import('../models/InsightModel.js')).default;
  const { default: InsightRoutes } = await import('./InsightRoutes.js');

  for (const uid of [OWNER, INTRUDER]) await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);

  const app = express();
  app.use(express.json());
  app.use('/api/insights', InsightRoutes);
  await new Promise((r) => {
    server = http.createServer(app).listen(0, '127.0.0.1', r);
  });
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
  await run('DELETE FROM insights');
});

const waitingList = (as, limit) =>
  call('GET', `/api/insights?status=pending&autonomyDecision=escalate${limit ? `&limit=${limit}` : ''}`, { as });

describe('listing the queue', () => {
  it('filters by decision before the limit, so a small page is still all escalations', async () => {
    // Newer non-escalated rows used to fill the page and hide the queue.
    const waiting = await seed(OWNER, { title: 'old escalation' });
    await run("UPDATE insights SET created_at = '2000-01-01' WHERE id = ?", [waiting]);
    for (let i = 0; i < 3; i++) await seed(OWNER, { decision: null, title: 'plain ' + i });
    const { body } = await waitingList(OWNER, 2);
    expect(body.insights.map((i) => i.id)).toEqual([waiting]);
  });

  it('never lists another account', async () => {
    await seed(OWNER);
    expect((await waitingList(INTRUDER)).body.insights).toEqual([]);
  });
});

describe('rejecting', () => {
  it('rejects every waiting insight of the caller, and nothing else', async () => {
    const a = await seed(OWNER);
    const b = await seed(OWNER);
    const notEscalated = await seed(OWNER, { decision: null });
    const alreadyApplied = await seed(OWNER, { status: 'applied' });
    const theirs = await seed(INTRUDER);

    const { status, body } = await call('POST', '/api/insights/escalated/reject', { as: OWNER, body: {} });
    expect(status).toBe(200);
    expect(body.rejected).toBe(2);
    expect([await statusOf(a), await statusOf(b)]).toEqual(['rejected', 'rejected']);
    expect(await statusOf(notEscalated)).toBe('pending');
    expect(await statusOf(alreadyApplied)).toBe('applied');
    expect(await statusOf(theirs)).toBe('pending');
  });

  it('rejects only the selected ids, and an empty selection rejects nothing', async () => {
    const a = await seed(OWNER);
    const b = await seed(OWNER);
    expect((await call('POST', '/api/insights/escalated/reject', { as: OWNER, body: { ids: [] } })).body.rejected).toBe(0);
    expect((await call('POST', '/api/insights/escalated/reject', { as: OWNER, body: { ids: [a] } })).body.rejected).toBe(1);
    expect([await statusOf(a), await statusOf(b)]).toEqual(['rejected', 'pending']);
  });

  it("cannot reject another account's insight, in bulk or by id", async () => {
    const theirs = await seed(INTRUDER);
    expect((await call('POST', '/api/insights/escalated/reject', { as: OWNER, body: { ids: [theirs] } })).body.rejected).toBe(0);
    expect((await call('POST', `/api/insights/${theirs}/reject`, { as: OWNER })).status).toBe(404);
    expect(await statusOf(theirs)).toBe('pending');
  });

  it('refuses a malformed id list', async () => {
    expect((await call('POST', '/api/insights/escalated/reject', { as: OWNER, body: { ids: 'all' } })).status).toBe(400);
  });
});

describe('accepting', () => {
  it('applies each id independently and reports applied, skipped and failed', async () => {
    const good = await seed(OWNER);
    const unknownTarget = await seed(OWNER, { targetType: 'nonsense' });
    const theirs = await seed(INTRUDER);
    const done = await seed(OWNER, { status: 'rejected' });

    const { status, body } = await call('POST', '/api/insights/escalated/apply', {
      as: OWNER,
      body: { ids: [good, unknownTarget, theirs, done] },
    });
    expect(status).toBe(200);
    expect(body.applied).toEqual([good]);
    expect(body.skipped.sort()).toEqual([theirs, done].sort());
    expect(body.failed).toEqual([{ id: unknownTarget, error: 'Unknown target type: nonsense' }]);
    expect(await statusOf(good)).toBe('applied');
    expect(await statusOf(unknownTarget)).toBe('pending'); // still waiting, still actionable
    expect(await statusOf(theirs)).toBe('pending');
  });

  it('takes a bounded batch: none, or more than 50, is refused', async () => {
    expect((await call('POST', '/api/insights/escalated/apply', { as: OWNER, body: { ids: [] } })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => 'id-' + i);
    expect((await call('POST', '/api/insights/escalated/apply', { as: OWNER, body: { ids: tooMany } })).status).toBe(400);
  });

  it("cannot read or apply another account's insight by id", async () => {
    const theirs = await seed(INTRUDER);
    expect((await call('GET', `/api/insights/${theirs}`, { as: OWNER })).status).toBe(404);
    expect((await call('POST', `/api/insights/${theirs}/apply`, { as: OWNER })).status).toBe(404);
    expect(await statusOf(theirs)).toBe('pending');
  });

  it('applies the caller\'s own insight by id', async () => {
    const mine = await seed(OWNER);
    expect((await call('POST', `/api/insights/${mine}/apply`, { as: OWNER })).status).toBe(200);
    expect(await statusOf(mine)).toBe('applied');
  });
});
