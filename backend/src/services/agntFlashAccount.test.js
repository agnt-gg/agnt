import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The AGNT Flash account as chat sees it: the credit chip and the one-click
 * top-up. Driven through the real callService with fetch stubbed at the edge,
 * and the plan gate set to ENFORCING a free plan, so the tests prove a free
 * account still reaches its own trial and can buy credit.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: async () => false, isEnforcing: () => true }));
vi.mock('./auth/planDenial.js', () => ({ planDenialMessageFor: () => 'upgrade' }));

const reply = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

describe('AGNT Flash account', () => {
  let fetchMock;
  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a free account reads its trial balance despite the enforced Pro gate', async () => {
    fetchMock.mockResolvedValue(reply(200, { source: 'agnt_trial', planName: 'AGNT Flash trial', includedCredits: 1_000_000, usedCredits: 900_000, reservedCredits: 0, remainingCredits: 100_000, resetAt: null, balance: { available: 0 } }));
    const { getFlashAccount } = await import('./agntFlashAccount.js');
    const account = await getFlashAccount();
    expect(account).toEqual({ source: 'agnt_trial', planName: 'AGNT Flash trial', trial: true, includedCredits: 1_000_000, usedCredits: 900_000, remainingCredits: 100_000, reservedCredits: 0, balanceMicroUSD: 0, resetAt: null });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://models.agnt.gg/models/v1/usage');
  });

  // Reported 2026-10-06: "the credits left number went UP". A read during a reply
  // saw the gateway's remaining (included - used - HELD), then the hold settled.
  it('"left" counts charged credits only; a hold for a reply in progress is reported apart', async () => {
    const { toFlashAccount } = await import('./agntFlashAccount.js');
    const during = toFlashAccount({ source: 'agnt_trial', includedCredits: 1_000_000, usedCredits: 100_000, reservedCredits: 53_000, remainingCredits: 847_000 });
    const after = toFlashAccount({ source: 'agnt_trial', includedCredits: 1_000_000, usedCredits: 129_483, reservedCredits: 0, remainingCredits: 870_517 });
    expect(during.remainingCredits).toBe(900_000);
    expect(during.reservedCredits).toBe(53_000);
    expect(after.remainingCredits).toBe(870_517);
    expect(after.remainingCredits).toBeLessThanOrEqual(during.remainingCredits);
  });

  it('falls back to the gateway remaining when totals are absent', async () => {
    const { toFlashAccount } = await import('./agntFlashAccount.js');
    expect(toFlashAccount({ remainingCredits: 42 }).remainingCredits).toBe(42);
  });

  it('a free account can start a top-up: POST with an idempotency key, Stripe URL returned', async () => {
    fetchMock.mockResolvedValue(reply(200, { orderId: 'o1', url: 'https://checkout.stripe.com/c/pay/cs_live_x' }));
    const { startTopUp } = await import('./agntFlashAccount.js');
    expect(await startTopUp(1000)).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_live_x', orderId: 'o1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://models.agnt.gg/models/v1/funding/checkout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ amountCents: 1000 });
    expect(init.headers['Idempotency-Key']).toMatch(/^agnt-/);
  });

  it('only sells the amounts the gateway sells, before any network call', async () => {
    const { startTopUp } = await import('./agntFlashAccount.js');
    for (const amount of [0, 500, 999, 100000, Number.NaN]) {
      await expect(startTopUp(amount)).rejects.toMatchObject({ code: 'unsupported_topup' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never opens a checkout URL that is not Stripe-hosted https', async () => {
    const { startTopUp } = await import('./agntFlashAccount.js');
    for (const url of ['http://checkout.stripe.com/x', 'https://evil.example/checkout.stripe.com', 'https://checkout.stripe.com.evil.example/x', 'javascript:alert(1)', undefined]) {
      fetchMock.mockResolvedValueOnce(reply(200, { orderId: 'o', url }));
      await expect(startTopUp(2500)).rejects.toMatchObject({ code: 'checkout_unavailable' });
    }
  });

  it('a checkout is a purchase: a failed one is not retried', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: 'service_unavailable' }));
    const { startTopUp } = await import('./agntFlashAccount.js');
    await expect(startTopUp(5000)).rejects.toMatchObject({ code: 'service_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
