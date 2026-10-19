import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEDULED_GOAL_PLANS, canScheduleGoals } from './scheduledGoalsPlan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('plans that include scheduled goals', () => {
  it('are the paid plans, however the plan name is cased or padded', () => {
    expect(['personal', 'always_on', 'business', 'enterprise', ' Business ', 'PERSONAL'].every(canScheduleGoals)).toBe(true);
    expect(['free', 'community', '', null, undefined, 'trial'].some(canScheduleGoals)).toBe(false);
  });

  it('match the plans the backend lets through (planEntitlements)', () => {
    const backend = readFileSync(join(ROOT, 'backend/src/services/auth/planEntitlements.js'), 'utf8');
    for (const plan of SCHEDULED_GOAL_PLANS) expect(backend, plan).toContain(`'${plan}'`);
  });
});
