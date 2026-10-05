// Several accounts on one machine (or a team scope next to personal ones)
// share one database: a goal must only be visible to, and controllable by,
// its owner. Real routes and a real (per-run temporary) database; only the
// login is stubbed (x-test-user) and goal execution is never reached because
// every cross-user request must stop at the ownership check.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { randomUUID } from 'crypto';

// These fixtures exercise ownership as paid accounts; billing denial is tested separately.
vi.mock('../services/auth/planEntitlements.js', () => ({ requireScheduledGoals: (_req, _res, next) => next(), canRunScheduledGoals: async () => true }));
vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, res, next) => {
    const user = req.headers['x-test-user'];
    if (!user) return res.status(401).json({ error: 'auth' });
    req.user = { userId: user, id: user };
    next();
  },
}));

const { default: db, dbReady } = await import('../models/database/index.js');
const { default: GoalRoutes } = await import('./GoalRoutes.js');
const { default: SkillForgeRoutes } = await import('./SkillForgeRoutes.js');
const { default: ScheduleRoutes } = await import('./ScheduleRoutes.js');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => (err ? reject(err) : resolve(row))));

const alice = `alice-${randomUUID()}`;
const bob = `bob-${randomUUID()}`;
const goalId = randomUUID();
let server, base;

beforeAll(async () => {
  await dbReady;
  for (const user of [alice, bob]) await run('INSERT INTO users (id, email) VALUES (?, ?)', [user, `${user}@test.local`]);
  await run('INSERT INTO goals (id, user_id, title, description, status) VALUES (?, ?, ?, ?, ?)', [goalId, alice, "Alice's goal", 'Private work', 'paused']);
  const app = express();
  app.use(express.json());
  app.use('/api/goals', GoalRoutes);
  app.use('/api/skillforge', SkillForgeRoutes);
  app.use('/api/schedules', ScheduleRoutes);
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const call = async (user, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': user }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Every goal-id route, as [method, path]. The structural test below keeps
// this honest: a new goal-id route must be added here or it fails.
const GOAL_ROUTES = [
  ['GET', `/goals/${goalId}`],
  ['GET', `/goals/${goalId}/status`],
  ['POST', `/goals/${goalId}/pause`],
  ['POST', `/goals/${goalId}/resume`],
  ['POST', `/goals/${goalId}/execute`],
  ['POST', `/goals/${goalId}/execute-autonomous`],
  ['GET', `/goals/${goalId}/iterations`],
  ['GET', `/goals/${goalId}/world-state`],
  ['POST', `/goals/${goalId}/revert/1`],
  ['POST', `/goals/${goalId}/review`],
  ['POST', `/goals/${goalId}/evaluate`],
  ['GET', `/goals/${goalId}/evaluation`],
  ['POST', `/goals/${goalId}/golden-standard`],
  ['DELETE', `/goals/${goalId}`],
  ['POST', `/skillforge/analyze/${goalId}`],
  ['POST', `/skillforge/evolve/${goalId}`],
];

describe("another user's goal", () => {
  it.each(GOAL_ROUTES)('%s %s answers 404 and changes nothing', async (method, path) => {
    const r = await call(bob, method, path, method === 'GET' ? undefined : {});
    expect(r).toEqual({ status: 404, body: { error: 'Goal not found' } });
    expect(await get('SELECT user_id, status, deleted_at FROM goals WHERE id = ?', [goalId])).toEqual({ user_id: alice, status: 'paused', deleted_at: null });
  });

  it('cannot be targeted by a new schedule', async () => {
    const r = await call(bob, 'POST', '/schedules', { targetType: 'goal', targetId: goalId, cron: '0 9 * * *' });
    expect(r).toEqual({ status: 404, body: { error: 'Goal not found' } });
    expect(await get('SELECT COUNT(*) AS n FROM schedules WHERE target_id = ?', [goalId])).toEqual({ n: 0 });
  });
});

describe('the owner', () => {
  it('reads their goal', async () => {
    const r = await call(alice, 'GET', `/goals/${goalId}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("Alice's goal");
  });

  it("schedules their goal, and another user's by-target list does not show it", async () => {
    const created = await call(alice, 'POST', '/schedules', { targetType: 'goal', targetId: goalId, cron: '0 9 * * *', enabled: false });
    expect(created.status).toBe(201);
    expect((await call(alice, 'GET', `/schedules/target/goal/${goalId}`)).body.schedules).toHaveLength(1);
    expect((await call(bob, 'GET', `/schedules/target/goal/${goalId}`)).body.schedules).toEqual([]);
  });
});

describe('every goal-id route is guarded', () => {
  const guardedRoutes = (router, prefix) => router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: prefix + layer.route.path,
      params: [...layer.route.path.matchAll(/:(\w+)/g)].map((m) => m[1]),
      guard: layer.route.stack.find((s) => s.handle.ownsGoalParam)?.handle.ownsGoalParam,
    }));

  it('GoalRoutes: any route naming a goal checks ownership of that param', () => {
    for (const route of guardedRoutes(GoalRoutes, '/goals')) {
      const goalParam = route.params.find((p) => p === 'id' || p === 'goalId');
      if (goalParam) expect(route, route.path).toMatchObject({ guard: goalParam });
    }
  });

  it('SkillForge: goal-id routes check ownership', () => {
    for (const route of guardedRoutes(SkillForgeRoutes, '/skillforge')) {
      if (route.params.includes('goalId')) expect(route, route.path).toMatchObject({ guard: 'goalId' });
    }
  });

  it('the cross-user list above covers every guarded route', () => {
    const listed = new Set(GOAL_ROUTES.map(([, path]) => path.replace(goalId, ':goalId').replace(/\/revert\/1$/, '/revert/:iteration')));
    const normalise = (p) => p.replace(':id', ':goalId');
    const guarded = [...guardedRoutes(GoalRoutes, '/goals'), ...guardedRoutes(SkillForgeRoutes, '/skillforge')].filter((r) => r.guard).map((r) => normalise(r.path));
    for (const path of guarded) expect([...listed], path).toContain(path);
  });
});
