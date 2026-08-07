/**
 * Configuration defaults, applied once at startup.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * A committed `backend/.env` used to supply these. That file also carried three
 * real secrets into a public repository, which is why it is gone — see
 * utils/secretResolver.js for where secrets live now.
 *
 * But a handful of its keys were genuine configuration with fixed, sensible
 * values that never varied per install, and ten call sites read them straight
 * off `process.env`. Editing ten call sites invites missing the eleventh, and
 * the next one someone adds. So the defaults are filled in exactly the way
 * dotenv fills them: populate `process.env`, once, before anything reads it.
 *
 * A real environment variable ALWAYS wins. This only fills blanks, so Docker
 * `-e`, CI, and a user's own shell keep working unchanged.
 *
 * ---------------------------------------------------------------------------
 * IMPORT ORDER IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 * This must be imported as a side effect immediately after 'dotenv/config' in
 * server.js. `AuthManager` (`export default new AuthManager()`) and
 * `Middleware` (`const middleware = new Middleware()`) both instantiate at
 * IMPORT time and capture these values in their constructors. ES module
 * imports all execute before any statement in the importing file, so applying
 * the defaults from a statement in server.js would run too late — the
 * constructors would already have read `undefined`.
 */

/**
 * Values that used to live in the committed .env and are not secrets.
 *
 * REMOTE_URL — the AGNT cloud. Read by AuthManager, WebhookModel, the email
 *   and web-search tools, EmailReceiver and WebhookReceiver.
 * FRONTEND_DEV_URL / FRONTEND_DIST_URL — Vite's dev and preview origins, used
 *   only to seed the CORS allowlist in server.js. The list already hardcodes
 *   the 127.0.0.1 forms; these supply the `localhost` forms.
 */
const ENV_DEFAULTS = Object.freeze({
  REMOTE_URL: 'https://api.agnt.gg',
  FRONTEND_DEV_URL: 'http://localhost:5173',
  FRONTEND_DIST_URL: 'http://localhost:4173',
});

/**
 * Fill any default that is unset or empty. Idempotent.
 *
 * Treats '' as unset: an empty value in a .env or a Docker `-e FOO=` is a
 * blank, not a deliberate choice, and `${''}/webhook/x` would silently build a
 * relative URL that fails far from the cause.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {Record<string, string|undefined>} the same object, mutated
 */
export function applyEnvDefaults(env = process.env) {
  for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
    if (env[key] === undefined || env[key] === '') env[key] = value;
  }
  return env;
}

export { ENV_DEFAULTS };

// Side effect on import — see IMPORT ORDER above.
applyEnvDefaults();
