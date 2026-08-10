/**
 * End-to-end HTTP/SSE test for the run-lifecycle routes.
 *
 * The registry unit tests write into a fake `res`. That proves the bookkeeping
 * but not the thing a browser actually depends on: real headers, a real flushed
 * SSE stream that delivers replayed frames AND subsequent live frames down one
 * connection, a real 204 when nothing is running, and a real close when the run
 * ends. Those are exactly the properties that were broken, so they are worth
 * exercising over a real socket.
 *
 * No LLM and no database are involved: the run is driven directly, which keeps
 * the test fast, deterministic, and focused on the transport.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

// The routes under test are guarded; substitute a fixed identity so the test is
// about the run lifecycle rather than about auth (auth is covered elsewhere).
vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'u1' };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

const { startRun, publish, endRun, _resetForTests } =
  await import('../services/orchestrator/activeRuns.js');
const orchestratorRoutes = (await import('./OrchestratorRoutes.js')).default;

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use('/orchestrator', orchestratorRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  // These tests deliberately leave SSE connections open (that is the feature).
  // server.close() waits for every socket to drain, so it would hang forever
  // without explicitly tearing them down first.
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => _resetForTests());

/**
 * Open a real SSE connection and collect frames as they arrive.
 * Resolves with a handle so the test can read mid-stream.
 */
function openStream(conversationId, user = 'u1') {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}/orchestrator/runs/${conversationId}/stream`,
      { headers: { 'x-test-user': user } },
      (res) => {
        let buffer = '';
        const events = [];
        let closed = false;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!block.startsWith('event: ')) continue;
            const eventName = block.slice(7, block.indexOf('\n'));
            const data = JSON.parse(block.slice(block.indexOf('data: ') + 6));
            events.push({ eventName, data });
          }
        });
        res.on('end', () => { closed = true; });
        resolve({
          status: res.statusCode,
          headers: res.headers,
          events,
          isClosed: () => closed,
          destroy: () => req.destroy(),
        });
      },
    );
    req.on('error', reject);
  });
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('reattaching over a real HTTP connection', () => {
  it('replays the turn so far, then keeps streaming live on the same connection', async () => {
    const run = startRun({ conversationId: 'c-live', userId: 'u1', userMessage: 'hello?' });
    publish(run, 'assistant_message', { id: 'a1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'partial ' });

    const stream = await openStream('c-live');
    await settle();

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');

    // Phase 1 — everything emitted before this client existed.
    expect(stream.events[0].eventName).toBe('run_resumed');
    expect(stream.events[0].data.userMessage).toBe('hello?');
    expect(stream.events.find((e) => e.eventName === 'content_delta').data.delta).toBe('partial ');

    // Phase 2 — the rest of the turn, down the same socket.
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'and the rest' });
    await settle();
    expect(stream.events.at(-1).data.delta).toBe('and the rest');

    endRun('c-live', 'completed');
    await settle();
    expect(stream.events.at(-1).eventName).toBe('run_ended');
    expect(stream.isClosed()).toBe(true);
  });

  it('answers 204 when nothing is generating', async () => {
    const stream = await openStream('never-ran');
    // The normal answer for the vast majority of page loads. It has to be
    // cheap and unambiguous, not an error the client has to interpret.
    expect(stream.status).toBe(204);
  });

  it('does not expose another user\'s run', async () => {
    startRun({ conversationId: 'c-private', userId: 'owner' });
    const stream = await openStream('c-private', 'intruder');
    expect(stream.status).toBe(204);
  });

  it('serves two tabs from one run', async () => {
    const run = startRun({ conversationId: 'c-two', userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });

    const tabA = await openStream('c-two');
    const tabB = await openStream('c-two');
    await settle();

    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'shared' });
    await settle();

    expect(tabA.events.at(-1).data.delta).toBe('shared');
    expect(tabB.events.at(-1).data.delta).toBe('shared');
  });

  it('keeps generating after a reattached client disappears again', async () => {
    const abortController = new AbortController();
    const run = startRun({ conversationId: 'c-flaky', userId: 'u1', abortController });

    const stream = await openStream('c-flaky');
    await settle();
    stream.destroy();
    await settle();

    // A second refresh must be just as survivable as the first.
    expect(abortController.signal.aborted).toBe(false);
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'kept going' });

    const second = await openStream('c-flaky');
    await settle();
    expect(second.events.find((e) => e.eventName === 'content_delta').data.delta).toBe('kept going');
  });
});

describe('status and cancel over HTTP', () => {
  const req = (method, path, user = 'u1') =>
    new Promise((resolve, reject) => {
      const r = http.request(
        `${baseUrl}${path}`,
        { method, headers: { 'x-test-user': user } },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({
            status: res.statusCode,
            json: body ? JSON.parse(body) : null,
          }));
        },
      );
      r.on('error', reject);
      r.end();
    });

  it('reports an active run', async () => {
    startRun({ conversationId: 'c-status', userId: 'u1', chatType: 'agent' });
    const res = await req('GET', '/orchestrator/runs/c-status');
    expect(res.json).toMatchObject({ active: true, known: true, chatType: 'agent' });
  });

  it('cancels on request — the only thing that now stops generation', async () => {
    const abortController = new AbortController();
    startRun({ conversationId: 'c-cancel', userId: 'u1', abortController });

    const res = await req('POST', '/orchestrator/runs/c-cancel/cancel');

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('refuses to cancel a run belonging to someone else', async () => {
    const abortController = new AbortController();
    startRun({ conversationId: 'c-mine', userId: 'owner', abortController });

    const res = await req('POST', '/orchestrator/runs/c-mine/cancel', 'intruder');

    expect(res.status).toBe(403);
    expect(abortController.signal.aborted).toBe(false);
  });

  it('reports an unknown conversation without inventing one', async () => {
    const res = await req('GET', '/orchestrator/runs/nope');
    expect(res.json).toEqual({ active: false, known: false });
  });

  /**
   * The discovery route.
   *
   * Every test above names a conversation up front. That is the assumption
   * this route breaks: a client that never started the run has no id to name,
   * and the localStorage marker that used to be the only record is
   * per-browser. So a task started in Chrome was invisible to Safari and to
   * the Mac app — alive and reattachable the whole time, and undiscoverable.
   */
  describe('listing what is running for me', () => {
    it('finds a run this client never started and knows nothing about', async () => {
      startRun({ conversationId: 'c-elsewhere', userId: 'u1', chatType: 'orchestrator', userMessage: 'long task' });

      const res = await req('GET', '/orchestrator/runs');

      expect(res.status).toBe(200);
      expect(res.json.runs).toHaveLength(1);
      expect(res.json.runs[0]).toMatchObject({
        conversationId: 'c-elsewhere',
        chatType: 'orchestrator',
        active: true,
        userMessage: 'long task',
      });
    });

    it('shows only MY runs', async () => {
      startRun({ conversationId: 'c-mine-list', userId: 'u1' });
      startRun({ conversationId: 'c-theirs-list', userId: 'someone-else' });

      const res = await req('GET', '/orchestrator/runs', 'u1');

      expect(res.json.runs.map((r) => r.conversationId)).toEqual(['c-mine-list']);
    });

    it('still lists a run that just FINISHED, flagged as ended', async () => {
      // Retained runs are the "...or finished one" half of picking a task up
      // from another device: a client arriving seconds after the last token
      // must still be able to collect the answer, which is the whole reason
      // activeRuns keeps ended runs around for a minute.
      startRun({ conversationId: 'c-just-done', userId: 'u1' });
      endRun('c-just-done', 'completed');

      const res = await req('GET', '/orchestrator/runs');
      const run = res.json.runs.find((r) => r.conversationId === 'c-just-done');

      expect(run).toMatchObject({ active: false, ended: true, status: 'completed' });
    });

    it('orders newest first', async () => {
      const older = startRun({ conversationId: 'c-older', userId: 'u1' });
      older.startedAt = Date.now() - 60_000;
      startRun({ conversationId: 'c-newer', userId: 'u1' });

      const res = await req('GET', '/orchestrator/runs');

      expect(res.json.runs.map((r) => r.conversationId)).toEqual(['c-newer', 'c-older']);
    });

    it('answers with an empty list, not an error, when nothing is running', async () => {
      const res = await req('GET', '/orchestrator/runs');
      expect(res.status).toBe(200);
      expect(res.json.runs).toEqual([]);
    });

    it('carries the routing fields a client needs, even when unsaved', async () => {
      // channelKey decides WHICH chat surface reattaches. A conversation too
      // young to have been autosaved has no stored row to derive it from, and
      // that must degrade to null rather than failing the whole listing — the
      // run is still perfectly reattachable.
      startRun({ conversationId: 'c-unsaved', userId: 'u1' });

      const res = await req('GET', '/orchestrator/runs');
      const run = res.json.runs.find((r) => r.conversationId === 'c-unsaved');

      expect(run).toHaveProperty('channelKey', null);
      expect(run).toHaveProperty('title', null);
      expect(run).toHaveProperty('outputId', null);
    });

    it('is not reachable without authentication', async () => {
      // The mocked middleware admits everyone, so this asserts the route is
      // GUARDED rather than that the guard works (auth is covered elsewhere).
      const source = await import('fs').then((fs) =>
        fs.readFileSync(new URL('./OrchestratorRoutes.js', import.meta.url), 'utf8'));
      expect(source).toMatch(/router\.get\(\s*'\/runs'\s*,\s*authenticateToken/);
    });

    it('is declared BEFORE the :conversationId route it could be swallowed by', async () => {
      const source = await import('fs').then((fs) =>
        fs.readFileSync(new URL('./OrchestratorRoutes.js', import.meta.url), 'utf8'));
      expect(source.indexOf("router.get('/runs',")).toBeLessThan(
        source.indexOf("router.get('/runs/:conversationId'"));
    });
  });
});
