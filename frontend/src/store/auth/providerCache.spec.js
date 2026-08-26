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

/**
 * WHY LOCAL CLI PROVIDERS WENT MISSING AFTER AN APP RESTART.
 *
 * Reported as: restarted AGNT, and Claude Code / Codex / Cursor / Antigravity
 * all showed as not connected — while the backend, asked directly, reported
 * every one of them connected and usable in under 20ms.
 *
 * A reload being the cure is the tell again, but this is a different defect
 * from the caching one below. `SET_CONNECTED_APPS` was committed in exactly two
 * places: the cold-start branch, which only fires while the list is still
 * empty, and inside the remote-lane success block. The remote endpoint now
 * answers 404 in production, so once boot had painted ANY non-empty list, the
 * store could never be updated again — the 60s poll ran, fetched correctly,
 * merged correctly, and then threw the answer away.
 *
 * The local CLI providers are the ones that suffer, because their status probes
 * race the backend's own startup and so are the most likely to resolve a moment
 * after the one commit that was ever going to happen.
 */
describe('the connected list keeps updating when the remote lane is down', () => {
  /** Local backend answers; remote 404s, exactly as it does in production. */
  function remoteIsDead(local) {
    axios.get.mockImplementation(async (url) => {
      if (url === LOCAL) return { data: local };
      if (url === REMOTE) throw new Error('404');
      return { data: [] };
    });
  }

  const committed = (ctx) =>
    ctx.commit.mock.calls.filter(([m]) => m === 'SET_CONNECTED_APPS').map(([, v]) => v);

  it('REGRESSION: a provider connected after boot appears without a page reload', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);
    remoteIsDead(['openai', 'claude-code']);

    // Not a cold start: boot already painted a list, and it lacked claude-code.
    const ctx = ctxFor(token, ['openai']);
    await appAuth.actions.fetchConnectedApps(ctx);

    const commits = committed(ctx);
    expect(commits.length, 'the store was never updated at all').toBeGreaterThan(0);
    expect(commits.at(-1)).toContain('claude-code');
  });

  it('picks up a CLI provider whose status probe lost the boot race', async () => {
    // The reported case: the CLI provider is found by lane 3, not lane 1.
    const token = makeJwt();
    localStorage.setItem('token', token);
    const providerAuthService = (await import('@/services/providerAuthService.js')).default;
    providerAuthService.getStatus.mockImplementation(async (id) => ({
      available: id === 'claude-code',
      apiUsable: id === 'claude-code',
    }));
    remoteIsDead(['openai']);

    const ctx = ctxFor(token, ['openai']);
    await appAuth.actions.fetchConnectedApps(ctx);

    expect(committed(ctx).at(-1)).toContain('claude-code');
  });

  it('never drops a remote-only provider — the property the old guard protected', async () => {
    // `notion` was learned from the remote lane on an earlier healthy fetch and
    // the local backend has never heard of it. Committing the local-only set
    // would erase it, which is precisely why the commit was gated in the first
    // place. Union, not replace.
    const token = makeJwt();
    localStorage.setItem('token', token);
    remoteIsDead(['openai', 'claude-code']);

    const ctx = ctxFor(token, ['openai', 'notion']);
    await appAuth.actions.fetchConnectedApps(ctx);

    const last = committed(ctx).at(-1);
    expect(last).toContain('notion');
    expect(last).toContain('claude-code');
  });

  it('commits nothing when nothing changed, so the 60s poll cannot churn watchers', async () => {
    const token = makeJwt();
    localStorage.setItem('token', token);

    // State the lane-3 precondition rather than inheriting it. vi.clearAllMocks
    // clears recorded calls but NOT implementations, so the CLI probe stub set
    // by an earlier test in this file would otherwise leak in and legitimately
    // add a provider — making this assertion fail for a reason that has nothing
    // to do with what it is testing.
    const providerAuthService = (await import('@/services/providerAuthService.js')).default;
    providerAuthService.getStatus.mockImplementation(async () => ({
      available: false,
      apiUsable: false,
    }));
    remoteIsDead(['openai']);

    const ctx = ctxFor(token, ['openai']);
    await appAuth.actions.fetchConnectedApps(ctx);

    expect(committed(ctx)).toHaveLength(0);
  });

  it('still commits on a cold start, which this must not have changed', async () => {
    // Anti-vacuity partner: without it, "commits the union" would pass against
    // an implementation that commits unconditionally and always has.
    const token = makeJwt();
    localStorage.setItem('token', token);
    remoteIsDead(['openai', 'claude-code']);

    const ctx = ctxFor(token, []);
    await appAuth.actions.fetchConnectedApps(ctx);

    expect(committed(ctx).at(-1)).toContain('claude-code');
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
