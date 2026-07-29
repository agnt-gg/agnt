/**
 * CONTRACT: a pairing code is minted on a loopback-only server only for a
 * client that could actually redeem it -- i.e. one on this machine.
 *
 * WHY THIS EXISTS
 * ---------------
 * The original rule was all-or-nothing: if nothing external could reach the
 * server, /pairing/code returned 409 with a reason. That protected the real
 * failure (a valid code on a dead URL, which surfaces on the phone as a bare
 * connection error and on the desktop as nothing at all) but it also refused a
 * perfectly workable case -- an iOS Simulator or a browser ON THIS MACHINE can
 * redeem a 127.0.0.1 code without trouble.
 *
 * PR #54 fixed that by deleting the refusal entirely and returning a
 * `loopbackOnly: true` flag instead, which restores the dead-QR failure for
 * every remote client. Neither all-or-nothing answer is right, because the
 * question was never "is the server reachable?" but "is it reachable BY THE
 * CLIENT THAT IS ASKING?".
 *
 * NOTE ON THE REWRITTEN TEST: PR #54 also rewrote the assertion that encoded
 * the old guard, flipping `expect(res.status).toBe(409)` to `toBe(200)`. That
 * is how a suite stops describing the system and starts describing whatever
 * made the build green. Both behaviours are pinned here instead, keyed on the
 * thing that actually distinguishes them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import PairingRoutes, { _resetPairing } from './PairingRoutes.js';
import { _resetRateLimits } from '../utils/rateLimit.js';
import RemoteAccessConfig from '../services/RemoteAccessConfig.js';

const SECRET = 'pairing-loopback-scope-secret';
let server;
let base;
let prevSecret;
let prevBindHost;

/** Overridden per-test to simulate where the request came from. */
let spoofedPeer = null;

const token = () => jwt.sign({ id: 'u1', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });

const call = (method, p, { auth } = {}) =>
  fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
  });

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  prevBindHost = process.env.BIND_HOST;
  process.env.JWT_SECRET = SECRET;

  const app = express();
  app.use(express.json());
  // The test server necessarily listens on loopback, so every real peer is
  // 127.0.0.1. Spoof the socket address to exercise the remote-client branch.
  app.use((req, _res, next) => {
    if (spoofedPeer) {
      Object.defineProperty(req, 'socket', {
        value: { ...req.socket, remoteAddress: spoofedPeer },
        configurable: true,
      });
    }
    next();
  });
  app.use('/api/pairing', PairingRoutes);
  await new Promise((r) => {
    server = http.createServer(app).listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  process.env.JWT_SECRET = prevSecret;
  if (prevBindHost === undefined) delete process.env.BIND_HOST;
  else process.env.BIND_HOST = prevBindHost;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  _resetPairing();
  _resetRateLimits();
  spoofedPeer = null;
  // Bound to loopback only: nothing external can reach this server.
  process.env.BIND_HOST = '0.0.0.0';
  RemoteAccessConfig.recordActualBind({ address: '127.0.0.1', port: 3333 });
});

describe('pairing on a loopback-only server', () => {
  it('MINTS for a client on this machine (iOS Simulator / local browser)', async () => {
    spoofedPeer = '127.0.0.1';
    const res = await call('POST', '/api/pairing/code', { auth: token() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[a-f0-9]{32}$/);
    // Flagged, so the UI can explain that a physical phone still needs LAN.
    expect(body.loopbackOnly).toBe(true);
    expect(body.simUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/m\/pair\?c=[a-f0-9]{32}$/);
  });

  it('mints for an IPv4-mapped IPv6 loopback peer (::ffff:127.0.0.1)', async () => {
    // Node renders IPv4 peers on a dual-stack socket this way. Treating it as
    // remote would refuse the Simulator on a majority of real setups.
    spoofedPeer = '::ffff:127.0.0.1';
    expect((await call('POST', '/api/pairing/code', { auth: token() })).status).toBe(200);
  });

  it('mints for an IPv6 loopback peer (::1)', async () => {
    spoofedPeer = '::1';
    expect((await call('POST', '/api/pairing/code', { auth: token() })).status).toBe(200);
  });

  it('REFUSES for a client on the network -- the code would be unredeemable', async () => {
    spoofedPeer = '192.168.1.42';
    const res = await call('POST', '/api/pairing/code', { auth: token() });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    // No code is handed out at all: a QR nobody can redeem is worse than none.
    expect(body.code).toBeUndefined();
    // And the response says what to do about it.
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('restartRequired');
    expect(body).toHaveProperty('bindHost');
  });

  it('REFUSES for a tailnet peer too -- reachability is not about the range', async () => {
    spoofedPeer = '100.119.81.89';
    expect((await call('POST', '/api/pairing/code', { auth: token() })).status).toBe(409);
  });
});

describe('pairing when the server IS externally reachable', () => {
  beforeEach(() => {
    RemoteAccessConfig.recordActualBind({ address: '0.0.0.0', port: 3333 });
  });

  it('mints for a remote client, and does not flag loopbackOnly', async () => {
    spoofedPeer = '192.168.1.42';
    const res = await call('POST', '/api/pairing/code', { auth: token() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[a-f0-9]{32}$/);
    expect(body.loopbackOnly).toBe(false);
  });

  it('still offers BOTH client links, so the UI can choose', async () => {
    spoofedPeer = '192.168.1.42';
    const body = await (await call('POST', '/api/pairing/code', { auth: token() })).json();
    // Dropping either one leaves a client with no way to be paired at all.
    expect(body.url).toMatch(/\/pair\?c=[a-f0-9]{32}$/);
    expect(body.liteUrl).toMatch(/\/m\/pair\?c=[a-f0-9]{32}$/);
    for (const origin of body.origins || []) {
      expect(origin.url).toMatch(/\/pair\?c=/);
      expect(origin.liteUrl).toMatch(/\/m\/pair\?c=/);
    }
  });
});
