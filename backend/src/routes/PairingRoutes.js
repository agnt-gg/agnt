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
 * WHICH ORIGIN GOES IN THE QR — see services/ReachableOrigin.js. It used to be
 * `lanAddresses()[0]`, which is only correct when the server IS the desktop the
 * user is sitting at. The remote-backend feature exists to make that false, so
 * the origin is now derived from the request that asked for the code: the
 * client demonstrably just reached us at that address. The code itself is
 * origin-independent — it is held in this process's memory and claimable from
 * any address that reaches us — so the UI is free to offer every candidate.
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
import NetworkIdentity from '../services/NetworkIdentity.js';
import TailscaleServe from '../services/TailscaleServe.js';
import { requirePaidFeature, hasFeature } from '../services/auth/planEntitlements.js';

// Warm the network name at boot, so the first user to open the panel is not
// the one who pays for the OS probe. Fire-and-forget by design: nothing waits
// on it, and every failure path inside resolves to null.
NetworkIdentity.primeNetworkName();
// Same reasoning for the Tailscale HTTPS front door: the first user to open the
// panel must not be the one who pays for the CLI probe, and until it settles
// the panel would offer the plain-http tailnet address it is meant to replace.
TailscaleServe.primeServeOrigin(process.env.PORT || 3333);
import {
  candidateOrigins,
  evaluateReachability,
  isSameMachineRequest,
} from '../services/ReachableOrigin.js';

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
//
// NOT plan-gated, deliberately. The panel needs to render for everyone — a free
// user should see the feature and a PRO badge, not an error. It reports
// entitlement as a field so the UI can say so honestly instead of letting a
// user tap through to a 403.
router.get('/status', requireAuthHeader, async (req, res) => {
  const desired = RemoteAccessConfig.resolveBindHost();
  const actual = RemoteAccessConfig.getActualBind();
  const port = process.env.PORT || 3333;
  const addresses = RemoteAccessConfig.lanAddresses();

  // The toggle writes config; the socket is already open and does not move.
  // So the only honest source for "is my phone able to reach this right now?"
  // is the ACTUAL bound address, never the config we would bind next time.
  //
  // An earlier version reported `desired` here and computed restartRequired by
  // comparing the config file against itself — always false. The panel then hid
  // the restart prompt and rendered a QR code for a LAN address nothing was
  // listening on: a valid code, a dead URL, and no way for the user to tell.
  const restartRequired = RemoteAccessConfig.isRestartRequired();

  // Reachability is a property of the whole path, not of our socket. A server
  // behind a reverse proxy is bound to loopback by design and is perfectly
  // reachable; a server bound to 0.0.0.0 with no network is not. Ask the
  // request, which arrived over the path we are being asked about.
  const reach = evaluateReachability(req, { port });
  const reachable = reach.usable || (actual ? actual.lanEnabled : desired.lanEnabled);

  res.json({
    success: true,
    // What is true right now — this gates the QR code.
    lanEnabled: reachable,
    bindHost: actual ? actual.host : desired.host,
    bindSource: desired.source,
    restartRequired,
    port: Number(port),
    // What the saved setting asks for, so the toggle reflects the user's choice
    // even while a restart is pending.
    desiredLanEnabled: desired.lanEnabled,
    // Name the network so "connect your phone to the same Wi-Fi" becomes an
    // instruction the user can actually check. null on wired/unknown setups,
    // where the UI falls back to generic wording.
    //
    // Read, never awaited: this is one line of garnish and it used to block
    // the whole response on `netsh` (8ms endpoint -> 142ms measured), once per
    // minute forever. NetworkIdentity refreshes itself in the background.
    networkName: NetworkIdentity.getNetworkName(),
    // Has anything other than this machine reached us? Splits "the phone never
    // got here" from "it got here and something later went wrong".
    lastExternalRequest: RemoteAccessConfig.getLastExternalRequest(),
    addresses,
    // Every address another device could use, best first, each labelled with
    // where it came from so the UI can explain itself. `urls` stays a flat
    // string[] for backwards compatibility with older frontends.
    origins: reach.origins,
    urls: reach.origins.filter((o) => o.external).map((o) => o.origin),
    // Whether this plan may actually use any of the above. Unknown resolves to
    // true, matching the guard on /code, so the UI never shows a lock the
    // backend would not actually enforce.
    remoteAccessEntitled: await hasFeature('remoteAccess'),
  });
});

// ---------------------------------------------------------------------------
// POST /api/pairing/lan-access  { enabled }
// ---------------------------------------------------------------------------
//
// PAID (`remoteAccess`). Turning LAN access on is the act of exposing this
// desktop to other devices, so it belongs to the same entitlement as pairing
// itself — gating only the QR code would leave the capability half-sold.
router.post('/lan-access', requireAuthHeader, requirePaidFeature('remoteAccess'), (req, res) => {
  const enabled = req.body?.enabled === true;
  try {
    RemoteAccessConfig.writeConfig({ lanEnabled: enabled });
  } catch (err) {
    console.error('[pairing] failed to persist LAN setting:', err);
    return res.status(500).json({ success: false, error: 'Could not save the setting' });
  }
  const desired = RemoteAccessConfig.resolveBindHost();
  const actual = RemoteAccessConfig.getActualBind();
  const envPinned = desired.source === 'env';

  // Same correctness rule as /status: compare against the OPEN SOCKET. The
  // previous version compared `enabled` with a bind host recomputed from the
  // config we had just written, so it was always false and the UI never asked
  // for the restart that actually applies the change.
  const restartRequired = !envPinned && RemoteAccessConfig.isRestartRequired();

  res.json({
    success: true,
    lanEnabled: actual ? actual.lanEnabled : enabled,
    desiredLanEnabled: enabled,
    // BIND_HOST in the environment outranks the toggle; say so instead of
    // letting the user flip a switch that silently does nothing.
    envPinned,
    restartRequired,
    message: envPinned
      ? 'Saved, but BIND_HOST is set in the environment and takes precedence.'
      : restartRequired
        ? 'Saved. Restart the backend to apply it.'
        : 'Saved.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/pairing/code  — mint a single-use pairing code
// ---------------------------------------------------------------------------
//
// PAID (`remoteAccess`). The gate goes HERE rather than on /claim: the phone
// has no session when it claims — that is the entire point of the code — so
// /claim has nothing to check a plan against. No code minted, no pairing
// possible, and the claim path stays exactly as it was.
//
// Fails OPEN when the plan cannot be determined. Pairing a phone to your own
// desktop over your own LAN is a local operation, and making it die when
// api.agnt.gg has a bad hour would be a worse bug than the one being fixed.
// See services/auth/planEntitlements.js.
router.post(
  '/code',
  rateLimit({ name: 'pairing-code', limit: 20, windowMs: 60_000 }),
  requireAuthHeader,
  requirePaidFeature('remoteAccess'),
  (req, res) => {
    sweep();
    if (pending.size >= MAX_PENDING) {
      return res.status(429).json({ success: false, error: 'Too many pending pairings' });
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Prefer an externally reachable origin (LAN / reverse proxy / PUBLIC_ORIGIN).
    //
    // When nothing external exists the answer depends on WHO is asking, which
    // is the distinction the original all-or-nothing refusal missed:
    //
    //   same machine  -> mint. An iOS Simulator or a local browser can redeem
    //                    a 127.0.0.1 code perfectly well; refusing broke a
    //                    legitimate workflow.
    //   anything else -> refuse. The code would be valid and the URL dead, and
    //                    that surfaces on the phone as a bare connection error
    //                    with nothing on the desktop to explain it. Fail here,
    //                    where we can say why.
    //
    // The test is "is there any address another device could use?", NOT "am I
    // bound to a LAN interface?" — a reverse-proxied deployment binds loopback
    // on purpose and is perfectly reachable.
    const port = process.env.PORT || 3333;
    const reach = evaluateReachability(req, { port });
    const loopbackOnly = !reach.usable;
    if (loopbackOnly && !isSameMachineRequest(req)) {
      const actualBind = RemoteAccessConfig.getActualBind();
      return res.status(409).json({
        success: false,
        error: reach.reason,
        restartRequired: RemoteAccessConfig.isRestartRequired(),
        bindHost: actualBind ? actualBind.host : RemoteAccessConfig.resolveBindHost().host,
      });
    }
    const best = reach.best || `http://127.0.0.1:${port}`;

    const code = crypto.randomBytes(16).toString('hex'); // 128 bits
    const expiresAt = Date.now() + CODE_TTL_MS;
    pending.set(code, { token, userId: req.user.id, expiresAt });

    // History-mode path, NOT `#/pair`: the frontend router uses
    // createWebHistory, so a fragment would load `/` and silently never mount
    // the Pair view. The backend's SPA fallback serves index.html for this
    // path, so a cold hit from a phone works.
    const pairUrl = (origin) => `${origin}/pair?c=${code}`;
    // Mobile lite: same code, /m/pair so the link carries the server origin.
    const litePairUrl = (origin) => `${origin}/m/pair?c=${code}`;
    const usable = reach.origins.filter((o) => o.external);
    const origins = usable.length
      ? usable.map((o) => ({ ...o, url: pairUrl(o.origin), liteUrl: litePairUrl(o.origin) }))
      : [
          {
            origin: best,
            url: pairUrl(best),
            liteUrl: litePairUrl(best),
            label: 'This Mac (localhost)',
            external: false,
            source: 'loopback',
            // Loopback IS a secure context, so voice and the camera work here
            // — which is the whole reason the Simulator path is worth keeping.
            secure: true,
          },
        ];

    res.json({
      success: true,
      code,
      expiresAt,
      ttlMs: CODE_TTL_MS,
      url: pairUrl(best),
      liteUrl: litePairUrl(best),
      /** Prefer this when pasting into iOS Simulator on the same Mac. */
      simUrl: `http://127.0.0.1:${port}/m/pair?c=${code}`,
      loopbackOnly,
      warning: loopbackOnly
        ? 'Server is localhost-only. Fine for iOS Simulator on this Mac; enable Phone Access (LAN) for a physical phone.'
        : undefined,
      origin: best,
      // Every candidate, so a multi-homed or split-horizon setup can be
      // resolved by the one participant that actually knows: the human.
      origins,
      addresses: RemoteAccessConfig.lanAddresses(),
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
