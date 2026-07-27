import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import PairingRoutes, { _resetPairing } from './PairingRoutes.js';
import { _resetRateLimits } from '../utils/rateLimit.js';
import RemoteAccessConfig from '../services/RemoteAccessConfig.js';

const SECRET = 'pairing-test-secret';
let server;
let base;
let prevSecret;

const token = (opts = { expiresIn: '1h' }) => jwt.sign({ id: 'u1', email: 'a@b.c' }, SECRET, opts);

const call = (method, p, { body, auth } = {}) =>
  fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const app = express();
  app.use(express.json());
  app.use('/api/pairing', PairingRoutes);
  await new Promise((r) => {
    server = http.createServer(app).listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  process.env.JWT_SECRET = prevSecret;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  _resetPairing();
  _resetRateLimits();
});

describe('pairing — authorisation', () => {
  it('refuses to mint a code without authentication', async () => {
    expect((await call('POST', '/api/pairing/code')).status).toBe(401);
  });

  it('refuses status without authentication', async () => {
    expect((await call('GET', '/api/pairing/status')).status).toBe(401);
  });

  it('refuses the LAN toggle without authentication', async () => {
    expect((await call('POST', '/api/pairing/lan-access', { body: { enabled: true } })).status).toBe(401);
  });
});

describe('pairing — code lifecycle', () => {
  it('mints a 128-bit code and a scannable URL that does NOT contain the token', async () => {
    const t = token();
    const res = await call('POST', '/api/pairing/code', { auth: t });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[a-f0-9]{32}$/);

    // History-mode path, asserted exactly. The frontend router uses
    // createWebHistory: a '#/pair' fragment would load '/' and never mount the
    // Pair view, and a loose "contains /pair?c=" check matches both forms
    // happily — which is exactly how that bug survived its first test.
    expect(body.url).toMatch(/^http:[/][/][^/]+[/]pair[?]c=[a-f0-9]{32}$/);
    expect(body.url).toContain(body.code);
    expect(body.url).not.toContain('#');

    // The whole point of a code: the QR must never carry the credential.
    expect(body.url).not.toContain(t);
    expect(JSON.stringify(body)).not.toContain(t);
  });

  it('exchanges a code for the authorising token exactly once', async () => {
    const t = token();
    const { code } = await (await call('POST', '/api/pairing/code', { auth: t })).json();

    const first = await call('POST', '/api/pairing/claim', { body: { code } });
    expect(first.status).toBe(200);
    expect((await first.json()).token).toBe(t);

    const second = await call('POST', '/api/pairing/claim', { body: { code } });
    expect(second.status).toBe(404);
  });

  it('rejects a malformed code without consulting the store', async () => {
    const res = await call('POST', '/api/pairing/claim', { body: { code: 'nope' } });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown but well-formed code', async () => {
    const res = await call('POST', '/api/pairing/claim', { body: { code: 'a'.repeat(32) } });
    expect(res.status).toBe(404);
  });

  it('rejects a claim whose authorising session expired between mint and claim', async () => {
    const stale = jwt.sign({ id: 'u1' }, SECRET, { expiresIn: 1 });
    const { code } = await (await call('POST', '/api/pairing/code', { auth: stale })).json();
    await new Promise((r) => setTimeout(r, 1500));
    const res = await call('POST', '/api/pairing/claim', { body: { code } });
    expect(res.status).toBe(401);
  });

  it('revoke drops every outstanding code', async () => {
    const t = token();
    const { code } = await (await call('POST', '/api/pairing/code', { auth: t })).json();
    const rev = await call('POST', '/api/pairing/revoke', { auth: t });
    expect((await rev.json()).revoked).toBe(1);
    expect((await call('POST', '/api/pairing/claim', { body: { code } })).status).toBe(404);
  });
});

describe('pairing — brute force', () => {
  it('rate-limits claim attempts to 10/min', async () => {
    const codes = Array.from({ length: 12 }, (_, i) => String(i).padStart(32, '0'));
    const statuses = [];
    for (const code of codes) {
      statuses.push((await call('POST', '/api/pairing/claim', { body: { code } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('pairing — status', () => {
  it('reports bind host, LAN state and reachable URLs', async () => {
    const res = await call('GET', '/api/pairing/status', { auth: token() });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.lanEnabled).toBe('boolean');
    expect(typeof body.bindHost).toBe('string');
    expect(Array.isArray(body.urls)).toBe(true);
    body.urls.forEach((u) => expect(u).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/));
  });
});

describe('pairing — reachability vs intent (the QR that could not work)', () => {
  // THE BUG: /status computed
  //     restartRequired: persisted.lanEnabled !== bind.lanEnabled
  // where resolveBindHost() derives its answer from readConfig() — the same
  // file. The two sides could never disagree, so restartRequired was always
  // false. The panel therefore hid the restart prompt and rendered a QR code
  // for a LAN address the process was not listening on: a perfectly valid code,
  // a dead URL, and nothing on screen to explain the failure.
  let prevBindHost;

  beforeEach(() => {
    prevBindHost = process.env.BIND_HOST;
    RemoteAccessConfig._resetActualBind();
  });

  afterEach(() => {
    if (prevBindHost === undefined) delete process.env.BIND_HOST;
    else process.env.BIND_HOST = prevBindHost;
    RemoteAccessConfig._resetActualBind();
  });

  it('reports restartRequired when the config wants LAN but the socket is loopback', async () => {
    process.env.BIND_HOST = '0.0.0.0'; // desired: reachable
    RemoteAccessConfig.recordActualBind({ address: '127.0.0.1', port: 3333 }); // actual: not

    const body = await (await call('GET', '/api/pairing/status', { auth: token() })).json();
    expect(body.restartRequired).toBe(true);
    // lanEnabled must describe REALITY, because it is what gates the QR code.
    expect(body.lanEnabled).toBe(false);
    expect(body.desiredLanEnabled).toBe(true);
    expect(body.bindHost).toBe('127.0.0.1');
  });

  it('reports no restart needed once the socket matches the config', async () => {
    process.env.BIND_HOST = '0.0.0.0';
    RemoteAccessConfig.recordActualBind({ address: '0.0.0.0', port: 3333 });

    const body = await (await call('GET', '/api/pairing/status', { auth: token() })).json();
    expect(body.restartRequired).toBe(false);
    expect(body.lanEnabled).toBe(true);
  });

  it('reports restartRequired when LAN was turned OFF but the socket is still open to it', async () => {
    process.env.BIND_HOST = '127.0.0.1'; // desired: loopback
    RemoteAccessConfig.recordActualBind({ address: '0.0.0.0', port: 3333 }); // actual: still exposed

    const body = await (await call('GET', '/api/pairing/status', { auth: token() })).json();
    expect(body.restartRequired).toBe(true);
    // Still genuinely reachable until the restart happens — say so.
    expect(body.lanEnabled).toBe(true);
  });

  it('REFUSES to mint a pairing code while the socket is loopback-only', async () => {
    process.env.BIND_HOST = '0.0.0.0';
    RemoteAccessConfig.recordActualBind({ address: '127.0.0.1', port: 3333 });

    const res = await call('POST', '/api/pairing/code', { auth: token() });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.restartRequired).toBe(true);
    // No code is handed out at all — a QR nobody can redeem is worse than none.
    expect(body.code).toBeUndefined();
  });

  it('mints normally once the socket is actually reachable', async () => {
    process.env.BIND_HOST = '0.0.0.0';
    RemoteAccessConfig.recordActualBind({ address: '0.0.0.0', port: 3333 });

    const res = await call('POST', '/api/pairing/code', { auth: token() });
    expect(res.status).toBe(200);
    expect((await res.json()).code).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not invent a restart prompt when the bind was never recorded', async () => {
    // e.g. routes mounted in a test harness with no real listen(). Unknown is
    // not the same as "wrong", and a spurious banner would be noise.
    process.env.BIND_HOST = '0.0.0.0';
    const body = await (await call('GET', '/api/pairing/status', { auth: token() })).json();
    expect(body.restartRequired).toBe(false);
  });
});
