/**
 * `agnt://` — turning a link on the web into a place in this app.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 * A visitor lands on agnt.gg/use-cases/email-triage from a search, wants the
 * agent that page describes, and has AGNT installed. Every other route from
 * that page to this app is blocked or clumsy:
 *
 *   - A page cannot detect us. Chrome and Edge refuse a fetch from a public
 *     origin to 127.0.0.1 outright ("Permission was denied for this request to
 *     access the `loopback` address space"), and no response header fixes it —
 *     the request is refused before any preflight is sent. Measured across
 *     Chrome 151, Edge 151, Chromium 145; only Firefox 146 allows it.
 *   - A downloaded file works everywhere but costs the user a trip through
 *     their file manager.
 *
 * A URL scheme is not subject to any of that, and it is the only mechanism
 * that can LAUNCH the app when it is closed. That is the whole point: the link
 * works whether AGNT is running, sleeping, or not yet started.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE RULE THAT SHAPES EVERYTHING BELOW: A LINK CARRIES A POINTER, NEVER A PAYLOAD
 * ───────────────────────────────────────────────────────────────────────────
 * `agnt://marketplace?item=agnt-usecase-email-triage` names something we
 * published. `agnt://install?payload=<base64 agent>` would let ANY web page,
 * email or chat message define an agent — its system prompt, its tool grants —
 * and the only thing standing between that and a compromised machine would be
 * whether the user read a wall of text in a dialog. A pointer can only ever
 * resolve to something already in our marketplace, which makes this an
 * allowlist rather than a judgement call.
 *
 * So `payload`, `prompt`, `tools`, `url` and friends are not parameters this
 * module knows about, and an unknown parameter is dropped rather than
 * forwarded. There is a test asserting exactly that.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * VERBS ARE GRADUATED BY WHAT THEY CAN DO
 * ───────────────────────────────────────────────────────────────────────────
 *   marketplace  opens a listing        no side effect  → no confirmation needed
 *   open         navigates to a screen  no side effect  → no confirmation needed
 *
 * Both are navigation. The worst a hostile link achieves is making the app show
 * a page, which is why neither needs a confirmation dialog and why this first
 * cut is safe to ship. `install` (writes an agent to disk) and `run` (executes
 * one) are deliberately NOT implemented here: install belongs behind an in-app
 * confirmation card, and run has no business being reachable from a URL at all.
 * Adding a verb to ACTIONS is a security decision, not a feature decision.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EVERY FIELD IS VALIDATED EVEN THOUGH IT ONLY BECOMES A QUERY STRING
 * ───────────────────────────────────────────────────────────────────────────
 * On Windows and Linux this string arrives in `process.argv` of a process the
 * OS just launched on behalf of a web page. Zoom, Steam, Discord and TeamViewer
 * have all shipped remote-code-execution through custom schemes by treating
 * that input as trustworthy. Nothing here is interpolated into a shell, a path
 * or a command line — and the input is validated against a strict allowlist
 * anyway, because "it is only used for X" is a property of today's code.
 *
 * This module is deliberately free of Electron imports so it can be unit
 * tested directly. main.js owns the side effects; this owns the decisions.
 */

export const SCHEME = 'agnt';
const SCHEME_PREFIX = `${SCHEME}:`;

/**
 * Screens `agnt://open?screen=…` may reach, mapped to their real router paths.
 *
 * Every value is checked against frontend/src/router/index.js by
 * verify-deep-link.mjs, so a route rename cannot leave a dead link here.
 *
 * Deliberately excluded: `/m` and `/m/*` (the phone shell — a desktop deep
 * link should never drop someone into the mobile pairing screen) and
 * `/oauth-callback` (a machine endpoint that expects a provider's parameters,
 * not a human).
 */
export const SCREENS = Object.freeze({
  marketplace: '/marketplace',
  agents: '/agents',
  workflows: '/workflows',
  tools: '/tools',
  skills: '/skills',
  goals: '/goals',
  chat: '/chat',
  dashboard: '/dashboard',
  settings: '/settings',
  connectors: '/connectors',
  artifacts: '/artifacts',
  docs: '/docs',
});

/**
 * A marketplace asset id, as published: `agnt-usecase-email-triage`.
 *
 * The id, NOT the listing UUID, is what the web pages link to — and that is a
 * load-bearing choice. A listing's UUID changes if a listing is ever deleted
 * and republished (which is currently the only way to revise a published
 * agent's system prompt), whereas the asset id is derived from the use-case
 * slug and is stable forever. Static pages compiled with a UUID would break on
 * the first prompt fix; compiled with an asset id they never do.
 */
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Referral / campaign attribution. Opaque to us, stored, never interpreted. */
const REF = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Is this string plausibly one of our links?
 *
 * Prefix-only, case-insensitive, because a scheme is case-insensitive per
 * RFC 3986 and Windows has been observed to deliver `AGNT://`. Says nothing
 * about validity — parseDeepLink decides that.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeDeepLink(value) {
  return typeof value === 'string' && value.slice(0, SCHEME_PREFIX.length).toLowerCase() === SCHEME_PREFIX;
}

/**
 * Pull the deep link out of a process argv.
 *
 * THE FIRST MATCH WINS AND THE REST ARE IGNORED. An attacker who can get a
 * second `agnt://` argument appended must not be able to override the one the
 * user actually clicked, and argv also carries Chromium's own switches, the
 * executable path, and in development the app directory. Nothing else in argv
 * is read, and argv is never forwarded anywhere.
 *
 * @param {string[]} argv
 * @returns {string|null}
 */
export function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (looksLikeDeepLink(arg)) return arg;
  }
  return null;
}

/**
 * Parse and validate. Never throws.
 *
 * @param {unknown} raw
 * @returns {{ok: true, action: string, params: object, path: string} |
 *           {ok: false, reason: string}}
 */
export function parseDeepLink(raw) {
  if (!looksLikeDeepLink(raw)) return fail('not-an-agnt-url');

  // A NUL byte truncates a string in most native APIs, so a value that looks
  // harmless here can be something else entirely downstream. Refuse rather
  // than sanitise: there is no legitimate link containing one.
  if (raw.includes('\0')) return fail('contains-nul');

  // Bounded before parsing. A pointer is short by construction; anything long
  // is either a payload someone is trying to smuggle or an attempt to wedge a
  // parser, and both deserve the same answer.
  if (raw.length > 2048) return fail('too-long');

  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail('unparseable');
  }

  /*
   * `agnt://marketplace?item=x` puts the verb in the HOST, while
   * `agnt:marketplace?item=x` — a shape some launchers produce — puts it in
   * the PATH. Both are legal for a non-special scheme and both are things the
   * OS may hand us, so accept either and normalise.
   *
   * URL lowercases a host but not a path, hence the explicit toLowerCase():
   * without it `agnt:Marketplace` would parse as a different verb from
   * `agnt://Marketplace`, and only one of them would work.
   */
  const fromHost = url.hostname;
  const fromPath = url.pathname.replace(/^\/+/, '').split('/')[0];
  const action = (fromHost || fromPath || '').toLowerCase();

  if (!action) return fail('no-action');

  const handler = ACTIONS[action];
  if (!handler) return fail(`unknown-action:${action}`);

  return handler(url.searchParams);
}

/**
 * The verbs. Each returns the SPA path to land on, built field by field from
 * values it has validated — never by forwarding the incoming query wholesale,
 * which is how an unexpected parameter ends up somewhere it was never
 * considered.
 */
const ACTIONS = Object.freeze({
  /** agnt://marketplace[?item=<asset-id>][&ref=<token>] */
  marketplace(q) {
    const item = q.get('item');
    const ref = q.get('ref');
    const params = {};

    if (item !== null) {
      if (!ASSET_ID.test(item)) return fail('bad-item');
      params.item = item;
    }
    // Attribution is optional and must never be the reason a link fails: a
    // mangled ref costs us a stat, while refusing the link costs the user the
    // thing they clicked. Drop it and carry on.
    if (ref !== null && REF.test(ref)) params.ref = ref;

    return ok('marketplace', params, buildPath('/marketplace', params));
  },

  /** agnt://open?screen=<name> */
  open(q) {
    const screen = (q.get('screen') || '').toLowerCase();
    if (!screen) return fail('no-screen');
    const path = SCREENS[screen];
    if (!path) return fail(`unknown-screen:${screen}`);
    return ok('open', { screen }, path);
  },
});

/** Names of every verb this build accepts. Used by the verifier and by tests. */
export const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

function buildPath(base, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

function ok(action, params, path) {
  return { ok: true, action, params, path };
}

function fail(reason) {
  return { ok: false, reason };
}

/**
 * Absolute URL to load for a cold start, where there is no window yet to
 * navigate and the app must come up already pointing at the right place.
 *
 * @param {string} origin - e.g. 'http://localhost:3333'
 * @param {{path: string}} intent
 * @returns {string}
 */
export function intentToUrl(origin, intent) {
  return `${String(origin).replace(/\/+$/, '')}${intent.path}`;
}
