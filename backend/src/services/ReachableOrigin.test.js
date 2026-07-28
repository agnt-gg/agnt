import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RemoteAccessConfig from './RemoteAccessConfig.js';
import {
  parseHostHeader,
  buildOrigin,
  isLoopbackHostname,
  isTrustedProxyPeer,
  configuredPublicOrigin,
  candidateOrigins,
  evaluateReachability,
} from './ReachableOrigin.js';

/** A request as Express hands it to us. */
const req = ({ host, peer = '127.0.0.1', tls = false, ...headers } = {}) => ({
  ip: peer,
  socket: { remoteAddress: peer, encrypted: tls },
  headers: { ...(host ? { host } : {}), ...headers },
});

const LAN = [{ address: '192.168.1.50', iface: 'Wi-Fi' }];

let envSnapshot;

beforeEach(() => {
  envSnapshot = {
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
    AGNT_PUBLIC_URL: process.env.AGNT_PUBLIC_URL,
    TRUST_PROXY: process.env.TRUST_PROXY,
    PORT: process.env.PORT,
  };
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.AGNT_PUBLIC_URL;
  delete process.env.TRUST_PROXY;
  vi.spyOn(RemoteAccessConfig, 'lanAddresses').mockReturnValue(LAN);
  vi.spyOn(RemoteAccessConfig, 'readConfig').mockReturnValue({ lanEnabled: true, publicOrigin: '' });
  vi.spyOn(RemoteAccessConfig, 'getActualBind').mockReturnValue({
    host: '0.0.0.0',
    port: 3333,
    lanEnabled: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('parseHostHeader', () => {
  it('splits hostname and port', () => {
    expect(parseHostHeader('agnt.example.com')).toEqual({ hostname: 'agnt.example.com', port: null });
    expect(parseHostHeader('192.168.1.50:3333')).toEqual({ hostname: '192.168.1.50', port: 3333 });
  });

  it('handles IPv6 literals', () => {
    expect(parseHostHeader('[fe80::1]:3333')).toEqual({ hostname: 'fe80::1', port: 3333 });
    expect(parseHostHeader('[::1]')).toEqual({ hostname: '::1', port: null });
  });

  it('takes the first entry of a proxy chain', () => {
    expect(parseHostHeader('outer.example.com, inner.svc')).toEqual({
      hostname: 'outer.example.com',
      port: null,
    });
  });

  // This string is concatenated into the URL the phone opens. Anything that can
  // terminate the authority section can redirect the pairing code elsewhere.
  it.each([
    ['a slash', 'evil.com/@real.com'],
    ['userinfo', 'user@evil.com'],
    ['a CR', 'evil.com\r\nX-Bad: 1'],
    ['a space', 'evil com'],
    ['a non-numeric port', 'host:abc'],
    ['an out-of-range port', 'host:99999'],
    ['an unterminated IPv6 literal', '[::1:3333'],
    ['emptiness', ''],
    ['a non-string', null],
  ])('rejects %s', (_label, value) => {
    expect(parseHostHeader(value)).toBeNull();
  });

  it('rejects an absurdly long value', () => {
    expect(parseHostHeader('a'.repeat(300))).toBeNull();
  });
});

describe('buildOrigin', () => {
  it('omits the port when it is the scheme default', () => {
    expect(buildOrigin('https', 'a.example.com', 443)).toBe('https://a.example.com');
    expect(buildOrigin('http', 'a.example.com', 80)).toBe('http://a.example.com');
  });

  it('keeps a non-default port', () => {
    expect(buildOrigin('http', '192.168.1.50', 3333)).toBe('http://192.168.1.50:3333');
    expect(buildOrigin('https', 'a.example.com', 8443)).toBe('https://a.example.com:8443');
  });

  it('brackets IPv6 hosts', () => {
    expect(buildOrigin('http', 'fe80::1', 3333)).toBe('http://[fe80::1]:3333');
  });
});

describe('isLoopbackHostname', () => {
  it.each(['localhost', '127.0.0.1', '127.0.1.1', '::1', '[::1]', '0.0.0.0', '', null])(
    'treats %s as loopback',
    (h) => expect(isLoopbackHostname(h)).toBe(true)
  );

  it.each(['192.168.1.50', '100.64.1.5', 'agnt.example.com', '10.0.0.4'])(
    'treats %s as reachable',
    (h) => expect(isLoopbackHostname(h)).toBe(false)
  );
});

describe('isTrustedProxyPeer', () => {
  it('trusts loopback by default and nothing else', () => {
    expect(isTrustedProxyPeer(req({ peer: '127.0.0.1' }), undefined)).toBe(true);
    expect(isTrustedProxyPeer(req({ peer: '::1' }), undefined)).toBe(true);
    expect(isTrustedProxyPeer(req({ peer: '192.168.1.9' }), undefined)).toBe(false);
  });

  it('extends trust to RFC1918 peers under "private" (Docker sibling containers)', () => {
    expect(isTrustedProxyPeer(req({ peer: '172.18.0.2' }), 'private')).toBe(true);
    expect(isTrustedProxyPeer(req({ peer: '203.0.113.9' }), 'private')).toBe(false);
  });

  it('honours the explicit on and off switches', () => {
    expect(isTrustedProxyPeer(req({ peer: '203.0.113.9' }), 'all')).toBe(true);
    expect(isTrustedProxyPeer(req({ peer: '127.0.0.1' }), 'false')).toBe(false);
  });

  it('sees through the IPv6-mapped-IPv4 form Node reports on dual-stack sockets', () => {
    expect(isTrustedProxyPeer(req({ peer: '::ffff:127.0.0.1' }), undefined)).toBe(true);
  });

  it('judges by the socket peer, not req.ip', () => {
    // Express rewrites req.ip from X-Forwarded-For once `trust proxy` is on.
    // Reading it first would let the header we are gating vouch for itself, so
    // a future `app.set('trust proxy', true)` would silently disarm this check.
    const spoofed = {
      ip: '127.0.0.1', // what Express would report from a forged XFF
      socket: { remoteAddress: '203.0.113.9' }, // who actually connected
      headers: {},
    };
    expect(isTrustedProxyPeer(spoofed, undefined)).toBe(false);
  });
});

describe('configuredPublicOrigin', () => {
  it('accepts a full URL and normalises the default port away', () => {
    process.env.PUBLIC_ORIGIN = 'https://agnt.example.com:443/';
    expect(configuredPublicOrigin()).toBe('https://agnt.example.com');
  });

  it('assumes http for a bare host:port', () => {
    process.env.PUBLIC_ORIGIN = 'agnt.lan:3333';
    expect(configuredPublicOrigin()).toBe('http://agnt.lan:3333');
  });

  it('falls back to the config file', () => {
    RemoteAccessConfig.readConfig.mockReturnValue({ lanEnabled: true, publicOrigin: 'https://x.agnt.cloud' });
    expect(configuredPublicOrigin()).toBe('https://x.agnt.cloud');
  });

  it('refuses a non-http scheme', () => {
    process.env.PUBLIC_ORIGIN = 'javascript:alert(1)';
    expect(configuredPublicOrigin()).toBeNull();
  });

  it('is null when unset', () => {
    expect(configuredPublicOrigin()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The five topologies. Each one produced a dead QR before this module existed.
// ---------------------------------------------------------------------------
describe('candidateOrigins — topologies', () => {
  const best = (r, opts) => candidateOrigins(r, opts).filter((o) => o.external)[0]?.origin;

  it('LAN: request from this machine falls back to the NIC scan (unchanged behaviour)', () => {
    expect(best(req({ host: 'localhost:3333' }), { port: 3333 })).toBe('http://192.168.1.50:3333');
  });

  it('Tailscale: uses the tailnet address the client actually reached, not the home LAN IP', () => {
    const origin = best(req({ host: '100.64.1.5:3333', peer: '100.64.1.9' }), { port: 3333 });
    expect(origin).toBe('http://100.64.1.5:3333');
    expect(origin).not.toContain('192.168.1.50');
  });

  it('Cloud VPS: uses the public hostname, not the datacenter-internal IP', () => {
    RemoteAccessConfig.lanAddresses.mockReturnValue([{ address: '10.0.4.7', iface: 'eth0' }]);
    const origin = best(req({ host: 'agnt.mysite.com', peer: '203.0.113.9' }), { port: 3333 });
    expect(origin).toBe('http://agnt.mysite.com:3333');
    expect(origin).not.toContain('10.0.4.7');
  });

  it('HTTPS proxy: keeps the scheme instead of downgrading to http', () => {
    const origin = best(
      req({
        host: 'agnt.example.com',
        peer: '127.0.0.1',
        'x-forwarded-host': 'agnt.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-port': '443',
      }),
      { port: 3333 }
    );
    expect(origin).toBe('https://agnt.example.com');
  });

  it('direct TLS: infers https from an encrypted socket with no proxy headers', () => {
    expect(best(req({ host: 'agnt.example.com:8443', peer: '203.0.113.9', tls: true }))).toBe(
      'https://agnt.example.com:8443'
    );
  });

  it('operator override outranks every heuristic', () => {
    process.env.PUBLIC_ORIGIN = 'https://pinned.example.com';
    expect(best(req({ host: '100.64.1.5:3333', peer: '100.64.1.9' }))).toBe('https://pinned.example.com');
  });

  it('offers every candidate, best first, so a multi-homed host can be resolved by the user', () => {
    RemoteAccessConfig.lanAddresses.mockReturnValue([
      { address: '192.168.1.50', iface: 'Wi-Fi' },
      { address: '10.8.0.2', iface: 'wg0' },
    ]);
    const list = candidateOrigins(req({ host: '100.64.1.5:3333', peer: '100.64.1.9' }), { port: 3333 });
    expect(list.map((o) => o.origin)).toEqual([
      'http://100.64.1.5:3333',
      'http://192.168.1.50:3333',
      'http://10.8.0.2:3333',
    ]);
    expect(list[0].source).toBe('request');
  });

  // A NIC address is INFERRED; sources 1-3 are EVIDENCE. Advertising an
  // interface the socket is not bound to is the original dead-QR bug wearing a
  // different hat, so the two classes must not be treated alike.
  it('withholds NIC addresses while the socket is loopback-only', () => {
    RemoteAccessConfig.getActualBind.mockReturnValue({ host: '127.0.0.1', port: 3333, lanEnabled: false });
    expect(candidateOrigins(req({ host: 'localhost:3333' }), { port: 3333 })).toEqual([]);
  });

  it('still trusts a live external request even while loopback-bound (proxy case)', () => {
    RemoteAccessConfig.getActualBind.mockReturnValue({ host: '127.0.0.1', port: 3333, lanEnabled: false });
    const list = candidateOrigins(req({ host: 'agnt.example.com', peer: '127.0.0.1' }), { port: 3333 });
    expect(list.map((o) => o.origin)).toEqual(['http://agnt.example.com:3333']);
  });

  it('scans NICs when the bind was never recorded (unit tests, imports)', () => {
    RemoteAccessConfig.getActualBind.mockReturnValue(null);
    expect(candidateOrigins(req({ host: 'localhost:3333' }), { port: 3333 }).map((o) => o.origin)).toEqual([
      'http://192.168.1.50:3333',
    ]);
  });

  it('never emits a duplicate when the Host header matches a NIC', () => {
    const list = candidateOrigins(req({ host: '192.168.1.50:3333', peer: '192.168.1.9' }), { port: 3333 });
    expect(list.filter((o) => o.origin === 'http://192.168.1.50:3333')).toHaveLength(1);
  });
});

describe('candidateOrigins — forwarded headers are gated', () => {
  const hosts = (r) => candidateOrigins(r, { port: 3333 }).map((o) => o.origin);

  it('ignores X-Forwarded-Host from an untrusted peer', () => {
    // Anyone on the network can invent this header. If it were honoured, a
    // pairing code could be steered to an attacker who then relays it.
    expect(
      hosts(req({ host: '192.168.1.50:3333', peer: '192.168.1.77', 'x-forwarded-host': 'evil.example.com' }))
    ).not.toContain('http://evil.example.com:3333');
  });

  it('honours it from loopback, where a same-box reverse proxy lives', () => {
    expect(
      hosts(req({ host: '127.0.0.1:3333', peer: '127.0.0.1', 'x-forwarded-host': 'agnt.example.com' }))
    ).toContain('http://agnt.example.com');
  });

  it('drops a forwarded host that fails validation rather than trusting it partially', () => {
    expect(
      hosts(req({ host: '127.0.0.1:3333', peer: '127.0.0.1', 'x-forwarded-host': 'evil.com/@real.com' }))
    ).not.toContain('http://evil.com/@real.com');
  });
});

describe('evaluateReachability', () => {
  it('permits a loopback-bound server that is demonstrably reachable through a proxy', () => {
    // THE FALSE 409: binding to loopback is the *correct* configuration behind
    // nginx, and the old bind-only check refused to pair in exactly that case.
    RemoteAccessConfig.getActualBind.mockReturnValue({ host: '127.0.0.1', port: 3333, lanEnabled: false });
    RemoteAccessConfig.lanAddresses.mockReturnValue([]);
    const r = evaluateReachability(
      req({ host: '127.0.0.1:3333', peer: '127.0.0.1', 'x-forwarded-host': 'agnt.example.com', 'x-forwarded-proto': 'https' }),
      { port: 3333 }
    );
    expect(r.usable).toBe(true);
    expect(r.best).toBe('https://agnt.example.com');
  });

  it('refuses when nothing external exists, and says why', () => {
    RemoteAccessConfig.getActualBind.mockReturnValue({ host: '127.0.0.1', port: 3333, lanEnabled: false });
    RemoteAccessConfig.lanAddresses.mockReturnValue([]);
    const r = evaluateReachability(req({ host: 'localhost:3333' }), { port: 3333 });
    expect(r.usable).toBe(false);
    expect(r.best).toBeNull();
    expect(r.reason).toMatch(/only listening on localhost/i);
  });

  it('distinguishes "no network at all" from "bound to localhost"', () => {
    RemoteAccessConfig.getActualBind.mockReturnValue({ host: '0.0.0.0', port: 3333, lanEnabled: true });
    RemoteAccessConfig.lanAddresses.mockReturnValue([]);
    const r = evaluateReachability(req({ host: 'localhost:3333' }), { port: 3333 });
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/no network address/i);
  });
});
