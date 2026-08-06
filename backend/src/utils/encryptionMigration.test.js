import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import sqlite3 from 'sqlite3';

/**
 * Credential re-encryption, from the published key to a per-install key.
 *
 * WHY THE FIXTURE IS SYNTHETIC
 * ----------------------------
 * A real install's database is tens of gigabytes, and the encrypted surface
 * inside it was measured at 6 rows / 456 bytes. Testing against a copy of a
 * real database would mean duplicating 30 GB to exercise a few hundred bytes.
 * So this builds the three credential tables from scratch in :memory: — the
 * same schema, seeded with values encrypted under a stand-in legacy key.
 *
 * WHAT MATTERS MOST HERE
 * ----------------------
 * Not "did it migrate", but "is anything ever unreadable". The migration runs
 * against live credentials with no database backup, which is only defensible
 * because dual-key decrypt makes every intermediate state readable. The
 * interruption test is the one that proves that claim.
 */

const CURRENT_KEY = 'per-install-key-for-migration-tests';
const LEGACY_KEY = 'the-published-key-every-install-shared';
const ENV_KEYS = ['ENCRYPTION_KEY', 'AGNT_LEGACY_ENCRYPTION_KEY', 'USER_DATA_PATH'];

let saved;
let db;

const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

const asLegacy = (plaintext) => CryptoJS.AES.encrypt(plaintext, LEGACY_KEY).toString();

async function loadModules({ legacy = LEGACY_KEY } = {}) {
  vi.resetModules();
  process.env.ENCRYPTION_KEY = CURRENT_KEY;
  if (legacy === null) delete process.env.AGNT_LEGACY_ENCRYPTION_KEY;
  else process.env.AGNT_LEGACY_ENCRYPTION_KEY = legacy;
  return {
    migration: await import('./encryptionMigration.js'),
    encryption: await import('./encryption.js'),
  };
}

/** The real schema, reduced to the columns this migration touches. */
async function seed() {
  await run(`CREATE TABLE api_keys (id TEXT PRIMARY KEY, user_id TEXT, provider_id TEXT, api_key TEXT)`);
  await run(
    `CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, user_id TEXT, provider_id TEXT, access_token TEXT, refresh_token TEXT)`
  );
  await run(`CREATE TABLE custom_openai_providers (id TEXT PRIMARY KEY, user_id TEXT, api_key TEXT)`);

  await run(`INSERT INTO api_keys VALUES (?,?,?,?)`, ['k1', 'u1', 'openai', asLegacy('openai-stored-value')]);
  await run(`INSERT INTO api_keys VALUES (?,?,?,?)`, ['k2', 'u1', 'anthropic', asLegacy('anthropic-stored-value')]);
  await run(`INSERT INTO oauth_tokens VALUES (?,?,?,?,?)`, [
    't1',
    'u1',
    'google',
    asLegacy('access-value'),
    asLegacy('refresh-value'),
  ]);
  // A refresh_token is legitimately null for some providers.
  await run(`INSERT INTO oauth_tokens VALUES (?,?,?,?,?)`, ['t2', 'u1', 'slack', asLegacy('slack-access'), null]);
  await run(`INSERT INTO custom_openai_providers VALUES (?,?,?)`, ['c1', 'u1', asLegacy('custom-provider-value')]);
}

beforeEach(async () => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  db = new sqlite3.Database(':memory:');
  await seed();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => db.close(resolve));
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('dryRun', () => {
  it('reports the work without writing anything', async () => {
    const { migration } = await loadModules();

    const before = await all(`SELECT api_key FROM api_keys ORDER BY id`);
    const report = await migration.dryRun(db);
    const after = await all(`SELECT api_key FROM api_keys ORDER BY id`);

    expect(report.needMigration).toBe(6); // 2 api_keys + 3 oauth values + 1 custom
    expect(report.alreadyCurrent).toBe(0);
    expect(report.unreadable).toBe(0);
    expect(after).toEqual(before);
  });

  it('counts a value it cannot read separately from one needing migration', async () => {
    // A row encrypted under neither key must never be silently counted as work
    // to do, or the migration would look like it failed.
    const { migration, encryption } = await loadModules();

    // An unprefixed value is PROBED with the legacy key, and a wrong key
    // returns short non-empty garbage roughly 0.4% of the time — so one
    // hand-picked foreign ciphertext makes this test fail about once in 250
    // runs. Search for one that is genuinely unclassifiable instead. The search
    // is over a fixed corpus and terminates immediately in practice.
    let foreign = null;
    for (let i = 0; i < 50 && foreign === null; i += 1) {
      const candidate = CryptoJS.AES.encrypt(`x${i}`, `some-unrelated-key-${i}`).toString();
      if (encryption.keyGenerationOf(candidate) === null) foreign = candidate;
    }
    expect(foreign, 'could not construct an unclassifiable ciphertext').not.toBeNull();

    await run(`INSERT INTO api_keys VALUES (?,?,?,?)`, ['k3', 'u1', 'mystery', foreign]);

    const report = await migration.dryRun(db);
    expect(report.needMigration).toBe(6);
    expect(report.unreadable).toBe(1);
  });
});

describe('migrateEncryptedColumns', () => {
  it('re-encrypts every value and preserves the plaintext exactly', async () => {
    const { migration, encryption } = await loadModules();

    const summary = await migration.migrateEncryptedColumns(db);
    expect(summary.migrated).toBe(6);
    expect(summary.skipped).toBe(0);

    const keys = await all(`SELECT id, api_key FROM api_keys ORDER BY id`);
    expect(encryption.decrypt(keys[0].api_key)).toBe('openai-stored-value');
    expect(encryption.decrypt(keys[1].api_key)).toBe('anthropic-stored-value');

    const tokens = await all(`SELECT id, access_token, refresh_token FROM oauth_tokens ORDER BY id`);
    expect(encryption.decrypt(tokens[0].access_token)).toBe('access-value');
    expect(encryption.decrypt(tokens[0].refresh_token)).toBe('refresh-value');
    expect(encryption.decrypt(tokens[1].access_token)).toBe('slack-access');
    expect(tokens[1].refresh_token).toBeNull();

    const custom = await all(`SELECT api_key FROM custom_openai_providers`);
    expect(encryption.decrypt(custom[0].api_key)).toBe('custom-provider-value');
  });

  it('leaves every row under the CURRENT key afterwards', async () => {
    // The actual security outcome: the published key no longer opens anything.
    const { migration, encryption } = await loadModules();
    await migration.migrateEncryptedColumns(db);

    const rows = await all(`SELECT api_key AS v FROM api_keys UNION ALL SELECT access_token FROM oauth_tokens`);
    for (const row of rows) {
      expect(encryption.keyGenerationOf(row.v)).toBe('current');
    }
  });

  it('is idempotent — a second run finds nothing to do', async () => {
    const { migration } = await loadModules();

    expect((await migration.migrateEncryptedColumns(db)).migrated).toBe(6);

    const second = await migration.migrateEncryptedColumns(db);
    expect(second.migrated).toBe(0);
    expect(second.reason).toBe('nothing-to-migrate');
  });

  it('does nothing at all without a legacy key — the shipped default', async () => {
    const { migration } = await loadModules({ legacy: null });

    const summary = await migration.migrateEncryptedColumns(db);
    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe('no-legacy-key');
    expect(summary.migrated).toBe(0);
  });

  it('skips a row it cannot read rather than destroying it', async () => {
    const { migration, encryption } = await loadModules();

    let foreign = null;
    for (let i = 0; i < 50 && foreign === null; i += 1) {
      const candidate = CryptoJS.AES.encrypt(`unreachable${i}`, `a-third-key-${i}`).toString();
      if (encryption.keyGenerationOf(candidate) === null) foreign = candidate;
    }
    expect(foreign).not.toBeNull();

    await run(`INSERT INTO api_keys VALUES (?,?,?,?)`, ['k9', 'u1', 'foreign', foreign]);

    await migration.migrateEncryptedColumns(db);

    const [row] = await all(`SELECT api_key FROM api_keys WHERE id = 'k9'`);
    expect(row.api_key).toBe(foreign); // byte-identical, untouched
  });

  it('ignores tables that do not exist on this install', async () => {
    await run(`DROP TABLE oauth_tokens`);
    const { migration } = await loadModules();

    const summary = await migration.migrateEncryptedColumns(db);
    expect(summary.migrated).toBe(3); // 2 api_keys + 1 custom provider
  });
});

describe('interruption safety — why no database backup is needed', () => {
  it('leaves every credential readable when the migration dies part-way', async () => {
    // The claim this whole design rests on. A migration that half-completes is
    // not a broken state, because decrypt() understands both generations. If
    // this test ever fails, the no-backup decision becomes indefensible.
    const { migration, encryption } = await loadModules();

    let updates = 0;
    const realRun = db.run.bind(db);
    vi.spyOn(db, 'run').mockImplementation((sql, params, callback) => {
      if (String(sql).startsWith('UPDATE') && ++updates > 2) {
        const cb = typeof params === 'function' ? params : callback;
        cb?.(new Error('simulated crash mid-migration'));
        return db;
      }
      return realRun(sql, params, callback);
    });

    await expect(migration.migrateEncryptedColumns(db)).rejects.toThrow('simulated crash');
    vi.restoreAllMocks();

    // Every value, migrated or not, still yields its original plaintext.
    const keys = await all(`SELECT id, api_key FROM api_keys ORDER BY id`);
    expect(encryption.decrypt(keys[0].api_key)).toBe('openai-stored-value');
    expect(encryption.decrypt(keys[1].api_key)).toBe('anthropic-stored-value');

    const tokens = await all(`SELECT access_token FROM oauth_tokens ORDER BY id`);
    expect(encryption.decrypt(tokens[0].access_token)).toBe('access-value');
    expect(encryption.decrypt(tokens[1].access_token)).toBe('slack-access');
  });

  it('can be completed by a later run after an interruption', async () => {
    const { migration, encryption } = await loadModules();

    let updates = 0;
    const realRun = db.run.bind(db);
    const spy = vi.spyOn(db, 'run').mockImplementation((sql, params, callback) => {
      if (String(sql).startsWith('UPDATE') && ++updates > 2) {
        const cb = typeof params === 'function' ? params : callback;
        cb?.(new Error('simulated crash mid-migration'));
        return db;
      }
      return realRun(sql, params, callback);
    });
    await expect(migration.migrateEncryptedColumns(db)).rejects.toThrow();
    spy.mockRestore();

    const summary = await migration.migrateEncryptedColumns(db);
    expect(summary.ran).toBe(true);

    const rows = await all(`SELECT api_key AS v FROM api_keys UNION ALL SELECT access_token FROM oauth_tokens`);
    for (const row of rows) expect(encryption.keyGenerationOf(row.v)).toBe('current');
  });
});
