/**
 * The decision this module makes is "is there an HTTPS front door in front of
 * MY port, right now?" — and getting it wrong is expensive in one direction:
 * advertising a tailnet HTTPS URL that does not reach AGNT replaces a working
 * http address with a broken https one. So every test here is about refusing
 * a front door that is not ours.
 *
 * parseServeStatus is pure, so this runs against real `tailscale serve status
 * --json` payloads with no daemon, no tailnet and no network.
 */
import { describe, it, expect } from 'vitest';
import {
  parseServeStatus,
  getServeOrigin,
  primeServeOrigin,
  _resetTailscaleCache,
} from './TailscaleServe.js';

/** Exactly what the CLI printed on the machine this was written on. */
const REAL = {
  TCP: { 443: { HTTPS: true } },
  Web: {
    'desktop-38va1or.tail98e39c.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:3333' } },
    },
  },
};

describe('finds the front door when it is genuinely ours', () => {
  it('reads a real serve config', () => {
    expect(parseServeStatus(REAL, 3333)).toEqual({
      origin: 'https://desktop-38va1or.tail98e39c.ts.net',
      hostname: 'desktop-38va1or.tail98e39c.ts.net',
    });
  });

  it('accepts the raw JSON string, as the CLI emits it', () => {
    expect(parseServeStatus(JSON.stringify(REAL), 3333)?.origin).toBe(
      'https://desktop-38va1or.tail98e39c.ts.net'
    );
  });

  it('accepts a string port, as process.env.PORT supplies it', () => {
    expect(parseServeStatus(REAL, '3333')).not.toBeNull();
  });

  it('keeps a non-standard public port in the origin', () => {
    const payload = {
      TCP: { 8443: { HTTPS: true } },
      Web: { 'host.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3333' } } } },
    };
    expect(parseServeStatus(payload, 3333)?.origin).toBe('https://host.ts.net:8443');
  });

  it('omits the port when it is the https default', () => {
    expect(parseServeStatus(REAL, 3333)?.origin).not.toMatch(/:443/);
  });

  it('accepts localhost and ::1 as the proxy target', () => {
    for (const target of ['http://localhost:3333', 'http://[::1]:3333']) {
      const payload = {
        TCP: { 443: { HTTPS: true } },
        Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: target } } } },
      };
      expect(parseServeStatus(payload, 3333), target).not.toBeNull();
    }
  });
});

describe('refuses a front door that is not ours', () => {
  it('ignores a proxy pointed at a different port', () => {
    const payload = {
      TCP: { 443: { HTTPS: true } },
      Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } },
    };
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });

  it('ignores a proxy pointed at another machine', () => {
    // Same port number, different host: a coincidence, not a route to us.
    const payload = {
      TCP: { 443: { HTTPS: true } },
      Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://192.168.1.9:3333' } } } },
    };
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });

  it('ignores a handler that is not mounted at the root', () => {
    // /grafana -> us would still leave /m/pair unresolvable, so the origin
    // would be a dead link.
    const payload = {
      TCP: { 443: { HTTPS: true } },
      Web: { 'host.ts.net:443': { Handlers: { '/grafana': { Proxy: 'http://127.0.0.1:3333' } } } },
    };
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });

  it('ignores a front door that is not terminating TLS', () => {
    // Without HTTPS this buys nothing over the interface address we already
    // offer, and would claim a secure context that does not exist.
    const payload = {
      TCP: { 443: { HTTPS: false } },
      Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3333' } } } },
    };
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });

  it('ignores a static file handler with no proxy at all', () => {
    const payload = {
      TCP: { 443: { HTTPS: true } },
      Web: { 'host.ts.net:443': { Handlers: { '/': { Path: '/var/www' } } } },
    };
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE INVARIANT THAT COST AN HOUR
//
// PairingRoutes primes this probe at module scope, so importing the route ran
// `tailscale` against the developer's own machine. On a desktop with a live
// serve config the origin tests asserted a real tailnet hostname and went red;
// the identical commit was green on a machine without Tailscale.
// ---------------------------------------------------------------------------
describe('a test run never reads the host machine', () => {
  it('reports no front door even where one genuinely exists', async () => {
    _resetTailscaleCache();
    await primeServeOrigin(3333);
    expect(getServeOrigin(3333)).toBeNull();
  });

  it('stays null after a scheduled background refresh', async () => {
    _resetTailscaleCache();
    expect(getServeOrigin(3333)).toBeNull();
    // Let the setImmediate the getter queued actually run.
    await new Promise((r) => setTimeout(r, 20));
    expect(getServeOrigin(3333)).toBeNull();
  });
});

describe('never throws on junk', () => {
  it.each([
    ['no serve config', {}],
    ['null', null],
    ['undefined', undefined],
    ['malformed json', '{not json'],
    ['empty string', ''],
    ['Web is not an object', { Web: 'nope' }],
    ['handlers missing', { TCP: { 443: { HTTPS: true } }, Web: { 'h.ts.net:443': {} } }],
    ['proxy is not a url', { TCP: { 443: { HTTPS: true } }, Web: { 'h.ts.net:443': { Handlers: { '/': { Proxy: 'not a url' } } } } }],
    ['a number', 42],
  ])('%s -> null', (_label, payload) => {
    expect(parseServeStatus(payload, 3333)).toBeNull();
  });
});
