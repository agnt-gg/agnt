import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CryptoJS from 'crypto-js';

/**
 * Dual-key credential encryption.
 *
 * Two defects are being held closed here, and they are different in kind.
 *
 * THE SECURITY DEFECT: every install encrypted with one key that was published
 * on GitHub, so "encrypted at rest" protected nothing against anyone holding a
 * copy of a user's agnt.db.
 *
 * THE AVAILABILITY DEFECT, which is the one that could bite during the fix:
 * moving to a per-install key means existing rows are under the old key. If
 * decrypt() only understood the new key, every stored credential would break
 * the moment the user updated. Dual-key decrypt is what makes the migration
 * safe enough to run without copying a 30 GB database — a row is readable
 * whether or not it has been migrated, so an interrupted migration is
 * survivable by construction rather than by backup.
 *
 * Also pinned: importing this module does no I/O and cannot throw. It used to
 * fs.readFileSync a committed .env at module scope and throw when absent,
 * which is what made that file impossible to delete for 197 days.
 */

const CURRENT_KEY = 'current-install-key-0123456789abcdef';
const LEGACY_KEY = 'the-published-key-that-shipped-to-everyone';
const ENV_KEYS = ['ENCRYPTION_KEY', 'AGNT_LEGACY_ENCRYPTION_KEY', 'USER_DATA_PATH'];

let saved;

/**
 * Load with a chosen key pair. Env wins in the resolver, so no disk is touched.
 *
 * `legacy: null` means "this install has no legacy key at all" — the state
 * after the key is removed in 0.6.9, and the state for anyone who overrides it
 * away. Deleting the environment variable NO LONGER produces that state, because
 * legacySecrets.js now ships a default, so the module is mocked instead.
 * Simulating it by clearing the env would silently test the shipped key
 * against itself and prove nothing.
 */
async function load({ current = CURRENT_KEY, legacy = LEGACY_KEY } = {}) {
  vi.resetModules();
  vi.doUnmock('./legacySecrets.js');

  if (current === null) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = current;

  if (legacy === null) {
    delete process.env.AGNT_LEGACY_ENCRYPTION_KEY;
    vi.doMock('./legacySecrets.js', () => ({
      LEGACY_ENCRYPTION_KEY: '',
      hasLegacyKey: () => false,
    }));
  } else {
    process.env.AGNT_LEGACY_ENCRYPTION_KEY = legacy;
  }

  return import('./encryption.js');
}

/** A value as an older AGNT would have written it. */
const asLegacyCiphertext = (plaintext) => CryptoJS.AES.encrypt(plaintext, LEGACY_KEY).toString();

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('importing the module', () => {
  it('touches no disk and throws nothing, even with no key anywhere', async () => {
    // The original module did fs.readFileSync('../../.env') at module scope and
    // threw if it was missing. That single line is why a published secret could
    // not simply be deleted: the backend would not boot without it.
    const fs = await import('node:fs');
    const readSpy = vi.spyOn(fs.default, 'readFileSync');

    await expect(load({ current: null, legacy: null })).resolves.toBeDefined();

    const touchedEnv = readSpy.mock.calls.some(([target]) => String(target).endsWith('.env'));
    expect(touchedEnv).toBe(false);
  });
});

describe('round trip', () => {
  it('encrypts and decrypts with the per-install key', async () => {
    const { encrypt, decrypt } = await load();
    const secret = 'a-stored-provider-credential-value';

    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertext each time (salted)', async () => {
    const { encrypt, decrypt } = await load();

    const a = encrypt('same input');
    const b = encrypt('same input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('handles unicode and long values', async () => {
    const { encrypt, decrypt } = await load();
    const value = '🔐 ключ — 密钥 '.repeat(200);

    expect(decrypt(encrypt(value))).toBe(value);
  });
});

describe('dual-key decrypt', () => {
  it('reads a value written by an older version under the published key', async () => {
    // Without this, every stored credential breaks the moment a user updates.
    const { decrypt } = await load();

    expect(decrypt(asLegacyCiphertext('legacy-stored-value'))).toBe('legacy-stored-value');
  });

  it('reads BOTH generations in the same process', async () => {
    // A half-migrated database is the normal state during a migration, and the
    // expected state forever if the migration is interrupted.
    const { encrypt, decrypt } = await load();

    expect(decrypt(encrypt('new'))).toBe('new');
    expect(decrypt(asLegacyCiphertext('old'))).toBe('old');
  });

  it('NEVER encrypts with the legacy key', async () => {
    // The whole point: new writes must not be readable with the published key.
    const { encrypt, CIPHERTEXT_PREFIX } = await load();
    const ciphertext = encrypt('freshly-stored');
    const body = ciphertext.slice(CIPHERTEXT_PREFIX.length);

    // A wrong-key decrypt is NOT single-valued — '' most of the time, a throw
    // sometimes, and non-empty garbage in about 0.4% of cases — so the only
    // stable property to assert is that it never reveals the plaintext.
    let viaLegacy;
    try {
      viaLegacy = CryptoJS.AES.decrypt(body, LEGACY_KEY).toString(CryptoJS.enc.Utf8);
    } catch {
      viaLegacy = null; // threw — also a failure to decrypt
    }
    expect(viaLegacy).not.toBe('freshly-stored');

    expect(CryptoJS.AES.decrypt(body, CURRENT_KEY).toString(CryptoJS.enc.Utf8)).toBe('freshly-stored');
  });

  it('tags its output so the generation is read, never guessed', async () => {
    // The structural fix for a measured 0.4% failure rate: choosing a key by
    // "did this decrypt to something non-empty" occasionally picks the wrong
    // one, because crypto-js strips PKCS7 padding without validating it.
    const { encrypt, keyGenerationOf, CIPHERTEXT_PREFIX } = await load();

    expect(encrypt('x').startsWith(CIPHERTEXT_PREFIX)).toBe(true);
    expect(keyGenerationOf(encrypt('x'))).toBe('current');

    // Legacy values are unprefixed, and being unprefixed is what identifies
    // them: every version up to 0.6.5 had exactly one key.
    const legacyValue = asLegacyCiphertext('old');
    expect(legacyValue.startsWith(CIPHERTEXT_PREFIX)).toBe(false);
    expect(keyGenerationOf(legacyValue)).toBe('legacy');
  });

  it('is immune to the wrong-key-returns-garbage case that broke key guessing', async () => {
    // Reproduce the exact hazard: values whose decryption under the OTHER key
    // yields non-empty garbage. With a tag, generation is a string check, so
    // the garbage cannot influence which key is chosen.
    const { encrypt, decrypt, keyGenerationOf } = await load();

    for (let i = 0; i < 200; i += 1) {
      const secret = `credential-value-${i}`;
      expect(decrypt(encrypt(secret))).toBe(secret);

      const legacyValue = asLegacyCiphertext(secret);
      expect(keyGenerationOf(legacyValue)).toBe('legacy');
      expect(decrypt(legacyValue)).toBe(secret);
    }
  });

  it('reports which generation opened a value', async () => {
    const { encrypt, keyGenerationOf } = await load();

    expect(keyGenerationOf(encrypt('x'))).toBe('current');
    expect(keyGenerationOf(asLegacyCiphertext('y'))).toBe('legacy');
    expect(keyGenerationOf(CryptoJS.AES.encrypt('z', 'some-third-key').toString())).toBeNull();
  });
});

describe('the SHIPPED default (nothing set in the environment at all)', () => {
  it('reads data written by AGNT <= 0.6.5 with no configuration whatsoever', async () => {
    // The reason the key is committed rather than left to a setting: this is
    // the path every existing user takes on upgrade. If it fails, they lose
    // every stored provider key and OAuth connection — silently, because
    // "nothing to migrate" and "nothing readable" look identical from outside.
    vi.resetModules();
    vi.doUnmock('./legacySecrets.js');
    delete process.env.AGNT_LEGACY_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = CURRENT_KEY;

    const { LEGACY_ENCRYPTION_KEY: shipped, hasLegacyKey: shippedHas } = await import('./legacySecrets.js');
    expect(shippedHas()).toBe(true);

    // Encrypted exactly as an old version would have.
    const oldRow = CryptoJS.AES.encrypt('a-stored-credential', shipped).toString();

    const { decrypt, keyGenerationOf } = await import('./encryption.js');
    expect(keyGenerationOf(oldRow)).toBe('legacy');
    expect(decrypt(oldRow)).toBe('a-stored-credential');
  });

  it('still writes new data under the per-install key, never the legacy one', async () => {
    vi.resetModules();
    vi.doUnmock('./legacySecrets.js');
    delete process.env.AGNT_LEGACY_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = CURRENT_KEY;

    const { LEGACY_ENCRYPTION_KEY: shipped } = await import('./legacySecrets.js');
    const { encrypt, keyGenerationOf, CIPHERTEXT_PREFIX } = await import('./encryption.js');

    const fresh = encrypt('newly-stored');
    expect(keyGenerationOf(fresh)).toBe('current');
    expect(fresh.startsWith(CIPHERTEXT_PREFIX)).toBe(true);

    // The published key must not open anything written from now on.
    const body = fresh.slice(CIPHERTEXT_PREFIX.length);
    let viaLegacy;
    try {
      viaLegacy = CryptoJS.AES.decrypt(body, shipped).toString(CryptoJS.enc.Utf8);
    } catch {
      viaLegacy = null;
    }
    expect(viaLegacy).not.toBe('newly-stored');
  });
});

describe('with no legacy key at all (post-0.6.9, or overridden away)', () => {
  it('still encrypts and decrypts current data normally', async () => {
    const { encrypt, decrypt } = await load({ legacy: null });

    expect(decrypt(encrypt('current-data'))).toBe('current-data');
  });

  it('fails cleanly on legacy data instead of returning something wrong', async () => {
    // A wrong-key decrypt must never yield plausible garbage that a caller
    // would store or send as if it were a credential. Measured against
    // crypto-js: 500 wrong-key attempts gave 375 empty results and 125 throws,
    // and never a non-empty wrong plaintext.
    const { decrypt } = await load({ legacy: null });
    const legacyValue = asLegacyCiphertext('unreachable-without-the-old-key');

    let outcome;
    try {
      outcome = decrypt(legacyValue);
    } catch (error) {
      outcome = `threw: ${error.message}`;
    }

    expect(outcome === '' || String(outcome).startsWith('threw:')).toBe(true);
    expect(outcome).not.toBe('unreachable-without-the-old-key');
  });
});

describe('never yields a credential it cannot actually open', () => {
  it('refuses foreign ciphertext without ever returning its plaintext', async () => {
    // WHAT THIS TEST USED TO BE, AND WHY IT WAS WRONG
    // ------------------------------------------------
    // It asserted that decrypt() behaves identically to the original
    // single-key implementation on malformed input. That is not testable,
    // because THE ORIGINAL IS NOT DETERMINISTIC on malformed input.
    //
    // crypto-js WordArrays are not zero-filled, and a malformed OpenSSL blob
    // produces a sigBytes/words mismatch, so the decode reads whatever was
    // left in previously allocated buffers. In an isolated probe the same
    // input gave the same answer 12 times out of 12; inside a suite that has
    // already performed randomly-salted encryptions it varies run to run. The
    // test failed intermittently in BOTH directions — sometimes the new code
    // threw and the old returned '', sometimes the reverse — which is the
    // signature of both sides reading residue rather than of a real difference.
    //
    // So this now pins the property that actually protects a user: whatever
    // decrypt() does with data it cannot open, it must never hand back a
    // plaintext. Returning the wrong credential is the only outcome here that
    // could cause real harm; '' versus a throw is caller-visible noise that
    // AuthManager already handles by rejecting either way.
    const { decrypt } = await load({ legacy: null });

    const secrets = Array.from({ length: 200 }, (_, i) => `plaintext-credential-number-${i}`);
    const foreign = secrets.map((s, i) => CryptoJS.AES.encrypt(s, `foreign-key-${i}`).toString());

    for (const [index, blob] of foreign.entries()) {
      let result;
      try {
        result = decrypt(blob);
      } catch {
        continue; // threw — nothing leaked
      }
      // NOT asserting result === '': a wrong key returns short non-empty
      // garbage about 0.4% of the time. What must never happen is returning
      // the real plaintext of data this install cannot legitimately open.
      expect(result, 'decrypt returned the plaintext of a foreign ciphertext').not.toBe(secrets[index]);
    }

    // Anti-vacuity: prove the same corpus DOES open under its own keys, so the
    // assertion above is not passing merely because nothing was decryptable.
    for (const [index, blob] of foreign.entries()) {
      expect(CryptoJS.AES.decrypt(blob, `foreign-key-${index}`).toString(CryptoJS.enc.Utf8)).toBe(secrets[index]);
    }
  });
});
