/**
 * The goals health endpoint carries the number the desktop updater needs.
 *
 * Electron's main process cannot read the database (requiring sqlite3 there
 * aborts the process) and holds no session token, so this unauthenticated probe
 * is the only way it can find out whether restarting would destroy running
 * work. If the field disappears, the update interlock silently becomes a no-op
 * that always says "nothing is running" — the failure would never be visible
 * until someone lost a forty-minute run.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import GoalService from './GoalService.js';
import GoalModel from '../models/GoalModel.js';

function res() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    header(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('GET /api/goals/health', () => {
  it('still answers OK — liveness is its first job', async () => {
    vi.spyOn(GoalModel, 'countExecuting').mockResolvedValue(0);
    const r = res();
    await GoalService.healthCheck({}, r);

    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('OK');
  });

  it('reports how many goals are executing', async () => {
    vi.spyOn(GoalModel, 'countExecuting').mockResolvedValue(3);
    const r = res();
    await GoalService.healthCheck({}, r);

    expect(r.body.executing).toBe(3);
  });

  it('reports zero rather than failing when the count cannot be taken', async () => {
    // A health probe that goes red because a COUNT query failed would take the
    // whole app down in any orchestrator that watches it. The updater's answer
    // is the expendable half here, not liveness.
    vi.spyOn(GoalModel, 'countExecuting').mockRejectedValue(new Error('SQLITE_BUSY'));
    const r = res();
    await GoalService.healthCheck({}, r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ status: 'OK', executing: 0 });
  });

  it('needs no authenticated user — main has no token', async () => {
    vi.spyOn(GoalModel, 'countExecuting').mockResolvedValue(1);
    const r = res();
    // No req.user at all, exactly as an unauthenticated probe arrives.
    await GoalService.healthCheck({}, r);

    expect(r.statusCode).toBe(200);
    expect(r.body.executing).toBe(1);
  });
});
