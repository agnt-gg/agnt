/**
 * GET /api/system/storage — real Express, storage modules injected. What must
 * hold: it requires authentication, it reports the database's size and the
 * last maintenance pass, and a failure answers 500 instead of hanging.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

const auth = { allow: true };
vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, res, next) => (auth.allow ? next() : res.status(401).json({ error: 'unauthorized' })),
}));
vi.mock('../models/database/index.js', () => ({ default: { fake: 'db' } }));
const stats = vi.fn();
vi.mock('../services/storage/freePages.js', () => ({ databaseSpaceStats: (...args) => stats(...args) }));
vi.mock('../services/storage/StorageMaintenance.js', () => ({ getLastStorageMaintenanceReport: () => ({ status: 'complete', finishedAt: '2026-10-28T12:00:00.000Z' }) }));

let server;
let base;

beforeEach(async () => {
  auth.allow = true;
  stats.mockReset();
  const SystemRoutes = (await import('./SystemRoutes.js')).default;
  const app = express();
  app.use('/api/system', SystemRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

describe('GET /api/system/storage', () => {
  it('reports the database size and the last maintenance pass', async () => {
    stats.mockResolvedValue({ fileBytes: 1000, freeBytes: 100, autoVacuum: 2 });
    const res = await fetch(`${base}/api/system/storage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      database: { fileBytes: 1000, freeBytes: 100, autoVacuum: 2 },
      lastMaintenance: { status: 'complete', finishedAt: '2026-10-28T12:00:00.000Z' },
    });
    expect(stats).toHaveBeenCalledWith({ fake: 'db' });
  });

  it('requires authentication', async () => {
    auth.allow = false;
    const res = await fetch(`${base}/api/system/storage`);
    expect(res.status).toBe(401);
    expect(stats).not.toHaveBeenCalled();
  });

  it('answers 500 when the statistics cannot be read', async () => {
    stats.mockRejectedValue(new Error('database is locked'));
    const res = await fetch(`${base}/api/system/storage`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Storage statistics are unavailable' });
  });
});
