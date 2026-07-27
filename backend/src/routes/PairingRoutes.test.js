import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import PairingRoutes, { _resetPairing } from './PairingRoutes.js';
import { _resetRateLimits } from '../utils/rateLimit.js';

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
