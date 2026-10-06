/**
 * The legacy write guard, mounted the way server.js mounts it.
 *
 * Regression: the Learning page's "Waiting for you" queue posts to
 * /api/insights/escalated/{apply,reject}. Its route tests mounted InsightRoutes
 * bare, so they passed while the real server answered 410
 * learning_lifecycle_required to Accept all / Reject all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { learningOnlyWrites, insightWritesGuard } from './learningWriteGuard.js';

let server;
let base;

beforeAll(async () => {
  const reached = (req, res) => res.json({ reached: true });
  const app = express();
  app.use('/api/insights', insightWritesGuard, reached);
  app.use('/api/experiments', learningOnlyWrites, reached);
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const statusOf = async (method, path) => (await fetch(base + path, { method })).status;

describe('insight writes', () => {
  it.each([
    ['POST', '/api/insights/escalated/reject'],
    ['POST', '/api/insights/escalated/apply'],
    ['POST', '/api/insights/memory/orchestrator'],
    ['PUT', '/api/insights/memory/entry/1'],
    ['DELETE', '/api/insights/memory/orphaned'],
  ])('%s %s reaches its route', async (method, path) => {
    expect(await statusOf(method, path)).toBe(200);
  });

  it.each([
    ['POST', '/api/insights/abc/apply'],
    ['POST', '/api/insights/abc/reject'],
    ['POST', '/api/insights/route'],
    ['POST', '/api/insights/settings'],
    ['DELETE', '/api/insights/abc'],
    ['POST', '/api/insights/escalated/reject-everything'],
    ['POST', '/api/insights/memoryless'],
  ])('%s %s stays retired (410)', async (method, path) => {
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('learning_lifecycle_required');
  });

  it('reads are untouched', async () => {
    expect(await statusOf('GET', '/api/insights?status=pending')).toBe(200);
  });
});

describe('other legacy surfaces', () => {
  it('blocks every write and allows reads', async () => {
    expect(await statusOf('POST', '/api/experiments/x')).toBe(410);
    expect(await statusOf('GET', '/api/experiments')).toBe(200);
  });
});
