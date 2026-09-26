/**
 * Arriving from another cloud instance as the same user.
 *
 * Measured 2026-09-26: switching goku -> bravo in a browser opened bravo as a
 * different account, whoever last signed in there. The switch now carries a
 * one-time code after `#`; this is the receiving end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { takeInstanceSignInCode, redeemInstanceSignInCode } from './instanceSignIn.js';

const CODE = 'A'.repeat(20) + '_' + 'b'.repeat(21) + '9'; // 43 chars, base64url
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImdtYWlsIn0.c2lnbmF0dXJl';

function page(href) {
  const url = new URL(href);
  const replaced = [];
  return {
    replaced,
    location: { hash: url.hash, pathname: url.pathname, search: url.search },
    history: { state: { from: 'router' }, replaceState: (state, _title, next) => replaced.push({ state, next }) },
  };
}

describe('taking the code out of the address', () => {
  it('returns it and removes it at once, keeping path, query and router state', () => {
    const host = page(`https://bravo.t1.agnt.gg/chat?team=t&home=x#agnt-signin=${CODE}`);
    expect(takeInstanceSignInCode(host)).toBe(CODE);
    expect(host.replaced).toEqual([{ state: { from: 'router' }, next: '/chat?team=t&home=x' }]);
  });

  it('ignores addresses without one, and anything malformed', () => {
    for (const hash of ['', '#', '#agnt-signin=', '#agnt-signin=short', `#agnt-signin=${CODE}!`, `#other=${CODE}`]) {
      const host = page('https://bravo.t1.agnt.gg/' + hash);
      expect(takeInstanceSignInCode(host), hash).toBeNull();
      expect(host.replaced).toEqual([]);
    }
  });

  it('never throws, even without a window', () => {
    expect(takeInstanceSignInCode(undefined)).toBeNull();
  });
});

describe('redeeming it', () => {
  let store;
  beforeEach(() => {
    store = { state: { userAuth: { token: 'eyJ.old.token' } }, commit: vi.fn() };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  const answer = (ok, body) => vi.fn(async () => ({ ok, status: ok ? 200 : 410, json: async () => body }));

  it('adopts the session it is traded for', async () => {
    const fetchImpl = answer(true, { token: JWT });
    expect(await redeemInstanceSignInCode(store, CODE, { fetchImpl, remoteUrl: 'https://api.agnt.gg' })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.agnt.gg/tenants/signin-codes/redeem');
    expect(JSON.parse(init.body)).toEqual({ code: CODE });
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_TOKEN', JWT);
  });

  it('a spent or refused code leaves whoever is signed in here alone', async () => {
    expect(await redeemInstanceSignInCode(store, CODE, { fetchImpl: answer(false, { error: 'expired' }) })).toBe(false);
    expect(await redeemInstanceSignInCode(store, CODE, { fetchImpl: answer(true, { token: 'not-a-jwt' }) })).toBe(false);
    expect(await redeemInstanceSignInCode(store, CODE, { fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toBe(false);
    expect(store.commit).not.toHaveBeenCalled();
  });
});
