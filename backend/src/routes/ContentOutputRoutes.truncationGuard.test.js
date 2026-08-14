/**
 * POST /content-outputs/save — THE TRUNCATION GUARD.
 *
 * THE INCIDENT (measured, 2026-08-14)
 * ───────────────────────────────────
 * A 404-message conversation was replaced on disk by a 4-message one. The
 * user reloaded and an afternoon of work was gone from the screen.
 *
 * Nothing was corrupt and no request failed. The save path adopts a row by
 * `conversation_id` when the caller sends no output `id` — correct, and the
 * reason three clients no longer mint three sidebar rows for one chat. But
 * adoption hands WRITE access to a row the caller has never READ. A tab that
 * reloads with an empty transcript still knows its conversationId, so its
 * first autosave adopted the full row and overwrote it with the two messages
 * it happened to hold. The regenerated title was the tell: it came from the
 * FIRST message of the surviving fragment.
 *
 * The invariant, stated once:
 *
 *     a caller that did not name the row may not shrink it.
 *
 * These tests are written against the real route over a real socket, and each
 * one asserts on what reached createOrUpdate — because "returned 200" is not
 * the property that matters here. What matters is whether the bytes on disk
 * were replaced.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

const findIdentityById = vi.fn();
const findMetaByConversationId = vi.fn();
const transcriptStatsById = vi.fn();
const createOrUpdate = vi.fn(async () => {});

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
    findIdentityById: (...a) => findIdentityById(...a),
    findMetaByConversationId: (...a) => findMetaByConversationId(...a),
    transcriptStatsById: (...a) => transcriptStatsById(...a),
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
  findIdentityById.mockReset();
  findMetaByConversationId.mockReset();
  transcriptStatsById.mockReset();
  createOrUpdate.mockReset();
});

/** A transcript payload in the shape serializeTranscript() produces. */
const transcript = (n) =>
  JSON.stringify({
    conversationId: 'conv-1',
    title: 'T',
    messages: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? 'assistant' : 'user',
      content: `message ${i}`,
      timestamp: i,
    })),
  });

const save = (body, user = 'u1') =>
  fetch(`${baseUrl}/content-outputs/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': user },
    body: JSON.stringify(body),
  });

/** The row exists and is found ONLY by conversation — i.e. blind adoption. */
const arrangeBlindAdopt = ({ storedMessages }) => {
  findIdentityById.mockResolvedValue(null);
  findMetaByConversationId.mockResolvedValue({ id: 'out-1', user_id: 'u1', conversation_id: 'conv-1' });
  transcriptStatsById.mockResolvedValue({ id: 'out-1', contentLength: 999, messageCount: storedMessages });
};

describe('a caller that never loaded the row may not shrink it', () => {
  it('REFUSES the exact incident: 404 stored, 4 incoming, adopted blindly', async () => {
    arrangeBlindAdopt({ storedMessages: 404 });

    const res = await save({
      content: transcript(4),
      contentType: 'conversation',
      conversationId: 'conv-1',
      title: 'Ok implement that into this worktree',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'transcript_truncation_refused',
      storedMessageCount: 404,
      incomingMessageCount: 4,
      id: 'out-1',
    });

    // THE ASSERTION THAT MATTERS: the bytes on disk were never touched.
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('tells the client which row to reload, so it can repair itself', async () => {
    arrangeBlindAdopt({ storedMessages: 50 });
    const res = await save({ content: transcript(1), contentType: 'conversation', conversationId: 'conv-1' });
    const body = await res.json();
    // Without the id the client cannot fetch the truth and would retry the
    // same destructive save forever.
    expect(body.id).toBe('out-1');
    expect(body.output).toMatchObject({ id: 'out-1' });
  });
});

describe('what the guard must NOT block', () => {
  it('allows a blind adopt that GROWS the conversation — the normal case', async () => {
    arrangeBlindAdopt({ storedMessages: 4 });
    const res = await save({ content: transcript(6), contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('allows an equal-length rewrite — a re-render of the same turn count', async () => {
    arrangeBlindAdopt({ storedMessages: 6 });
    const res = await save({ content: transcript(6), contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('allows shrinking when the caller NAMED the row — it has read it', async () => {
    // Editing an earlier message and re-running legitimately shortens the
    // transcript. That client has been saving all along, so it holds the id.
    findIdentityById.mockResolvedValue({ id: 'out-1', user_id: 'u1', conversation_id: 'conv-1' });
    findMetaByConversationId.mockResolvedValue(null);
    transcriptStatsById.mockResolvedValue({ id: 'out-1', contentLength: 999, messageCount: 400 });

    const res = await save({ id: 'out-1', content: transcript(2), contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    // The guard must not even ask: naming the row is the proof.
    expect(transcriptStatsById).not.toHaveBeenCalled();
  });

  it('allows shrinking when the caller states the intent explicitly', async () => {
    arrangeBlindAdopt({ storedMessages: 400 });
    const res = await save({
      content: transcript(2), contentType: 'conversation', conversationId: 'conv-1', allowTruncate: true,
    });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('leaves non-conversation outputs entirely alone', async () => {
    // An html artifact legitimately gets shorter. It is not a transcript and
    // this guard has no business judging it.
    arrangeBlindAdopt({ storedMessages: 400 });
    const res = await save({ content: '<p>short</p>', contentType: 'html', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('creates a brand-new row without consulting the guard', async () => {
    findIdentityById.mockResolvedValue(null);
    findMetaByConversationId.mockResolvedValue(null);
    const res = await save({ content: transcript(2), contentType: 'conversation', conversationId: 'conv-new' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('unknown is not zero', () => {
  /**
   * The dangerous failure for a guard like this is treating "I could not
   * parse it" as "it has no messages" — that reading turns every save of an
   * unrecognised payload into a refused truncation, and a guard that blocks
   * legitimate saves gets deleted by the next person on call.
   */
  it('allows the save when the STORED count is unknown', async () => {
    findIdentityById.mockResolvedValue(null);
    findMetaByConversationId.mockResolvedValue({ id: 'out-1', user_id: 'u1', conversation_id: 'conv-1' });
    transcriptStatsById.mockResolvedValue({ id: 'out-1', contentLength: 20, messageCount: null });

    const res = await save({ content: transcript(1), contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('allows the save when the INCOMING payload is not parseable', async () => {
    arrangeBlindAdopt({ storedMessages: 400 });
    const res = await save({ content: 'not json at all', contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(200);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('counts a bare-array payload, which older clients still send', async () => {
    // Refusing to count a shape we can plainly read would leave those clients
    // unguarded — the guard would be present but blind.
    arrangeBlindAdopt({ storedMessages: 10 });
    const bareArray = JSON.stringify([{ id: 'm0', role: 'user', content: 'hi' }]);
    const res = await save({ content: bareArray, contentType: 'conversation', conversationId: 'conv-1' });
    expect(res.status).toBe(409);
    expect(createOrUpdate).not.toHaveBeenCalled();
  });
});

describe('ownership still comes first', () => {
  it('never writes into another user\'s row, and never judges it', async () => {
    // A foreign row is discarded outright: the ownership check is an `else if`,
    // so it does not even fall through to the conversation lookup. The caller
    // gets a fresh row of their own.
    //
    // The guard must stay out of this entirely — refusing a stranger's save
    // with a 409 that reports someone else's message count would leak the size
    // of their conversation.
    findIdentityById.mockResolvedValue({ id: 'out-1', user_id: 'someone-else', conversation_id: 'conv-1' });

    const res = await save({ id: 'out-1', content: transcript(2), contentType: 'conversation', conversationId: 'conv-1' });

    expect(res.status).toBe(200);
    expect(transcriptStatsById).not.toHaveBeenCalled();
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    expect(createOrUpdate.mock.calls[0][0]).not.toBe('out-1');
    expect(createOrUpdate.mock.calls[0][1]).toBe('u1');
  });
});
