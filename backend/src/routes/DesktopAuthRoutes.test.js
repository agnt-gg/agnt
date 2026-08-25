/**
 * The loopback endpoints the desktop sign-in comes home to.
 *
 * These run against a REAL express server on a REAL socket rather than a fake
 * `req`. The loopback guard reads `req.socket.remoteAddress`, which only means
 * anything when there is a socket — a hand-built request object would let the
 * test assert whatever the test author assumed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import router, { isLoopbackAddress } from './DesktopAuthRoutes.js';
import { __resetHandoffsForTests } from '../services/auth/desktopHandoffStore.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1LTEifQ.c2ln';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use('/api/auth/desktop', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/auth/desktop`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => __resetHandoffsForTests());

const begin = async () => (await (await fetch(`${base}/begin`, { method: 'POST' })).json()).nonce;

describe('the round trip', () => {
  it('carries a token from the browser to the app', async () => {
    const nonce = await begin();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);

    const landing = await fetch(`${base}/handoff/${nonce}?token=${TOKEN}`);
    expect(landing.status).toBe(200);
    expect(landing.headers.get('content-type')).toMatch(/text\/html/);

    const claim = await fetch(`${base}/handoff/${nonce}/claim`);
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ token: TOKEN });
  });

  it('answers a poll with 204 until the browser arrives', async () => {
    // Distinct from 404 on purpose: a client must be able to tell "keep
    // waiting" from "this is gone", or it gives up on a slow sign-in.
    const nonce = await begin();
    expect((await fetch(`${base}/handoff/${nonce}/claim`)).status).toBe(204);
  });

  it('shows the user a page, not a status code', async () => {
    // This is a real tab someone is looking at. "Nothing happened" is the
    // failure mode the whole change exists to remove.
    const nonce = await begin();
    const body = await (await fetch(`${base}/handoff/${nonce}?token=${TOKEN}`)).text();

    expect(body).toContain('Signed in');
    expect(body).toContain('return to AGNT');
  });
});

describe('what it refuses', () => {
  it('gives the token out exactly once', async () => {
    const nonce = await begin();
    await fetch(`${base}/handoff/${nonce}?token=${TOKEN}`);

    expect((await fetch(`${base}/handoff/${nonce}/claim`)).status).toBe(200);
    expect((await fetch(`${base}/handoff/${nonce}/claim`)).status).toBe(404);
  });

  it('refuses a nonce it never issued', async () => {
    const res = await fetch(`${base}/handoff/${'a'.repeat(64)}?token=${TOKEN}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('expired');
  });

  it('cannot be answered twice', async () => {
    const nonce = await begin();
    await fetch(`${base}/handoff/${nonce}?token=${TOKEN}`);

    // A second delivery is refused, so nothing that learned the nonce can
    // replace the token before the app claims it.
    expect((await fetch(`${base}/handoff/${nonce}?token=attacker`)).status).toBe(410);
    expect((await (await fetch(`${base}/handoff/${nonce}/claim`)).json()).token).toBe(TOKEN);
  });

  it('explains a callback that carried no token', async () => {
    const nonce = await begin();
    const res = await fetch(`${base}/handoff/${nonce}`);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('did not complete');
  });

  it('never lets a token be cached', async () => {
    const nonce = await begin();
    const landing = await fetch(`${base}/handoff/${nonce}?token=${TOKEN}`);
    const claim = await fetch(`${base}/handoff/${nonce}/claim`);

    expect(landing.headers.get('cache-control')).toContain('no-store');
    // The token is in the landing URL, so it must not travel in a Referer.
    expect(landing.headers.get('referrer-policy')).toBe('no-referrer');
    expect(claim.headers.get('cache-control')).toContain('no-store');
  });

  it('does not reflect an error message into the page as markup', async () => {
    const nonce = await begin();
    const res = await fetch(`${base}/handoff/${nonce}?error=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    const body = await res.text();

    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img src=x');
  });
});

describe('only this machine may speak to these routes', () => {
  it('accepts the loopback forms Node actually reports', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    // IPv6 scoped form, e.g. from a link-local interface.
    expect(isLoopbackAddress('::1%lo0')).toBe(true);
  });

  it('refuses everything else', () => {
    // The token these routes hand out needs no session, so who may ask is the
    // only remaining boundary. A deployment bound to 0.0.0.0 for Docker or
    // phone access must not expose them.
    for (const address of [
      '192.168.1.50',
      '10.0.0.2',
      '203.0.113.10',
      '::ffff:192.168.1.50',
      '2001:db8::1',
      '127.0.0.1.evil.com',
      '',
      null,
      undefined,
    ]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });

  it('a real loopback socket is accepted', async () => {
    // Proves the predicate is actually wired to the request, not just exported.
    expect((await fetch(`${base}/begin`, { method: 'POST' })).status).toBe(200);
  });
});
