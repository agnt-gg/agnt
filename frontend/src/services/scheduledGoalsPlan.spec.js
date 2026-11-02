import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEDULED_GOAL_PLANS, canScheduleGoals } from './scheduledGoalsPlan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('plans that include scheduled goals', () => {
  it('are the paid plans and the referral trial, however the plan name is cased or padded', () => {
    expect(['personal', 'always_on', 'business', 'enterprise', 'trial', ' Business ', 'PERSONAL'].every(canScheduleGoals)).toBe(true);
    expect(['free', 'community', '', null, undefined].some(canScheduleGoals)).toBe(false);
  });

  // The backend's plans live with the licence verifier: scheduled goals are a
  // local limit, lifted by LOCAL_PLANS (the paid plans plus TRIAL_PLAN).
  it('match the plans the backend lets through (licence.js LOCAL_PLANS)', () => {
    const backend = readFileSync(join(ROOT, 'backend/src/services/auth/licence.js'), 'utf8');
    expect(backend).toContain('export const LOCAL_PLANS');
    expect(backend).toContain("export const TRIAL_PLAN = 'trial'");
    for (const plan of SCHEDULED_GOAL_PLANS) expect(backend, plan).toContain(`'${plan}'`);
  });
});
