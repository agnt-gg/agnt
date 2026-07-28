/**
 * Smoke: mobile lite pair claim → /m/chat.
 *
 * Uses Chromium + a small Express stack (static frontend/dist + pairing API)
 * so it does not depend on a working node_modules/electron install.
 */
import { test, expect } from '@playwright/test';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import PairingRoutes, { _resetPairing } from '../../backend/src/routes/PairingRoutes.js';
import { _resetRateLimits } from '../../backend/src/utils/rateLimit.js';
import RemoteAccessConfig from '../../backend/src/services/RemoteAccessConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '../../frontend/dist');
const SECRET = 'mobile-lite-e2e-secret';

function fakeJwt(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

test.use({
  // Prefer system Chrome when Playwright's bundled headless shell is missing.
  channel: process.env.PW_CHANNEL || 'chrome',
});

test.describe('Mobile lite pairing smoke', () => {
  /** @type {import('http').Server} */
  let server;
  let base;
  let prevSecret;

  test.beforeAll(async () => {
    prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
    _resetPairing();
    _resetRateLimits();
    // Allow mint even when bind looks loopback-only
    RemoteAccessConfig.recordActualBind({ address: '127.0.0.1', port: 3333 });

    const app = express();
    app.use(express.json());
    app.use('/api/pairing', PairingRoutes);

    app.get('/api/users/auth/status', (req, res) => {
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      try {
        const user = jwt.verify(token, SECRET);
        return res.json({
          isAuthenticated: true,
          user: { id: user.id, email: user.email, name: user.name || 'Test' },
        });
      } catch {
        return res.json({ isAuthenticated: false });
      }
    });

    app.get('/api/users/settings', (_req, res) => {
      res.json({
        selectedProvider: 'OpenAI',
        selectedModel: 'gpt-4o',
      });
    });

    app.get('/api/users/subscription/status', (_req, res) => {
      res.json({ planType: 'pro', status: 'active', features: {} });
    });

    app.get('/api/auth/connected', (_req, res) => {
      res.json(['OpenAI']);
    });

    app.use(express.static(DIST));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(DIST, 'index.html'));
    });

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    process.env.JWT_SECRET = prevSecret;
    if (server) await new Promise((r) => server.close(r));
  });

  test.beforeEach(() => {
    _resetPairing();
    _resetRateLimits();
  });

  test('pair claim lands on /m/chat Annie shell', async ({ page }) => {
    const mintToken = fakeJwt({ id: 'u1', email: 'a@b.c', name: 'Ada' });

    const mint = await fetch(`${base}/api/pairing/code`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintToken}`,
        'Content-Type': 'application/json',
      },
    });
    expect(mint.status).toBe(200);
    const { code, liteUrl, simUrl } = await mint.json();
    expect(code).toMatch(/^[a-f0-9]{32}$/);

    // Pair URL from API points at LAN host:port; rewrite to this test server.
    const pairPath = `/m/pair?c=${code}`;
    await page.goto(`${base}${pairPath}`);

    await page.waitForURL(/\/m\/chat/, { timeout: 30000 });

    const composer = page
      .locator('textarea[placeholder*="Message Annie"], textarea.ml-textarea')
      .first();
    await expect(composer).toBeVisible({ timeout: 20000 });

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
    // Same session as desktop minter
    const payload = JSON.parse(
      Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.id).toBe('u1');
    expect(payload.email).toBe('a@b.c');

    // silence unused
    expect(liteUrl || simUrl).toBeTruthy();
  });
});
