import { describe, it, expect } from 'vitest';
import { DEFAULT_WORKFLOW_NAME, needsName } from './workflowNaming.js';
import { startRefusal } from './workflowStartRefusal.js';

describe('needsName', () => {
  it('asks only while the workflow has no name of its own', () => {
    expect(needsName(DEFAULT_WORKFLOW_NAME)).toBe(true);
    expect(needsName('  My Workflow  ')).toBe(true);
    expect(needsName('')).toBe(true);
    expect(needsName(null)).toBe(true);
    expect(needsName(undefined)).toBe(true);
  });

  it('a template or saved workflow saves without asking', () => {
    expect(needsName('Watch a web page')).toBe(false);
    expect(needsName('My Workflow 2')).toBe(false);
  });
});

describe('startRefusal', () => {
  it("a plan limit carries the server's explanation and is marked upgradable", () => {
    const body = {
      error: 'Upgrade required',
      message: 'The free plan runs timers daily or slower; "Hourly" needs a paid AGNT plan.',
      code: 'PLAN_LIMIT',
      requiredFeature: 'automation',
    };
    expect(startRefusal(403, body)).toEqual({ message: body.message, planLimit: true });
  });

  it('a required feature alone also marks it upgradable', () => {
    expect(startRefusal(403, { error: 'Feature not available', requiredFeature: 'webhooks' }).planLimit).toBe(true);
  });

  it('any other refusal falls back to the error label, then to the status', () => {
    expect(startRefusal(400, { error: 'Workflow has no trigger' })).toEqual({ message: 'Workflow has no trigger', planLimit: false });
    expect(startRefusal(500, { error: '   ' })).toEqual({ message: 'The workflow could not start (HTTP 500).', planLimit: false });
    expect(startRefusal(502, null)).toEqual({ message: 'The workflow could not start (HTTP 502).', planLimit: false });
  });
});
