/**
 * AGNT Flash, from chat's point of view: is this message an out-of-credits
 * notice, how many credits are left, and how to get more in one click.
 *
 * The backend tags a credit refusal with `<!-- agnt-notice:<code> -->` (see
 * backend agntServiceNotice.js). Chat renders the "keep going" card from that
 * code; the sentence above it is the gateway's own words.
 */
import { API_CONFIG } from '@/tt.config';

/** Prepaid amounts models.agnt.gg sells. Mirrors the backend's TOP_UP_AMOUNTS_CENTS. */
export const TOP_UP_OPTIONS = Object.freeze([
  { cents: 1000, label: '$10' },
  { cents: 2500, label: '$25' },
  { cents: 5000, label: '$50' },
]);

/** Share of included credits used before chat suggests topping up or upgrading. */
export const LOW_CREDIT_SHARE = 0.8;

const NOTICE = /\s*<!-- agnt-notice:([a-z_]{1,64}) -->\s*$/;

/** `{ code, text }` when `content` is an AGNT Flash credit notice, else null. */
export function parseAgntNotice(content) {
  if (typeof content !== 'string') return null;
  const match = NOTICE.exec(content);
  return match ? { code: match[1], text: content.slice(0, match.index) } : null;
}

/** The message text without its notice tag, for display. */
export function stripAgntNotice(content) {
  return typeof content === 'string' ? content.replace(NOTICE, '') : content;
}

/** 9_200_000 -> "9.2M", 450_000 -> "450k". */
export function formatCredits(credits) {
  const n = Math.max(0, Number(credits) || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

/** Used share of included credits, 0..1. Zero when nothing is included. */
export function usedShare(account) {
  if (!account?.includedCredits) return 0;
  return Math.min(1, Math.max(0, account.usedCredits / account.includedCredits));
}

/**
 * Has this account gained something to spend since `baseline`? True after a
 * top-up lands, a plan's credits appear, or a new month resets the allowance.
 */
export function hasMoreToSpend(account, baseline) {
  if (!account) return false;
  if (!baseline) return account.remainingCredits > 0 || account.balanceMicroUSD > 0;
  return account.remainingCredits > baseline.remainingCredits || account.balanceMicroUSD > baseline.balanceMicroUSD;
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status})`);
  return body;
}

export async function fetchFlashAccount() {
  return readJson(await fetch(`${API_CONFIG.BASE_URL}/agnt-services/models/account`, { headers: authHeaders(), cache: 'no-store' }));
}

export function openExternal(url) {
  if (window.electron?.openExternalUrl) window.electron.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** Opens Stripe checkout for prepaid credit in the browser. */
export async function startFlashTopUp(amountCents) {
  const { url } = await readJson(
    await fetch(`${API_CONFIG.BASE_URL}/agnt-services/models/top-up`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amountCents }) }),
  );
  openExternal(url);
}
