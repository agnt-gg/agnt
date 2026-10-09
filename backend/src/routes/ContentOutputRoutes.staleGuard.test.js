import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import crypto from 'crypto';

const findIdentityById = vi.fn();
const findMetaByConversationId = vi.fn();
const transcriptStatsById = vi.fn();
const contentHashById = vi.fn();
const systemUserTurnsById = vi.fn();
const createOrUpdate = vi.fn(async () => {});

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: 'u1' };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

vi.mock('../models/ContentOutputModel.js', () => ({
  default: {
    findIdentityById: (...a) => findIdentityById(...a),
    findMetaByConversationId: (...a) => findMetaByConversationId(...a),
    transcriptStatsById: (...a) => transcriptStatsById(...a),
    contentHashById: (...a) => contentHashById(...a),
    systemUserTurnsById: (...a) => systemUserTurnsById(...a),
    createOrUpdate: (...a) => createOrUpdate(...a),
    findMetaById: vi.fn(async (id) => ({ id, title: 'stored' })),
    findOne: vi.fn(),
    findAllByUserId: vi.fn(async () => []),
  },
}));

vi.mock('../services/RealtimeService.js', () => ({
  broadcastToUser: vi.fn(),
  RealtimeEvents: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const routes = (await import('./ContentOutputRoutes.js')).default;

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/content-outputs', routes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  for (const fn of [findIdentityById, findMetaByConversationId, transcriptStatsById, contentHashById, systemUserTurnsById, createOrUpdate]) fn.mockReset();
  findIdentityById.mockResolvedValue({ id: 'out-1', user_id: 'u1', conversation_id: 'conv-1' });
  findMetaByConversationId.mockResolvedValue(null);
});

const transcript = (messages) => JSON.stringify({ conversationId: 'conv-1', title: 'T', messages });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SYNCED = [
  { id: 'u1', role: 'user', content: 'build it' },
  { id: 'a1', role: 'assistant', content: 'Started a sub-chat for the build.' },
];
const REPORT = '[System: Sub-chat finished]\n\nSub-chat: "Landing page rebuild" (conversation id ff5135cc)\nStatus: completed\n\nIts final answer:\nBuilt the page.\n\n<!-- agnt-subchats:abc -->';

const save = (body) =>
  fetch(`${baseUrl}/content-outputs/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'out-1', contentType: 'conversation', conversationId: 'conv-1', ...body }),
  });

describe('a client writing over turns it never synced', () => {
  it('is refused when the stored transcript holds a report turn the save lacks', async () => {
    contentHashById.mockResolvedValue('hash-after-report');
    systemUserTurnsById.mockResolvedValue([REPORT]);
    const stale = transcript([...SYNCED, { id: 'u2', role: 'user', content: 'next question' }]);

    const res = await save({ content: stale, baseContentHash: 'hash-the-client-synced' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'transcript_stale', id: 'out-1', contentHash: 'hash-after-report' });
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('is allowed once the client holds the report, whatever its ids, whitespace or text-turn marker', async () => {
    contentHashById.mockResolvedValue('hash-after-report');
    systemUserTurnsById.mockResolvedValue([REPORT]);
    const caughtUp = transcript([
      ...SYNCED,
      { id: 'local-9', role: 'user', content: `[TEXT MESSAGE TURN]\n${REPORT.replace(/\n/g, '\n\n')}` },
      { id: 'local-10', role: 'assistant', content: 'Built and checked.' },
    ]);

    const res = await save({ content: caughtUp, baseContentHash: 'hash-the-client-synced' });

    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('what the guard leaves alone', () => {
  it('a client whose base matches the stored content saves without reading report turns', async () => {
    const content = transcript(SYNCED);
    contentHashById.mockResolvedValue('same');

    const res = await save({ content, baseContentHash: 'same' });

    expect(res.status).toBe(200);
    expect(systemUserTurnsById).not.toHaveBeenCalled();
    expect((await res.json()).contentHash).toBe(sha(content));
  });

  it('a stale base with no report turns stored is allowed: an ordinary server re-write is not a conflict', async () => {
    contentHashById.mockResolvedValue('server-rewrote-same-turns');
    systemUserTurnsById.mockResolvedValue(['[System: Your previous response contained only tool calls with no text.]']);
    const res = await save({ content: transcript(SYNCED), baseContentHash: 'old' });
    expect(res.status).toBe(200);
  });

  it('a client that sends no base behaves exactly as before', async () => {
    const res = await save({ content: transcript(SYNCED) });
    expect(res.status).toBe(200);
    expect(contentHashById).not.toHaveBeenCalled();
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('a row that has never been hashed is not judged', async () => {
    contentHashById.mockResolvedValue(null);
    const res = await save({ content: transcript(SYNCED), baseContentHash: 'anything' });
    expect(res.status).toBe(200);
    expect(systemUserTurnsById).not.toHaveBeenCalled();
  });

  it('an explicit truncation is not judged', async () => {
    contentHashById.mockResolvedValue('changed');
    systemUserTurnsById.mockResolvedValue([REPORT]);
    const res = await save({ content: transcript(SYNCED.slice(0, 1)), baseContentHash: 'old', allowTruncate: true });
    expect(res.status).toBe(200);
    expect(contentHashById).not.toHaveBeenCalled();
  });

  it('an unparseable incoming payload is not judged as missing the report', async () => {
    contentHashById.mockResolvedValue('changed');
    systemUserTurnsById.mockResolvedValue([REPORT]);
    const res = await save({ content: 'not json', baseContentHash: 'old' });
    expect(res.status).toBe(200);
  });

  it('non-conversation outputs are not judged', async () => {
    const res = await save({ content: '<p>x</p>', contentType: 'html', baseContentHash: 'old' });
    expect(res.status).toBe(200);
    expect(contentHashById).not.toHaveBeenCalled();
  });

  it('a row found only by conversation is left to the truncation guard', async () => {
    findIdentityById.mockResolvedValue(null);
    findMetaByConversationId.mockResolvedValue({ id: 'out-1', user_id: 'u1', conversation_id: 'conv-1' });
    transcriptStatsById.mockResolvedValue({ id: 'out-1', contentLength: 10, messageCount: 2 });
    const res = await save({ id: undefined, content: transcript(SYNCED), baseContentHash: 'old' });
    expect(res.status).toBe(200);
    expect(contentHashById).not.toHaveBeenCalled();
  });
});
