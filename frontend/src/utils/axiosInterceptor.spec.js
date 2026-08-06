/**
 * The mid-session net.
 *
 * The router guard is a NAVIGATION-time gate. A token can expire, be revoked,
 * or stop being accepted while the user sits on a page that never navigates
 * again — and without this interceptor the app keeps rendering an
 * authenticated shell over a stream of 401s. That is the same lie the session
 * gate was built to stop telling, just arrived at a few minutes later.
 *
 * The hard part is precision, in both directions:
 *   - miss a real session rejection and the lie persists
 *   - fire on somebody else's 401 (an upstream LLM provider whose API key is
 *     wrong, relayed through our backend) and a working user is thrown out of
 *     the app mid-sentence
 *
 * So it matches only OUR middleware's rejection shape, from OUR data backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    },
    configurable: true,
  });
}
ensureLocalStorage();

const handlers = { onError: null };
vi.mock('axios', () => ({
  default: {
    interceptors: {
      response: {
        use: (_ok, onError) => {
          handlers.onError = onError;
        },
      },
    },
  },
}));

const { initializeAxiosInterceptor } = await import('./axiosInterceptor.js');
const { API_CONFIG } = await import('@/tt.config.js');
const { SESSION } = await import('@/store/auth/userAuth.js');

function makeStore(sessionState = SESSION.VALID) {
  return {
    state: { userAuth: { sessionState } },
    commit: vi.fn(),
    dispatch: vi.fn(),
  };
}

function makeRouter(path = '/chat') {
  return {
    currentRoute: { value: { path } },
    push: vi.fn().mockResolvedValue(undefined),
  };
}

/** An axios rejection as our backend's auth middleware produces it. */
function sessionRejection(url = `${API_CONFIG.BASE_URL}/agents/`, reason = 'invalid') {
  return {
    config: { url },
    response: { status: 401, data: { success: false, error: 'Authentication required', reason } },
  };
}

async function fire(error) {
  await expect(handlers.onError(error)).rejects.toBe(error);
}

describe('mid-session session rejection', () => {
  let store;
  let router;

  beforeEach(() => {
    store = makeStore();
    router = makeRouter();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    initializeAxiosInterceptor(store, router);
  });

  it('signs the user out when the data backend rejects the session', async () => {
    await fire(sessionRejection());

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/logout');
    expect(store.commit).toHaveBeenCalledWith(
      'userAuth/SET_AUTH_FAILURE',
      expect.objectContaining({ reason: 'http_401', status: 401 }),
    );
  });

  it('leaves the protected screen it was on', async () => {
    await fire(sessionRejection());
    expect(router.push).toHaveBeenCalledWith({ path: '/settings' });
  });

  it('sends a phone to the pairing home, not desktop Settings', async () => {
    router = makeRouter('/m/chat');
    initializeAxiosInterceptor(store, router);

    await fire(sessionRejection());

    expect(router.push).toHaveBeenCalledWith({ path: '/m' });
  });

  it('handles the missing-token reason too', async () => {
    await fire(sessionRejection(`${API_CONFIG.BASE_URL}/agents/`, 'missing'));
    expect(store.dispatch).toHaveBeenCalledWith('userAuth/logout');
  });

  it('accepts a same-origin relative URL', async () => {
    // Not every call site builds an absolute URL; a relative /api/... path is
    // by definition this app's own backend.
    await fire(sessionRejection('/api/agents/'));
    expect(store.dispatch).toHaveBeenCalledWith('userAuth/logout');
  });

  it('one logout for a burst of parallel failures', async () => {
    // A dead session fails every in-flight request at once. Twenty logouts
    // would mean twenty redirects and twenty events.
    const first = sessionRejection();
    await fire(first);
    store.state.userAuth.sessionState = SESSION.INVALID; // logout committed it

    await fire(sessionRejection());
    await fire(sessionRejection());

    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('emits auth-redirect so the UI can explain itself', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    await fire(sessionRejection());

    const event = spy.mock.calls.find((c) => c[0]?.type === 'auth-redirect')?.[0];
    expect(event).toBeTruthy();
    expect(event.detail).toMatchObject({ reason: 'http_401', from: '/chat' });
    spy.mockRestore();
  });
});

describe('what must NOT trigger a logout', () => {
  let store;
  let router;

  beforeEach(() => {
    store = makeStore();
    router = makeRouter();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    initializeAxiosInterceptor(store, router);
  });

  const expectNoLogout = async (error) => {
    await fire(error);
    expect(store.dispatch).not.toHaveBeenCalledWith('userAuth/logout');
    expect(router.push).not.toHaveBeenCalled();
  };

  it('a 401 from an upstream provider relayed through our backend', async () => {
    // Wrong OpenAI key, expired Anthropic credential, etc. Nothing to do with
    // the user's AGNT session, and logging them out would be baffling.
    await expectNoLogout({
      config: { url: `${API_CONFIG.BASE_URL}/models/openai/models` },
      response: { status: 401, data: { error: 'Incorrect API key provided' } },
    });
  });

  it('a 401 from the REMOTE auth server', async () => {
    // A different authority with its own handling in fetchUserData. It may end
    // the session, but through that path, not this one.
    await expectNoLogout({
      config: { url: 'https://api.agnt.gg/users/subscription/status' },
      response: { status: 401, data: { error: 'Authentication required', reason: 'invalid' } },
    });
  });

  it('a 403', async () => {
    await expectNoLogout({
      config: { url: `${API_CONFIG.BASE_URL}/agents/` },
      response: { status: 403, data: { reason: 'invalid' } },
    });
  });

  it('a 500', async () => {
    await expectNoLogout({
      config: { url: `${API_CONFIG.BASE_URL}/agents/` },
      response: { status: 500, data: {} },
    });
  });

  it('a network error with no response at all', async () => {
    await expectNoLogout({ config: { url: `${API_CONFIG.BASE_URL}/agents/` }, message: 'Network Error' });
  });

  it('a rejection with no config (defensive)', async () => {
    await expectNoLogout({ message: 'boom' });
  });
});
