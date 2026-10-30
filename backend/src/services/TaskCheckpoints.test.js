import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { databaseRepository } from './authorization/ScopeRepository.js';
import { TaskCheckpoints, boardStatusFor, createBoardClient } from './TaskCheckpoints.js';

// The same columns the consolidated schema declares (models/database/index.js).
const SCHEMA = `CREATE TABLE chat_checkpoints (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, output_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, task_title TEXT, state TEXT NOT NULL DEFAULT 'pending', note TEXT, team_id TEXT, workspace_id TEXT, task_id TEXT, created_at TEXT NOT NULL, decided_at TEXT)`;

let raw, repo;
beforeEach(async () => {
  raw = new sqlite3.Database(':memory:');
  repo = databaseRepository(raw);
  await repo.run(SCHEMA);
});
afterEach(() => new Promise((resolve) => raw.close(() => resolve())));

const plan = { kind: 'plan', title: 'The plan · 3 steps', content: '1. Pull customers\n2. Draft\n3. Send', task_title: 'Send the January price notice' };

describe('checkpoints', () => {
  it('posts a pending card and lists it as waiting', async () => {
    const service = new TaskCheckpoints(repo);
    const { checkpoint } = await service.create('ann', 'conv-1', plan);
    expect(checkpoint).toMatchObject({ kind: 'plan', state: 'pending', taskTitle: 'Send the January price notice', task: null });
    expect((await service.pending('ann')).map((c) => c.id)).toEqual([checkpoint.id]);
    expect(await service.pending('ben')).toEqual([]);
  });

  it('a newer card in the same chat replaces the pending one; other chats are untouched', async () => {
    const service = new TaskCheckpoints(repo);
    const first = (await service.create('ann', 'conv-1', plan)).checkpoint;
    const other = (await service.create('ann', 'conv-2', plan)).checkpoint;
    const revised = (await service.create('ann', 'conv-1', { ...plan, title: 'The plan (revised)' })).checkpoint;
    expect((await service.get('ann', first.id)).state).toBe('superseded');
    expect((await service.pending('ann')).map((c) => c.id).sort()).toEqual([other.id, revised.id].sort());
    await expect(service.decide('ann', first.id, { decision: 'approved' })).rejects.toMatchObject({ status: 409, code: 'not_pending' });
  });

  it('refuses malformed cards', async () => {
    const service = new TaskCheckpoints(repo);
    await expect(service.create('ann', 'c', { ...plan, kind: 'launch' })).rejects.toMatchObject({ status: 400 });
    await expect(service.create('ann', 'c', { ...plan, content: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(service.create('ann', '', plan)).rejects.toMatchObject({ status: 400 });
    await expect(service.create('', 'c', plan)).rejects.toMatchObject({ status: 401 });
  });

  it('a decision happens once, only by the owner, and only a run can be skipped', async () => {
    const service = new TaskCheckpoints(repo);
    const card = (await service.create('ann', 'conv-1', plan)).checkpoint;
    await expect(service.decide('ben', card.id, { decision: 'approved' })).rejects.toMatchObject({ status: 404 });
    await expect(service.decide('ann', card.id, { decision: 'skipped' })).rejects.toMatchObject({ status: 400 });
    await expect(service.decide('ann', card.id, { decision: 'maybe' })).rejects.toMatchObject({ status: 400 });
    const { checkpoint } = await service.decide('ann', card.id, { decision: 'approved' });
    expect(checkpoint).toMatchObject({ state: 'approved' });
    expect(checkpoint.decidedAt).toBeTruthy();
    await expect(service.decide('ann', card.id, { decision: 'approved' })).rejects.toMatchObject({ status: 409 });
    const run = (await service.create('ann', 'conv-run', { kind: 'run', title: 'This run', content: '2 reminders' })).checkpoint;
    expect((await service.decide('ann', run.id, { decision: 'skipped' })).checkpoint.state).toBe('skipped');
  });

  it('remembers which saved chat it lives in, once, for its owner only', async () => {
    const service = new TaskCheckpoints(repo);
    const card = (await service.create('ann', 'conv-1', plan)).checkpoint;
    await expect(service.locate('ben', card.id, 'out-1')).rejects.toMatchObject({ status: 404 });
    expect((await service.locate('ann', card.id, 'out-1')).outputId).toBe('out-1');
    expect((await service.locate('ann', card.id, 'out-2')).outputId).toBe('out-1');
  });
});

describe('the board card follows the chat', () => {
  it('status mapping', () => {
    expect(boardStatusFor('plan', 'pending')).toBe('review');
    expect(boardStatusFor('plan', 'approved')).toBe('doing');
    expect(boardStatusFor('review', 'changes')).toBe('doing');
    expect(boardStatusFor('final', 'approved')).toBe('done');
    expect(boardStatusFor('routine', 'approved')).toBe('done');
  });

  it('creates one card per conversation, reuses it, and moves it with each decision', async () => {
    const board = { create: vi.fn(async () => ({ id: 'task-9' })), move: vi.fn(async () => ({})) };
    const service = new TaskCheckpoints(repo, board);
    const team = { teamId: 'acme', workspaceId: 'sales' };
    const first = (await service.create('ann', 'conv-1', plan, { authToken: 'tok', team })).checkpoint;
    expect(board.create).toHaveBeenCalledWith({ authToken: 'tok', teamId: 'acme', workspaceId: 'sales', title: 'Send the January price notice' });
    expect(first.task).toEqual({ teamId: 'acme', workspaceId: 'sales', id: 'task-9' });
    await service.decide('ann', first.id, { decision: 'approved' }, { authToken: 'tok' });
    const final = (await service.create('ann', 'conv-1', { kind: 'final', title: 'Finished', content: 'All 46 scheduled' }, { authToken: 'tok' })).checkpoint;
    expect(board.create).toHaveBeenCalledTimes(1);
    expect(final.task.id).toBe('task-9');
    await service.decide('ann', final.id, { decision: 'approved' }, { authToken: 'tok' });
    expect(board.move.mock.calls.map(([args]) => args.status)).toEqual(['review', 'doing', 'review', 'done']);
  });

  it('a board that cannot be reached never blocks the checkpoint', async () => {
    const board = { create: vi.fn(async () => { throw new Error('team unavailable'); }), move: vi.fn() };
    const service = new TaskCheckpoints(repo, board);
    const { checkpoint, linkError } = await service.create('ann', 'conv-1', plan, { authToken: 't', team: { teamId: 'a', workspaceId: 'w' } });
    expect(checkpoint.state).toBe('pending');
    expect(checkpoint.task).toBeNull();
    expect(linkError).toMatch(/team unavailable/);
  });
});

describe('board client', () => {
  it('moves with the current revision and retries once after a teammate\u2019s edit', async () => {
    const calls = [];
    let revision = 1;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push([options.method || 'GET', url.replace('http://x/api', ''), options.headers.Authorization]);
      if (!options.method) return { ok: true, json: async () => ({ id: 't', status: 'todo', revision }) };
      const body = JSON.parse(options.body);
      if (body.expectedRevision === 1) { revision = 2; return { ok: false, status: 409, json: async () => ({ error: 'changed', code: 'revision_conflict' }) }; }
      return { ok: true, json: async () => ({ id: 't', status: body.status, revision: 3 }) };
    });
    const client = createBoardClient({ fetchImpl, base: () => 'http://x/api' });
    const moved = await client.move({ authToken: 'tok', teamId: 'acme', workspaceId: 'sales', taskId: 't', status: 'done' });
    expect(moved.status).toBe('done');
    expect(calls.map((c) => c[0])).toEqual(['GET', 'PATCH', 'GET', 'PATCH']);
    expect(calls.every((c) => c[2] === 'Bearer tok')).toBe(true);
    expect(calls[0][1]).toBe('/teams/acme/workspaces/sales/tasks/t');
  });
});
