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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTrustedOAuthMessageOrigin,
  hasOAuthMessagePayload,
  resetRefusalReporting,
} from './oauthMessageOrigin.js';

const REMOTE = 'https://api.agnt.gg';
const hostedApp = { location: { origin: 'https://tenant.example.com' } };

// A refusal reports itself on the console so that a sender refused IN ERROR is
// diagnosable in a packaged build. Nearly every test in this file refuses
// something on purpose, so the reporter is stubbed rather than left to print a
// wall of expected warnings. Its own behaviour is asserted at the end.
let warn;
beforeEach(() => {
  resetRefusalReporting();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});
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
    // There is no second signal here to corroborate an origin with, so there is
    // nothing to trade off: an unattributable sender is simply not trusted.
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

/**
 * A TRUSTED ORIGIN IS NOT A WELL-FORMED MESSAGE.
 *
 * These are global `message` listeners. Passing the origin check only means the
 * sender is us — it says nothing about what they sent, and same-origin senders
 * that know nothing about OAuth (extensions, dev-server clients, other widgets)
 * post whatever they like. `event.data.type` on a `null` payload throws.
 *
 * The throw is invisible in practice, which is why it survived: the handlers
 * are `async`, so it never reaches the dispatcher. It becomes an unhandled
 * rejection instead, and a test written as `expect(...).not.toThrow()` would
 * pass whether or not the guard exists. The integration test in
 * useProviderConnection.spec.js captures the rejection explicitly for that
 * reason.
 */
describe('hasOAuthMessagePayload', () => {
  describe('payloads that can carry a `type`', () => {
    it.each([
      ['an OAuth message', { type: 'oauth-callback', code: 'x' }],
      ['an unrelated object', { hello: 'world' }],
      ['an empty object', {}],
      // An array cannot match any branch, but it is object-shaped and reading
      // `.type` off it is safe, so there is no reason to single it out.
      ['an array', []],
    ])('accepts %s', (_label, data) => {
      expect(hasOAuthMessagePayload({ data })).toBe(true);
    });
  });

  describe('payloads that would throw or cannot match', () => {
    it.each([
      ['null, the shape Copilot flagged', null],
      ['undefined', undefined],
    ])('refuses %s, which would throw on .type', (_label, data) => {
      expect(hasOAuthMessagePayload({ data })).toBe(false);
    });

    it.each([
      ['a string, as some dev-server clients post', 'vite:beforeUpdate'],
      ['a number', 42],
      ['a boolean', true],
    ])('refuses %s, which cannot match any branch', (_label, data) => {
      // These do not throw — primitives box, so `.type` is merely undefined.
      // They are refused anyway so that one predicate decides what is
      // actionable, rather than each `.type` read having to be defensive.
      expect(hasOAuthMessagePayload({ data })).toBe(false);
    });

    it('refuses an event with no data property at all', () => {
      expect(hasOAuthMessagePayload({})).toBe(false);
    });

    it('refuses a missing event, rather than throwing on it', () => {
      expect(hasOAuthMessagePayload(undefined)).toBe(false);
      expect(hasOAuthMessagePayload(null)).toBe(false);
    });
  });

  it('does not mistake null for an object', () => {
    // `typeof null === 'object'`, so a check written as `typeof data ===
    // 'object'` alone would admit exactly the value that throws.
    expect(typeof null).toBe('object');
    expect(hasOAuthMessagePayload({ data: null })).toBe(false);
  });
});

/**
 * A REFUSAL HAS TO BE DIAGNOSABLE.
 *
 * Callers act on a refusal with a bare `return`, so a sender refused in error
 * looks exactly like a network failure: an OAuth connection that quietly does
 * nothing. Under Electron the sender is a separate BrowserWindow, and what it
 * reports as an origin across that boundary is not something jsdom can settle
 * — so the person who finds out will be running a packaged build, which a
 * development-only log never reaches.
 *
 * It is therefore always on, and made cheap rather than conditional. These
 * tests pin "cheap": once per origin, bounded overall, silent on success.
 */
describe('reporting a refusal', () => {
  it('says nothing when the sender is trusted', () => {
    expect(isTrustedOAuthMessageOrigin(REMOTE, hostedApp, REMOTE)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the refused origin and what would have been accepted', () => {
    expect(isTrustedOAuthMessageOrigin('https://localhost.evil.com', hostedApp, REMOTE)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain('https://localhost.evil.com');
    expect(message).toContain('https://tenant.example.com');
    expect(message).toContain(REMOTE);
  });

  it('reports a repeated origin once, however many messages it sends', () => {
    for (let i = 0; i < 50; i += 1) {
      isTrustedOAuthMessageOrigin('https://evil.example.net', hostedApp, REMOTE);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops reporting rather than growing without bound', () => {
    // A sender that cycles origins must not be able to make this expensive.
    for (let i = 0; i < 500; i += 1) {
      isTrustedOAuthMessageOrigin(`https://evil-${i}.example.net`, hostedApp, REMOTE);
    }

    expect(warn.mock.calls.length).toBeLessThanOrEqual(20);
    expect(warn.mock.calls.length).toBeGreaterThan(0);
  });

  it('never puts a credential in the log — only origins', () => {
    isTrustedOAuthMessageOrigin('https://evil.example.net', hostedApp, REMOTE);

    const [message] = warn.mock.calls[0];
    // The predicate is only ever given an origin, so there is nothing else it
    // COULD print; this pins that the message stays that way.
    expect(message).not.toMatch(/token|bearer|code=|secret/i);
  });
});
