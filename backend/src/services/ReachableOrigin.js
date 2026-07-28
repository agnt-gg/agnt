/**
 * Where can another device actually reach this server?
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * Pairing puts an address in a QR code. The original implementation derived
 * that address from the server's own network cards:
 *
 *     const host = lanAddresses()[0]?.address || '127.0.0.1';
 *     const origin = `http://${host}:${port}`;
 *
 * That is correct in exactly one topology — the server IS the desktop the user
 * is sitting at, on the same Wi-Fi as the phone. It was the only topology that
 * existed when pairing shipped.
 *
 * The remote-backend feature (electron/connectionConfig.js) exists precisely to
 * make that assumption false: the desktop now points at a homelab box, a VPS,
 * a tailnet address, or a reverse proxy. In every one of those cases the server
 * reads its own NIC list and encodes an address the phone has no route to:
 *
 *   Tailscale   → encodes the box's home LAN IP    (phone is on the tailnet)
 *   Cloud VPS   → encodes a 10.x datacenter IP     (phone is on the internet)
 *   HTTPS proxy → encodes http://, downgraded      (TLS terminated upstream)
 *   nginx       → refuses outright with a 409      ("only listening on
 *                 localhost") even though localhost is exactly where a
 *                 correctly-configured reverse proxy expects it to listen
 *
 * Every failure is silent: the code mints, the QR renders, the phone scans, and
 * the page never loads. Nothing distinguishes it from a broken server.
 *
 * ---------------------------------------------------------------------------
 * THE FIX
 * ---------------------------------------------------------------------------
 * Stop guessing. The client that is asking for the QR just reached this server
 * successfully — the address it used is on the request. Prefer that, and keep
 * the NIC scan only as the fallback for the case it was always right about
 * (the request came from this machine, so its Host header is useless).
 *
 * Precedence, highest first:
 *   1. PUBLIC_ORIGIN / publicOrigin  — operator pins the canonical URL
 *   2. X-Forwarded-Proto/Host        — only from a TRUSTED peer (see below)
 *   3. Host header                   — the address the client actually typed
 *   4. NIC scan                      — today's behaviour, unchanged
 *
 * All usable candidates are returned, not just the winner, because in an
 * ambiguous topology (multi-homed box, split-horizon DNS) the human looking at
 * the screen knows something the server cannot infer. The UI shows the list.
 *
 * ---------------------------------------------------------------------------
 * WHY FORWARDED HEADERS ARE GATED
 * ---------------------------------------------------------------------------
 * The QR carries a single-use code that is exchanged for a real token. If an
 * attacker could choose the origin, the phone would hand that code to them and
 * they would relay it for the token. `Host` is set by the client's own browser
 * from its URL bar, so in the real flow it is the user's own trusted input.
 * `X-Forwarded-*` is a plain header anyone can invent, and is only meaningful
 * when it was written by a proxy we trust — so it is honoured only when the
 * immediate peer qualifies under TRUST_PROXY.
 *
 *   TRUST_PROXY unset | 'loopback'  → trust 127.0.0.1 / ::1  (same-box nginx,
 *                                     Caddy, Traefik — the common case)
 *   TRUST_PROXY 'private'           → also trust RFC1918 peers (Docker/compose,
 *                                     where the proxy is a sibling container)
 *   TRUST_PROXY '1'|'true'|'all'    → trust any peer (only behind a closed net)
 *   TRUST_PROXY '0'|'false'|'none'  → never trust forwarded headers
 */

import RemoteAccessConfig from './RemoteAccessConfig.js';

/** Hostnames that only ever resolve back to the machine making the request. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/**
 * A hostname we are willing to place in a URL. Deliberately strict: this string
 * is concatenated into the URL the phone will open, so anything exotic (a
 * slash, a CR, an @) could redirect the pairing code somewhere else entirely.
 */
const SAFE_HOSTNAME = /^[a-z0-9]([a-z0-9\-._]*[a-z0-9])?$/i;
const SAFE_IPV6 = /^[0-9a-f:.]+$/i;

export function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string') return true;
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  return LOOPBACK_HOSTNAMES.has(h) || h.startsWith('127.');
}

function isPrivateIpv4(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * Split a Host / X-Forwarded-Host value into hostname + port.
 * Returns null for anything that fails validation, so callers can simply skip
 * the candidate rather than reason about partially-trusted input.
 * @returns {{ hostname: string, port: number|null }|null}
 */
export function parseHostHeader(value) {
  if (typeof value !== 'string') return null;
  // A proxy chain may append: "a.example.com, b.internal". The first entry is
  // the one the original client asked for.
  const raw = value.split(',')[0].trim();
  if (!raw || raw.length > 255) return null;

  let hostname = raw;
  let port = null;

  if (raw.startsWith('[')) {
    // IPv6 literal: [::1]:3333
    const close = raw.indexOf(']');
    if (close < 0) return null;
    hostname = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (rest) {
      if (!/^:\d+$/.test(rest)) return null;
      port = Number(rest.slice(1));
    }
    if (!SAFE_IPV6.test(hostname)) return null;
  } else {
    const colon = raw.lastIndexOf(':');
    if (colon > -1) {
      const tail = raw.slice(colon + 1);
      if (!/^\d+$/.test(tail)) return null;
      port = Number(tail);
      hostname = raw.slice(0, colon);
    }
    if (!SAFE_HOSTNAME.test(hostname)) return null;
  }

  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  return { hostname, port };
}

/** Build an origin string, omitting the port when it is the scheme default. */
export function buildOrigin(protocol, hostname, port) {
  const proto = protocol === 'https' ? 'https' : 'http';
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  const isDefault = (proto === 'https' && Number(port) === 443) || (proto === 'http' && Number(port) === 80);
  return port && !isDefault ? `${proto}://${host}:${port}` : `${proto}://${host}`;
}

/**
 * Is the immediate peer allowed to tell us what the original request looked
 * like? See the TRUST_PROXY table in the module header.
 */
export function isTrustedProxyPeer(req, mode = process.env.TRUST_PROXY) {
  const setting = String(mode ?? '').trim().toLowerCase();
  if (setting === '0' || setting === 'false' || setting === 'none') return false;
  if (setting === '1' || setting === 'true' || setting === 'all') return true;

  // The SOCKET peer, deliberately ahead of req.ip. Express rewrites req.ip from
  // X-Forwarded-For once `trust proxy` is enabled — so reading req.ip first
  // would let the very header we are gating decide whether to trust itself. The
  // socket address cannot be forged by a client.
  const ip = RemoteAccessConfig.normalizeIp(req?.socket?.remoteAddress || req?.ip || '');
  if (!ip) return false;
  const loopback = ip === '::1' || ip.startsWith('127.');
  if (setting === 'private') return loopback || isPrivateIpv4(ip);
  return loopback; // default
}

/** Did this connection arrive over TLS at *this* process? */
function directlyEncrypted(req) {
  return Boolean(req?.socket?.encrypted || req?.connection?.encrypted);
}

/**
 * An operator-pinned public URL. Beats every heuristic because it is the only
 * source that can know about split-horizon DNS, a CNAME, or a tunnel.
 * @returns {string|null}
 */
export function configuredPublicOrigin() {
  const raw = (process.env.PUBLIC_ORIGIN || process.env.AGNT_PUBLIC_URL || '').trim() ||
    (RemoteAccessConfig.readConfig()?.publicOrigin || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.\-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return buildOrigin(u.protocol.slice(0, -1), u.hostname.replace(/^\[|\]$/g, ''), u.port || null);
  } catch {
    return null;
  }
}

/**
 * Every address another device could plausibly use to reach this server, best
 * first.
 *
 * @param {object} req  Express request (may be omitted for a bare NIC scan)
 * @param {{ port?: number|string }} [opts]
 * @returns {Array<{ origin: string, source: string, label: string, external: boolean }>}
 */
export function candidateOrigins(req, opts = {}) {
  const port = Number(opts.port || process.env.PORT || 3333);
  const out = [];
  const seen = new Set();

  const push = (origin, source, label) => {
    if (!origin || seen.has(origin)) return;
    seen.add(origin);
    let hostname = '';
    try {
      hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return;
    }
    out.push({ origin, source, label, external: !isLoopbackHostname(hostname) });
  };

  // 1. Operator override.
  push(configuredPublicOrigin(), 'configured', 'Configured public address');

  const trusted = req ? isTrustedProxyPeer(req) : false;
  const headers = req?.headers || {};

  // 2. What the proxy says the client originally asked for.
  if (trusted) {
    const fwdHost = parseHostHeader(headers['x-forwarded-host']);
    if (fwdHost) {
      const fwdProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
      const proto = fwdProto === 'https' || fwdProto === 'http'
        ? fwdProto
        : directlyEncrypted(req) ? 'https' : 'http';
      const fwdPort = Number(String(headers['x-forwarded-port'] || '').split(',')[0].trim()) || fwdHost.port;
      push(buildOrigin(proto, fwdHost.hostname, fwdPort), 'forwarded', 'Via reverse proxy');
    }
  }

  // 3. The address this client actually typed. The single most reliable signal
  //    for "an address that works", because it demonstrably just did.
  const host = parseHostHeader(headers.host);
  if (host && !isLoopbackHostname(host.hostname)) {
    push(
      buildOrigin(directlyEncrypted(req) ? 'https' : 'http', host.hostname, host.port ?? port),
      'request',
      'The address you are using'
    );
  }

  // 4. NIC scan — right whenever the request came from this machine, which is
  //    exactly the case the three signals above cannot speak to.
  //
  //    Unlike them it is pure inference: sources 1-3 are EVIDENCE (a client just
  //    reached us there / a trusted proxy says so / an operator declared it),
  //    whereas an interface address is only reachable if the socket is bound to
  //    it. Listing a NIC while loopback-only would advertise an address the
  //    machine owns and nothing is listening on — precisely the dead QR this
  //    module exists to prevent. An unrecorded bind means we are not the server
  //    process (unit tests, imports), so leave that path as it was.
  const bind = RemoteAccessConfig.getActualBind();
  if (!bind || bind.lanEnabled) {
    for (const a of RemoteAccessConfig.lanAddresses()) {
      push(buildOrigin('http', a.address, port), 'interface', `This machine on ${a.iface}`);
    }
  }

  return out;
}

/**
 * Can a *different* device reach us at all, and where?
 *
 * Replaces the old `getActualBind().lanEnabled` test, which asked "am I bound
 * to a LAN interface?" — a question that has the wrong answer for every
 * reverse-proxied deployment, where binding to loopback is the correct and
 * recommended configuration.
 *
 * @returns {{ usable: boolean, origins: Array, best: string|null, reason: string|null }}
 */
export function evaluateReachability(req, opts = {}) {
  const origins = candidateOrigins(req, opts);
  const external = origins.filter((o) => o.external);
  const bind = RemoteAccessConfig.getActualBind();

  if (external.length) {
    return { usable: true, origins, best: external[0].origin, reason: null };
  }

  return {
    usable: false,
    origins,
    best: null,
    reason: bind && !bind.lanEnabled
      ? 'This server is only listening on localhost, and nothing else has reached it, so a phone cannot connect.'
      : 'No network address was found that another device could reach.',
  };
}

export default {
  candidateOrigins,
  evaluateReachability,
  configuredPublicOrigin,
  isTrustedProxyPeer,
  isLoopbackHostname,
  parseHostHeader,
  buildOrigin,
};
