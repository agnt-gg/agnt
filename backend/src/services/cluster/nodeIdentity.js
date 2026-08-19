import os from 'os';
import { resolveSecret } from '../../utils/secretResolver.js';

/**
 * Which node this process is, and what it is allowed to do.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * AGNT has exactly one notion of "who" today, and it is the USER. That is the
 * right and only answer while one process does all the work. The moment a
 * second process can pick up the same goal's tasks, two questions separate
 * that had always shared an answer:
 *
 *   who is this work FOR   -> the user id, unchanged, already everywhere
 *   who is DOING the work  -> this module
 *
 * Without the second, a claim cannot be attributed, a lease cannot be renewed
 * by its owner (and only its owner), and spend cannot be broken down by where
 * it was actually spent. Every one of those is a `WHERE claimed_by = ?`, and
 * none of them can be expressed in terms of the user.
 *
 * ---------------------------------------------------------------------------
 * WHY resolveSecret AND NOT A NEW FILE FORMAT
 * ---------------------------------------------------------------------------
 * A node id needs exactly the cascade secretResolver already implements, and
 * getting that cascade right is the whole difficulty:
 *
 *   1. process.env  — an operator naming a node explicitly (Docker `-e`,
 *                     systemd). Always wins.
 *   2. keyfile      — <dataDir>/secrets/NODE_ID, so the id survives restarts.
 *   3. generate     — CSPRNG on first boot, persisted with the `wx` exclusive
 *                     -create flag.
 *
 * That third step is the one worth borrowing rather than rewriting. Two
 * processes booting concurrently against the same data directory — the HTTP
 * server and the forked workflow process do exactly this — would otherwise
 * each generate an id, each write it, and each return the value it generated
 * while only one survived on disk. `wx` makes that race impossible to lose
 * silently: exactly one creator wins and every other caller adopts the
 * winner's value. Re-deriving that from scratch would be a second, less
 * tested implementation of a solved problem.
 *
 * A node id is not secret. It is borrowed for the persistence semantics, not
 * for confidentiality, and nothing here should be read as a claim otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHY 'ephemeral' AND NOT THE DEFAULT 'throw'
 * ---------------------------------------------------------------------------
 * resolveSecret defaults to refusing to continue when a value cannot be
 * persisted, and for ENCRYPTION_KEY that is correct: a key that changes on
 * restart silently orphans every row encrypted with it.
 *
 * A node id has no such property. Nothing is encrypted with it and nothing is
 * permanently lost if it changes. The worst case of a regenerated id is that
 * a node's outstanding claims are no longer renewable BY THAT NODE — and the
 * lease already handles precisely that case, because it is the same state a
 * crashed node leaves behind: the lease expires and the task returns to
 * `pending` for anyone to take.
 *
 * So the trade is "a read-only volume means some tasks are retried" against
 * "a read-only volume means AGNT refuses to boot at all". Refusing to boot is
 * far worse than the harm it prevents, and this is a single-node install's
 * boot path too — it must not acquire a new way to fail.
 */

/** The two things a node can be. Frozen so a typo is a TypeError, not a role. */
export const NODE_ROLES = Object.freeze({
  PRIMARY: 'primary',
  WORKER: 'worker',
});

/** Env var naming, kept in one place so the docs and the code cannot drift. */
export const NODE_ROLE_ENV = 'AGNT_NODE_ROLE';
export const NODE_LABEL_ENV = 'AGNT_NODE_LABEL';

/**
 * An unrecognised role is reported once per process, not once per call.
 *
 * getNodeRole() is called on every claim attempt. A warning inside that path
 * without a latch is a log flood that buries the thing it is trying to say.
 */
let warnedAboutRole = false;

/**
 * This node's stable identifier.
 *
 * 16 bytes rather than the resolver's 32-byte default: this is a collision
 * -resistant name that appears in log lines and `claimed_by`, not key
 * material. 128 bits of CSPRNG entropy makes a collision across any realistic
 * fleet impossible while keeping the value short enough to read.
 *
 * @returns {string} 32 lowercase hex characters, or the operator's NODE_ID
 */
export function getNodeId() {
  return resolveSecret('NODE_ID', { bytes: 16, onPersistFailure: 'ephemeral' });
}

/**
 * What this node is allowed to do.
 *
 * DEFAULTS TO PRIMARY, AND EVERY UNRECOGNISED VALUE ALSO RESOLVES TO PRIMARY.
 *
 * That second half is the load-bearing one. `worker` is the role that starts
 * a poll loop and reaches out to another machine; `primary` is what every
 * install in the field already is. A typo, a half-written compose file, or an
 * empty string must therefore land on the existing behaviour rather than
 * quietly enabling a new one. The unsafe direction is the one that requires
 * an exact, deliberate spelling.
 *
 * @returns {'primary'|'worker'}
 */
export function getNodeRole() {
  const raw = String(process.env[NODE_ROLE_ENV] ?? '').trim().toLowerCase();

  if (raw === NODE_ROLES.WORKER) return NODE_ROLES.WORKER;
  if (raw === NODE_ROLES.PRIMARY || raw === '') return NODE_ROLES.PRIMARY;

  if (!warnedAboutRole) {
    warnedAboutRole = true;
    console.warn(
      `[cluster] ${NODE_ROLE_ENV}='${raw}' is not a role. Falling back to ` +
        `'${NODE_ROLES.PRIMARY}'. Valid values: ${Object.values(NODE_ROLES).join(', ')}.`
    );
  }
  return NODE_ROLES.PRIMARY;
}

/**
 * A human-readable name for this node. Never used for identity or matching —
 * it exists so a fleet listing says "hetzner-fsn1" instead of 32 hex digits.
 *
 * @returns {string}
 */
export function getNodeLabel() {
  const configured = String(process.env[NODE_LABEL_ENV] ?? '').trim();
  if (configured) return configured;
  try {
    return os.hostname() || 'unnamed-node';
  } catch {
    // os.hostname() can throw in a stripped container. A label is cosmetic;
    // it must never be the reason a node fails to start.
    return 'unnamed-node';
  }
}

/** True when this process should pull work from another node. */
export function isWorker() {
  return getNodeRole() === NODE_ROLES.WORKER;
}

/** True when this process owns the database and serves the cluster API. */
export function isPrimary() {
  return getNodeRole() === NODE_ROLES.PRIMARY;
}

/**
 * One object for logs, diagnostics and the fleet endpoint.
 * @returns {{ nodeId: string, role: string, label: string }}
 */
export function describeNode() {
  return { nodeId: getNodeId(), role: getNodeRole(), label: getNodeLabel() };
}

/** Test seam: drop the once-per-process warning latch. */
export function __resetRoleWarningForTests() {
  warnedAboutRole = false;
}
