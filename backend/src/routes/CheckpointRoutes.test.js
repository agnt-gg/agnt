import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import { databaseRepository } from '../services/authorization/ScopeRepository.js';
import { TaskCheckpoints } from '../services/TaskCheckpoints.js';
import { createCheckpointRouter } from './CheckpointRoutes.js';

const SCHEMA = `CREATE TABLE chat_checkpoints (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, output_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, task_title TEXT, state TEXT NOT NULL DEFAULT 'pending', note TEXT, team_id TEXT, workspace_id TEXT, task_id TEXT, created_at TEXT NOT NULL, decided_at TEXT)`;
let raw, service, server, notify;

beforeEach(async () => {
  raw = new sqlite3.Database(':memory:');
  const repo = databaseRepository(raw);
  await repo.run(SCHEMA);
  service = new TaskCheckpoints(repo);
  notify = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/checkpoints', createCheckpointRouter({ getService: () => service, authenticate: (req, _res, next) => { const id = req.headers.authorization?.replace('Bearer ', ''); if (id) req.user = { id }; next(); }, notify }));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => raw.close(() => resolve()));
});
const call = async (path, method = 'GET', body, user = 'ann') => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkpoints${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + user } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};

describe('checkpoint routes', () => {
  it('lists only what waits on me, and my conversation\u2019s cards', async () => {
    const mine = (await service.create('ann', 'conv-1', { kind: 'plan', title: 'Plan', content: 'Steps' })).checkpoint;
    await service.create('ben', 'conv-9', { kind: 'plan', title: 'Ben', content: 'Steps' });
    expect((await call('/')).body.map((c) => c.id)).toEqual([mine.id]);
    expect((await call('/?conversationId=conv-1')).body.map((c) => c.id)).toEqual([mine.id]);
    expect((await call('/?conversationId=conv-9')).body).toEqual([]);
  });

  it('another person\u2019s card is a 404 on every route', async () => {
    const theirs = (await service.create('ben', 'conv-9', { kind: 'plan', title: 'Ben', content: 'Steps' })).checkpoint;
    expect((await call('/' + theirs.id)).status).toBe(404);
    expect((await call('/' + theirs.id + '/decide', 'POST', { decision: 'approved' })).status).toBe(404);
    expect((await call('/' + theirs.id + '/locate', 'POST', { outputId: 'x' })).status).toBe(404);
    expect((await service.get('ben', theirs.id)).state).toBe('pending');
  });

  it('decide: once, then 409; the person\u2019s windows are told', async () => {
    const card = (await service.create('ann', 'conv-1', { kind: 'review', title: 'Check the email', content: 'Hi Sam' })).checkpoint;
    const decided = await call('/' + card.id + '/decide', 'POST', { decision: 'approved' });
    expect(decided.status).toBe(200);
    expect(decided.body.checkpoint.state).toBe('approved');
    expect(notify).toHaveBeenCalledWith('ann', 'checkpoint:changed', { id: card.id, conversationId: 'conv-1', state: 'approved' });
    const again = await call('/' + card.id + '/decide', 'POST', { decision: 'approved' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('not_pending');
  });

  it('requires sign-in', async () => {
    expect((await call('/', 'GET', null, null)).status).toBe(401);
  });
});
