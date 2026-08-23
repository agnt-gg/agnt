/**
 * Turning `POST {REMOTE_URL}/auth/callback` failures into something a person
 * can act on.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * That endpoint used to answer every failure with `error.message` verbatim, so
 * the only honest thing a client could do was print it. A user who typed
 * nothing wrong and did nothing unusual could be shown:
 *
 *   SQLITE_CONSTRAINT: NOT NULL constraint failed: oauth_tokens.user_id
 *
 * The server now answers with a stable `reason` discriminator and a generic
 * message (agnt-server commit 9819bb6), which means the client can finally say
 * what happened and — the part that actually matters — what to do next.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 * `reason` is the field to switch on; the HTTP status is deliberately NOT.
 * Several reasons share a status (400 covers both `invalid_request` and
 * `invalid_state`) and the status alone cannot tell "your link expired" from
 * "you sent us nothing".
 *
 *   invalid_request   400  the request lacked a code
 *   invalid_state     400  state absent, malformed, expired, replayed, or
 *                          bound to a different session (CSRF nonce)
 *   provider_unknown  404  no such provider
 *   exchange_failed   502  the PROVIDER refused the authorization
 *   storage_failed    500  we could not persist the connection
 *
 * An unrecognised reason falls back to generic copy rather than surfacing a
 * raw string: a message nobody wrote is a message nobody checked.
 */

/**
 * User-facing copy per reason.
 *
 * Every entry ends in an instruction. "Something went wrong" leaves the user
 * with a dead window and no idea whether to wait, retry, or give up — and
 * `exchange_failed` in particular is nearly always fixed by simply trying
 * again, which is worth saying out loud.
 */
const REASON_COPY = {
  invalid_request: 'That connection request was incomplete. Start the connection again from Settings.',
  invalid_state: 'That connection link has expired or was already used. Start the connection again from Settings.',
  provider_unknown: 'We do not recognise that provider. It may have been renamed or removed.',
  exchange_failed: 'declined the authorization. This is usually temporary — try connecting again.',
  storage_failed: 'We could not save the connection. Please try again in a moment.',
};

const FALLBACK = 'We could not complete the connection. Please try again from Settings.';

/**
 * @param {string|null|undefined} reason  the server's `reason` discriminator
 * @param {string|null|undefined} providerName  display name, when known
 * @returns {string} a sentence to show the user
 */
export function oauthCallbackMessage(reason, providerName) {
  // `exchange_failed` is the one case where naming the provider is genuinely
  // informative: the refusal came from THEM, not from us, and saying so stops
  // the user hunting for a fault in AGNT.
  if (reason === 'exchange_failed') {
    return `${providerName || 'The provider'} ${REASON_COPY.exchange_failed}`;
  }
  return REASON_COPY[reason] || FALLBACK;
}

/**
 * Build an Error carrying both the copy and the machine-readable reason.
 *
 * `.reason` is preserved on the error so callers that want to branch (retry
 * automatically on `storage_failed`, say) can do so without re-parsing prose.
 *
 * @param {object|null|undefined} body  the parsed JSON error body
 * @param {string|null|undefined} providerName
 * @param {number|null|undefined} status
 */
export function oauthCallbackError(body, providerName, status) {
  const reason = body?.reason || null;
  const error = new Error(oauthCallbackMessage(reason, providerName));
  error.reason = reason;
  error.status = status ?? null;
  return error;
}

export const __REASON_COPY_FOR_TESTS = REASON_COPY;
