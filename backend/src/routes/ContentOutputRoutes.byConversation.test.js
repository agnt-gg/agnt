/**
 * GET /content-outputs/by-conversation/:conversationId
 *
 * A client that knows its conversationId had no way to ask for the transcript
 * it saved: ContentOutputModel.findByConversationId existed but nothing routed
 * to it. That gap is why the workspace chats persisted to localStorage and
 * rebuilt themselves from the raw provider log instead.
 *
 * Tested over a real socket rather than with a fake `res` because the failure
 * mode this route is most exposed to is a ROUTING one: Express matches in
 * declaration order, so '/:id' declared first would swallow 'by-conversation'
 * and answer with a 404-for-an-output-named-by-conversation. That bug is
 * invisible to a handler unit test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

const findByConversationId = vi.fn();
const findOne = vi.fn();
const setChannelKey = vi.fn();

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: req.headers['x-test-user'] || 'u1' };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

vi.mock('../models/ContentOutputModel.js', () => ({
  default: {
    findByConversationId: (...a) => findByConversationId(...a),
    findOne: (...a) => findOne(...a),
    setChannelKey: (...a) => setChannelKey(...a),
    findAllByUserId: vi.fn(async () => []),
    createOrUpdate: vi.fn(async () => {}),
    findMetaById: vi.fn(async () => ({})),
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
  app.use(express.json());
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
  findByConversationId.mockReset();
  findOne.mockReset();
  setChannelKey.mockReset();
});

const patchChannel = (id, body, user = 'u1') =>
  fetch(`${baseUrl}/content-outputs/${id}/channel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-test-user': user },
    body: JSON.stringify(body),
  });

const get = (path) => fetch(`${baseUrl}${path}`, { headers: { 'x-test-user': 'u1' } });

describe('GET /content-outputs/by-conversation/:conversationId', () => {
  it('returns the saved transcript row for the conversation', async () => {
    findByConversationId.mockResolvedValue({
      id: 'out-9',
      conversation_id: 'conv-1',
      content: '{"messages":[]}',
    });

    const res = await get('/content-outputs/by-conversation/conv-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'out-9', conversation_id: 'conv-1' });
    expect(findByConversationId).toHaveBeenCalledWith('conv-1', 'u1');
  });

  it('is NOT swallowed by the /:id route', async () => {
    // The regression this guards: with '/:id' declared first, this request
    // reaches getContentOutput with id='by-conversation'.
    findByConversationId.mockResolvedValue({ id: 'out-9', content: '{}' });

    await get('/content-outputs/by-conversation/conv-1');

    expect(findByConversationId).toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('404s when the conversation has no saved transcript', async () => {
    // A normal answer, not an error: the caller falls back to the provider log.
    findByConversationId.mockResolvedValue(undefined);
    const res = await get('/content-outputs/by-conversation/conv-none');
    expect(res.status).toBe(404);
  });

  it('scopes the lookup to the requesting user', async () => {
    findByConversationId.mockResolvedValue(undefined);
    await fetch(`${baseUrl}/content-outputs/by-conversation/conv-1`, {
      headers: { 'x-test-user': 'someone-else' },
    });
    // A conversation id is a bearer token for its own contents otherwise.
    expect(findByConversationId).toHaveBeenCalledWith('conv-1', 'someone-else');
  });

  it('reports a lookup failure as a 500 rather than hanging the request', async () => {
    findByConversationId.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/content-outputs/by-conversation/conv-1');
    expect(res.status).toBe(500);
    err.mockRestore();
  });
});

/**
 * PATCH /content-outputs/:id/channel — assign a saved row to the chat channel
 * that owns it, so the main conversation list stops showing embedded chats.
 * A PATCH rather than a re-save because the only thing changing is ownership;
 * a re-save would ship the whole transcript back to write one string.
 */
describe('PATCH /content-outputs/:id/channel', () => {
  it('scopes the row to the given channel', async () => {
    setChannelKey.mockResolvedValue(1);

    const res = await patchChannel('out-9', { channelKey: 'workspace:ws-1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'out-9', channelKey: 'workspace:ws-1' });
    expect(setChannelKey).toHaveBeenCalledWith('out-9', 'u1', 'workspace:ws-1');
  });

  it('scopes only rows the caller owns', async () => {
    setChannelKey.mockResolvedValue(0);
    const res = await patchChannel('out-9', { channelKey: 'workspace:ws-1' }, 'someone-else');

    // Not-found and not-yours are deliberately indistinguishable.
    expect(res.status).toBe(404);
    expect(setChannelKey).toHaveBeenCalledWith('out-9', 'someone-else', 'workspace:ws-1');
  });

  it('rejects a non-string channel key instead of writing junk', async () => {
    setChannelKey.mockResolvedValue(1);
    const res = await patchChannel('out-9', { channelKey: { nope: true } });

    expect(res.status).toBe(400);
    expect(setChannelKey).not.toHaveBeenCalled();
  });

  it('reports a write failure as a 500', async () => {
    setChannelKey.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await patchChannel('out-9', { channelKey: 'workspace:ws-1' })).status).toBe(500);
    err.mockRestore();
  });
});
