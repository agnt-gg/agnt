/**
 * Public OAuth client identifiers for the third-party CLIs AGNT signs in to.
 *
 * WHAT THESE ARE
 * --------------
 * Google's own installed-app OAuth clients, published by Google in their own
 * open-source CLIs. The Gemini pair is verifiable directly:
 *
 *   https://github.com/google-gemini/gemini-cli
 *     packages/core/src/code_assist/oauth2.ts
 *     const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j…'
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
 * and the credential files AGNT writes — ~/.gemini/oauth_creds.json and
 * ~/.antigravity/oauth_creds.json — carry only tokens, no client_id (verified
 * on a live install). So an empty constant here does not merely block new
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
 * config/oauthClients.test.js is a ship gate that fails if either pair is
 * empty, malformed, or accidentally duplicated between the two providers.
 *
 * If they ever need recovering, they are Google's published values: the Gemini
 * pair is in google-gemini/gemini-cli (packages/core/src/code_assist/oauth2.ts)
 * and both pairs are in this repository's history at
 * `git show f346ff1:backend/.env`.
 *
 * NOTE ON SECRET SCANNERS: these values match GitHub's `GOCSPX-` pattern and
 * will be flagged wherever they live — .env, .js, anywhere. Google's own
 * repository is flagged for the same reason. The correct disposition is to
 * dismiss the alert as a false positive. Moving the values does not silence
 * it, and removing them breaks zero-config sign-in for every user.
 */

/* eslint-disable no-inline-comments */

/** Google's Gemini CLI installed-app client. */
const GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINI_CLI_CLIENT_SECRET = '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';

/**
 * Antigravity's installed-app client — DISTINCT from Gemini CLI's.
 * The Gemini client is not authorised for Antigravity's extra scopes and
 * returns HTTP 400 invalid_scope, so these cannot be collapsed into one.
 */
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';

export const GEMINI_CLI_OAUTH = Object.freeze({
  CLIENT_ID: process.env.GEMINI_CLI_CLIENT_ID || GEMINI_CLI_CLIENT_ID,
  CLIENT_SECRET: process.env.GEMINI_CLI_CLIENT_SECRET || GEMINI_CLI_CLIENT_SECRET,
});

export const ANTIGRAVITY_OAUTH = Object.freeze({
  CLIENT_ID: process.env.ANTIGRAVITY_CLIENT_ID || ANTIGRAVITY_CLIENT_ID,
  CLIENT_SECRET: process.env.ANTIGRAVITY_CLIENT_SECRET || ANTIGRAVITY_CLIENT_SECRET,
});

/** True when a provider can actually complete an OAuth exchange or refresh. */
export function isOAuthClientConfigured(client) {
  return Boolean(client?.CLIENT_ID && client?.CLIENT_SECRET);
}
