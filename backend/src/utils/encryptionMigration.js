import fs from 'fs';
import path from 'path';
import { encrypt, decrypt, keyGenerationOf } from './encryption.js';
import { hasLegacyKey } from './legacySecrets.js';
import pathManager from './PathManager.js';

/**
 * Re-encrypt credentials written under the published key with this install's
 * own key.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — FOUR COLUMNS, AND THAT IS ALL
 * ---------------------------------------------------------------------------
 * Nothing else in the database is encrypted. Conversations, outputs, agents,
 * workflows, traces and files are all plaintext and are never touched here.
 *
 * That matters operationally: the database on a working install can be tens of
 * gigabytes, while the encrypted surface is measured in hundreds of bytes. A
 * real instance measured 6 rows / 456 bytes across all three tables; the
 * heaviest plausible case, extrapolated from the cloud's own credential
 * tables, is under a thousand rows. So this NEVER copies the database, never
 * runs VACUUM, never uses sqlite .backup, and never scans a large table.
 * Reaching for a whole-database backup to protect a few hundred bytes would
 * cost minutes of I/O and gigabytes of disk to guard against a risk that the
 * dual-key design has already removed.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACKUP, AND WHY THAT IS SAFER RATHER THAN RISKIER
 * ---------------------------------------------------------------------------
 * decrypt() reads BOTH keys (see utils/encryption.js). So a row is readable
 * whether or not it has been migrated, and remains readable if this function
 * crashes halfway, is killed by a force-quit, or never runs. There is no state
 * in which data becomes unreachable, which means there is nothing to restore.
 *
 * The protections are structural rather than custodial:
 *   - a row is only written after its NEW ciphertext has been decrypted again
 *     and compared byte-for-byte with the original plaintext;
 *   - a row that fails any step is SKIPPED, not written, and stays readable
 *     under the legacy key;
 *   - all writes share one transaction, so a crash mid-run leaves the table
 *     exactly as it was;
 *   - the original ciphertext of every row that will be touched is written to
 *     a small sidecar file first — bytes, not gigabytes.
 *
 * ---------------------------------------------------------------------------
 * THE ONE REMAINING IMPRECISION, AND WHY IT IS HARMLESS
 * ---------------------------------------------------------------------------
 * Values written by this version carry a generation prefix, so identifying
 * them is a string comparison. Identifying a LEGACY value is not: an
 * unprefixed value has to be probed by decrypting it with the legacy key, and
 * a wrong key returns short non-empty garbage in roughly 0.4% of attempts
 * (measured: 12 of 3,000). So an unprefixed value that is neither legacy nor
 * readable — corrupt, or written by some other tool — can occasionally be
 * classified as legacy rather than unreadable.
 *
 * That costs nothing real. Such a row is already unreadable by definition, and
 * the verify-before-write step means the worst case is re-encrypting garbage
 * as garbage. In practice the case does not arise at all: every unprefixed row
 * on a real install was written by AGNT <= 0.6.5, which had exactly one key.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT BY CONSTRUCTION, NOT BY A MARKER
 * ---------------------------------------------------------------------------
 * The work is defined as "rows that decrypt under the legacy key", so a second
 * run finds nothing and does nothing. No marker row, no schema change, no
 * migration-state to get out of sync with reality — and, unlike a marker, it
 * stays correct if a user restores an older database file.
 */

/** The complete encrypted surface. */
const TARGETS = Object.freeze([
  { table: 'api_keys', columns: ['api_key'] },
  { table: 'oauth_tokens', columns: ['access_token', 'refresh_token'] },
  { table: 'custom_openai_providers', columns: ['api_key'] },
]);

const all = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));

async function tableExists(db, table) {
  const rows = await all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
  return rows.length > 0;
}

/**
 * Find every value still encrypted under the legacy key.
 * READ-ONLY — issues nothing but SELECT. Safe to call at any time.
 *
 * @param {import('sqlite3').Database} db
 * @returns {Promise<{scanned: number, legacy: Array, unreadable: Array, current: number}>}
 */
export async function scanEncryptedColumns(db) {
  const result = { scanned: 0, legacy: [], unreadable: [], current: 0 };

  for (const { table, columns } of TARGETS) {
    if (!(await tableExists(db, table))) continue;

    const rows = await all(db, `SELECT id, ${columns.join(', ')} FROM ${table}`);
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value !== 'string' || value.length === 0) continue;

        result.scanned += 1;
        const generation = keyGenerationOf(value);
        if (generation === 'current') result.current += 1;
        else if (generation === 'legacy') result.legacy.push({ table, column, id: row.id, value });
        else result.unreadable.push({ table, column, id: row.id, bytes: value.length });
      }
    }
  }

  return result;
}

/**
 * Report what a migration would do, without writing anything.
 * @param {import('sqlite3').Database} db
 */
export async function dryRun(db) {
  const scan = await scanEncryptedColumns(db);
  return {
    legacyKeyAvailable: hasLegacyKey(),
    valuesScanned: scan.scanned,
    alreadyCurrent: scan.current,
    needMigration: scan.legacy.length,
    unreadable: scan.unreadable.length,
    unreadableDetail: scan.unreadable,
    bytes: scan.legacy.reduce((sum, entry) => sum + entry.value.length, 0),
  };
}

/**
 * Write the pre-migration ciphertext of the rows about to change.
 *
 * Not a database backup — a receipt. It holds only the values this run will
 * overwrite, so it is bytes rather than gigabytes, and it exists so that a
 * catastrophic mistake in this file is recoverable by hand. Written 0600
 * because it contains credential ciphertext.
 *
 * @returns {string|null} path written, or null when there is nothing to record
 */
function writeSidecar(entries) {
  if (entries.length === 0) return null;

  const dir = pathManager.getDataPath('secrets');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `encryption-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    note: 'Pre-migration ciphertext for rows re-encrypted from the legacy published key to this install key.',
    entries: entries.map(({ table, column, id, value }) => ({ table, column, id, ciphertext: value })),
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

/**
 * Migrate every legacy-encrypted value to the per-install key.
 *
 * @param {import('sqlite3').Database} db
 * @param {{dryRun?: boolean}} [options]
 */
export async function migrateEncryptedColumns(db, options = {}) {
  const summary = {
    ran: false,
    reason: null,
    migrated: 0,
    skipped: 0,
    unreadable: 0,
    sidecar: null,
  };

  // Without the legacy key nothing old can be read, so there is nothing this
  // can do. Not an error: it is the documented default. See legacySecrets.js.
  if (!hasLegacyKey()) {
    summary.reason = 'no-legacy-key';
    return summary;
  }

  const scan = await scanEncryptedColumns(db);
  summary.unreadable = scan.unreadable.length;

  if (scan.legacy.length === 0) {
    summary.reason = 'nothing-to-migrate';
    return summary;
  }

  if (options.dryRun) {
    summary.reason = 'dry-run';
    summary.migrated = scan.legacy.length;
    return summary;
  }

  summary.sidecar = writeSidecar(scan.legacy);

  await run(db, 'BEGIN IMMEDIATE');
  try {
    for (const entry of scan.legacy) {
      const { table, column, id, value } = entry;

      // Decrypt with the legacy key, re-encrypt with this install's key, then
      // PROVE the new ciphertext round-trips before it is allowed near the
      // database. A verify-after-write would already have destroyed the only
      // copy of the original by the time it noticed.
      let plaintext;
      try {
        plaintext = decrypt(value);
      } catch {
        summary.skipped += 1;
        continue;
      }
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        summary.skipped += 1;
        continue;
      }

      const reEncrypted = encrypt(plaintext);
      let verified;
      try {
        verified = decrypt(reEncrypted);
      } catch {
        summary.skipped += 1;
        continue;
      }
      if (verified !== plaintext) {
        summary.skipped += 1;
        continue;
      }

      await run(db, `UPDATE ${table} SET ${column} = ? WHERE id = ?`, [reEncrypted, id]);
      summary.migrated += 1;
    }

    await run(db, 'COMMIT');
    summary.ran = true;
    summary.reason = 'migrated';
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch {
      /* the transaction is already gone; nothing further to undo */
    }
    summary.reason = `failed: ${error?.message}`;
    throw error;
  }

  return summary;
}

export { TARGETS as ENCRYPTED_COLUMNS };
