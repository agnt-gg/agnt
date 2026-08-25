/**
 * LOOPBACK SIGN-IN FOR THE DESKTOP APP.
 *
 * ---------------------------------------------------------------------------
 * THE FLOW
 * ---------------------------------------------------------------------------
 *   1. The app asks for a nonce                     POST /begin
 *   2. It opens the user's REAL browser at the API's Google endpoint, passing
 *      this backend's loopback address as the redirect target.
 *   3. Google signs them in — no password, the browser already has a session.
 *   4. The API redirects the browser here            GET  /handoff/:nonce?token=
 *   5. The app, which has been polling, picks it up  GET  /handoff/:nonce/claim
 *
 * Step 4 is the reason any of this exists: a browser the app did not open has
 * no `window.opener`, so there is no `postMessage` path home. A loopback URL
 * is the address the app can be reached at, and RFC 8252 recommends exactly
 * this shape for native applications.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ROUTES REFUSE ANYTHING THAT IS NOT LOOPBACK
 * ---------------------------------------------------------------------------
 * They cannot require a session — the user is in the middle of getting one.
 * The nonce is the only credential, so the blast radius is narrowed by who is
 * allowed to speak at all.
 *
 * This flow is desktop-only by construction: the redirect target is a loopback
 * URL, which only resolves on the machine running the app. A request arriving
 * from anywhere else cannot be part of a real sign-in, so refusing it costs
 * nothing and takes these routes off the attack surface of every deployment
 * that binds to 0.0.0.0 for Docker or phone access.
 *
 * The check reads `req.socket.remoteAddress` rather than `req.ip`. `req.ip`
 * honours `X-Forwarded-For` when `trust proxy` is set, which is a header the
 * caller controls — precisely the wrong thing to derive a security decision
 * from.
 */

import express from 'express';
import { createHandoff, completeHandoff, claimHandoff } from '../services/auth/desktopHandoffStore.js';

const router = express.Router();

/** Every form Node reports for "this machine". */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Exported so the allowed set can be asserted directly. A test that only
 * exercises a real loopback socket proves the ACCEPT path and says nothing
 * about what is refused, which is the half that matters.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  // IPv6 scoped form, e.g. `::1%lo0`.
  return LOOPBACK_ADDRESSES.has(address.split('%')[0]);
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress);
}

function requireLoopback(req, res, next) {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'Desktop sign-in is only available on this machine.' });
  }
  return next();
}

router.use(requireLoopback);

/**
 * Escape text destined for the browser page below.
 *
 * Nothing user-controlled reaches it today, but this file's whole job is to
 * render a page in response to a request an attacker can shape, and a future
 * edit that interpolates a provider name should not have to remember.
 */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function resultPage({ title, message, ok }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; background: #070710; color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { text-align: center; padding: 48px 40px; max-width: 30rem; }
  .mark {
    width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 30px;
    background: ${ok ? 'rgba(0,255,153,.12)' : 'rgba(255,90,90,.12)'};
    color: ${ok ? '#00FF99' : '#ff5a5a'};
    border: 1px solid ${ok ? 'rgba(0,255,153,.35)' : 'rgba(255,90,90,.35)'};
  }
  h1 { font-size: 21px; font-weight: 600; margin: 0 0 10px; }
  p  { font-size: 15px; line-height: 1.55; opacity: .68; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">${ok ? '&#10003;' : '!'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

/**
 * Begin a sign-in. Returns the nonce the app will poll on and embed in the
 * redirect URL it hands to the API.
 */
router.post('/begin', (req, res) => {
  const nonce = createHandoff();
  res.json({ nonce });
});

/**
 * Where the user's browser lands when the API is done.
 *
 * Always answers with a page rather than a redirect or a bare status: this is
 * a real tab the user is looking at, and "nothing happened" is the failure
 * mode this whole change exists to remove.
 */
router.get('/handoff/:nonce', (req, res) => {
  const { nonce } = req.params;
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  res.set('Cache-Control', 'no-store');
  // The token is in this URL. Referrer-Policy keeps it out of the Referer
  // header of anything the page might later load.
  res.set('Referrer-Policy', 'no-referrer');

  if (!token) {
    const reason = typeof req.query.error === 'string' ? req.query.error : '';
    return res.status(400).send(
      resultPage({
        ok: false,
        title: 'Sign-in did not complete',
        message: reason || 'No session was returned. Close this tab and try again from AGNT.',
      }),
    );
  }

  if (!completeHandoff(nonce, token)) {
    // Expired, already answered, or a nonce this backend never issued. All
    // three are the same thing to the person reading the page.
    return res.status(410).send(
      resultPage({
        ok: false,
        title: 'This sign-in link has expired',
        message: 'Close this tab and start the sign-in again from AGNT.',
      }),
    );
  }

  return res.send(
    resultPage({
      ok: true,
      title: 'Signed in',
      message: 'You can close this tab and return to AGNT.',
    }),
  );
});

/**
 * The app collects its token here. Single use.
 *
 * `pending` is a 204 rather than a 404 so a polling client can tell "not yet"
 * from "this sign-in is gone", and stop rather than spin.
 */
router.get('/handoff/:nonce/claim', (req, res) => {
  const result = claimHandoff(req.params.nonce);

  res.set('Cache-Control', 'no-store');

  if (result.status === 'ready') return res.json({ token: result.token });
  if (result.status === 'pending') return res.status(204).end();
  return res.status(404).json({ error: 'unknown or expired sign-in' });
});

export default router;
