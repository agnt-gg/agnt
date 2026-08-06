/**
 * The health check behind "is the ChatGPT provider offered to this user?"
 *
 * WHAT THIS EXISTS TO PREVENT
 * ---------------------------
 * `checkApiUsable` used to probe `api.openai.com/v1/models` — a host this
 * provider never talks to. A ChatGPT OAuth token is scope-limited there
 * (measured: 403 `api.model.read`) while answering 200 on its own product, so
 * the check reported `apiUsable: false` for exactly the users the provider
 * exists for. Two call sites believed it: OnboardingModal HID the provider from
 * the connection page, and ModelRoutes refused the model list with a 400. The
 * user was told the ChatGPT provider did not exist while its endpoint was
 * answering 200.
 *
 * The bug was invisible on any machine with an `OPENAI_API_KEY`, because the
 * probe resolved its token through `ensureValidToken`, which the env key
 * overrides — so it spent the key, got 200, and pronounced the provider healthy
 * for a reason that had nothing to do with the provider.
 *
 * NOTE ON THE MOCKS: CodexAuthManager reads the REAL ~/.codex/auth.json from
 * os.homedir(). Without mocking `fs`, every assertion here would silently
 * depend on whether the machine running the suite is signed in to ChatGPT.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const readFileSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    readFileSync: (...a) => readFileSync(...a),
    realpathSync: { native: (p) => p },
    existsSync: () => true,
    mkdirSync: () => {},
    writeFileSync: () => {},
  },
}));

const axiosGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a) => axiosGet(...a), post: vi.fn() },
}));

vi.mock('../ai/clientVersions.js', () => ({
  getClientVersion: async () => '9.9.9',
}));

const { default: codexAuth } = await import('./CodexAuthManager.js');

/** A JWT whose payload is real enough for expiry + account-id extraction. */
const jwt = (payload) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
};

const OAUTH = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123', chatgpt_plan_type: 'pro' },
});

/** Put a given auth.json in front of the manager. */
const signedInWith = (tokens) => {
  readFileSync.mockReturnValue(JSON.stringify(tokens));
};

const ok = (status = 200) => axiosGet.mockResolvedValue({ status });
const fails = (status) => axiosGet.mockRejectedValue({ response: { status } });

beforeEach(() => {
  readFileSync.mockReset();
  axiosGet.mockReset();
  codexAuth.apiCheckCache = null;
  delete process.env.OPENAI_API_KEY;
});

describe('it asks the service the provider actually uses', () => {
  it('probes the ChatGPT Codex backend, never the platform API', async () => {
    // THE REGRESSION GUARD. A health check must call the service whose health
    // it reports; anything else is a different question wearing the same name.
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });

    const [url] = axiosGet.mock.calls[0];
    expect(url).toContain('https://chatgpt.com/backend-api/codex/models');
    expect(url).not.toContain('api.openai.com');
  });

  it('sends client_version, which the endpoint requires', async () => {
    // Found by a LIVE probe, not by these mocks: without it the endpoint
    // answers 400, so the check would report every ChatGPT user unusable while
    // proving nothing about their credential. A mocked HTTP layer cannot tell
    // you what the real service demands.
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(axiosGet.mock.calls[0][0]).toContain('client_version=9.9.9');
  });

  it('sends the OAuth token and the account header', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });

    const [, opts] = axiosGet.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Bearer ${OAUTH}`);
    expect(opts.headers['ChatGPT-Account-ID']).toBe('acct_123');
    expect(opts.headers.originator).toBe('codex_cli_rs');
  });

  it('a 200 from the Codex backend means usable', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    ok(200);

    const s = await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(s).toMatchObject({ available: true, apiUsable: true, apiStatus: 200 });
  });

  it.each([401, 403, 500])('a %i means not usable, and says so honestly', async (status) => {
    signedInWith({ tokens: { access_token: OAUTH } });
    fails(status);

    const s = await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(s).toMatchObject({ available: true, apiUsable: false, apiStatus: status });
  });
});

describe('an OPENAI_API_KEY must not decide whether ChatGPT works', () => {
  it('does not report the provider healthy on the strength of a platform key', async () => {
    // The masking bug: with an env key set, the old probe spent that key
    // against api.openai.com, got 200, and called the provider healthy — on a
    // machine where the ChatGPT credential might be absent or revoked.
    process.env.OPENAI_API_KEY = 'sk-platform';
    signedInWith({ tokens: {} }); // signed OUT of ChatGPT
    ok(200);

    const s = await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(s.apiUsable).toBe(false);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('still probes with the OAuth token when both credentials exist', async () => {
    process.env.OPENAI_API_KEY = 'sk-platform';
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(axiosGet.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${OAUTH}`);
  });
});

describe('no ChatGPT sign-in', () => {
  it('an sk- key alone cannot drive this provider, and costs no round trip', async () => {
    // The Codex backend answers 401 for an `sk-` key, so this is a definite no
    // that needs no network call to discover.
    signedInWith({ OPENAI_API_KEY: 'sk-in-the-codex-file', tokens: {} });

    const s = await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(s.apiUsable).toBe(false);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('no credential at all is "not connected", not an exception', async () => {
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const s = await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(s).toMatchObject({ available: false, apiUsable: false, apiStatus: null });
  });
});

describe('what the UI does with the answer', () => {
  /**
   * These pin the DOWNSTREAM consequence, because that is what the user
   * actually experiences. The predicate is OnboardingModal.vue's provider
   * filter; if it and this check ever disagree again, this fails.
   */
  const hiddenFromOnboarding = (s) => s.available === true && s.apiUsable !== true;

  it('a ChatGPT-only user is OFFERED the provider', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    expect(hiddenFromOnboarding(await codexAuth.checkApiUsable({ forceRefresh: true }))).toBe(false);
  });

  it('a user whose ChatGPT credential is genuinely rejected is not offered it', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    fails(401);

    expect(hiddenFromOnboarding(await codexAuth.checkApiUsable({ forceRefresh: true }))).toBe(true);
  });
});

describe('caching', () => {
  it('forceRefresh bypasses the cache', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });
    await codexAuth.checkApiUsable({ forceRefresh: true });
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  it('a warm cache is reused', async () => {
    signedInWith({ tokens: { access_token: OAUTH } });
    ok();

    await codexAuth.checkApiUsable({ forceRefresh: true });
    await codexAuth.checkApiUsable();
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });
});
