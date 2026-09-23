import { SHARED_JWT_SECRET, isPlaceholderSecret } from '../utils/legacySecrets.js';
import { resolveSecret } from '../utils/secretResolver.js';
import { AUTH_MODE_ENV, AUTH_MODE_VERIFY_REMOTE, isRemoteVerifyMode } from '../services/auth/authMode.js';

/**
 * Populate process.env.JWT_SECRET at boot — and refuse to boot on a published
 * placeholder.
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
 * WHICH VALUE FILLS A BLANK DEPENDS ON THE AUTH MODE
 * ---------------------------------------------------------------------------
 * A desktop install verifies locally and therefore needs the issuer's key —
 * the published SHARED_JWT_SECRET. Same as 0.6.5, byte for byte.
 *
 * A verify-remote install (every container, every hosted tenant) must NOT
 * hold that key: it sits on a network, and the key lets anyone who has it
 * mint a session. It gets a random, private, per-install secret instead, from
 * the same resolver that already generates ENCRYPTION_KEY, and the middleware
 * asks api.agnt.gg about each token. See services/auth/authMode.js.
 *
 * ---------------------------------------------------------------------------
 * A PLACEHOLDER IS NOT A SECRET, AND THE PROCESS DOES NOT START WITH ONE
 * ---------------------------------------------------------------------------
 * For eight months the compose file shipped `${JWT_SECRET:-CHANGE_ME_IN_PRODUCTION}`
 * and the process started with it. On a container bound to 0.0.0.0 that is a
 * bearer token anyone on the network can sign (GitHub issue #144), plus every
 * stored credential encrypted under a string in a public repository. "Fill
 * only a blank" cannot catch it, because a placeholder is not blank.
 *
 * So the three secrets are audited before anything else runs, and a known
 * placeholder is fatal: EX_CONFIG, with the fix in the message. An operator
 * removes the line and gets a generated value; the rows written under the old
 * one are lifted by the re-encryption migration (utils/legacySecrets.js).
 *
 * ---------------------------------------------------------------------------
 * AN OPERATOR'S OWN VALUE STILL WINS
 * ---------------------------------------------------------------------------
 * Any real value in the environment is left alone. Anyone running their own
 * auth issuer sets JWT_SECRET and this is a no-op — which is also the escape
 * hatch once `/users/sync-token` lands and the shared secret is deleted.
 */

/** The secrets an install must never run with a published value for. */
export const AUDITED_SECRETS = Object.freeze(['JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY']);

/** Exit status for a refused boot. EX_CONFIG, same as the tenant binding check. */
export const EX_CONFIG = 78;

/**
 * Is any audited secret set to a published placeholder?
 *
 * Pure: reads the env it is given, writes nothing, so the caller decides how
 * to die and the whole thing is unit-testable without spawning a process.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true } | { ok: false, name: string, reason: string }}
 */
export function auditSecretDefaults(env = process.env) {
  for (const name of AUDITED_SECRETS) {
    if (!isPlaceholderSecret(env[name])) continue;
    return {
      ok: false,
      name,
      reason:
        `${name} is set to a published placeholder. It shipped as a default in docker-compose.yml ` +
        `and the docs; anyone who has read them has it. Remove ${name} from your environment ` +
        `(compose file, .env, -e flag) and a private value will be generated and stored under ` +
        `USER_DATA_PATH/secrets, or set a real one.`,
    };
  }
  return { ok: true };
}

/**
 * Fill a blank JWT_SECRET with the value this install's auth mode needs.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function applySecretDefaults(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.trim() === '') {
    env.JWT_SECRET = isRemoteVerifyMode(env)
      ? // Private and persisted: a secret regenerated on every boot would
        // invalidate nothing (this install verifies remotely) but would also
        // never be usable for a locally minted token later.
        resolveSecret('JWT_SECRET', { bytes: 32, onPersistFailure: 'ephemeral' })
      : SHARED_JWT_SECRET;
  }
  return env;
}

/**
 * Explain the mode once at boot, so a container log shows which verification
 * path a session will take. No secret values are ever logged.
 */
function describeMode(env = process.env) {
  return isRemoteVerifyMode(env)
    ? `${AUTH_MODE_ENV}=${AUTH_MODE_VERIFY_REMOTE}: tokens are verified by the issuer; local JWT_SECRET is private to this install`
    : 'local: tokens are verified against JWT_SECRET';
}

// Side effect on import — see the import-order note in server.js.
const audit = auditSecretDefaults();
if (!audit.ok) {
  console.error(`[secrets] refusing to start: ${audit.reason}`);
  process.exit(EX_CONFIG);
}
applySecretDefaults();
console.log(`[secrets] auth mode ${describeMode()}`);
