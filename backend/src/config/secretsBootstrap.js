import { SHARED_JWT_SECRET } from '../utils/legacySecrets.js';

/**
 * Populate process.env.JWT_SECRET at boot.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Five places read `process.env.JWT_SECRET` directly:
 *
 *   routes/Middleware.js     jwt.verify on every authenticated request
 *   routes/AuthRoutes.js     soft user-id extraction
 *   utils/authGuard.js       requireAuth
 *   utils/socketIdentity.js  websocket handshake
 *   plugins/dev/discord-plugin/annie-orchestrator-bridge.js
 *
 * Until 0.6.6 the committed backend/.env supplied that variable. Removing the
 * file left it undefined, `jwt.verify(token, undefined)` threw, every caller
 * caught the throw and downgraded to unauthenticated, and every session on the
 * machine was rejected. See utils/legacySecrets.js for the full account.
 *
 * ---------------------------------------------------------------------------
 * WHY POPULATE THE ENV RATHER THAN REWRITE THE FIVE CALL SITES
 * ---------------------------------------------------------------------------
 * The fifth one is a plugin. Plugins run in a sandbox that forwards
 * `process.env` and cannot import backend modules, so the env var has to exist
 * regardless — which makes rewriting the other four pure churn that leaves two
 * mechanisms where one would do.
 *
 * It is also the pattern this directory already uses: config/envDefaults.js
 * fills REMOTE_URL and the frontend origins the same way, immediately after
 * dotenv, for the same reason.
 *
 * ---------------------------------------------------------------------------
 * AN OPERATOR'S OWN VALUE ALWAYS WINS
 * ---------------------------------------------------------------------------
 * Only fills a blank. Anyone running their own auth issuer sets JWT_SECRET in
 * the environment and this is a no-op — which is also the escape hatch once
 * `/users/sync-token` lands and the shared secret is deleted.
 */
export function applySecretDefaults(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.trim() === '') {
    env.JWT_SECRET = SHARED_JWT_SECRET;
  }
  return env;
}

// Side effect on import — see the import-order note in server.js.
applySecretDefaults();
