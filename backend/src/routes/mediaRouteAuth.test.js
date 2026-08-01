/**
 * Media routes must be reachable by the BROWSER.
 *
 * THE BUG THIS PINS
 * ─────────────────
 * Three routes stream raw bytes into <img>/<video>/<iframe>/CSS url().
 * Two of them were guarded by `authenticateToken`, which reads only the
 * `Authorization` header — something a browser can never attach to a
 * subresource load. That was invisible while authenticateToken admitted
 * everyone; the moment it started rejecting, every Artifacts preview and every
 * restored generated image returned 401.
 *
 * A unit test of the guard would have passed throughout, because the guard was
 * never wrong — the WIRING was. So the load-bearing assertions here are
 * positional source contracts over the real route files, plus a behavioural
 * check that a cookie-only request actually reaches a handler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

import { MEDIA_ROUTE_PREFIXES } from '../utils/mediaRoutes.js';
import { MEDIA_COOKIE_NAME } from '../utils/authGuard.js';
import ImageRoutes from './ImageRoutes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'media-route-test-secret';
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');

/* ═══════════ 1. wiring — the thing that actually broke ═══════════ */

describe('media routes are guarded for the browser, not for our JS', () => {
  const CASES = [
    ['FileSystemRoutes.js', "router.get('/raw'", '/api/filesystem/raw'],
    ['ImageRoutes.js', "ImageRoutes.get('/:id'", '/api/images'],
  ];

  it.each(CASES)('%s registers %s with requireAuthMedia', (file, registration) => {
    const src = read(file);
    const at = src.indexOf(registration);
    expect(at, `${registration} not found in ${file}`).toBeGreaterThan(-1);
    // The guard is the argument right after the path, so look at that line.
    const line = src.slice(at, src.indexOf('\n', at));
    expect(line, `${file}: byte-streaming route must accept the media cookie`).toContain('requireAuthMedia');
    expect(line, `${file}: header-only guard is unreachable from an <img src>`).not.toContain('authenticateToken');
  });

  it('LocalFileRoutes still applies the media guard to the whole router', () => {
    expect(read('LocalFileRoutes.js')).toContain('LocalFileRoutes.use(requireAuthMedia)');
  });

  it('every route file that streams bytes is a registered media route', () => {
    // The real defence: a NEW sendFile/createReadStream route cannot be added
    // without either classifying it here or failing this test.
    const KNOWN = new Set([
      'FileSystemRoutes.js',
      'ImageRoutes.js',
      'LocalFileRoutes.js',
      // spaFallback.js sends exactly one file: frontend/dist/index.html, the
      // public app shell. It is reachable unauthenticated on purpose (it is how
      // the login screen loads) and takes no user input for the path, so there
      // is nothing for a media cookie to protect.
      'spaFallback.js',
    ]);
    const streaming = fs
      .readdirSync(HERE)
      .filter((f) => f.endsWith('.js') && !f.includes('.test.'))
      .filter((f) => {
        const src = read(f);
        return /res\.sendFile\(/.test(src) || /createReadStream\([^)]*\)[\s\S]{0,40}\.pipe\(res\)/.test(src);
      });

    for (const f of streaming) {
      expect(
        KNOWN.has(f),
        `${f} streams bytes to the client. If a browser loads that URL it MUST use requireAuthMedia and be listed in utils/mediaRoutes.js; if only our JS fetches it, add it to KNOWN here with a note.`,
      ).toBe(true);
    }
    // Anti-vacuity: the scan must actually be finding the known ones.
    expect(streaming.length).toBeGreaterThanOrEqual(3);
  });
});

/* ═══════════ 2. the cookie must reach them ═══════════ */

describe('media cookie scope covers every media route', () => {
  it('backend registry and frontend cookie paths agree exactly', () => {
    // Two lists on opposite sides of the wire. A route present in one and
    // absent from the other is a silent 401 on every image the app renders.
    const feSrc = fs.readFileSync(
      path.join(HERE, '../../../frontend/src/services/mediaAuth.js'),
      'utf8',
    );
    const block = feSrc.slice(feSrc.indexOf('MEDIA_COOKIE_PATHS = Object.freeze(['));
    const fePaths = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(fePaths.length).toBeGreaterThan(0);
    expect([...fePaths].sort()).toEqual([...MEDIA_ROUTE_PREFIXES].sort());
  });

  it('scopes each cookie to one route, never to all of /api', () => {
    // `path=/api` would be prefix-matched onto POST /api/filesystem/file and
    // every other mutating endpoint — a CSRF carrier we have no reason to make.
    for (const p of MEDIA_ROUTE_PREFIXES) {
      expect(p.startsWith('/api/')).toBe(true);
      expect(p).not.toBe('/api');
    }
  });
});

/* ═══════════ 3. behaviour — a cookie-only request gets through ═══════════ */

describe('ImageRoutes accepts the carrier a browser can actually send', () => {
  let server;
  let base;
  let prevSecret;

  beforeAll(async () => {
    prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
    const app = express();
    app.use('/api/images', ImageRoutes);
    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    process.env.JWT_SECRET = prevSecret;
    await new Promise((r) => server.close(r));
  });

  const token = () => jwt.sign({ id: 'u1', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });

  it('rejects an unauthenticated load', async () => {
    const res = await fetch(`${base}/api/images/whatever`);
    expect(res.status).toBe(401);
  });

  it('accepts the media cookie — 404 here means it REACHED the handler', async () => {
    const res = await fetch(`${base}/api/images/whatever`, {
      headers: { Cookie: `${MEDIA_COOKIE_NAME}=${encodeURIComponent(token())}` },
    });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it('still accepts a Bearer header, so existing JS callers keep working', async () => {
    const res = await fetch(`${base}/api/images/whatever`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    expect(res.status).toBe(404);
  });

  it('rejects a forged cookie', async () => {
    const bad = jwt.sign({ id: 'u1' }, 'not-the-secret', { expiresIn: '1h' });
    const res = await fetch(`${base}/api/images/whatever`, {
      headers: { Cookie: `${MEDIA_COOKIE_NAME}=${encodeURIComponent(bad)}` },
    });
    expect(res.status).toBe(401);
  });
});
