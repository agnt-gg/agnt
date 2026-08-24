/**
 * THE TENANT HANDOVER, AND THE ORDER IT HAS TO HAPPEN IN.
 *
 * A hosted tenant delivers its session token in the URL. Desktop finds one in
 * localStorage and seeds the store synchronously, so a desktop boot never has
 * a window in which the app is running without a credential. A tenant boot
 * did: the token was picked up in a leaf component's `onMounted`, so every
 * component that mounted earlier polled with `state.token === null` and its
 * requests went out with no `Authorization` header.
 *
 * The backend refused them correctly. The client then read its own header-less
 * request's refusal as a revoked session and wiped localStorage — which made
 * the failure permanent, because every request after that was header-less too.
 *
 * These tests are written against the ORDERING INVARIANT rather than the
 * symptom: nothing may mount before the credential path is complete. A test
 * phrased as "the user is not logged out after five minutes" would pass for
 * any number of wrong reasons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('@/services/mediaAuth.js', () => ({
  setMediaCookie: vi.fn(),
  clearMediaCookie: vi.fn(),
}));

const { adoptTokenFromUrl, consumeAdoptedToken, __resetAdoptedTokenForTests } = await import(
  './urlSessionToken.js'
);

/** Structurally a JWT: three non-empty dot-separated segments. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUtMSJ9.c2lnbmF0dXJl';

function fakeLocation(href) {
  return { href };
}

function fakeHistory() {
  return { replaceState: vi.fn() };
}

function makeStore() {
  return { commit: vi.fn() };
}

/** The URL as replaceState was asked to rewrite it. */
function rewrittenUrl(hist) {
  return hist.replaceState.mock.calls[0]?.[2];
}

describe('adopting a token handed over in the URL', () => {
  beforeEach(() => {
    __resetAdoptedTokenForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores the token so the request interceptor has something to attach', () => {
    const store = makeStore();
    const adopted = adoptTokenFromUrl(
      store,
      fakeLocation(`https://charizard.t1.agnt.gg/settings?token=${JWT}`),
      fakeHistory(),
    );

    expect(adopted).toBe(true);
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_TOKEN', JWT);
  });

  it('strips the token from the address bar', () => {
    // Not cosmetic: the token stays in location.search for the life of the
    // page otherwise, and the browser sends the full URL as Referer on every
    // subsequent request — which put live session tokens into the reverse
    // proxy's access log, one line per API call.
    const hist = fakeHistory();
    adoptTokenFromUrl(makeStore(), fakeLocation(`https://x.t1.agnt.gg/settings?token=${JWT}`), hist);

    expect(hist.replaceState).toHaveBeenCalled();
    expect(rewrittenUrl(hist)).not.toContain('token');
    expect(rewrittenUrl(hist)).not.toContain(JWT);
  });

  it('keeps the other query params, because returnTo is read after the strip', () => {
    const hist = fakeHistory();
    adoptTokenFromUrl(
      makeStore(),
      fakeLocation(`https://x.t1.agnt.gg/settings?returnTo=%2Fworkspace&token=${JWT}`),
      hist,
    );

    expect(rewrittenUrl(hist)).toContain('returnTo=%2Fworkspace');
    expect(rewrittenUrl(hist)).not.toContain(JWT);
  });

  it('preserves the path and hash it was invoked on', () => {
    const hist = fakeHistory();
    adoptTokenFromUrl(makeStore(), fakeLocation(`https://x.t1.agnt.gg/m/chat?token=${JWT}#panel`), hist);

    expect(rewrittenUrl(hist)).toBe('/m/chat#panel');
  });

  it('does nothing at all when there is no token in the URL', () => {
    const store = makeStore();
    const hist = fakeHistory();

    expect(adoptTokenFromUrl(store, fakeLocation('https://x.t1.agnt.gg/settings'), hist)).toBe(false);
    expect(store.commit).not.toHaveBeenCalled();
    expect(hist.replaceState).not.toHaveBeenCalled();
  });

  describe('a malformed ?token=', () => {
    it('is NOT adopted, so it cannot evict a working session', () => {
      // Someone already signed in follows a link carrying junk. Storing it
      // would fail verification and take their real localStorage token down
      // with it — a logout caused by a stranger's URL.
      const store = makeStore();
      adoptTokenFromUrl(store, fakeLocation('https://x.t1.agnt.gg/settings?token=garbage'), fakeHistory());

      expect(store.commit).not.toHaveBeenCalled();
    });

    it('is still stripped from the URL', () => {
      // It is credential-SHAPED even when it is not a credential, and it does
      // not belong in history or in a Referer header either way.
      const hist = fakeHistory();
      adoptTokenFromUrl(makeStore(), fakeLocation('https://x.t1.agnt.gg/settings?token=garbage'), hist);

      expect(rewrittenUrl(hist)).not.toContain('garbage');
    });

    it('rejects a two-segment token', () => {
      const store = makeStore();
      adoptTokenFromUrl(store, fakeLocation('https://x.t1.agnt.gg/?token=aaa.bbb'), fakeHistory());
      expect(store.commit).not.toHaveBeenCalled();
    });

    it('rejects three segments where one is empty', () => {
      const store = makeStore();
      adoptTokenFromUrl(store, fakeLocation('https://x.t1.agnt.gg/?token=aaa..ccc'), fakeHistory());
      expect(store.commit).not.toHaveBeenCalled();
    });
  });

  describe('boot must survive it, whatever happens', () => {
    it('returns false instead of throwing on an unparseable href', () => {
      const store = makeStore();
      expect(() => adoptTokenFromUrl(store, fakeLocation('not a url'), fakeHistory())).not.toThrow();
      expect(adoptTokenFromUrl(store, fakeLocation('not a url'), fakeHistory())).toBe(false);
    });

    it('returns false when there is no location at all', () => {
      expect(adoptTokenFromUrl(makeStore(), undefined, fakeHistory())).toBe(false);
    });

    it('still adopts when history.replaceState is unavailable', () => {
      // Failing to tidy the URL is a cosmetic and privacy loss. Failing to
      // sign the user in is an outage. They are not the same, so one must not
      // take the other down.
      const store = makeStore();
      const adopted = adoptTokenFromUrl(store, fakeLocation(`https://x.t1.agnt.gg/?token=${JWT}`), {});

      expect(adopted).toBe(true);
      expect(store.commit).toHaveBeenCalledWith('userAuth/SET_TOKEN', JWT);
    });
  });

  describe('consumeAdoptedToken', () => {
    it('hands the token over exactly once', () => {
      adoptTokenFromUrl(makeStore(), fakeLocation(`https://x.t1.agnt.gg/?token=${JWT}`), fakeHistory());

      expect(consumeAdoptedToken()).toBe(JWT);
      // The sign-in path navigates on a truthy answer. A second truthy answer
      // would navigate again on some later component's mount.
      expect(consumeAdoptedToken()).toBeNull();
    });

    it('is null when nothing was adopted', () => {
      expect(consumeAdoptedToken()).toBeNull();
    });

    it('is null when the token was rejected as malformed', () => {
      adoptTokenFromUrl(makeStore(), fakeLocation('https://x.t1.agnt.gg/?token=garbage'), fakeHistory());
      expect(consumeAdoptedToken()).toBeNull();
    });
  });
});

/**
 * The ordering guard.
 *
 * Every defect in this chain was an ORDER-OF-OPERATIONS bug, not a logic bug —
 * each individual statement was correct, and ran too late. Order is invisible
 * in review and silent when it regresses, so it is asserted mechanically
 * against the source.
 */
describe('boot order in main.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

  // Comments in this file discuss `app.mount` and the interceptors by name.
  // Index arithmetic over raw text would match the prose, not the code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const at = (needle) => {
    const i = code.indexOf(needle);
    expect(i, `expected to find \`${needle}\` in main.js`).toBeGreaterThan(-1);
    return i;
  };

  it('attaches the Authorization header before anything mounts', () => {
    // This used to be the LAST statement in the file. Requests issued while
    // components were mounting had no interceptor to add a header to them.
    expect(at('axios.interceptors.request.use')).toBeLessThan(at('app.mount('));
  });

  it('adopts the URL token before anything mounts', () => {
    expect(at('adoptTokenFromUrl(store)')).toBeLessThan(at('app.mount('));
  });

  it('installs the 401 handler before anything mounts', () => {
    expect(at('initializeAxiosInterceptor(store, router)')).toBeLessThan(at('app.mount('));
  });

  it('has the token in the store before the header interceptor could need it', () => {
    expect(at('axios.interceptors.request.use')).toBeLessThan(at('adoptTokenFromUrl(store)'));
  });

  it('registers exactly one request interceptor', () => {
    // Two would mean the old trailing one came back in a merge, and the last
    // registered wins — silently restoring the original bug.
    const count = code.split('axios.interceptors.request.use').length - 1;
    expect(count).toBe(1);
  });
});
