/**
 * The free plan's limits (decided 2026-10-21): 2 automatic workflows, timers
 * daily or slower, 5 connected accounts, 7 days of history. Paid plans have
 * none. Before this, free ran unlimited automatic workflows at any interval.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-limits-'));
vi.mock('../../utils/PathManager.js', () => ({ default: { getDataPath: (...parts) => path.join(dataDir, ...parts) } }));
vi.mock('./sessionTokenCache.js', () => ({ getSessionToken: () => null, getSessionUserId: () => 'u1', subscribe: () => () => {} }));
let rows = [];
vi.mock('../../models/database/index.js', () => ({ default: { all: (_sql, _params, cb) => cb(null, rows) } }));
vi.mock('../ai/providerConfigs.js', () => ({ getAllProviderKeys: () => ['openai', 'anthropic'] }));

const { FREE_LIMITS, timerTooFastForFree, isAutonomous, freeHistorySince } = await import('./planLimits.js');
const { admitWorkflow } = await import('../../workflow/workflowAdmission.js');
const { enforceFreeLimits } = await import('./licenceEnforcer.js');
const { assertCanConnect } = await import('./connectionLimit.js');
const { graceActive, GRACE_DAYS } = await import('./planGrace.js');

const free = { hasPaidPlan: async () => false, hasLicence: () => true, inGrace: () => false };
const paid = { hasPaidPlan: async () => true };
const timer = (schedule) => ({ nodes: [{ type: 'trigger-timer', category: 'trigger', parameters: { schedule } }] });

beforeEach(() => {
  rows = [];
  delete process.env.ENFORCE_PLAN_GATES;
  fs.rmSync(path.join(dataDir, 'licences'), { recursive: true, force: true });
});

describe('the limits', () => {
  it('are the decided numbers', () => {
    expect(FREE_LIMITS).toEqual({ autonomousRoutines: 2, fastestTimer: 'Daily', connections: 5, historyDays: 7 });
  });
  it('timers: daily or slower is free; faster, or unknown, is not', () => {
    for (const s of ['Daily', 'Weekly', 'Monthly']) expect(timerTooFastForFree(s), s).toBe(false);
    for (const s of ['Every Minute', 'Every 5 Minutes', 'Every 15 Minutes', 'Every 30 Minutes', 'Hourly', 'every second', undefined]) expect(timerTooFastForFree(s), String(s)).toBe(true);
  });
  it('a Specific Time timer (time of day on chosen days) is daily at most: allowed', async () => {
    const specific = { nodes: [{ type: 'trigger-timer', category: 'trigger', parameters: { scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Monday'] } }] };
    expect(await admitWorkflow(specific, 'u1', { ...free, liveAutonomous: 0 })).toEqual({ ok: true });
  });
  it('automatic = any trigger, core or plugin; a workflow with none runs by hand', () => {
    expect(isAutonomous(timer('Daily'))).toBe(true);
    expect(isAutonomous({ nodes: [{ type: 'slack-new-message', category: 'trigger' }] })).toBe(true);
    expect(isAutonomous({ nodes: [{ type: 'send-email', category: 'action' }] })).toBe(false);
  });
  it('history shows the last 7 days', () => {
    expect(freeHistorySince(Date.parse('2026-10-21T00:00:00Z'))).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('switching a workflow on (free)', () => {
  it('a daily timer, under the limit: allowed', async () => {
    expect(await admitWorkflow(timer('Daily'), 'u1', { ...free, liveAutonomous: 1 })).toEqual({ ok: true });
  });
  it('THE ZAPIER CASE: an hourly timer is refused, whatever else runs', async () => {
    expect(await admitWorkflow(timer('Hourly'), 'u1', { ...free, liveAutonomous: 0 })).toMatchObject({ ok: false, code: 'PLAN_LIMIT', limit: 'fastestTimer' });
  });
  it('a third automatic workflow is refused', async () => {
    expect(await admitWorkflow(timer('Daily'), 'u1', { ...free, liveAutonomous: 2 })).toMatchObject({ ok: false, code: 'PLAN_LIMIT', limit: 'autonomousRoutines' });
  });
  it('switching on never gets grace', async () => {
    expect(await admitWorkflow(timer('Daily'), 'u1', { ...free, inGrace: () => true, liveAutonomous: 5 })).toMatchObject({ ok: false });
  });
  it('a workflow with no trigger is never limited', async () => {
    expect(await admitWorkflow({ nodes: [{ type: 'send-email' }] }, 'u1', { ...free, liveAutonomous: 9 })).toEqual({ ok: true });
  });
  it('a paid plan has no limits', async () => {
    expect(await admitWorkflow(timer('Every Minute'), 'u1', { ...paid, liveAutonomous: 50 })).toEqual({ ok: true });
  });
});

describe('restore at boot (free)', () => {
  it('over the limit inside grace: kept running', async () => {
    expect(await admitWorkflow(timer('Daily'), 'u1', { ...free, inGrace: () => true, restore: true, liveAutonomous: 4 })).toEqual({ ok: true, grace: true });
  });
  it('over the limit after grace: refused (switched off)', async () => {
    expect(await admitWorkflow(timer('Daily'), 'u1', { ...free, restore: true, liveAutonomous: 2 })).toMatchObject({ ok: false, limit: 'autonomousRoutines' });
  });
  it('grace is 14 days from the first time it is asked', () => {
    const start = Date.parse('2026-10-21T00:00:00Z');
    expect(GRACE_DAYS).toBe(14);
    expect(graceActive('u-grace', start)).toBe(true);
    expect(graceActive('u-grace', start + 13 * 86_400_000)).toBe(true);
    expect(graceActive('u-grace', start + 14 * 86_400_000)).toBe(false);
  });
});

describe('at login, after grace (free)', () => {
  it('keeps the 2 most recently changed, stops the rest and any timer faster than daily', async () => {
    const live = [
      { id: 'old', user_id: 'u1', updated_at: '2026-01-01', workflow_data: JSON.stringify(timer('Daily')) },
      { id: 'newest', user_id: 'u1', updated_at: '2026-10-01', workflow_data: JSON.stringify(timer('Weekly')) },
      { id: 'fast', user_id: 'u1', updated_at: '2026-09-30', workflow_data: JSON.stringify(timer('Hourly')) },
      { id: 'mid', user_id: 'u1', updated_at: '2026-06-01', workflow_data: JSON.stringify(timer('Daily')) },
      { id: 'other-user', user_id: 'u2', updated_at: '2026-10-02', workflow_data: JSON.stringify(timer('Hourly')) },
    ];
    const deactivate = vi.fn(async () => {});
    const stopped = await enforceFreeLimits('u1', { listActive: async () => live, deactivate, inGrace: () => false });
    expect(stopped).toEqual([{ id: 'fast', reason: 'timer faster than daily' }, { id: 'old', reason: 'over the free limit' }]);
    expect(deactivate.mock.calls.map((c) => c[0])).toEqual(['fast', 'old']);
  });
  it('inside grace, nothing is stopped', async () => {
    const live = [1, 2, 3].map((n) => ({ id: `w${n}`, user_id: 'u1', workflow_data: JSON.stringify(timer('Daily')) }));
    const deactivate = vi.fn();
    expect(await enforceFreeLimits('u1', { listActive: async () => live, deactivate, inGrace: () => true })).toEqual([]);
    expect(deactivate).not.toHaveBeenCalled();
  });
});

describe('connected accounts (free: 5)', () => {
  const five = ['github', 'notion', 'slack', 'google', 'airtable'].map((provider_id) => ({ provider_id }));
  it('a sixth account is refused with an upgrade reason', async () => {
    rows = five;
    await expect(assertCanConnect('u1', 'hubspot', { hasPaidPlan: async () => false })).rejects.toMatchObject({ code: 'PLAN_LIMIT', limit: 'connections', status: 403 });
  });
  it('refreshing or replacing a connected account always passes', async () => {
    rows = five;
    await expect(assertCanConnect('u1', 'Notion', { hasPaidPlan: async () => false })).resolves.toBeUndefined();
  });
  it('AI model keys never count and are never refused', async () => {
    rows = [...five, { provider_id: 'openai' }];
    await expect(assertCanConnect('u1', 'anthropic', { hasPaidPlan: async () => false })).resolves.toBeUndefined();
  });
  it('under the limit, or on a paid plan: allowed', async () => {
    rows = five.slice(0, 4);
    await expect(assertCanConnect('u1', 'hubspot', { hasPaidPlan: async () => false })).resolves.toBeUndefined();
    rows = five;
    await expect(assertCanConnect('u1', 'hubspot', { hasPaidPlan: async () => true })).resolves.toBeUndefined();
  });
});
