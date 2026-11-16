/**
 * Changing a subscriber's plan: the store sends the billing period and code
 * only when given, and the preview sends exactly the body the change is then
 * made with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(String(k), String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear() },
    configurable: true,
  });
}
ensureLocalStorage();

const post = vi.fn();
vi.mock('axios', () => ({ default: { get: vi.fn(), post: (...args) => post(...args) } }));

const { default: userAuth } = await import('./userAuth.js');

const ctx = { commit: vi.fn(), state: { token: 'token-1' } };
const sent = () => post.mock.calls.map(([url, body]) => [url.slice(url.indexOf('/users/')), body]);

beforeEach(() => post.mockReset());

describe('plan changes (userAuth.updateSubscription, userAuth.previewSubscriptionChange)', () => {
  it('sends the plan, and the billing period and code only when given', async () => {
    post.mockResolvedValue({ data: {} });
    await userAuth.actions.updateSubscription(ctx, { newPlanType: 'business' });
    await userAuth.actions.updateSubscription(ctx, { newPlanType: 'personal', interval: 'yearly', promoCode: 'SAVE25' });
    expect(sent()).toEqual([
      ['/users/subscription/update', { newPlanType: 'business' }],
      ['/users/subscription/update', { newPlanType: 'personal', interval: 'yearly', promoCode: 'SAVE25' }],
    ]);
  });

  it('prices a change with exactly the body it is then made with', async () => {
    post.mockResolvedValueOnce({ data: { amountDue: 7500 } }).mockResolvedValueOnce({ data: { interval: 'yearly' } });
    const change = { newPlanType: 'personal', interval: 'yearly', promoCode: 'SAVE25' };
    expect(await userAuth.actions.previewSubscriptionChange(ctx, change)).toEqual({ amountDue: 7500 });
    await userAuth.actions.updateSubscription(ctx, change);
    const [[previewPath, previewBody], [updatePath, updateBody]] = sent();
    expect(previewPath).toBe('/users/subscription/preview');
    expect(updatePath).toBe('/users/subscription/update');
    expect(previewBody).toEqual(updateBody);
  });

  it("a refusal reaches the caller with the server's reason", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: 'That code is not valid.', reason: 'invalid_code' } } }));
    const error = await userAuth.actions.previewSubscriptionChange(ctx, { newPlanType: 'personal', interval: 'yearly', promoCode: 'NOPE' }).catch((e) => e);
    expect(post).toHaveBeenCalledTimes(1);
    expect(error.response.status).toBe(400);
    expect(error.response.data.reason).toBe('invalid_code');
  });
});
