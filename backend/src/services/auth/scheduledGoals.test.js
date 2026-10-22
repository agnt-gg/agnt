import { describe, it, expect, vi, beforeEach } from 'vitest';
// The plan is what each account's VERIFIED licence says (licence.js). 'paid'
// holds a Personal licence, 'free' a free one, anyone else none at all.
vi.mock('./licence.js', () => ({
  PAID_PLANS: new Set(['personal', 'always_on', 'business', 'enterprise']),
  verifiedPlan: vi.fn(async (id) => (id === 'paid' ? 'personal' : id === 'free' ? 'free' : null)),
}));
vi.mock('./sessionTokenCache.js', () => ({ getSessionUserId: () => 'paid' }));
import { verifiedPlan } from './licence.js';
import { canRunScheduledGoals, requireScheduledGoals } from './planEntitlements.js';
beforeEach(() => { vi.clearAllMocks(); delete process.env.ENFORCE_PLAN_GATES; });
describe('Paid scheduling entitlement', () => {
  it('uses the scheduled owner, not the most recently active paid account', async () => {
    expect(await canRunScheduledGoals('free')).toBe(false);
    expect(verifiedPlan).toHaveBeenCalledWith('free', expect.anything());
    expect(await canRunScheduledGoals('paid')).toBe(true);
    expect(await canRunScheduledGoals('unknown')).toBe(false);
  });
  it('rejects a free request with an upgrade response, not an auth failure', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }; const next = vi.fn();
    await requireScheduledGoals({ method: 'POST', user: { userId: 'free' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(403); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiredFeature: 'scheduledGoals' })); expect(next).not.toHaveBeenCalled();
  });
  it.each([['DELETE', {}], ['PATCH', { enabled: false }]])('lets a downgraded owner stop/remove schedules through %s', async (method, body) => {
    const next = vi.fn(); await requireScheduledGoals({ method, body, user: { userId: 'free' } }, {}, next); expect(next).toHaveBeenCalledOnce();
  });
  it('does not let a pause request smuggle in cron changes', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }; const next = vi.fn();
    await requireScheduledGoals({ method: 'PATCH', body: { enabled: false, cron: '* * * * *' }, user: { userId: 'free' } }, res, next); expect(next).not.toHaveBeenCalled();
  });
});
