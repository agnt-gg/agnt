/**
 * Client for Text Annie (Settings -> Phone Access): `/api/agnt-services/mobile/*`,
 * which proxies mobile.agnt.gg with this install's own session.
 */
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

const auth = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const base = () => `${API_CONFIG.BASE_URL}/agnt-services/mobile`;

export async function getStatus() {
  return (await axios.get(`${base()}/status`, { headers: auth() })).data;
}
export async function addPhone(number, route) {
  return (await axios.post(`${base()}/phones`, { number, route }, { headers: auth() })).data;
}
export async function newCode(phoneId) {
  return (await axios.post(`${base()}/phones/${encodeURIComponent(phoneId)}/code`, {}, { headers: auth() })).data;
}
export async function setRoute(phoneId, route) {
  return (await axios.put(`${base()}/phones/${encodeURIComponent(phoneId)}`, { route }, { headers: auth() })).data;
}
export async function removePhone(phoneId) {
  return (await axios.delete(`${base()}/phones/${encodeURIComponent(phoneId)}`, { headers: auth() })).data;
}

/**
 * What the linking QR code encodes: the standard SMS form, `SMSTO:<line>:<code>`.
 * iPhone and Android cameras recognise it natively and open Messages with the
 * code typed in. A web link that redirects into Messages does not survive the
 * camera on iOS, and Android drops its `&body=`; it is also ~3x longer, which
 * makes a denser code that a camera struggles to read off a laptop screen.
 * Null when the line is unknown (the number and code are still on screen).
 */
export function linkQrPayload(line, code) {
  if (!/^\+[1-9]\d{6,14}$/.test(line || '') || !/^AGNT-[A-Z2-9]{6}$/.test(code || '')) return null;
  return `SMSTO:${line}:${code}`;
}

/**
 * The link code a phone was given, kept for as long as that code is valid.
 * The service only ever stores a hash, so leaving Settings used to lose the
 * code, and the only way back was asking for a new one, which kills the code
 * the person may already have texted. Session storage: it survives navigation
 * and reloads, not a restart, and every entry dies with its code.
 */
const LINK_CODES_KEY = 'agnt.textAnnie.linkCodes';
const LINK_CODE = /^AGNT-[A-Z2-9]{6}$/;

function liveCodes(entries, now) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  return Object.fromEntries(Object.entries(entries).filter(([, entry]) =>
    LINK_CODE.test(entry?.code || '') && Number.isFinite(entry?.expiresAt) && entry.expiresAt > now));
}

export function loadLinkCodes(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    return liveCodes(JSON.parse(storage?.getItem(LINK_CODES_KEY) || '{}'), now);
  } catch {
    return {}; // corrupt or unavailable storage: no remembered codes, never a crash
  }
}

export function saveLinkCodes(codes, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    storage?.setItem(LINK_CODES_KEY, JSON.stringify(liveCodes(codes, now)));
  } catch {
    /* storage full or blocked: the code is still on screen for this visit */
  }
}

/**
 * The remembered code for a pending phone, only while it is still THE code:
 * same issue (the service reports when the current code expires) and unexpired.
 * A code replaced elsewhere, e.g. on mobile.agnt.gg, is never shown.
 */
export function currentLinkCode(codes, phone, now = Date.now()) {
  const entry = codes?.[phone?.id];
  if (phone?.state !== 'pending' || !entry || !LINK_CODE.test(entry.code || '')) return null;
  if (entry.expiresAt !== phone.codeExpiresAt || entry.expiresAt <= now) return null;
  return entry.code;
}

/** One sentence for any failure: the service's own message when it gave one. */
export function explain(error) {
  const data = error?.response?.data;
  if (data?.message) return data.message;
  if (data?.reason === 'hosting_required') return 'Texting needs AGNT Mobile: included with paid AGNT plans, or $5/month at mobile.agnt.gg.';
  if (typeof data?.error === 'string' && !/^[a-z_]+$/.test(data.error)) return data.error;
  if (error?.response?.status === 401) return 'Sign in to AGNT to text Annie.';
  if (!error?.response) return 'Could not reach AGNT. Check your connection and try again.';
  return (data?.reason || data?.error || 'Something went wrong').replaceAll('_', ' ');
}
