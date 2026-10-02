/**
 * What the chat shows when models.agnt.gg refuses a request.
 *
 * The generic path renders every provider failure as
 *   "⚠️ **API Error:** 402 <message> … Please check your API configuration"
 * which is right for a broken key and wrong for AGNT Flash: its refusals are
 * account states (trial spent, credits used, spending off), not
 * misconfiguration, and there is no API configuration to check. The OpenAI SDK
 * also prefixes the HTTP status to `error.message`.
 *
 * The gateway sends a sentence written for the person in `error.error.message`
 * and a stable code in `error.code`, so the wording stays on the server and can
 * change without shipping the app. This module only frames it:
 *   - credit and spending states read as a plain notice, not an error;
 *   - anything else is labelled as AGNT Flash, without the key advice;
 *   - https links become markdown links, because chat does not autolink.
 *
 * Every other provider keeps the existing generic message (returns null).
 */

// Account states the person resolves by upgrading, funding or switching provider.
export const AGNT_NOTICE_CODES = Object.freeze(new Set([
  'trial_credit_exhausted',
  'spending_not_authorized',
  'insufficient_credit',
  'budget_exceeded',
]));

/**
 * The machine-readable half of a notice. Chat renders the "keep going" card
 * (upgrade / top up / bring your own) from this code, and the sentence above it
 * stays the server's own words. It rides inside the message as an HTML comment
 * so it survives persistence and reload without a second channel, and is
 * invisible wherever the markdown is shown as-is.
 */
export const agntNoticeMarker = (code) => `<!-- agnt-notice:${code} -->`;

const STATUS_PREFIX = /^\d{3}\s+/;
const HTTPS_URL = /https:\/\/[^\s<>()[\]"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function linkify(text) {
  return text.replace(HTTPS_URL, (url) => {
    const target = url.replace(TRAILING_PUNCTUATION, '');
    const trailing = url.slice(target.length);
    return `[${target.slice('https://'.length)}](${target})${trailing}`;
  });
}

/**
 * @param {unknown} error   error thrown by the OpenAI SDK (or a stream iterator)
 * @param {string|null} provider  the adapter's provider key
 * @returns {string|null} chat content to show, or null to use the generic message
 */
export function agntServiceNotice(error, provider) {
  if (provider !== 'agnt' || !error || typeof error !== 'object') return null;
  const body = error.error && typeof error.error === 'object' ? error.error : null;
  const code = typeof error.code === 'string' ? error.code : typeof body?.code === 'string' ? body.code : null;
  const sentence = typeof body?.message === 'string' && body.message.trim()
    ? body.message.trim()
    : String(error.message || '').replace(STATUS_PREFIX, '').trim();
  if (!sentence) return null;
  const text = linkify(sentence);
  return code && AGNT_NOTICE_CODES.has(code) ? `${text}\n\n${agntNoticeMarker(code)}` : `⚠️ **AGNT Flash:** ${text}`;
}
