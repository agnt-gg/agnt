/**
 * Plan entitlements in the LOCAL backend.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE SERVER-SIDE GATE
 * ---------------------------------------------------
 * The API's `gatedFeature` guards a request that already reached the cloud, so
 * asking the database about a plan costs nothing extra. This module guards a
 * purely LOCAL operation — pairing a phone with the desktop in front of you —
 * and answering it requires a network round trip that the operation itself does
 * not need.
 *
 * That asymmetry is the whole design, and it is what these tests are about:
 *
 *   - every unknown answer must resolve to ENTITLED, because a billing check
 *     must never become an availability failure for someone who paid;
 *   - only a definite `free` may deny;
 *   - and none of it may refuse anyone until the gate is switched on.
 *
 * The tests below are weighted accordingly: one case for the denial, and eight
 * for the ways it must NOT deny.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

const tokenState = { token: 'tok-1' };
vi.mock('./sessionTokenCache.js', () => ({
  authHeader: () => (tokenState.token ? { Authorization: `Bearer ${tokenState.token}` } : {}),
  getSessionToken: () => tokenState.token,
}));

vi.mock('../../utils/PathManager.js', () => ({
  default: { getDataPath: (...parts) => ['/tmp/agnt-test', ...parts].join('/') },
}));

const axios = (await import('axios')).default;
const mod = await import('./planEntitlements.js');
const { getPlanType, hasFeature, requirePaidFeature, isEnforcing, __resetPlanEntitlementsForTests } = mod;

const okPlan = (planType) => ({ data: { planType, planStatus: 'active', authenticated: true } });

beforeEach(() => {
  __resetPlanEntitlementsForTests();
  vi.clearAllMocks();
  tokenState.token = 'tok-1';
  process.env.REMOTE_URL = 'https://api.test';
  process.env.ENFORCE_PLAN_GATES = 'true'; // most tests want the gate live
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENFORCE_PLAN_GATES;
});

/** Minimal express double. */
function invoke(middleware, req = {}) {
  return new Promise((resolve) => {
    let nexted = false;
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ nexted, statusCode: this.statusCode, body: payload });
        return this;
      },
    };
    middleware(req, res, () => {
      nexted = true;
      resolve({ nexted: true, statusCode: null, body: null });
    });
  });
}

describe('plan lookup', () => {
  it('reads the plan type from the cloud', async () => {
    axios.get.mockResolvedValue(okPlan('personal'));
    expect(await getPlanType()).toBe('personal');
    expect(axios.get.mock.calls[0][0]).toBe('https://api.test/license/status');
    expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('caches, so a polling panel does not hammer the cloud', async () => {
    axios.get.mockResolvedValue(okPlan('personal'));
    await getPlanType();
    await getPlanType();
    await getPlanType();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent lookups into one request', async () => {
    axios.get.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(okPlan('business')), 10))
    );
    const [a, b, c] = await Promise.all([getPlanType(), getPlanType(), getPlanType()]);
    expect([a, b, c]).toEqual(['business', 'business', 'business']);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});

describe('THE DENIAL — the one case that refuses', () => {
  it('a definite free plan is refused', async () => {
    axios.get.mockResolvedValue(okPlan('free'));
    expect(await hasFeature('remoteAccess')).toBe(false);

    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.nexted).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.body.requiredFeature).toBe('remoteAccess');
  });

  it('refuses with 403 and NEVER 401', async () => {
    // A 401 here would be read by the client as "session dead", log the user
    // out, and return them to the same refusal after logging back in.
    axios.get.mockResolvedValue(okPlan('free'));
    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.statusCode).toBe(403);
    expect(result.statusCode).not.toBe(401);
  });
});

describe('IT FAILS OPEN — every unknown resolves to entitled', () => {
  const expectAllowed = async () => {
    expect(await hasFeature('remoteAccess')).toBe(true);
    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.nexted).toBe(true);
  };

  it('when the cloud is unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expectAllowed();
  });

  it('when the cloud returns a 500', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('boom');
    error.response = { status: 500 };
    axios.get.mockRejectedValue(error);
    await expectAllowed();
  });

  it('when the request times out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('timeout of 4000ms exceeded');
    error.code = 'ECONNABORTED';
    axios.get.mockRejectedValue(error);
    await expectAllowed();
  });

  it('when no session token has been seen yet', async () => {
    tokenState.token = null;
    await expectAllowed();
    expect(axios.get, 'called the cloud with no credential').not.toHaveBeenCalled();
  });

  it('when the cloud says our token is not recognised', async () => {
    // authenticated:false is "do not know", not "free". Treating a stale token
    // as a downgrade would refuse a paying customer.
    axios.get.mockResolvedValue({ data: { planType: 'free', authenticated: false } });
    await expectAllowed();
  });

  it('when the body is malformed', async () => {
    axios.get.mockResolvedValue({ data: { nonsense: true } });
    await expectAllowed();
  });

  it('when REMOTE_URL is not configured', async () => {
    delete process.env.REMOTE_URL;
    await expectAllowed();
  });

  it('when the feature name is unknown', async () => {
    // A typo must not silently deny a paying customer.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.get.mockResolvedValue(okPlan('free'));
    expect(await hasFeature('remoteAcess')).toBe(true);
  });
});

describe('every paid plan is entitled', () => {
  for (const plan of ['personal', 'business', 'enterprise']) {
    it(`${plan} passes`, async () => {
      __resetPlanEntitlementsForTests();
      axios.get.mockResolvedValue(okPlan(plan));
      expect(await hasFeature('remoteAccess')).toBe(true);
    });
  }
});

describe('staging', () => {
  it('SHADOW refuses nobody, even a free plan', async () => {
    process.env.ENFORCE_PLAN_GATES = 'false';
    axios.get.mockResolvedValue(okPlan('free'));

    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.nexted).toBe(true);
    // The entitlement answer is still correct — only the refusal is withheld.
    expect(await hasFeature('remoteAccess')).toBe(false);
  });

  it('ships OFF when neither the env var nor the sentinel is present', () => {
    delete process.env.ENFORCE_PLAN_GATES;
    // PathManager is mocked to a directory that does not exist, so existsSync
    // is false — which is the shipped default: no sentinel, no enforcement.
    expect(isEnforcing()).toBe(false);
  });

  it('the env var pins enforcement in both directions', () => {
    process.env.ENFORCE_PLAN_GATES = 'true';
    expect(isEnforcing()).toBe(true);
    process.env.ENFORCE_PLAN_GATES = 'false';
    expect(isEnforcing()).toBe(false);
  });

  it('anti-vacuity: the harness can actually observe a refusal', async () => {
    // If invoke() always reported nexted, every fail-open test above would pass
    // against a module that refuses everyone.
    axios.get.mockResolvedValue(okPlan('free'));
    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.nexted).toBe(false);
    expect(result.statusCode).toBe(403);
  });
});

describe('the guard cannot break the request path', () => {
  it('a throwing entitlement check still calls next()', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.get.mockImplementation(() => {
      throw new Error('synchronous explosion');
    });
    const result = await invoke(requirePaidFeature('remoteAccess'));
    expect(result.nexted).toBe(true);
  });
});
