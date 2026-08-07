/**
 * A 403 about ENTITLEMENT must not be treated as a 403 about IDENTITY.
 *
 * ---------------------------------------------------------------------------
 * THE LOOP THIS PREVENTS
 * ---------------------------------------------------------------------------
 * `http_403` is in DEFINITIVE_AUTH_REJECTIONS, and correctly so: it has always
 * meant "this account is forbidden" (suspended, disabled), and clearing the
 * token is the right answer.
 *
 * The API now returns 403 for a second, unrelated reason — the caller is
 * authenticated but their PLAN does not include the feature. If that went down
 * the same path, a free user touching a paid endpoint would be logged out, log
 * back in, touch it again, and be logged out again. An infinite login loop that
 * logging in cannot fix.
 *
 * That is not hypothetical: it is the same mechanism that made a JWT_SECRET
 * rotation impossible, and it has already cost this project one outage.
 *
 * The distinguishing marker is the RESPONSE SHAPE (`requiredFeature`), not the
 * status code — see gatedFeature in the API's routes/Middleware.js.
 */

import { describe, it, expect } from 'vitest';
import { classifyAuthError, isDefinitiveAuthRejection } from './userAuth.js';

const responseError = (status, data) => ({ response: { status, data } });

describe('classifying a 403', () => {
  it('an entitlement denial is classified as plan_denied', () => {
    const failure = classifyAuthError(
      responseError(403, { error: 'Feature not available', requiredFeature: 'webhooks' })
    );
    expect(failure.reason).toBe('plan_denied');
    expect(failure.requiredFeature).toBe('webhooks');
    expect(failure.status).toBe(403);
  });

  it('recognises the requirePlan shape too', () => {
    const failure = classifyAuthError(responseError(403, { error: 'Upgrade required', requiredPlan: 'personal' }));
    expect(failure.reason).toBe('plan_denied');
  });

  it('a plain forbidden is STILL http_403', () => {
    // Suspended accounts must keep logging out. Widening the plan carve-out to
    // every 403 would silently disable that.
    const failure = classifyAuthError(responseError(403, { error: 'Account suspended' }));
    expect(failure.reason).toBe('http_403');
  });

  it('a 403 with no body is STILL http_403', () => {
    expect(classifyAuthError(responseError(403, undefined)).reason).toBe('http_403');
    expect(classifyAuthError(responseError(403, null)).reason).toBe('http_403');
    expect(classifyAuthError(responseError(403, 'forbidden')).reason).toBe('http_403');
  });
});

describe('what clears the session', () => {
  it('plan_denied does NOT clear the session', () => {
    expect(isDefinitiveAuthRejection('plan_denied')).toBe(false);
  });

  it('the genuinely definitive rejections still do', () => {
    // Anti-vacuity: if these ever flip, the assertion above is meaningless.
    expect(isDefinitiveAuthRejection('http_401')).toBe(true);
    expect(isDefinitiveAuthRejection('http_403')).toBe(true);
    expect(isDefinitiveAuthRejection('unauthenticated_response')).toBe(true);
    expect(isDefinitiveAuthRejection('no_token')).toBe(true);
  });

  it('transient failures still do not', () => {
    expect(isDefinitiveAuthRejection('http_5xx')).toBe(false);
    expect(isDefinitiveAuthRejection('network_error')).toBe(false);
    expect(isDefinitiveAuthRejection('timeout')).toBe(false);
  });
});

describe('the other reasons are unchanged', () => {
  it('401 stays 401', () => {
    expect(classifyAuthError(responseError(401, { error: 'bad token' })).reason).toBe('http_401');
  });

  it('5xx stays transient', () => {
    expect(classifyAuthError(responseError(503, {})).reason).toBe('http_5xx');
  });

  it('a timeout is still a timeout', () => {
    expect(classifyAuthError({ code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' }).reason).toBe('timeout');
  });

  it('an unmapped status keeps its code', () => {
    expect(classifyAuthError(responseError(418, {})).reason).toBe('http_418');
  });
});
