/**
 * An entitlement refusal has to reach the user as a sentence, not a status code.
 *
 * The server answers a paid-feature request from a free account with
 * `403 { error: 'Feature not available', requiredFeature: 'emailServer' }`. It
 * uses 403 rather than 401 precisely so the product can offer an upgrade
 * instead of logging the user out. That design is wasted if the client turns it
 * back into "Request failed with status code 403".
 *
 * Two properties matter, and they pull against each other:
 *   - a PLAN denial must be recognised and explained;
 *   - a genuine 403 (suspended account) must NOT be, or a suspended user is
 *     told to buy a subscription.
 */

import { describe, it, expect } from 'vitest';
import {
  readPlanDenial,
  readPlanDenialBody,
  planDenialMessage,
  planDenialMessageFor,
} from './planDenial.js';

const axiosError = (status, data) => ({ response: { status, data } });

describe('recognising a plan denial', () => {
  it('reads the requireFeature shape', () => {
    const denial = readPlanDenial(axiosError(403, { error: 'Feature not available', requiredFeature: 'emailServer' }));
    expect(denial).toEqual({ requiredFeature: 'emailServer', requiredPlan: null });
  });

  it('reads the requirePlan shape', () => {
    const denial = readPlanDenial(axiosError(403, { error: 'Upgrade required', requiredPlan: 'personal' }));
    expect(denial).toEqual({ requiredFeature: null, requiredPlan: 'personal' });
  });

  it('does NOT treat a plain 403 as a plan denial', () => {
    // A suspended account is forbidden, not un-entitled. Telling that user to
    // upgrade would be both wrong and insulting.
    expect(readPlanDenial(axiosError(403, { error: 'Account suspended' }))).toBeNull();
    expect(readPlanDenial(axiosError(403, {}))).toBeNull();
    expect(readPlanDenial(axiosError(403, null))).toBeNull();
    expect(readPlanDenial(axiosError(403, 'forbidden'))).toBeNull();
  });

  it('ignores every other status, even with a matching body', () => {
    // Shape alone is not enough — a 500 that happens to echo the field back is
    // an outage, not an entitlement decision.
    expect(readPlanDenial(axiosError(401, { requiredFeature: 'emailServer' }))).toBeNull();
    expect(readPlanDenial(axiosError(500, { requiredFeature: 'emailServer' }))).toBeNull();
  });

  it('survives an error with no response at all', () => {
    expect(readPlanDenial(new Error('ECONNREFUSED'))).toBeNull();
    expect(readPlanDenial(undefined)).toBeNull();
    expect(readPlanDenial(null)).toBeNull();
  });
});

describe('the message', () => {
  it('names the feature in human words and says what to do', () => {
    const message = planDenialMessage({ requiredFeature: 'emailServer' }, 'Sending email');
    expect(message).toContain('Email');
    expect(message).toMatch(/upgrade/i);
    expect(message).toMatch(/Billing/);
    // The raw flag name is developer vocabulary; it must not be what the user reads.
    expect(message).not.toContain('emailServer');
  });

  it('names the plan when the server supplied one', () => {
    expect(planDenialMessage({ requiredPlan: 'personal' }, 'This')).toContain('personal');
  });

  it('falls back to the action when the feature is unknown', () => {
    const message = planDenialMessage({ requiredFeature: null }, 'Sending email');
    expect(message).toContain('Sending email');
    expect(message).toMatch(/upgrade/i);
  });

  it('passes an unmapped feature through rather than dropping it', () => {
    expect(planDenialMessage({ requiredFeature: 'someNewFeature' })).toContain('someNewFeature');
  });
});

describe('the catch-block helper', () => {
  it('returns a sentence for a plan denial', () => {
    const message = planDenialMessageFor(
      axiosError(403, { error: 'Feature not available', requiredFeature: 'webhooks' }),
      'Registering a webhook'
    );
    expect(message).toContain('Webhooks');
  });

  it('returns null for anything else, so the caller keeps its own handling', () => {
    // The important half. If this returned a string for real failures, every
    // network error would be reported to the user as a billing problem.
    expect(planDenialMessageFor(axiosError(500, {}), 'x')).toBeNull();
    expect(planDenialMessageFor(axiosError(403, { error: 'Account suspended' }), 'x')).toBeNull();
    expect(planDenialMessageFor(new Error('socket hang up'), 'x')).toBeNull();
  });
});

describe('the fetch-shaped variant', () => {
  it('reads a parsed body directly', () => {
    expect(readPlanDenialBody({ requiredFeature: 'emailServer' })).toEqual({
      requiredFeature: 'emailServer',
      requiredPlan: null,
    });
  });

  it('rejects a body that is not an entitlement refusal', () => {
    expect(readPlanDenialBody({ error: 'Internal server error' })).toBeNull();
    expect(readPlanDenialBody(null)).toBeNull();
    expect(readPlanDenialBody('Forbidden')).toBeNull();
  });
});
