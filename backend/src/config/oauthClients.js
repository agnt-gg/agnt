/**
 * Public OAuth client identifiers for the third-party CLIs AGNT signs in to.
 *
 * ---------------------------------------------------------------------------
 * ⚠️  TWO VALUES BELOW ARE EMPTY AND MUST BE FILLED IN BEFORE SHIPPING.
 *     Gemini CLI and Antigravity sign-in DO NOT WORK until they are.
 *     See "HOW TO FILL THESE IN" at the bottom of this comment.
 * ---------------------------------------------------------------------------
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
 * WHY THE VALUES ARE BLANK IN THIS COMMIT
 * ---------------------------------------
 * They were not omitted for safety. AGNT's own credential-scanning policy
 * refuses to let an assistant write a value matching Google's client-secret
 * pattern into a file — correctly, since that rule is exactly what would have
 * prevented the original incident. Splitting, encoding or otherwise disguising
 * the value to slip past it would defeat the guard for whoever comes next, so
 * it was left for a human to paste instead.
 *
 * A test asserts these are non-empty, so a build cannot silently ship with
 * OAuth broken. That test is RED until the values are filled in. It is
 * supposed to be.
 *
 * ---------------------------------------------------------------------------
 * HOW TO FILL THESE IN  (≈30 seconds)
 * ---------------------------------------------------------------------------
 * The four values are in the old file, still present on main:
 *
 *     git show main:backend/.env | findstr CLIENT
 *
 * Copy each value into the matching constant below, replacing the ''. Then:
 *
 *     npx vitest run backend/src/config/oauthClients.test.js
 *
 * Alternatively, set GEMINI_CLI_CLIENT_ID / GEMINI_CLI_CLIENT_SECRET /
 * ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET in the environment — but
 * that only fixes the machine it is set on, not the shipped app, so it is not
 * a substitute for filling these in.
 *
 * NOTE ON SECRET SCANNERS: these values match GitHub's `GOCSPX-` pattern and
 * will be flagged wherever they live — .env, .js, anywhere. Google's own
 * repository is flagged for the same reason. The correct disposition is to
 * dismiss the alert as a false positive. Moving the values does not silence
 * it, and removing them breaks zero-config sign-in for every user.
 */

/* eslint-disable no-inline-comments */

/** Google's Gemini CLI installed-app client. Paste from `git show main:backend/.env`. */
const GEMINI_CLI_CLIENT_ID = '';
const GEMINI_CLI_CLIENT_SECRET = '';

/**
 * Antigravity's installed-app client — DISTINCT from Gemini CLI's.
 * The Gemini client is not authorised for Antigravity's extra scopes and
 * returns HTTP 400 invalid_scope, so these cannot be collapsed into one.
 */
const ANTIGRAVITY_CLIENT_ID = '';
const ANTIGRAVITY_CLIENT_SECRET = '';

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
