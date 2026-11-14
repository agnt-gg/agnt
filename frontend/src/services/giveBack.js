/**
 * What AGNT gives a new account, and three plain ways to give back.
 *
 * The gifts are granted by the servers: AGNT Flash credits once per computer
 * (models.agnt.gg) and an invited friend's 30 days of AGNT Pro (api.agnt.gg).
 * This module only describes them.
 *
 * Giving back is a follow on X, a star on GitHub and a shared invite. Follows
 * and stars are never rewarded or checked: both platforms forbid paying for
 * them, and an ask with nothing attached leaves the gift a gift. The invite is
 * the one thing that earns anything, and only from a friend's own payment
 * (services/referral).
 */
import { formatCredits, usedShare } from '@/services/agntFlash.js';

export const X_HANDLE = 'agnt_gg';
export const X_FOLLOW_URL = `https://x.com/intent/follow?screen_name=${X_HANDLE}`;
export const GITHUB_REPO = 'agnt-gg/agnt';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;

/** 24×24 paths for the give-back buttons. `stroke` icons are drawn as outlines. */
export const ICONS = Object.freeze({
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  github:
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  star: 'M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z',
  linkedin: 'M3 9h3.6v12H3zM4.8 2.8a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM10 9h3.4v1.7c.6-1 1.9-2 3.9-2 3.6 0 4.2 2.3 4.2 5.4V21h-3.6v-6.1c0-1.5 0-3.3-2-3.3s-2.3 1.6-2.3 3.2V21H10z',
  copy: 'M10.5 8.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5',
  gift: 'M4.5 8h15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM5 12v8.5h14V12M12 8v12.5M12 8S10.6 3.5 8 3.5C6.3 3.5 5.7 5.6 7 6.8 8.2 7.9 12 8 12 8zm0 0s1.4-4.5 4-4.5c1.7 0 2.3 2.1 1 3.3C15.8 7.9 12 8 12 8z',
  mail: 'M5.5 5.5h13A2.5 2.5 0 0 1 21 8v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V8a2.5 2.5 0 0 1 2.5-2.5zM3.8 7l8.2 6 8.2-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
});

// ── The gift ──────────────────────────────────────────────────────────────

/**
 * The free AGNT Flash credits this account still holds, or null. A computer
 * that already gave its trial to another account has none, so it is offered
 * nothing rather than told about a gift it does not have.
 */
export function flashGift(account) {
  if (!account?.trial || !(account.includedCredits > 0) || !(account.remainingCredits > 0)) return null;
  return { credits: account.includedCredits, headline: roundCredits(account.includedCredits) };
}

/** 1_000_000 -> "1M": formatCredits without a trailing ".0". */
export function roundCredits(credits) {
  return formatCredits(credits).replace(/\.0(?=[kMB]$)/, '');
}

/** How much of an allowance is spent, in words: "less than 1%", "about 18%" or "all". */
export function usedPhrase(account) {
  const share = usedShare(account);
  if (share >= 1) return 'all';
  if (share < 0.01) return 'less than 1%';
  return `about ${Math.min(99, Math.round(share * 100))}%`;
}

// ── Stars ─────────────────────────────────────────────────────────────────

const STARS_KEY = 'agnt:github-stars';
const STARS_TTL_MS = 6 * 60 * 60 * 1000;
let starsRequest = null;

function readStars(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STARS_KEY) || 'null');
    return Number.isSafeInteger(saved?.count) && saved.count >= 0 && Number.isFinite(saved?.at) ? saved : null;
  } catch {
    return null;
  }
}

async function requestStars(fetchImpl) {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${GITHUB_REPO}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const count = (await response.json())?.stargazers_count;
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  } catch (error) {
    console.warn('[giveBack] GitHub star count unavailable:', error?.message || error);
    return null;
  }
}

/**
 * The repository's star count, or null when GitHub cannot say (offline, rate
 * limited). Kept for six hours, so showing it costs one public request per
 * computer; a failed request falls back to the last count seen.
 */
export async function fetchStarCount({ fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now } = {}) {
  const cached = readStars(storage);
  if (cached && now() - cached.at < STARS_TTL_MS) return cached.count;
  if (!starsRequest) {
    starsRequest = requestStars(fetchImpl).finally(() => {
      starsRequest = null;
    });
  }
  const count = await starsRequest;
  if (count === null) return cached ? cached.count : null;
  try {
    storage?.setItem(STARS_KEY, JSON.stringify({ count, at: now() }));
  } catch {
    // Storage full or disabled: the count still shows, it is just asked for again.
  }
  return count;
}

/** 576 -> "576", 1_234 -> "1.2k", 12_345 -> "12k". Rounded down, so it never overstates. */
export function formatStarCount(count) {
  if (!Number.isSafeInteger(count) || count < 0) return '';
  if (count < 1000) return String(count);
  if (count < 10_000) return `${Math.floor(count / 100) / 10}k`;
  return `${Math.floor(count / 1000)}k`;
}

// ── The clipboard ─────────────────────────────────────────────────────────

/** Puts text on the clipboard. False when nothing would take it, so the caller can say so. */
export async function copyToClipboard(text, { clipboard = globalThis.navigator?.clipboard, doc = globalThis.document } = {}) {
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    // An unfocused window refuses the async clipboard: copy a selection instead.
    try {
      const field = doc.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      doc.body.appendChild(field);
      field.select();
      const copied = doc.execCommand('copy');
      field.remove();
      return copied === true;
    } catch {
      return false;
    }
  }
}
