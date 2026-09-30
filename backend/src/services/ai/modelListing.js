/**
 * modelListing.js — where a provider's model list came from, told truthfully.
 *
 * WHY THIS EXISTS
 * Every model-list failure used to degrade silently: an expired cache, the
 * last list saved to disk, or a hand-written array came back as HTTP 200 and
 * looked exactly like a fresh vendor answer. Verified 2026-09-30: xAI answered
 * 403 "used all available credits" and AGNT showed a 7.8-day-old Grok list as
 * current. A picker cannot tell the user something is wrong if the response
 * does not say so.
 *
 * So every listing carries its provenance:
 *   live       the vendor answered just now
 *   cache      served from memory within its TTL (a vendor answer, recently)
 *   persisted  the vendor failed; this is the last list it ever returned
 *   fallback   the vendor failed and never answered; hand-written list
 *   static     this provider has no listing endpoint by design
 */

export const LISTING_SOURCE = Object.freeze({
  LIVE: 'live',
  CACHE: 'cache',
  PERSISTED: 'persisted',
  FALLBACK: 'fallback',
  STATIC: 'static',
});

const MAX_ERROR_LENGTH = 300;

/**
 * Make an upstream error safe to show a user or write to a log.
 *
 * node-fetch network errors embed the full request URL ("request to <url>
 * failed"), and query-param providers (Gemini API keys) carry the key in that
 * URL. Vendor bodies sometimes echo a partial key. None of that may leave.
 */
export function redactUpstreamError(message, secret) {
  let text = String(message ?? '');
  if (typeof secret === 'string' && secret.length >= 6) text = text.split(secret).join('[redacted]');
  return text
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/\b(sk|pk|xai|gsk|csk|AIza)[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

/**
 * A listing record. `fetchedAt` is when the VENDOR produced this list (ms), not
 * when it was served, so a persisted list from last week says last week.
 */
export function listing(source, { fetchedAt = null, error = null } = {}) {
  return { source, fetchedAt: fetchedAt ?? null, error: error || null };
}

/**
 * Response fields for a model-list route. `stale` is true whenever the list is
 * not a current vendor answer, including a cache served because a refresh
 * failed — the one case where a list can be recent and still wrong.
 */
export function provenanceFields(record) {
  const source = record?.source || LISTING_SOURCE.FALLBACK;
  const stale = source === LISTING_SOURCE.PERSISTED
    || source === LISTING_SOURCE.FALLBACK
    || (source === LISTING_SOURCE.CACHE && Boolean(record?.error));
  return {
    source,
    stale,
    fetchedAt: record?.fetchedAt ? new Date(record.fetchedAt).toISOString() : null,
    upstreamError: record?.error || null,
  };
}
