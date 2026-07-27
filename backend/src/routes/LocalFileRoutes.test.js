/**
 * End-to-end proof that the arbitrary-file-read hole is closed.
 *
 * This boots a REAL express app with the REAL router on an ephemeral port and
 * makes REAL HTTP requests, because the bug being fixed was never visible in
 * unit-land: the router registered fine, the handler worked fine, and the
 * middleware that was supposed to stop unauthenticated callers called next().
 * Only an actual request over an actual socket tells you what a stranger on
 * your network can read.
 *
 * The original exploit, verified against a live instance on 2026-07-27:
 *   GET http://<lan-ip>:3333/api/local-file/C:/…/backend/.env
 *   -> 200, 1392 bytes, containing JWT_SECRET
 *   -> forge a token for any user id -> POST /api/tools/execute_shell_command
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import LocalFileRoutes from './LocalFileRoutes.js';
import { MEDIA_COOKIE_NAME } from '../utils/authGuard.js';

const SECRET = 'localfile-test-secret';
let server;
let base;
let tmpDir;
let files = {};
let prevSecret;
let prevRoots;

const token = () => jwt.sign({ id: 'u1', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });

/** @param {string} p @param {RequestInit} [init] */
const get = (p, init = {}) => fetch(base + p, { ...init, redirect: 'manual' });

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-localfile-'));
  files.env = path.join(tmpDir, '.env');
  files.pem = path.join(tmpDir, 'server.pem');
  files.png = path.join(tmpDir, 'art.png');
  files.txt = path.join(tmpDir, 'notes.txt');
  fs.writeFileSync(files.env, 'JWT_SECRET=super-secret-value\nOPENAI_API_KEY=sk-xxx\n');
  fs.writeFileSync(files.pem, '-----BEGIN PRIVATE KEY-----\nnope\n');
  fs.writeFileSync(files.png, Buffer.from('89504e470d0a1a0a' + '00'.repeat(64), 'hex'));
  fs.writeFileSync(files.txt, 'hello world, this is a rendered artifact');

  const app = express();
  app.use('/api/local-file', LocalFileRoutes);
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  process.env.JWT_SECRET = prevSecret;
  await new Promise((r) => server.close(r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  prevRoots = process.env.AGNT_LOCAL_FILE_ROOTS;
  delete process.env.AGNT_LOCAL_FILE_ROOTS;
});
afterEach(() => {
  if (prevRoots === undefined) delete process.env.AGNT_LOCAL_FILE_ROOTS;
  else process.env.AGNT_LOCAL_FILE_ROOTS = prevRoots;
});

const asUrl = (abs) => '/api/local-file/' + encodeURI(abs.replace(/\\/g, '/'));

describe('LocalFileRoutes — authentication', () => {
  it('THE EXPLOIT: refuses an unauthenticated read of a .env file', async () => {
    const res = await get(asUrl(files.env));
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain('JWT_SECRET');
    expect(body).not.toContain('super-secret-value');
  });

  it('refuses an unauthenticated read of an ordinary file too', async () => {
    expect((await get(asUrl(files.txt))).status).toBe(401);
  });

  it('refuses the legacy ?path= form unauthenticated', async () => {
    const res = await get('/api/local-file?path=' + encodeURIComponent(files.txt));
    expect(res.status).toBe(401);
  });

  it('refuses a forged token signed with the wrong secret', async () => {
    const bad = jwt.sign({ id: 'u1' }, 'not-the-secret');
    const res = await get(asUrl(files.txt), { headers: { Authorization: `Bearer ${bad}` } });
    expect(res.status).toBe(401);
  });

  it('serves an ordinary file with a valid Bearer token', async () => {
    const res = await get(asUrl(files.txt), { headers: { Authorization: `Bearer ${token()}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('rendered artifact');
  });

  it('serves via the media cookie — the carrier <img>/<iframe> subresources actually use', async () => {
    const res = await get(asUrl(files.png), { headers: { cookie: `${MEDIA_COOKIE_NAME}=${token()}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('serves via ?token= for callers that can set neither header nor cookie', async () => {
    const res = await get(asUrl(files.txt) + `?token=${token()}`);
    expect(res.status).toBe(200);
  });
});

describe('LocalFileRoutes — credential guard (applies even when authenticated)', () => {
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  it('refuses .env to an authenticated caller', async () => {
    const res = await get(asUrl(files.env), { headers: auth() });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('super-secret-value');
  });

  it('refuses private key material', async () => {
    expect((await get(asUrl(files.pem), { headers: auth() })).status).toBe(403);
  });

  it('still serves legitimate media', async () => {
    expect((await get(asUrl(files.png), { headers: auth() })).status).toBe(200);
  });
});

describe('LocalFileRoutes — behaviour preserved', () => {
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  it('honours HTTP Range so <video> seeking still works', async () => {
    const res = await get(asUrl(files.txt), { headers: { ...auth(), Range: 'bytes=0-4' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-4\/\d+$/);
    expect(await res.text()).toBe('hello');
  });

  it('416s an unsatisfiable range', async () => {
    const res = await get(asUrl(files.txt), { headers: { ...auth(), Range: 'bytes=99999-' } });
    expect(res.status).toBe(416);
  });

  it('404s a missing file (authenticated)', async () => {
    const res = await get(asUrl(path.join(tmpDir, 'nope.txt')), { headers: auth() });
    expect(res.status).toBe(404);
  });

  it('sets Accept-Ranges and the right Content-Type', async () => {
    const res = await get(asUrl(files.png), { headers: auth() });
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('LocalFileRoutes — optional root scoping', () => {
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  it('is unrestricted when AGNT_LOCAL_FILE_ROOTS is unset', async () => {
    expect((await get(asUrl(files.txt), { headers: auth() })).status).toBe(200);
  });

  it('allows paths inside a configured root', async () => {
    process.env.AGNT_LOCAL_FILE_ROOTS = tmpDir;
    expect((await get(asUrl(files.txt), { headers: auth() })).status).toBe(200);
  });

  it('refuses paths outside every configured root', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-other-'));
    try {
      process.env.AGNT_LOCAL_FILE_ROOTS = other;
      const res = await get(asUrl(files.txt), { headers: auth() });
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('refuses a ../ traversal out of a configured root', async () => {
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    process.env.AGNT_LOCAL_FILE_ROOTS = sub;
    const traversal = path.join(sub, '..', 'notes.txt');
    const res = await get(asUrl(traversal), { headers: auth() });
    expect(res.status).toBe(403);
  });
});
