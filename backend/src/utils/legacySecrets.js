/**
 * The published encryption key, and what to do about data encrypted with it.
 *
 * ---------------------------------------------------------------------------
 * BACKGROUND
 * ---------------------------------------------------------------------------
 * Every AGNT install up to and including 0.6.5 encrypted stored API keys and
 * OAuth tokens with a single ENCRYPTION_KEY that shipped inside the app and
 * was committed to a public repository. From 0.6.6 each install generates its
 * own key (see utils/secretResolver.js), which is what actually fixes the
 * problem — the published value stops protecting anything.
 *
 * But rows written by an older version are still encrypted with the old key,
 * so SOMETHING has to be able to read them once, in order to re-encrypt them.
 * That is the only purpose this module serves.
 *
 * ---------------------------------------------------------------------------
 * WHY A PUBLISHED SECRET IS DELIBERATELY WRITTEN INTO SOURCE HERE
 * ---------------------------------------------------------------------------
 * Because it adds no exposure and prevents real harm. Both halves are needed;
 * neither on its own would justify it.
 *
 * NO EXPOSURE ADDED. This value has been public since 2026-01-20 in
 * agnt-gg/agnt at backend/.env. It is in 64 forks, in every clone, in this
 * repository's own history at f346ff1:backend/.env, and was baked into every
 * shipped app.asar. Anyone who wants it has had it for months. Writing it into
 * a source file does not make it available to one additional person.
 *
 * REAL HARM PREVENTED. Without it the migration cannot read a single existing
 * row, so every user who ever saved a provider API key or connected an OAuth
 * integration loses it on upgrade — silently, because "nothing to migrate" and
 * "nothing readable" look identical from the outside.
 *
 * The asymmetry is not close, so the value lives here rather than behind a
 * setting nobody will find. An operator who wants the opposite trade can set
 * AGNT_LEGACY_ENCRYPTION_KEY to anything else; the environment still wins.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS KEY CAN AND CANNOT DO
 * ---------------------------------------------------------------------------
 * DECRYPT ONLY. encrypt() never touches it — see utils/encryption.js, where the
 * key is selected by a generation tag on the ciphertext rather than by trying
 * keys until one appears to work. Every value written from 0.6.6 onward
 * carries the per-install key's tag, so this key opens strictly less data with
 * each passing day, and nothing at all once a user has migrated.
 *
 * ---------------------------------------------------------------------------
 * IT IS TEMPORARY, AND THAT IS ENFORCED
 * ---------------------------------------------------------------------------
 * Once installs have migrated, this module and its call sites should be
 * deleted outright. Adoption is measurable from the app_version reported to
 * /license/validate.
 *
 * REMOVE BY 0.6.9 — and that is not a deadline anyone has to remember.
 * legacySecrets.test.js FAILS THE BUILD once package.json reaches 0.6.9 with
 * this key still present. A deadline written only in prose is a deadline
 * discovered years later by someone reading an old diff.
 */

/**
 * Decrypt-only key for data written by AGNT <= 0.6.5.
 *
 * An empty string means "no legacy fallback": decryption of old rows fails
 * cleanly and the migration skips them, rather than corrupting anything. Every
 * consumer must treat '' as absent — which is also the state this module is
 * deliberately left in when the key is removed in 0.6.9.
 *
 * @type {string}
 */
export const LEGACY_ENCRYPTION_KEY = process.env.AGNT_LEGACY_ENCRYPTION_KEY || '4f9a2c8d1e5b7f3a9c4d6e1f8a2b3c7d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';

/** @returns {boolean} whether old rows can be read at all. */
export function hasLegacyKey() {
  return typeof LEGACY_ENCRYPTION_KEY === 'string' && LEGACY_ENCRYPTION_KEY.length > 0;
}

/**
 * ---------------------------------------------------------------------------
 * THE SHARED JWT SECRET
 * ---------------------------------------------------------------------------
 * Same category as the key above, and it belongs in the same file for the same
 * reason: it is a published value that must keep working until the client no
 * longer needs it.
 *
 * WHAT IT IS FOR. This backend does not mint tokens — `jwt.sign` appears
 * nowhere outside tests. Every JWT it verifies was issued by api.agnt.gg,
 * signed with this value. Verification is only possible because the value
 * shipped to every install in the committed backend/.env.
 *
 * WHY REMOVING IT LOCKED EVERYONE OUT. Deleting that file left
 * `process.env.JWT_SECRET` undefined. `jwt.verify(token, undefined)` throws;
 * Middleware, AuthRoutes and authGuard each catch it and downgrade the caller
 * to unauthenticated. Every session on the machine is rejected — "Session
 * expired" in the browser, "backend rejected the session" on sign-in — with no
 * log line naming the cause. Restoring the value restores exactly the
 * behaviour of 0.6.5.
 *
 * WHY NOT A GENERATED PER-INSTALL SECRET. Because there is nothing local to
 * verify. A random key cannot validate a token signed by the cloud, so it
 * turns "rejects everyone" into "still rejects everyone", now with a keyfile
 * on disk suggesting otherwise.
 *
 * WHY NOT TRUST_REMOTE_AUTH. That flag makes the backend `jwt.decode` instead
 * of `jwt.verify` — it stops checking signatures at all. Today forging a
 * session against this machine requires the published secret; under that flag
 * it requires nothing but a base64 string. Loopback-only binding limits the
 * blast radius, but Phone Access exists precisely to remove that limit. It is
 * strictly weaker than what 0.6.5 shipped, and it is the code path scheduled
 * for deletion, so defaulting it on would cement the thing being removed.
 *
 * THE EXPOSURE IS UNCHANGED BY WRITING IT HERE. Public since 2026-01-20 in
 * agnt-gg/agnt, in 64 forks, in this repository's history at f346ff1, and
 * inside every shipped app.asar. Nobody gains access who did not already have
 * it.
 *
 * REMOVE BY 0.6.9, together with LEGACY_ENCRYPTION_KEY. The real fix is the
 * `/users/sync-token` exchange, after which the client mints and verifies its
 * own local session token and stops needing the cloud's signing key at all.
 * legacySecrets.test.js fails the build if this is still here at that version.
 *
 * @type {string}
 */
export const SHARED_JWT_SECRET = process.env.JWT_SECRET || '6g8UlgibzfngealexqkNPv1/H2ZG00cb4gp2/5JSNgs=';

/** @returns {boolean} whether cloud-issued tokens can be verified at all. */
export function hasSharedJwtSecret() {
  return typeof SHARED_JWT_SECRET === 'string' && SHARED_JWT_SECRET.length > 0;
}
