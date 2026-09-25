/**
 * The desktop update handoff, end to end through HTTP:
 *   GET  /api/system/busy
 *   POST /api/system/prepare-shutdown
 *
 * Real Express, real RestartManager, busy sources injected. What must hold:
 *   - only the app that spawned the backend (AGNT_CONTROL_TOKEN) may call them;
 *     without the variable they do not exist
 *   - a source that fails is reported as unknown, never as zero
 *   - prepare-shutdown refuses while busy or unknown and changes nothing;
 *     force overrides; success drains, answers 202, THEN shuts down
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

// Only /restart uses it, and the real one opens the database on import. Each
// mount() resets modules, so without this every test re-ran the schema set-up
// against one shared file and an in-flight migration hit SQLITE_SCHEMA.
vi.mock('./Middleware.js', () => ({ authenticateToken: (req, res, next) => next() }));

const TOKEN = 'a'.repeat(64);
let server;
let base;
let RestartManager;
let shutdowns;

async function call(method, path, { token = TOKEN, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers['x-agnt-control-token'] = token;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function mount(tokenEnv) {
  vi.resetModules();
  if (tokenEnv === undefined) delete process.env.AGNT_CONTROL_TOKEN;
  else process.env.AGNT_CONTROL_TOKEN = tokenEnv;
  RestartManager = (await import('../services/RestartManager.js')).default;
  const SystemRoutes = (await import('./SystemRoutes.js')).default;
  shutdowns = [];
  RestartManager.setShutdownHandler((reason) => shutdowns.push(reason));
  RestartManager.setBusySources({ goals: async () => 0, chats: async () => 0, workflows: async () => 0, tools: async () => 0 });
  const app = express();
  app.use(express.json());
  app.use('/api/system', SystemRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  delete process.env.AGNT_CONTROL_TOKEN;
});

describe('without AGNT_CONTROL_TOKEN (browser, Docker, npm start)', () => {
  beforeEach(() => mount(undefined));
  it('both routes do not exist', async () => {
    expect((await call('GET', '/api/system/busy')).status).toBe(404);
    expect((await call('POST', '/api/system/prepare-shutdown')).status).toBe(404);
    expect(shutdowns).toEqual([]);
  });
});

describe('with AGNT_CONTROL_TOKEN (desktop)', () => {
  beforeEach(() => mount(TOKEN));

  it('refuses a missing or wrong token', async () => {
    expect((await call('GET', '/api/system/busy', { token: null })).status).toBe(403);
    expect((await call('GET', '/api/system/busy', { token: 'b'.repeat(64) })).status).toBe(403);
    expect((await call('POST', '/api/system/prepare-shutdown', { token: 'short' })).status).toBe(403);
    expect(RestartManager.isDraining()).toBe(false);
  });

  it('reports every source', async () => {
    RestartManager.setBusySources({ goals: async () => 2, chats: async () => 1 });
    const r = await call('GET', '/api/system/busy');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ goals: 2, chats: 1, workflows: 0, tools: 0, unknown: [] });
  });

  it('a failing or hanging source is unknown, not zero', async () => {
    RestartManager.setBusySources({ goals: async () => { throw new Error('db locked'); }, tools: () => new Promise(() => {}) });
    const r = await call('GET', '/api/system/busy');
    expect(r.body.unknown).toEqual(['goals', 'tools']);
  }, 10000);

  it('prepare-shutdown refuses while busy and stops nothing', async () => {
    RestartManager.setBusySources({ chats: async () => 1 });
    const r = await call('POST', '/api/system/prepare-shutdown');
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('busy');
    expect(RestartManager.isDraining()).toBe(false);
    expect(shutdowns).toEqual([]);
  });

  it('prepare-shutdown refuses when a source cannot answer', async () => {
    RestartManager.setBusySources({ workflows: async () => { throw new Error('child gone'); } });
    const r = await call('POST', '/api/system/prepare-shutdown');
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('unknown');
    expect(shutdowns).toEqual([]);
  });

  it('when idle: 202, drains, and shuts down after the response', async () => {
    const r = await call('POST', '/api/system/prepare-shutdown');
    expect(r.status).toBe(202);
    expect(r.body.ok).toBe(true);
    expect(RestartManager.isDraining()).toBe(true);
    await new Promise((res) => setTimeout(res, 50));
    expect(shutdowns).toEqual(['update']);
  });

  it('force overrides busy', async () => {
    RestartManager.setBusySources({ goals: async () => 3 });
    const r = await call('POST', '/api/system/prepare-shutdown', { body: { force: true } });
    expect(r.status).toBe(202);
    await new Promise((res) => setTimeout(res, 50));
    expect(shutdowns).toEqual(['update']);
  });

  it('a second request while draining is refused, and shutdown runs once', async () => {
    expect((await call('POST', '/api/system/prepare-shutdown')).status).toBe(202);
    const again = await call('POST', '/api/system/prepare-shutdown', { body: { force: true } });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('draining');
    await new Promise((res) => setTimeout(res, 50));
    expect(shutdowns).toEqual(['update']);
  });
});
