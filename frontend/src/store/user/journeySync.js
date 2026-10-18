/**
 * Joins this desktop install, and its sign-ins, to the website journey that led
 * to it (agnt.gg/journeys.js in agnt-server; see docs/JOURNEYS.md there).
 *
 * Two facts go to agnt.gg, and nothing else:
 *   install  a random id for THIS install (not a fingerprint), app version and
 *            OS family. Sent signed out, because most people who download never
 *            sign in, and that drop-off is the number being measured.
 *   claim    after sign-in: "this install belongs to the signed-in account",
 *            plus the one-time nonce of a browser sign-in if there was one, so
 *            agnt.gg can join that browser's history to the account. agnt.gg
 *            takes the account from the verified token, never from this body.
 *
 * Sent from the renderer, straight to agnt.gg (which allows the desktop origin),
 * so the local backend gains no route a signed-out caller can reach. The id
 * lives in localStorage, which is stable because the packaged app always loads
 * from its own local origin.
 *
 * Desktop only. DNT, Global Privacy Control and agnt_analytics_opt_out send
 * nothing; a hosted team space is a server, not an install, and never reports.
 */
import { authSubject, ANONYMOUS_SUBJECT } from '@/store/auth/licenseIdentity.js';

export const NONCE_KEY = 'agnt_journey_signin_nonce';
export const INSTALL_KEY = 'agnt_journey_install';
const SITE = 'https://agnt.gg';
const NONCE_TTL_MS = 30 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const INSTALL_ID = /^[a-f0-9]{32}$/;

const randomHex = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export function rememberSignInNonce(storage, nonce, now = Date.now()) {
  try { storage.setItem(NONCE_KEY, JSON.stringify({ nonce, at: now })); } catch { /* storage full or blocked: nothing to join */ }
}

function pendingNonce(storage, now) {
  try {
    const saved = JSON.parse(storage.getItem(NONCE_KEY) || 'null');
    if (saved && typeof saved.nonce === 'string' && now - saved.at < NONCE_TTL_MS) return saved.nonce;
    storage.removeItem(NONCE_KEY);
  } catch { /* malformed entry */ }
  return null;
}

export function journeyTrackingAllowed({ storage, navigator, win = globalThis.window }) {
  if (!win?.electron || win.electron.isSpaceView) return false;
  if (navigator?.doNotTrack === '1' || navigator?.globalPrivacyControl === true) return false;
  try { return storage.getItem('agnt_analytics_opt_out') !== '1'; } catch { return false; }
}

/** The OS family agnt.gg matches an install against a download with. */
export function platformFamily(navigator) {
  const p = String(navigator?.userAgentData?.platform || navigator?.platform || '').toLowerCase();
  if (p.startsWith('win')) return 'win32';
  if (p.startsWith('mac')) return 'darwin';
  if (p.includes('linux')) return 'linux';
  return 'unknown';
}

function loadState(storage, now, makeId) {
  let state = null;
  try { state = JSON.parse(storage.getItem(INSTALL_KEY) || 'null'); } catch { state = null; }
  if (!state || !INSTALL_ID.test(state.id || '')) {
    state = { id: makeId(), created_at: now };
    storage.setItem(INSTALL_KEY, JSON.stringify(state));
  }
  return state;
}

async function post(fetchImpl, path, body, token) {
  const response = await fetchImpl(SITE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Journey ${path} returned HTTP ${response.status}`);
  const receipt = await response.json();
  if (receipt.success !== true) throw new Error(`Journey ${path} was not acknowledged`);
  return receipt;
}

/** Never rejects. Each half is retried independently on a later session start. */
export async function syncJourney({
  fetchImpl = globalThis.fetch, token = null, storage, navigator, win, appVersion = '', now = Date.now(), makeId = randomHex, logger = console,
}) {
  if (!journeyTrackingAllowed({ storage, navigator, win })) return { skipped: true };
  let state;
  try { state = loadState(storage, now, makeId); } catch (error) { logger.warn('[journey] no storage:', error.message); return { skipped: true }; }
  const save = () => { try { storage.setItem(INSTALL_KEY, JSON.stringify(state)); } catch { /* next run retries */ } };
  const result = { install: 'acknowledged', claim: 'skipped' };

  if (!state.acknowledged_at) {
    if (state.attempted_at && now - state.attempted_at < RETRY_MS) result.install = 'deferred';
    else {
      state.attempted_at = now; save();
      try {
        await post(fetchImpl, '/api/journey/install', { install_id: state.id, app_version: String(appVersion || '').slice(0, 40), platform: platformFamily(navigator) });
        state.acknowledged_at = now; save();
        result.install = 'sent';
      } catch (error) {
        logger.warn('[journey] install report deferred:', error.message);
        result.install = 'deferred';
      }
    }
  }

  const subject = token ? authSubject(token) : ANONYMOUS_SUBJECT;
  const nonce = token ? pendingNonce(storage, now) : null;
  if (token && (state.claimed_for !== subject || nonce)) {
    try {
      const receipt = await post(fetchImpl, '/api/journey/claim', { install_id: state.id, ...(nonce ? { nonce } : {}) }, token);
      state.claimed_for = subject; save();
      if (nonce) storage.removeItem(NONCE_KEY);
      result.claim = 'sent';
      result.journey = receipt.journey || null;
    } catch (error) {
      logger.warn('[journey] claim deferred:', error.message);
      result.claim = 'deferred';
    }
  }
  return result;
}
