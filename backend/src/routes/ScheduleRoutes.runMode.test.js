import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';

// The routine card shows how each run works and the chat it came from: both are stored on the schedule.
const rows = new Map();
vi.mock('../models/ScheduleModel.js', () => ({
  default: {
    create: vi.fn(async (input) => { const id = 's' + (rows.size + 1); rows.set(id, { id, user_id: input.userId, run_mode: input.runMode, source_conversation_id: input.sourceConversationId, cron: input.cron }); return id; }),
    findOne: vi.fn(async (id) => rows.get(id) || null),
    setRunMode: vi.fn(async (id, mode) => { rows.get(id).run_mode = mode; return 1; }),
    setEnabled: vi.fn(async () => 1),
    updateCron: vi.fn(async () => 1),
  },
}));
vi.mock('./Middleware.js', () => ({ authenticateToken: (req, _res, next) => { req.user = { userId: 'u1' }; next(); } }));
vi.mock('../services/auth/planEntitlements.js', () => ({ requireScheduledGoals: (_req, _res, next) => next() }));
vi.mock('./goalOwnership.js', () => ({ findOwnedGoal: vi.fn(async () => ({ id: 'g1' })) }));
vi.mock('../services/scheduler/SchedulerService.js', () => ({ default: {} }));

const { default: ScheduleRoutes } = await import('./ScheduleRoutes.js');
const app = express().use(express.json()).use('/api/schedules', ScheduleRoutes);
const body = { targetType: 'goal', targetId: 'g1', cron: '0 9 * * 1' };
let server, base;
beforeAll(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
afterAll(() => new Promise((resolve) => server.close(resolve)));
const send = async (method, path, payload) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const request = () => ({ post: (p) => ({ send: (b) => send('POST', p, b) }), patch: (p) => ({ send: (b) => send('PATCH', p, b) }) });

beforeEach(() => rows.clear());

describe('a routine records how its runs work and where it came from', () => {
  it('stores runMode and the source chat on create', async () => {
    const res = await request().post('/api/schedules').send({ ...body, runMode: 'ask', sourceConversationId: 'conv-1' });
    expect(res.status).toBe(201);
    expect(res.body.schedule).toMatchObject({ run_mode: 'ask', source_conversation_id: 'conv-1' });
  });
  it('without them a schedule is created exactly as before', async () => {
    const res = await request().post('/api/schedules').send(body);
    expect(res.status).toBe(201);
    expect(res.body.schedule).toMatchObject({ run_mode: null, source_conversation_id: null });
  });
  it('refuses an unknown run mode, on create and on change', async () => {
    expect((await request().post('/api/schedules').send({ ...body, runMode: 'yolo' })).status).toBe(400);
    const { body: made } = await request().post('/api/schedules').send(body);
    expect((await request().patch('/api/schedules/' + made.schedule.id).send({ runMode: 'yolo' })).status).toBe(400);
  });
  it('the owner can switch a routine between asking first and running on its own', async () => {
    const { body: made } = await request().post('/api/schedules').send({ ...body, runMode: 'ask' });
    const res = await request().patch('/api/schedules/' + made.schedule.id).send({ runMode: 'auto' });
    expect(res.status).toBe(200);
    expect(res.body.schedule.run_mode).toBe('auto');
  });
});
