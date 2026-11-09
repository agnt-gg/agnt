/**
 * POST /api/system/storage/compact and the `compaction` field of GET /storage,
 * through HTTP with a real RestartManager and injected busy sources.
 *
 * What must hold: the rebuild starts only when this process owns the data
 * directory, nothing is in progress (or the caller forces it) and no rebuild
 * is already running; a refusal starts nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

vi.mock('./Middleware.js', () => ({ authenticateToken: (req, res, next) => next() }));

const state = { owner: true, running: false, last: null, calls: [] };

vi.mock('../models/database/index.js', () => ({ default: { filename: '/data/agnt.db' } }));
vi.mock('../models/database/dataDirOwnership.js', () => ({ isDataDirOwner: async () => state.owner }));
vi.mock('../services/storage/freePages.js', () => ({ databaseSpaceStats: async () => ({ fileBytes: 10, freeBytes: 4, autoVacuum: 0 }) }));
vi.mock('../services/storage/StorageMaintenance.js', () => ({ getLastStorageMaintenanceReport: () => null }));
vi.mock('../services/storage/databaseCompaction.js', () => ({
  getCompactionState: () => ({ running: state.running, last: state.last }),
  compactDatabase: async (file) => {
    state.calls.push(file);
    state.last = { status: 'complete', bytesFreed: 4 };
    return state.last;
  },
}));

let server;
let base;
let RestartManager;

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  Object.assign(state, { owner: true, running: false, last: null, calls: [] });
  vi.resetModules();
  RestartManager = (await import('../services/RestartManager.js')).default;
  RestartManager.setBusySources({ goals: async () => 0, chats: async () => 0, workflows: async () => 0, tools: async () => 0 });
  const SystemRoutes = (await import('./SystemRoutes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/system', SystemRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('POST /api/system/storage/compact', () => {
  it('starts the rebuild on the open database when nothing is in progress', async () => {
    const res = await call('POST', '/api/system/storage/compact');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ success: true, status: 'started' });
    expect(state.calls).toEqual(['/data/agnt.db']);
  });

  it.each(['goals', 'chats', 'workflows', 'tools'])('refuses while %s are in progress and starts nothing', async (key) => {
    RestartManager.setBusySources({ goals: async () => 0, chats: async () => 0, workflows: async () => 0, tools: async () => 0, [key]: async () => 2 });
    const res = await call('POST', '/api/system/storage/compact');
    expect(res.status).toBe(409);
    expect(res.body.busy[key]).toBe(2);
    expect(state.calls).toEqual([]);
  });

  it('refuses when a busy source cannot answer', async () => {
    RestartManager.setBusySources({ goals: async () => 0, chats: async () => { throw new Error('down'); }, workflows: async () => 0, tools: async () => 0 });
    const res = await call('POST', '/api/system/storage/compact');
    expect(res.status).toBe(409);
    expect(res.body.busy.unknown).toEqual(['chats']);
    expect(state.calls).toEqual([]);
  });

  it('force starts it even while work is in progress', async () => {
    RestartManager.setBusySources({ goals: async () => 1, chats: async () => 0, workflows: async () => 0, tools: async () => 0 });
    const res = await call('POST', '/api/system/storage/compact', { force: true });
    expect(res.status).toBe(202);
    expect(state.calls).toEqual(['/data/agnt.db']);
  });

  it('refuses when another process owns the data directory, even with force', async () => {
    state.owner = false;
    const res = await call('POST', '/api/system/storage/compact', { force: true });
    expect(res.status).toBe(409);
    expect(state.calls).toEqual([]);
  });

  it('refuses while a rebuild is already running', async () => {
    state.running = true;
    const res = await call('POST', '/api/system/storage/compact', { force: true });
    expect(res.status).toBe(409);
    expect(state.calls).toEqual([]);
  });
});

describe('GET /api/system/storage', () => {
  it('reports the rebuild state next to the size figures', async () => {
    await call('POST', '/api/system/storage/compact');
    const res = await call('GET', '/api/system/storage');
    expect(res.status).toBe(200);
    expect(res.body.database).toEqual({ fileBytes: 10, freeBytes: 4, autoVacuum: 0 });
    expect(res.body.compaction).toEqual({ running: false, last: { status: 'complete', bytesFreed: 4 } });
  });
});
