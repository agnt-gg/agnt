/**
 * Device pairing — `/api/pairing/*`
 *
 * Lets a phone on the same network join an authenticated session by scanning a
 * QR code, without ever typing a JWT on a phone keyboard.
 *
 * PROTOCOL
 *   1. Desktop (authenticated) POSTs /code. The server mints a 128-bit
 *      single-use code with a 120 s TTL and stashes the CALLER'S OWN TOKEN
 *      against it, in memory only.
 *   2. The QR encodes only `<origin>/pair?c=<code>` — never the token. QR
 *      codes get photographed, screen-shared and left on desks; a 2-minute
 *      single-use code is a far smaller blast radius than a 7-day JWT.
 *   3. The phone opens that URL and POSTs /claim with the code. The code is
 *      consumed atomically and the token is returned exactly once.
 *
 * The phone receives the initiator's existing token rather than a freshly
 * signed one on purpose: under TRUST_REMOTE_AUTH the tokens that matter are
 * issued by the remote auth server, and a locally-signed substitute would pass
 * local verification while failing every upstream call (subscription, license).
 * Handing over the real token guarantees the phone has exactly the same
 * capabilities as the desktop that authorised it, and nothing more.
 */

import express from 'express';
import crypto from 'crypto';
import { requireAuthHeader, extractToken, verifyAuthToken } from '../utils/authGuard.js';
import { rateLimit } from '../utils/rateLimit.js';
import RemoteAccessConfig from '../services/RemoteAccessConfig.js';

const router = express.Router();

const CODE_TTL_MS = 120_000;
const MAX_PENDING = 20;

/** code -> { token, userId, expiresAt } */
const pending = new Map();

function sweep() {
  const now = Date.now();
  for (const [code, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(code);
  }
}

/** Test seam. */
export function _resetPairing() {
  pending.clear();
}

/**
 * Constant-time lookup. A plain `Map.get` leaks nothing useful on its own
 * (hash lookup, not comparison), but the claim path also confirms existence,
 * so equalise the work across hit and miss.
 */
function consumeCode(code) {
  sweep();
  const entry = pending.get(code);
  if (!entry) {
    // Burn comparable time so a timing oracle cannot distinguish
    // "well-formed but unknown" from "known".
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return null;
  }
  pending.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

// ---------------------------------------------------------------------------
// GET /api/pairing/status  — where am I reachable, and is LAN access on?
// ---------------------------------------------------------------------------
router.get('/status', requireAuthHeader, (req, res) => {
  const bind = RemoteAccessConfig.resolveBindHost();
  const persisted = RemoteAccessConfig.readConfig();
  const port = process.env.PORT || 3333;
  const addresses = RemoteAccessConfig.lanAddresses();

  res.json({
    success: true,
    lanEnabled: bind.lanEnabled,
    bindHost: bind.host,
    bindSource: bind.source,
    port: Number(port),
    // The toggle writes config; the bind host only changes on restart. When
    // they disagree the UI must say "restart to apply" rather than silently
    // showing a URL that cannot connect.
    restartRequired: persisted.lanEnabled !== bind.lanEnabled,
    addresses,
    urls: addresses.map((a) => `http://${a.address}:${port}`),
  });
});

// ---------------------------------------------------------------------------
// POST /api/pairing/lan-access  { enabled }
// ---------------------------------------------------------------------------
router.post('/lan-access', requireAuthHeader, (req, res) => {
  const enabled = req.body?.enabled === true;
  try {
    RemoteAccessConfig.writeConfig({ lanEnabled: enabled });
  } catch (err) {
    console.error('[pairing] failed to persist LAN setting:', err);
    return res.status(500).json({ success: false, error: 'Could not save the setting' });
  }
  const bind = RemoteAccessConfig.resolveBindHost();
  const envPinned = bind.source === 'env';
  res.json({
    success: true,
    lanEnabled: enabled,
    // BIND_HOST in the environment outranks the toggle; say so instead of
    // letting the user flip a switch that silently does nothing.
    envPinned,
    restartRequired: !envPinned && enabled !== bind.lanEnabled,
    message: envPinned
      ? 'Saved, but BIND_HOST is set in the environment and takes precedence.'
      : 'Saved. Restart the backend to apply.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/pairing/code  — mint a single-use pairing code
// ---------------------------------------------------------------------------
router.post(
  '/code',
  rateLimit({ name: 'pairing-code', limit: 20, windowMs: 60_000 }),
  requireAuthHeader,
  (req, res) => {
    sweep();
    if (pending.size >= MAX_PENDING) {
      return res.status(429).json({ success: false, error: 'Too many pending pairings' });
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const code = crypto.randomBytes(16).toString('hex'); // 128 bits
    const expiresAt = Date.now() + CODE_TTL_MS;
    pending.set(code, { token, userId: req.user.id, expiresAt });

    const port = process.env.PORT || 3333;
    const addresses = RemoteAccessConfig.lanAddresses();
    const host = addresses[0]?.address || '127.0.0.1';
    const origin = `http://${host}:${port}`;

    res.json({
      success: true,
      code,
      expiresAt,
      ttlMs: CODE_TTL_MS,
      // History-mode path, NOT `#/pair`: the frontend router uses
      // createWebHistory, so a fragment would load `/` and silently never
      // mount the Pair view. The backend's SPA fallback serves index.html for
      // this path, so a cold hit from a phone works.
      url: `${origin}/pair?c=${code}`,
      origin,
      addresses,
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/pairing/claim  { code }   — UNAUTHENTICATED BY DESIGN
// The code IS the credential. Rate-limited hard: 128 bits is unguessable, but
// a limiter turns "unguessable" into "not even worth the packets".
// ---------------------------------------------------------------------------
router.post(
  '/claim',
  rateLimit({ name: 'pairing-claim', limit: 10, windowMs: 60_000 }),
  (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^[a-f0-9]{32}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'Malformed pairing code' });
    }

    const entry = consumeCode(code);
    if (!entry) {
      return res.status(404).json({ success: false, error: 'Pairing code is invalid, used, or expired' });
    }

    // The stashed token may have expired between mint and claim.
    const check = verifyAuthToken(entry.token);
    if (!check.ok) {
      return res.status(401).json({ success: false, error: 'The authorising session is no longer valid' });
    }

    console.log(`[pairing] device paired for user ${entry.userId}`);
    res.json({ success: true, token: entry.token, user: { id: check.user.id, email: check.user.email } });
  }
);

// ---------------------------------------------------------------------------
// POST /api/pairing/revoke  — drop every outstanding code
// ---------------------------------------------------------------------------
router.post('/revoke', requireAuthHeader, (req, res) => {
  const count = pending.size;
  pending.clear();
  res.json({ success: true, revoked: count });
});

console.log('Pairing Routes Started...');

export default router;
