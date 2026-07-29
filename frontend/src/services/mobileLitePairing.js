/**
 * Pairing helpers for mobile lite: the pair *link* carries the server URL.
 *
 * Desktop QR is typically:
 *   http://<host>:3333/pair?c=<32hex>
 * Lite prefers:
 *   http://<host>:3333/m/pair?c=<32hex>
 *
 * Paste either (or a bare 32-hex code on the current origin). When the host
 * differs from window.location, navigate to that host's /m/pair so claim is
 * same-origin (no CORS, token lands in the right localStorage).
 */

export const SERVER_ORIGIN_KEY = 'agnt_lite_server_origin';
/** When "1", native bootstrap / /m may auto-open the last server on launch. */
export const AUTO_OPEN_SERVER_KEY = 'agnt_lite_auto_open_server';
/** JSON array of { origin, lastUsed, label? } — multi-server list. */
export const SERVER_LIST_KEY = 'agnt_lite_servers';

const CODE_RE = /^[a-f0-9]{32}$/i;
const MAX_SERVERS = 12;

/**
 * Normalize a user-entered server base to an origin (scheme + host + port).
 * Accepts full URLs, scheme-less host:port, or host with path (path ignored).
 * @param {string} text
 * @returns {string|null} e.g. "http://192.168.1.5:3333"
 */
export function normalizeServerOrigin(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const looksLikeHost = /^https?:\/\//i.test(raw) || /[.:/]/.test(raw);
  if (!looksLikeHost) return null;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`http://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function setAutoOpenServer(enabled) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(AUTO_OPEN_SERVER_KEY, '1');
    else localStorage.removeItem(AUTO_OPEN_SERVER_KEY);
  } catch {
    /* ignore */
  }
}

export function getAutoOpenServer() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(AUTO_OPEN_SERVER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {string} text
 * @param {string} [currentOrigin] default window.location.origin
 * @returns {{ kind: 'code', code: string, origin: string, litePairUrl: string, navigateAway: boolean }
 *   | { kind: 'url', code: string, origin: string, litePairUrl: string, navigateAway: boolean }
 *   | { kind: 'origin', origin: string, liteHomeUrl: string, navigateAway: boolean }
 *   | null}
 */
export function parsePairingInput(text, currentOrigin) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const here =
    currentOrigin ||
    (typeof window !== 'undefined' && window.location?.origin) ||
    '';

  // Bare pairing code → claim on current origin
  if (CODE_RE.test(raw)) {
    const code = raw.toLowerCase();
    if (!here) return null;
    return {
      kind: 'code',
      code,
      origin: here,
      litePairUrl: `${here}/m/pair?c=${code}`,
      navigateAway: false,
    };
  }

  // Full URL (pair link, lite pair, or bare AGNT origin / /m).
  // Reject bare words that URL() would happily turn into http://nope.
  const looksLikeHost =
    /^https?:\/\//i.test(raw) || /[.:/]/.test(raw);
  if (!looksLikeHost) return null;

  let url;
  try {
    // Scheme-less pastes (Tailscale MagicDNS host:port/…) must get http://
    // first — bare `host:port/path` is not a valid absolute URL.
    url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`http://${raw}`);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const origin = url.origin;
  const codeParam = (url.searchParams.get('c') || '').trim().toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (CODE_RE.test(codeParam)) {
    const code = codeParam;
    const litePairUrl = `${origin}/m/pair?c=${code}`;
    return {
      kind: 'url',
      code,
      origin,
      litePairUrl,
      navigateAway: Boolean(here && origin !== here),
    };
  }

  // Origin, /m, /chat, or any path without a pair code → treat as server base
  // (user "Server URL" field often has host:port only or trailing /m).
  return {
    kind: 'origin',
    origin,
    liteHomeUrl: `${origin}/m`,
    navigateAway: Boolean(here && origin !== here),
  };
}

/**
 * @returns {Array<{ origin: string, lastUsed: number, label?: string }>}
 */
export function listPairedServers() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SERVER_LIST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && typeof s.origin === 'string' && s.origin)
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  } catch {
    return [];
  }
}

function writeServerList(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SERVER_LIST_KEY, JSON.stringify(list.slice(0, MAX_SERVERS)));
  } catch {
    /* ignore quota */
  }
}

/**
 * Remember last-used origin and upsert into the multi-server list.
 * @param {string} origin
 * @param {{ label?: string }} [opts]
 */
export function rememberServerOrigin(origin, opts = {}) {
  if (typeof localStorage === 'undefined' || !origin) return;
  const normalized = normalizeServerOrigin(origin) || origin;
  try {
    localStorage.setItem(SERVER_ORIGIN_KEY, normalized);
  } catch {
    /* ignore */
  }
  const now = Date.now();
  const list = listPairedServers().filter((s) => s.origin !== normalized);
  list.unshift({
    origin: normalized,
    lastUsed: now,
    label: opts.label || hostLabel(normalized),
  });
  writeServerList(list);
}

export function removePairedServer(origin) {
  if (!origin) return;
  const normalized = normalizeServerOrigin(origin) || origin;
  writeServerList(listPairedServers().filter((s) => s.origin !== normalized));
  if (getRememberedServerOrigin() === normalized) {
    const next = listPairedServers()[0];
    try {
      if (next) localStorage.setItem(SERVER_ORIGIN_KEY, next.origin);
      else localStorage.removeItem(SERVER_ORIGIN_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function hostLabel(origin) {
  try {
    const u = new URL(origin);
    return u.host || origin;
  } catch {
    return origin;
  }
}

export function getRememberedServerOrigin() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const last = localStorage.getItem(SERVER_ORIGIN_KEY);
    if (last) return last;
    const list = listPairedServers();
    return list[0]?.origin || null;
  } catch {
    return null;
  }
}

export function clearRememberedServerOrigin() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SERVER_ORIGIN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Claim a code against an explicit API origin (defaults to same-origin BASE_URL).
 * @param {string} code
 * @param {{ origin?: string }} [opts]
 */
export async function claimPairingCodeAt(code, opts = {}) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!CODE_RE.test(normalized)) {
    throw new Error('Malformed pairing code');
  }

  let base;
  if (opts.origin) {
    base = `${String(opts.origin).replace(/\/$/, '')}/api`;
  } else {
    const { API_CONFIG } = await import('@/tt.config.js');
    base = API_CONFIG.BASE_URL;
  }

  const url = `${base}/pairing/claim`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: normalized }),
    });
  } catch (networkErr) {
    const err = new Error(
      `Cannot reach ${url}. Is AGNT running? For Simulator use http://127.0.0.1:3333`,
    );
    err.cause = networkErr;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.error || `Claim failed (${res.status})`;
    if (res.status === 404) {
      msg = 'Code invalid, already used, or expired (2 min). Generate a new code on desktop.';
    } else if (res.status === 401) {
      msg = 'Desktop session expired — sign in on desktop and generate a new code.';
    }
    const err = new Error(msg);
    err.response = { status: res.status, data };
    throw err;
  }
  if (opts.origin) rememberServerOrigin(opts.origin);
  return data;
}

/**
 * Apply a successful /api/pairing/claim payload to the Vuex auth store.
 *
 * CRITICAL: Do not depend on fetchUserData (REMOTE_URL → api.agnt.gg) for the
 * session to become valid. That call often fails offline or for local-only
 * JWTs; without userAuth.user the router guard bounces /m/chat back to /m and
 * pairing looks "broken" even though claim succeeded.
 *
 * @param {import('vuex').Store} store
 * @param {{ token: string, user?: { id?: string, email?: string, name?: string } }} res
 */
export async function applyPairingSession(store, res) {
  if (!res?.token) throw new Error('No token returned');

  store.commit('userAuth/SET_TOKEN', res.token);

  const claimed = res.user || {};
  const fallbackUser = {
    id: claimed.id || 'paired',
    email: claimed.email || null,
    name: claimed.name || (claimed.email ? String(claimed.email).split('@')[0] : 'Paired device'),
    authMethod: 'pairing',
  };
  // Set immediately so requiresAuth routes pass even if remote status fails.
  store.commit('userAuth/SET_USER', fallbackUser);

  try {
    await store.dispatch('userAuth/fetchUserData', { forceRefresh: true });
  } catch {
    /* keep claim user */
  }

  // Remote status can clear user on soft failure — restore claim identity.
  if (!store.state.userAuth?.user) {
    store.commit('userAuth/SET_USER', fallbackUser);
  }

  // Next cold start: skip setup UI and go straight to chat on this host.
  if (typeof window !== 'undefined' && window.location?.origin) {
    rememberServerOrigin(window.location.origin);
  }
  setAutoOpenServer(true);

  return store.state.userAuth.user;
}
