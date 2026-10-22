/**
 * Plan gates on the desktop backend (rewritten 2026-10-21).
 *
 * The previous suite pinned the opposite of what is right: "IT FAILS OPEN —
 * every unknown resolves to entitled" and "ships OFF when neither the env var
 * nor the sentinel is present". With those rules no install enforced a plan.
 * The plan now comes from a licence verified here (licence.js, tested in
 * licence.test.js); these tests pin how the gates use it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let plan = null;
vi.mock('./licence.js', () => ({
  PAID_PLANS: new Set(['personal', 'always_on', 'business', 'enterprise']),
  verifiedPlan: vi.fn(async () => plan),
}));
vi.mock('./sessionTokenCache.js', () => ({ getSessionUserId: () => 'u1' }));

const { isEnforcing, getPlanType, hasFeature, requirePaidFeature, canRunScheduledGoals, requireScheduledGoals } = await import('./planEntitlements.js');
const { verifiedPlan } = await import('./licence.js');

const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (code) => ((r.statusCode = code), r);
  r.json = (body) => ((r.body = body), r);
  return r;
};
async function guard(feature, req = { user: { userId: 'u1' } }) {
  const r = res();
  const next = vi.fn();
  await requirePaidFeature(feature)(req, r, next);
  return { next, r };
}

beforeEach(() => {
  plan = null;
  verifiedPlan.mockClear();
  delete process.env.ENFORCE_PLAN_GATES;
});

describe('enforcement', () => {
  it('is ON when nothing is configured (it used to ship off)', () => {
    expect(isEnforcing()).toBe(true);
  });
  it('only an explicit false/0/off turns it off (tests, development)', () => {
    for (const v of ['false', '0', 'off', 'FALSE']) {
      process.env.ENFORCE_PLAN_GATES = v;
      expect(isEnforcing(), v).toBe(false);
    }
    process.env.ENFORCE_PLAN_GATES = 'true';
    expect(isEnforcing()).toBe(true);
  });
});

describe('the plan comes from the verified licence, for the right account', () => {
  it('asks for the given account, or the session account', async () => {
    plan = 'personal';
    expect(await getPlanType({ userId: 'u2' })).toBe('personal');
    expect(verifiedPlan).toHaveBeenLastCalledWith('u2', { network: true });
    await getPlanType();
    expect(verifiedPlan).toHaveBeenLastCalledWith('u1', { network: true });
  });
});

describe('paid features need proof', () => {
  it('every paid plan is entitled', async () => {
    for (const p of ['personal', 'always_on', 'business', 'enterprise']) {
      plan = p;
      expect(await hasFeature('remoteAccess'), p).toBe(true);
    }
  });
  it('free is refused, and so is UNKNOWN (no verified licence)', async () => {
    plan = 'free';
    expect(await hasFeature('remoteAccess')).toBe(false);
    plan = null;
    expect(await hasFeature('remoteAccess')).toBe(false);
  });
  it('an unknown feature name is refused, not granted', async () => {
    plan = 'business';
    expect(await hasFeature('notARealFeature')).toBe(false);
  });
});

describe('the HTTP guard', () => {
  it('refuses with 403 and requiredFeature, never 401 (a 401 logs the user out into a loop)', async () => {
    plan = 'free';
    const { next, r } = await guard('remoteAccess');
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ requiredFeature: 'remoteAccess' });
  });
  it('lets a paid plan through, checking the requester (not whoever logged in last)', async () => {
    plan = 'personal';
    const { next } = await guard('remoteAccess', { user: { userId: 'u9' } });
    expect(next).toHaveBeenCalledOnce();
    expect(verifiedPlan).toHaveBeenLastCalledWith('u9', { network: true });
  });
  // Found in the end-to-end check, 2026-10-21: a paying account whose FIRST
  // request was pairing was refused, because the licence fetch only looked in
  // the session cache (filled by a different guard). The request's own token
  // is used now.
  it("fetches the licence with the request's own bearer token", async () => {
    plan = 'enterprise';
    const { next } = await guard('remoteAccess', { user: { userId: 'u9' }, headers: { authorization: 'Bearer own-token' } });
    expect(next).toHaveBeenCalledOnce();
    expect(verifiedPlan).toHaveBeenLastCalledWith('u9', { network: true, token: 'own-token' });
  });

  it('a failing check denies; it never lets the request through', async () => {
    verifiedPlan.mockRejectedValueOnce(new Error('disk on fire'));
    const { next, r } = await guard('remoteAccess');
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
  });
});

describe('scheduled goals', () => {
  it('need a proven paid plan for the owner', async () => {
    plan = null;
    expect(await canRunScheduledGoals('u1')).toBe(false);
    plan = 'always_on';
    expect(await canRunScheduledGoals('u1')).toBe(true);
    expect(await canRunScheduledGoals(null)).toBe(false);
  });
  it('a downgraded account can still switch off and delete its schedules', async () => {
    plan = 'free';
    for (const req of [{ method: 'DELETE', body: {} }, { method: 'PATCH', body: { enabled: false } }]) {
      const next = vi.fn();
      await requireScheduledGoals({ ...req, user: { userId: 'u1' } }, res(), next);
      expect(next).toHaveBeenCalledOnce();
    }
    const r = res();
    const next = vi.fn();
    await requireScheduledGoals({ method: 'POST', body: {}, user: { userId: 'u1' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
  });
});
