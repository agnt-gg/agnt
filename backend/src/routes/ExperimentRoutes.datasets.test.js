// #93: POST /api/experiments/datasets with the documented item shape
// ({ input, expectedOutput }) answered 500, because importManual validated
// taskInput / expectedBehavior and the route turned every error into a 500.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => { req.user = { userId: 'user-a' }; next(); },
}));
vi.mock('../models/ExperimentModel.js', () => ({ default: { createDataset: vi.fn(async () => 'dataset-1') } }));
vi.mock('../models/GoldenStandardModel.js', () => ({ default: {} }));
vi.mock('../models/SkillModel.js', () => ({ default: {} }));
vi.mock('../services/ExperimentService.js', () => ({ default: {} }));

const { default: ExperimentRoutes } = await import('./ExperimentRoutes.js');
const { default: ExperimentModel } = await import('../models/ExperimentModel.js');

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/experiments', ExperimentRoutes);
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/experiments`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => vi.clearAllMocks());

const post = async (body) => {
  const res = await fetch(`${base}/datasets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const stored = () => ExperimentModel.createDataset.mock.calls[0][1];

describe('POST /datasets, source manual', () => {
  it('Given the documented item shape from the issue Then 201, stored under the runner field names', async () => {
    const r = await post({
      name: 'probe', category: 'general', source: 'manual',
      items: [{ input: 'say hi', expectedOutput: 'hi', metadata: {} }],
      splitConfig: { train: 0, test: 1, validation: 0 },
    });
    expect(r).toEqual({ status: 201, body: { success: true, datasetId: 'dataset-1' } });
    expect(stored().items).toEqual([{ taskInput: 'say hi', expectedBehavior: 'hi', metadata: {} }]);
    expect(stored().category).toBe('general');
    expect(stored().splitConfig).toEqual({ trainRatio: 0, valRatio: 0, holdoutRatio: 1 });
  });
  it('Given the canonical field names and no split Then 201 with the default split and category', async () => {
    const r = await post({ name: 'canon', source: 'manual', items: [{ taskInput: 'q', expectedBehavior: 'a' }] });
    expect(r.status).toBe(201);
    expect(stored()).toMatchObject({ category: 'manual', splitConfig: { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 } });
  });
  it('Given an item without an expected answer Then 400 naming the item and the fields, nothing stored', async () => {
    const r = await post({ source: 'manual', items: [{ input: 'ok', expectedOutput: 'ok' }, { input: 'missing' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Item 1 needs a non-empty expectedBehavior (or expectedOutput)');
    expect(ExperimentModel.createDataset).not.toHaveBeenCalled();
  });
  it('Given no items Then 400', async () => {
    const r = await post({ source: 'manual', items: [] });
    expect(r).toEqual({ status: 400, body: { error: 'items must be a non-empty array' } });
  });
  it('Given split ratios that do not sum to 1 Then 400', async () => {
    const r = await post({ source: 'manual', items: [{ input: 'q', expectedOutput: 'a' }], splitConfig: { train: 0.7, test: 0.7, validation: 0 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/sum to 1/);
  });
  it('Given a database failure Then still a 500, without the internal message', async () => {
    ExperimentModel.createDataset.mockRejectedValueOnce(new Error('SQLITE_FULL'));
    const r = await post({ source: 'manual', items: [{ input: 'q', expectedOutput: 'a' }] });
    expect(r).toEqual({ status: 500, body: { error: 'Failed to create eval dataset' } });
  });
});
