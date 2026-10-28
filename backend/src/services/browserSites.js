/**
 * The sites the AGNT browser is signed in to — read and forget, for Settings.
 *
 * A login lives in the browser profile as cookies, so "which sites am I signed
 * in to" is "which sites does the profile hold cookies for". Cookies cannot say
 * which of them are a login, so the list is honest about what it is: sites with
 * saved cookies, logins among them. Signing out of a site removes its cookies.
 *
 * NEVER A VALUE. Cookie values are credentials. Only names of SITES, counts and
 * expiry leave this module; nothing here logs or returns a cookie's value.
 *
 * Read through CDP on the browser target (Storage.getCookies), so no tab is
 * opened for it — the profile's cookie database is locked by the running
 * browser and encrypted per install, so asking the browser is the only
 * correct reader.
 */

import { CdpConnection } from './cdpConnection.js';

const CONNECT_TIMEOUT_MS = 15000;
/**
 * Cookie calls get far longer than CdpConnection's default. MEASURED
 * (Chrome, headless, fresh profile, 2026-10-28): the FIRST Storage.* call after
 * launch waits for the cookie store to load from disk — getCookies timed out
 * at 5s and the next call took 4s; every call after that took ~1ms.
 */
const COOKIE_CALL_TIMEOUT_MS = 20000;

/** Second-level labels that are not a site on their own: example.co.uk is the site, not co.uk. */
const SHARED_SECOND_LEVEL = /^(co|com|net|org|gov|edu|ac|ltd|plc|ne|or|go|gob|nic|mil)$/;

/**
 * The site a cookie domain belongs to: its registrable domain, approximately.
 * A display grouping, not a security boundary — sign-out removes exactly the
 * cookies listed under the site, whatever this groups them as.
 */
export function siteOf(domain) {
  const host = String(domain || '').replace(/^\./, '').toLowerCase().trim();
  if (!host) return null;
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const country = labels[labels.length - 1].length === 2;
  const take = country && SHARED_SECOND_LEVEL.test(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * Group CDP cookies by site, values dropped.
 * @param {Array<{ domain: string, expires?: number, session?: boolean }>} cookies
 * @returns {Array<{ site: string, cookies: number, session: boolean, expires: string|null }>}
 */
export function groupCookiesBySite(cookies) {
  const sites = new Map();
  for (const cookie of cookies || []) {
    const site = siteOf(cookie?.domain);
    if (!site) continue;
    const entry = sites.get(site) || { site, cookies: 0, session: false, expiresAt: 0 };
    entry.cookies += 1;
    // CDP reports a session cookie as session:true / expires:-1.
    if (cookie.session || !(Number(cookie.expires) > 0)) entry.session = true;
    else entry.expiresAt = Math.max(entry.expiresAt, Number(cookie.expires) * 1000);
    sites.set(site, entry);
  }
  return [...sites.values()]
    .map(({ expiresAt, ...entry }) => ({ ...entry, expires: expiresAt ? new Date(expiresAt).toISOString() : null }))
    .sort((a, b) => a.site.localeCompare(b.site));
}

async function withBrowser(cdpUrl, work) {
  const connection = await new CdpConnection(cdpUrl).connect({ timeoutMs: CONNECT_TIMEOUT_MS });
  try {
    return await work(connection);
  } finally {
    connection.close();
  }
}

const cookieCall = (connection, method, params = {}) => connection.send(method, params, undefined, { timeoutMs: COOKIE_CALL_TIMEOUT_MS });

/** The sites the browser at `cdpUrl` holds cookies for. */
export function readSites(cdpUrl) {
  return withBrowser(cdpUrl, async (connection) => {
    const { cookies = [] } = await cookieCall(connection, 'Storage.getCookies');
    return groupCookiesBySite(cookies);
  });
}

/**
 * The CookieParam that deletes `cookie`: the same identity (name, path,
 * host-only vs domain, partition) with an expiry in the past. A host-only
 * cookie is addressed by URL — passing its domain would create a DOMAIN cookie
 * beside it rather than replace it.
 */
function expiryFor(cookie) {
  const scope = String(cookie.domain || '').startsWith('.')
    ? { domain: cookie.domain }
    : { url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path || '/'}` };
  return {
    name: cookie.name,
    value: '',
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    expires: 1,
    ...scope,
  };
}

/**
 * Sign the browser out of a site: remove every cookie listed under it, then
 * read back to report what is actually gone.
 * @returns {Promise<{ removed: number, remaining: number }>}
 */
export function forgetSite(cdpUrl, site) {
  return withBrowser(cdpUrl, async (connection) => {
    const { cookies = [] } = await cookieCall(connection, 'Storage.getCookies');
    const doomed = cookies.filter((cookie) => siteOf(cookie.domain) === site);
    if (doomed.length === 0) return { removed: 0, remaining: 0 };
    await cookieCall(connection, 'Storage.setCookies', { cookies: doomed.map(expiryFor) });
    const { cookies: after = [] } = await cookieCall(connection, 'Storage.getCookies');
    const remaining = after.filter((cookie) => siteOf(cookie.domain) === site).length;
    return { removed: doomed.length - remaining, remaining };
  });
}
