/**
 * WHO MAY REDEEM AN OAUTH CODE AGAINST THE SIGNED-IN USER'S ACCOUNT.
 *
 * The handlers behind this predicate POST a forwarded `code` to
 * `/auth/callback` with the current user's bearer token. Admitting the wrong
 * sender does not leak the victim's tokens — it grafts the ATTACKER'S account
 * onto the victim's, so the victim's later "read my email" or "save to Drive"
 * runs quietly operate on someone else's data.
 *
 * The guard this replaces was:
 *
 *   allowedOrigins.some((origin) =>
 *     event.origin === origin || event.origin.includes('localhost'))
 *
 * The second term never uses the callback's own `origin` parameter, so it is a
 * constant OR'd into every iteration — an unconditional substring test. The
 * repository's existing coverage did not catch it, because the one negative
 * test used `https://evil.example.com`, which contains no `localhost` and so
 * was refused by the broken guard too. A negative test only means something
 * when it exercises the shape that actually slips through.
 *
 * These tests are therefore written around the substring hole specifically,
 * and around the loopback allowance that replaces it.
 */

import { describe, it, expect } from 'vitest';
import { isTrustedOAuthMessageOrigin } from './oauthMessageOrigin.js';

const REMOTE = 'https://api.agnt.gg';
const hostedApp = { location: { origin: 'https://tenant.example.com' } };
const localApp = { location: { origin: 'http://localhost:3333' } };

const trusts = (origin, win = hostedApp, remote = REMOTE) =>
  isTrustedOAuthMessageOrigin(origin, win, remote);

describe('isTrustedOAuthMessageOrigin', () => {
  describe('the senders that must keep working', () => {
    it('accepts the app talking to itself', () => {
      expect(trusts('https://tenant.example.com')).toBe(true);
    });

    it('accepts the AGNT API, which forwards the code in the Electron path', () => {
      expect(trusts('https://api.agnt.gg')).toBe(true);
    });

    it('accepts a remote configured with a path, comparing parsed origins', () => {
      // user.config.js ships `REMOTE_URL` with an /api suffix in some setups;
      // a naive string compare against the raw value would never match.
      expect(trusts('https://api.agnt.gg', hostedApp, 'https://api.agnt.gg/api')).toBe(true);
    });

    it.each([
      ['a different loopback port', 'http://localhost:5173'],
      ['the dotted-quad form', 'http://127.0.0.1:5173'],
      ['the IPv6 literal', 'http://[::1]:5173'],
    ])('accepts %s while the app is itself on loopback', (_label, origin) => {
      // Running from source puts Vite and the backend on different ports, so
      // an exact-origin allowlist alone would break OAuth for developers.
      expect(trusts(origin, localApp)).toBe(true);
    });
  });

  /**
   * Every one of these is registrable by anyone, and every one was admitted by
   * the guard this replaces. They are the reason the check is not a substring.
   */
  describe('the origins the substring rule let through', () => {
    it.each([
      'https://localhost.evil.com',
      'https://evil-localhost.io',
      'http://localhostage.com',
      'https://notlocalhost.xyz',
      'http://localhost.attacker.co.uk',
      'https://xn--localhost-fake.com',
    ])('refuses %s', (origin) => {
      expect(trusts(origin)).toBe(false);
      // ...and refuses it just the same from a developer's own machine, where
      // the loopback allowance is switched on.
      expect(trusts(origin, localApp)).toBe(false);
    });
  });

  describe('the loopback allowance does not escape development', () => {
    it('refuses a loopback sender when the app is hosted', () => {
      // THE LOAD-BEARING TEST. A developer convenience must not become a
      // production trust rule: a hosted tenant has no reason to believe
      // anything served from the visitor's own machine.
      expect(trusts('http://localhost:5173', hostedApp)).toBe(false);
    });

    it('still accepts the hosted app talking to itself', () => {
      expect(trusts('https://tenant.example.com', hostedApp)).toBe(true);
    });
  });

  describe('near-misses on the allowlisted origins', () => {
    it.each([
      ['a suffix of the API host', 'https://api.agnt.gg.evil.com'],
      ['a prefix of the API host', 'https://evil.com/api.agnt.gg'],
      ['the API host over plain http', 'http://api.agnt.gg'],
      ['a subdomain of the API host', 'https://evil.api.agnt.gg'],
      ['a lookalike of the app host', 'https://tenant.example.com.evil.net'],
    ])('refuses %s', (_label, origin) => {
      expect(trusts(origin)).toBe(false);
    });
  });

  describe('an origin that identifies nobody is refused, never abstained on', () => {
    // Unlike the popup handover in utils/googleAuthPopup.js, there is no second
    // signal here to fall back on, so there is nothing to trade off: an
    // unattributable sender is simply not trusted.
    it.each([
      ['the empty string', ''],
      ['the opaque origin', 'null'],
      ['a sandboxed frame reporting undefined', undefined],
      ['a non-string', 12345],
      ['an object', {}],
    ])('refuses %s', (_label, origin) => {
      expect(trusts(origin)).toBe(false);
    });

    it('refuses the opaque origin even if the app is itself opaque', () => {
      // Otherwise a sandboxed artifact iframe would match the app by equality.
      expect(trusts('null', { location: { origin: 'null' } })).toBe(false);
    });
  });

  describe('it does not fall over on a broken environment', () => {
    it('survives a window with no location', () => {
      expect(isTrustedOAuthMessageOrigin('https://api.agnt.gg', {}, REMOTE)).toBe(true);
      expect(isTrustedOAuthMessageOrigin('https://evil.com', {}, REMOTE)).toBe(false);
    });

    it('falls back to the configured remote when the argument is omitted', () => {
      // A default parameter fires on `undefined`, so omitting the argument and
      // passing `undefined` are the same thing: both use API_CONFIG.REMOTE_URL.
      // `null` is therefore the only way to say "no remote at all", and the
      // test below relies on that distinction.
      expect(isTrustedOAuthMessageOrigin('https://api.agnt.gg', hostedApp)).toBe(true);
      expect(isTrustedOAuthMessageOrigin('https://api.agnt.gg', hostedApp, undefined)).toBe(true);
    });

    it('survives an unset remote URL', () => {
      expect(isTrustedOAuthMessageOrigin('https://tenant.example.com', hostedApp, null)).toBe(true);
      expect(isTrustedOAuthMessageOrigin('https://api.agnt.gg', hostedApp, null)).toBe(false);
    });

    it('survives a malformed remote URL', () => {
      expect(isTrustedOAuthMessageOrigin('https://api.agnt.gg', hostedApp, 'not a url')).toBe(false);
    });
  });
});
