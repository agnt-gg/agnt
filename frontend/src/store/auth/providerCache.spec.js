/**
 * WHY A FRESH SIGN-IN SHOWED NO CONNECTED INTEGRATIONS UNTIL A RELOAD.
 *
 * Reported as: signed in with Google, every integration appeared disconnected,
 * pressing F5 fixed it. A reload being the cure is the tell — `withFreshness`
 * keeps its cache in closure-local variables, so reloading the page is simply
 * the one action that empties it. That makes this a caching defect rather than
 * a fetch that never happened.
 *
 * Three independent causes, all of which predate the sign-in work:
 *
 *   1. THE INNER DEDUP WAS IDENTITY-BLIND. `fetchConnectedApps` kept its own
 *      module-level in-flight promise, from before `withFreshness` grew
 *      identity scoping. A caller who had just signed in would adopt an
 *      ANONYMOUS request already on the wire, and the wrapper would then stamp
 *      that anonymous answer as the signed-in user's — defeating the identity
 *      option one layer down, inside the very action it was protecting.
 *
 *   2. A TOTAL FAILURE LOOKED LIKE A SUCCESS. Both network lanes end in
 *      `.catch(() => null)`, so an outage resolves NORMALLY with a CLI-only
 *      list. The wrapper saw no error, stamped it fresh, and served it.
 *
 *   3. THE PROVIDER CATALOGUE CACHED ITS FALLBACK FOR THIRTY MINUTES.
 *      `fetchAllProviders` catches, commits six CLI-tied providers where the
 *      real catalogue is seventy-odd, and returns normally.
 *
 * These drive the real actions rather than re-implementing them, and assert on
 * whether the NETWORK was consulted again — which is the only thing that
 * distinguishes a served cache from a fresh answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api', REMOTE_URL: 'https://api.agnt.gg' },
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/services/providerAuthService.js', () => ({
  default: { getStatus: vi.fn(async () => ({ available: false, apiUsable: false })) },
}));
vi.mock('@/services/localKeyBackfill.js', () => ({
  backfillLocalProviderKeys: vi.fn(async () => {}),
}));
vi.mock('@/store/app/aiProvider.js', () => ({
  resolveProviderKey: (id) => String(id).toLowerCase(),
  PROVIDER_DISPLAY_NAMES: {},
}));

const USER_ID = 'add4b3d4e2536a142bc0c89a585eda3e';

function makeJwt(id = USER_ID) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ id, userId: id, exp: Math.floor(Date.now() / 1000) + 3600 }),
    'sig',
  ].join('.');
}

const LOCAL = 'http://localhost:3333/api/auth/connected';
const REMOTE = 'https://api.agnt.gg/auth/connected';
const CATALOGUE = 'https://api.agnt.gg/auth/providers';

let axios;
let appAuth;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
  axios = (await import('axios')).default;
  appAuth = (await import('./appAuth.js')).default;
});

/** A Vuex context shaped the way these actions read it. */
function ctxFor(token, connectedApps = []) {
  return {
    commit: vi.fn(),
    dispatch: vi.fn(),
    state: { connectedApps },
    rootState: { userAuth: { token } },
  };
}

const callsTo = (url) => axios.get.mock.calls.filter(([u]) => u === url).length;

/** Both lanes answer with real data. */
function lanesSucceed({ local = ['openai'], remote = ['google'] } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url === LOCAL) return { data: local };
    if (url === REMOTE) return { data: remote };
    return { data: [] };
  });
}

/** Both lanes fail, exactly as an outage or an unauthenticated call does. */
function lanesFail() {
  axios.get.mockImplementation(async (url) => {
    if (url === LOCAL || url === REMOTE) throw new Error('network down');
    return { data: [] };
  });
}

describe('an anonymous fetch is never adopted by a signed-in caller', () => {
  it('starts its own request instead of joining the one already in flight', async () => {
    // The exact sequence from the report: something asks for connected apps
    // while signed out, the answer is still on the wire when the user signs
    // in, and the signed-in read arrives immediately afterwards.
    let releaseAnonymous;
    axios.get.mockImplementation((url) => {
      if (url === LOCAL) return new Promise((resolve) => { releaseAnonymous = resolve; });
      if (url === REMOTE) return Promise.reject(new Error('401'));
      return Promise.resolve({ data: [] });
    });

    const anonymous = appAuth.actions.fetchConnectedApps(ctxFor(null));
    await Promise.resolve();
    expect(callsTo(LOCAL)).toBe(1);

    const token = makeJwt();
    localStorage.setItem('token', token);
    lanesSucceed({ local: ['openai', 'anthropic'], remote: ['google'] });
    const signedIn = appAuth.actions.fetchConnectedApps(ctxFor(token));

    // THE ASSERTION. Before the fix the signed-in call returned the anonymous
    // promise and this stayed at 1, so the user's own connections were never
    // requested at all.
    expect(
      callsTo(LOCAL),
      'the signed-in read reused the anonymous request already in flight',
    ).toBe(2);

    releaseAnonymous({ data: [] });
    await Promise.all([anonymous, signedIn]);
  });

  it('still shares one request between two callers of the same subject', async () => {
    // The dedup is scoped, not removed. Two screens mounting together must
    // still make one request.
    const token = makeJwt();
    localStorage.setItem('token', token);
    lanesSucceed();

    await Promise.all([
      appAuth.actions.fetchConnectedApps(ctxFor(token)),
      appAuth.actions.fetchConnectedApps(ctxFor(token)),
    ]);

    expect(callsTo(LOCAL)).toBe(1);
  });
});

describe('fetchConnectedApps does not freeze a degraded answer', () => {
  it('re-fetches after both lanes failed', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    lanesFail();

    await appAuth.actions.fetchConnectedApps(ctxFor(token));
    expect(callsTo(LOCAL)).toBe(1);

    // Well inside the one-minute TTL. Before the fix this was a cache hit on
    // an empty list, and stayed one until the page was reloaded.
    await appAuth.actions.fetchConnectedApps(ctxFor(token));
    expect(callsTo(LOCAL)).toBe(2);
  });

  it('re-fetches when only the remote lane failed', async () => {
    // A partial picture is still a partial picture: the remote lane carries
    // connections this install has never stored locally.
    const token = makeJwt();
    localStorage.setItem('token', token);
    axios.get.mockImplementation(async (url) => {
      if (url === LOCAL) return { data: ['openai'] };
      if (url === REMOTE) throw new Error('remote down');
      return { data: [] };
    });

    await appAuth.actions.fetchConnectedApps(ctxFor(token));
    await appAuth.actions.fetchConnectedApps(ctxFor(token));

    expect(callsTo(LOCAL)).toBe(2);
  });

  it('caches a complete answer, so this is not simply a broken cache', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    lanesSucceed();

    await appAuth.actions.fetchConnectedApps(ctxFor(token));
    await appAuth.actions.fetchConnectedApps(ctxFor(token));

    expect(callsTo(LOCAL)).toBe(1);
  });

  it('caches an anonymous answer, whose remote 401 is expected rather than a failure', async () => {
    // Signed out, the remote lane refusing is the designed behaviour. Treating
    // it as a failure would poll the network every time a signed-out screen
    // painted.
    axios.get.mockImplementation(async (url) => {
      if (url === LOCAL) return { data: ['openai'] };
      if (url === REMOTE) throw new Error('401');
      return { data: [] };
    });

    await appAuth.actions.fetchConnectedApps(ctxFor(null));
    await appAuth.actions.fetchConnectedApps(ctxFor(null));

    expect(callsTo(LOCAL)).toBe(1);
  });
});

describe('fetchAllProviders does not freeze its offline fallback', () => {
  it('re-fetches after the catalogue failed', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    axios.get.mockImplementation(async () => {
      throw new Error('catalogue unavailable');
    });

    await appAuth.actions.fetchAllProviders(ctxFor(token));
    await appAuth.actions.fetchAllProviders(ctxFor(token));

    // The TTL here is THIRTY MINUTES. One failure around sign-in used to hide
    // every integration for half an hour.
    expect(callsTo(CATALOGUE)).toBe(2);
  });

  it('still commits the fallback so CLI providers remain usable offline', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    axios.get.mockImplementation(async () => {
      throw new Error('catalogue unavailable');
    });

    const ctx = ctxFor(token);
    await appAuth.actions.fetchAllProviders(ctx);

    const committed = ctx.commit.mock.calls.find(([m]) => m === 'SET_ALL_PROVIDERS');
    expect(committed, 'the offline fallback stopped being committed').toBeTruthy();
    expect(committed[1].map((p) => p.id)).toContain('claude-code');
  });

  it('caches a real catalogue', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    axios.get.mockImplementation(async () => ({ data: [{ id: 'google', name: 'Google' }] }));

    await appAuth.actions.fetchAllProviders(ctxFor(token));
    await appAuth.actions.fetchAllProviders(ctxFor(token));

    expect(callsTo(CATALOGUE)).toBe(1);
  });
});
