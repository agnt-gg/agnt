/**
 * POST /orchestrator/conversations/:id/truncate and /fork over a real HTTP
 * socket. The log model and the fork service are substituted: this pins the
 * routes' contract — status codes, refusal reasons, the run-active guard, the
 * conditional write, and that a fork receives the CUT transcript.
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

vi.mock('../services/orchestrator/conversationFork.js', () => ({
  forkConversation: vi.fn(),
}));

const ConversationLogModel = (await import('../models/ConversationLogModel.js')).default;
const { forkConversation } = await import('../services/orchestrator/conversationFork.js');
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
  initialPrompt: 'Hi',
  messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello there.' },
    { role: 'user', content: 'Tell me a joke' },
    { role: 'assistant', content: 'Knock knock.' },
  ],
  finalResponse: 'Knock knock.',
  updatedAt: '2026-07-30 10:00:00',
});

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
  ConversationLogModel.getByConversationId.mockResolvedValue(storedLog());
  ConversationLogModel.replaceHistory.mockResolvedValue({ conversationId: 'c1', updated: true });
  forkConversation.mockResolvedValue({ conversationId: 'fork-1', copied: { promptState: true, settings: false, dataRefs: 2 } });
});

const post = (action, body, id = 'c1') =>
  fetch(`${baseUrl}/orchestrator/conversations/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

describe('POST /conversations/:id/truncate', () => {
  it('writes the cut transcript, conditioned on the updated_at it read', async () => {
    const res = await post('truncate', { anchorText: 'Tell me a joke', sameTextAfter: 0, mode: 'before' });
    expect(res).toEqual({ status: 200, json: { success: true } });
    expect(ConversationLogModel.getByConversationId).toHaveBeenCalledWith('c1', 'u1');
    const call = ConversationLogModel.replaceHistory.mock.calls[0][0];
    expect(JSON.parse(call.full_history)).toEqual(storedLog().messages.slice(0, 2));
    expect(call.final_response).toBe('Hello there.');
    expect(call.expectedUpdatedAt).toBe('2026-07-30 10:00:00');
  });

  it('through: keeps the anchor user message and drops its reply', async () => {
    await post('truncate', { anchorText: 'Tell me a joke', mode: 'through' });
    expect(JSON.parse(ConversationLogModel.replaceHistory.mock.calls[0][0].full_history)).toHaveLength(3);
  });

  it('400s on a malformed cut, or a fork-only mode', async () => {
    expect((await post('truncate', { mode: 'before' })).status).toBe(400);
    expect((await post('truncate', { anchorText: 'Hi', mode: 'turn' })).status).toBe(400);
  });

  it('404s when the conversation is missing or not the caller\'s', async () => {
    ConversationLogModel.getByConversationId.mockResolvedValue(null);
    expect((await post('truncate', { anchorText: 'Hi', mode: 'before' })).status).toBe(404);
  });

  it('409s while a run is active and never reads or writes', async () => {
    startRun({ conversationId: 'c1', userId: 'u1', chatType: 'orchestrator', abortController: new AbortController() });
    const res = await post('truncate', { anchorText: 'Hi', mode: 'before' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'run-active' } });
    expect(ConversationLogModel.getByConversationId).not.toHaveBeenCalled();
    endRun('c1');
  });

  it('409s with the reason when the anchor is not in the transcript', async () => {
    const res = await post('truncate', { anchorText: 'never said', mode: 'before' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'anchor-not-found' } });
    expect(ConversationLogModel.replaceHistory).not.toHaveBeenCalled();
  });

  it('409s when another write landed between the read and the write', async () => {
    ConversationLogModel.replaceHistory.mockResolvedValue({ conversationId: 'c1', updated: false });
    const res = await post('truncate', { anchorText: 'Hi', mode: 'before' });
    expect(res).toEqual({ status: 409, json: { success: false, error: 'concurrent-write' } });
  });
});

describe('POST /conversations/:id/fork', () => {
  it('forks the transcript cut through the anchor\'s turn and returns the new id', async () => {
    const res = await post('fork', { anchorText: 'Hi', mode: 'turn' });
    expect(res).toEqual({ status: 200, json: { success: true, conversationId: 'fork-1', copied: { promptState: true, settings: false, dataRefs: 2 } } });
    const args = forkConversation.mock.calls[0][0];
    expect(args.sourceId).toBe('c1');
    expect(args.userId).toBe('u1');
    expect(args.messages).toEqual(storedLog().messages.slice(0, 2));
    expect(ConversationLogModel.replaceHistory).not.toHaveBeenCalled();
  });

  it('through: the fork ends on the anchor user message, unanswered', async () => {
    await post('fork', { anchorText: 'Tell me a joke', mode: 'through' });
    expect(forkConversation.mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', content: 'Tell me a joke' });
  });

  it('400s on a delete-only mode; 404s for someone else\'s conversation; 409s on a miss', async () => {
    expect((await post('fork', { anchorText: 'Hi', mode: 'before' })).status).toBe(400);
    ConversationLogModel.getByConversationId.mockResolvedValueOnce(null);
    expect((await post('fork', { anchorText: 'Hi', mode: 'turn' })).status).toBe(404);
    expect(await post('fork', { anchorText: 'never said', mode: 'turn' })).toEqual({ status: 409, json: { success: false, error: 'anchor-not-found' } });
    expect(forkConversation).not.toHaveBeenCalled();
  });

  it('500s, without leaking the cause, when the fork cannot be written', async () => {
    forkConversation.mockRejectedValue(new Error('SQLITE_FULL'));
    const res = await post('fork', { anchorText: 'Hi', mode: 'turn' });
    expect(res).toEqual({ status: 500, json: { success: false, error: 'Failed to fork conversation' } });
  });
});
