/**
 * Public OAuth client identifiers for the third-party CLIs AGNT signs in to.
 *
 * WHAT THESE ARE
 * --------------
 * Google's own installed-app OAuth client, published by Google with its CLI.
 *
 * They are NOT AGNT secrets and they are not ours. An installed/native
 * application cannot keep a secret — the binary ships to the user, so anyone
 * can extract whatever is inside it. RFC 8252 §8.5 says so explicitly, and
 * Google issues these clients on that understanding. The `client_secret` on a
 * native client is an application IDENTIFIER, not an access grant: possessing
 * it gets you nothing, because a user still has to complete a consent screen
 * and the resulting tokens belong to them.
 *
 * AGNT uses these exact values so that signing in through AGNT produces the
 * same OAuth client the real CLI would use. A different client fails outright:
 * Antigravity's extra scopes (cclog, experimentsandconfigs) are authorised only
 * for its own client, and Google validates redirect_uri against the client's
 * registered list.
 *
 * WHY THEY LIVE HERE AND NOT IN A .env
 * ------------------------------------
 * They never vary per install, per environment or per user, so they were never
 * configuration. Keeping them in a committed backend/.env forced that file to
 * exist — and that file was also carrying three REAL secrets (JWT_SECRET,
 * SESSION_SECRET, ENCRYPTION_KEY) into a public repository for 197 days.
 * Separating "public constant" from "secret" is what let the file be deleted.
 *
 * THESE MUST NEVER BE BLANK
 * -------------------------
 * They are not only used for fresh sign-in. Both refresh paths do:
 *
 *     const clientId = data.client_id || OAUTH_CONFIG.CLIENT_ID;
 *
 * and the credential file AGNT writes — ~/.antigravity/oauth_creds.json —
 * carries only tokens, no client_id (verified on a live install). So an empty constant here does not merely block new
 * connections: it sends an empty client_id to Google's token endpoint and
 * breaks the hourly refresh, signing out ALREADY-CONNECTED users within the
 * hour. Antigravity has no client_id fallback in its own credential file at
 * all, so this constant is the only source.
 *
 * (A session created by the REAL Antigravity CLI does live in the OS keychain.
 * AGNT can now READ that store — see services/auth/secretStore.js — but such a
 * credential is marked ownedByAgnt: false and is never refreshed here, so it
 * does not change this constant's role.)
 *
 * config/oauthClients.test.js is a ship gate that fails if the pair is empty
 * or malformed.
 *
 * If they ever need recovering, they are Google's published values, and in
 * this repository's history at `git show f346ff1:backend/.env`.
 *
 * NOTE ON SECRET SCANNERS: these values match GitHub's `GOCSPX-` pattern and
 * will be flagged wherever they live — .env, .js, anywhere. Google's own
 * repository is flagged for the same reason. The correct disposition is to
 * dismiss the alert as a false positive. Moving the values does not silence
 * it, and removing them breaks zero-config sign-in for every user.
 */

/* eslint-disable no-inline-comments */

/** Antigravity's installed-app client. */
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';

export const ANTIGRAVITY_OAUTH = Object.freeze({
  CLIENT_ID: process.env.ANTIGRAVITY_CLIENT_ID || ANTIGRAVITY_CLIENT_ID,
  CLIENT_SECRET: process.env.ANTIGRAVITY_CLIENT_SECRET || ANTIGRAVITY_CLIENT_SECRET,
});

/** True when a provider can actually complete an OAuth exchange or refresh. */
export function isOAuthClientConfigured(client) {
  return Boolean(client?.CLIENT_ID && client?.CLIENT_SECRET);
}
