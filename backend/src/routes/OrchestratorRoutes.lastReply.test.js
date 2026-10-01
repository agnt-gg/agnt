/**
 * PATCH /orchestrator/conversations/:id/last-reply over a real HTTP socket.
 *
 * The model is substituted (no database): this pins the route's contract —
 * status codes, refusal reasons, the run-active guard, and that the write is
 * conditioned on the updated_at that was read.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

vi.mock('../models/ConversationLogModel.js', () => ({
  default: { getByConversationId: vi.fn(), replaceHistory: vi.fn() },
}));

const ConversationLogModel = (await import('../models/ConversationLogModel.js')).default;
const { startRun, endRun, _resetForTests } = await import('../services/orchestrator/activeRuns.js');
const orchestratorRoutes = (await import('./OrchestratorRoutes.js')).default;

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/orchestrator', orchestratorRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const storedLog = () => ({
  conversationId: 'c1',
  messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello there.' },
  ],
  finalResponse: 'Hello there.',
  updatedAt: '2026-07-30 10:00:00',
});

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
  ConversationLogModel.getByConversationId.mockResolvedValue(storedLog());
  ConversationLogModel.replaceHistory.mockResolvedValue({ conversationId: 'c1', updated: true });
});

const patch = (body, id = 'c1') =>
  fetch(`${baseUrl}/orchestrator/conversations/${id}/last-reply`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

describe('PATCH /conversations/:id/last-reply', () => {
  it('writes the edited transcript, conditioned on the updated_at it read', async () => {
    const res = await patch({ previousText: 'Hello there.', content: 'Hi!' });
    expect(res).toEqual({ status: 200, json: { success: true } });
    expect(ConversationLogModel.getByConversationId).toHaveBeenCalledWith('c1', 'u1');
    const call = ConversationLogModel.replaceHistory.mock.calls[0][0];
    expect(JSON.parse(call.full_history)[1]).toEqual({ role: 'assistant', content: 'Hi!' });
    expect(call.final_response).toBe('Hi!');
    expect(call.expectedUpdatedAt).toBe('2026-07-30 10:00:00');
  });

  it('400s on a malformed body', async () => {
    expect((await patch({ content: 'x' })).status).toBe(400);
    expect((await patch({ previousText: 'a', content: '  ' })).status).toBe(400);
  });

  it('404s when the conversation is missing or not the caller\'s', async () => {
    ConversationLogModel.getByConversationId.mockResolvedValue(null);
    expect((await patch({ previousText: 'Hello there.', content: 'Hi!' })).status).toBe(404);
  });

  it('409s while a run is active and never reads or writes', async () => {
    startRun({ conversationId: 'c1', userId: 'u1', chatType: 'orchestrator', abortController: new AbortController() });
    const res = await patch({ previousText: 'Hello there.', content: 'Hi!' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'run-active' } });
    expect(ConversationLogModel.replaceHistory).not.toHaveBeenCalled();
    endRun('c1');
  });

  it('409s with the reason when the transcript does not end in that text', async () => {
    const res = await patch({ previousText: 'Not what was said.', content: 'Hi!' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'text-mismatch' } });
    expect(ConversationLogModel.replaceHistory).not.toHaveBeenCalled();
  });

  it('409s when another write landed between the read and the write', async () => {
    ConversationLogModel.replaceHistory.mockResolvedValue({ conversationId: 'c1', updated: false });
    const res = await patch({ previousText: 'Hello there.', content: 'Hi!' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'concurrent-write' } });
  });
});
