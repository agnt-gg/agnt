/**
 * POST /api/tools/:toolName/execute — the route agnt.tool() calls from scripts.
 * Real router and real (isolated) database; the tool itself is stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, res, next) => {
    const user = req.headers['x-test-user'];
    req.user = user ? { id: user, isAuthenticated: true } : { isAuthenticated: false };
    next();
  },
}));
vi.mock('../services/orchestrator/tools.js', () => ({ executeTool: vi.fn(), getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('../services/orchestrator/toolRegistry.js', () => ({ default: {} }));
vi.mock('../tools/ToolRegistry.js', () => ({ default: {} }));
vi.mock('../plugins/PluginManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginAccountStore.js', () => ({ default: {} }));
vi.mock('../models/CustomToolModel.js', () => ({ default: {} }));
vi.mock('../services/hostedPlanLimits.js', () => ({ applyPlanLocks: vi.fn((tools) => tools) }));

import db, { dbReady } from '../models/database/index.js';
import { executeTool } from '../services/orchestrator/tools.js';
import toolsRouter from './ToolsRoutes.js';

const OWNER = 'tools-route-owner';
const OTHER = 'tools-route-other';
const RUN = 'tools-route-run';

const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const recordsFor = (runId) =>
  dbAll('SELECT tool_name, tool_call_id, status, input, output, error FROM agent_tool_executions WHERE execution_id = ? ORDER BY start_time', [runId]);

let server;
let base;

beforeAll(async () => {
  await dbReady;
  for (const id of [OWNER, OTHER]) await dbRun('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)', [id, `${id}@test.local`]);
  await dbRun("INSERT OR IGNORE INTO agent_executions (id, user_id, status) VALUES (?, ?, 'running')", [RUN, OWNER]);

  const app = express();
  app.use(express.json());
  app.use('/api/tools', toolsRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/tools`;
}, 60_000);

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  executeTool.mockReset();
  await dbRun('DELETE FROM agent_tool_executions WHERE execution_id = ?', [RUN]);
});

async function post(tool, { user = OWNER, parent, args = { path: '.' } } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = user;
  if (parent) headers['x-agnt-parent-execution'] = parent;
  const response = await fetch(`${base}/${tool}/execute`, { method: 'POST', headers, body: JSON.stringify({ args }) });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/tools/:toolName/execute', () => {
  it('needs a signed-in caller', async () => {
    expect((await post('list_files', { user: null })).status).toBe(401);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('runs the tool and returns its parsed result', async () => {
    executeTool.mockResolvedValue(JSON.stringify({ success: true, files: ['a.js'] }));
    const { status, body } = await post('list_files');
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, tool: 'list_files', result: { success: true, files: ['a.js'] } });
    expect(executeTool).toHaveBeenCalledWith('list_files', { path: '.' }, null, { userId: OWNER });
  });

  it('reports a failed tool as success: false', async () => {
    executeTool.mockResolvedValue(JSON.stringify({ success: false, error: 'nope' }));
    const { body } = await post('list_files');
    expect(body.success).toBe(false);
    expect(body.error).toBe('nope');
  });
});

describe('calls made by a script (agnt.tool)', () => {
  it("are recorded under the script's run, and the tool sees that run", async () => {
    executeTool.mockResolvedValue(JSON.stringify({ success: true, files: ['a.js'] }));
    const { body } = await post('list_files', { parent: RUN });
    expect(body.success).toBe(true);
    expect(executeTool).toHaveBeenCalledWith('list_files', { path: '.' }, null, { userId: OWNER, executionId: RUN });

    const [record, ...rest] = await recordsFor(RUN);
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ tool_name: 'list_files', tool_call_id: null, status: 'completed', error: null });
    expect(JSON.parse(record.input)).toEqual({ path: '.' });
    expect(JSON.parse(record.output)).toEqual({ success: true, files: ['a.js'] });
  });

  it('are recorded as failed when the tool fails', async () => {
    executeTool.mockResolvedValue(JSON.stringify({ success: false, error: 'nope' }));
    await post('list_files', { parent: RUN });
    const [record] = await recordsFor(RUN);
    expect(record).toMatchObject({ status: 'failed', error: 'nope' });
  });

  it('are recorded as failed when the tool throws, and the caller still gets an answer', async () => {
    executeTool.mockRejectedValue(new Error('exploded'));
    const { status, body } = await post('list_files', { parent: RUN });
    expect(status).toBe(500);
    expect(body.error).toBe('exploded');
    const [record] = await recordsFor(RUN);
    expect(record).toMatchObject({ status: 'failed', error: 'exploded' });
  });

  it('record nothing when the parent run is not found', async () => {
    executeTool.mockResolvedValue(JSON.stringify({ success: true }));
    const { body } = await post('list_files', { user: OTHER, parent: RUN });
    expect(body.success).toBe(true);
    expect(executeTool).toHaveBeenCalledWith('list_files', { path: '.' }, null, { userId: OTHER });
    expect(await recordsFor(RUN)).toEqual([]);
  });
});
