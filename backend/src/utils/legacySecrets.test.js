import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CryptoJS from 'crypto-js';
import jwt from 'jsonwebtoken';
import { LEGACY_ENCRYPTION_KEY, hasLegacyKey, SHARED_JWT_SECRET, hasSharedJwtSecret } from './legacySecrets.js';

/**
 * The decrypt-only legacy key, and its expiry date.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING PROTECTED
 * ---------------------------------------------------------------------------
 * Two opposite failure modes, a few months apart.
 *
 * TOO EARLY — the key goes missing before users have migrated. Every stored
 * provider API key and OAuth connection becomes unreadable on upgrade, with no
 * error anywhere: the migration simply reports nothing to do. Silent credential
 * loss across the entire install base.
 *
 * TOO LATE — the key is still shipping long after everyone has migrated, so a
 * published value keeps travelling in the app for no benefit at all. This is
 * the far likelier one, because nothing forces anybody to remember a comment.
 *
 * The sunset test below turns that comment into a build failure.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SOURCE = fs.readFileSync(path.join(HERE, 'legacySecrets.js'), 'utf8');

/** The literal in the source, independent of any environment override. */
function shippedKey() {
  return SOURCE.match(/AGNT_LEGACY_ENCRYPTION_KEY \|\| '([^']*)'/)?.[1] ?? null;
}

/** Likewise for the JWT secret. */
function shippedJwtSecret() {
  return SOURCE.match(/SHARED_JWT_SECRET = process\.env\.JWT_SECRET \|\| '([^']*)'/)?.[1] ?? null;
}

/**
 * A JWT signed ONCE by the real published secret and frozen here.
 *
 * Same discipline as LEGACY_FIXTURE_CIPHERTEXT, for the same reason: signing a
 * token with `shippedJwtSecret()` and then verifying it with
 * `SHARED_JWT_SECRET` compares a value to itself and passes for any value at
 * all. This fixture was generated from git history, independently of the
 * module, so verifying it is a real claim about which secret the module holds.
 *
 * Payload is a dummy — no real session token appears in this repository.
 */
const JWT_FIXTURE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZ250LXNoYXJlZC1qd3QtZml4dHVyZS12MSJ9.bITf0O4GYSwB_IryWCkjKJHagRbAVYo-bkJHrlSU4dk';
const JWT_FIXTURE_SUBJECT = 'agnt-shared-jwt-fixture-v1';

/** Semver compare, enough for x.y.z. */
function atLeast(version, target) {
  const a = version.split('.').map(Number);
  const b = target.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

const REMOVE_BY = '0.6.9';

/**
 * A ciphertext produced ONCE by the real published key and frozen here.
 *
 * The obvious version of the test below was a tautology:
 *
 *     const blob = CryptoJS.AES.encrypt(PLAINTEXT, shippedKey());
 *     expect(decrypt(blob, LEGACY_ENCRYPTION_KEY)).toBe(PLAINTEXT);
 *
 * shippedKey() and LEGACY_ENCRYPTION_KEY are the same value, so it asserted
 * only that a key decrypts what it just encrypted — true of every key,
 * including a corrupted one. A negative control that replaced the key with
 * 'deadbeef' passed, which is how it was caught.
 *
 * A frozen fixture makes the claim real: this blob was sealed by the key AGNT
 * <= 0.6.5 actually used, so opening it proves the module still holds that
 * key, and any change to the constant fails.
 *
 * Not sensitive: the plaintext is the sentinel directly below, and the key
 * that opens it has been public since 2026-01-20.
 */
const LEGACY_FIXTURE_CIPHERTEXT = 'U2FsdGVkX18eI8wB1UzgA7mbRG2mVgTdeRf0Ycf29HTueq0DXqRcM6DIiXH2mTsm';
const LEGACY_FIXTURE_PLAINTEXT = 'agnt-legacy-key-fixture-v1';

describe('the legacy key is present, so existing users keep their credentials', () => {
  it('ships a key rather than relying on a setting nobody will find', () => {
    // Without this, the 0.6.6 migration reads nothing and every user who had
    // saved an API key or connected an OAuth provider loses it silently.
    expect(
      hasLegacyKey(),
      'LEGACY_ENCRYPTION_KEY is empty. Every existing user will lose stored ' +
        'provider API keys and OAuth connections on upgrade, with no error shown.'
    ).toBe(true);
    expect(shippedKey()).toBeTruthy();
  });

  it('is the key that actually opens data written by AGNT <= 0.6.5', () => {
    // Against a FROZEN blob sealed by the real published key — not one this
    // test just encrypted, which would pass for any key at all.
    expect(LEGACY_FIXTURE_CIPHERTEXT, 'fixture not generated').toBeTruthy();

    const opened = CryptoJS.AES.decrypt(LEGACY_FIXTURE_CIPHERTEXT, LEGACY_ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);

    expect(
      opened,
      'The shipped legacy key does not open data written by AGNT <= 0.6.5. ' +
        'Every existing user would lose stored provider keys and OAuth connections on upgrade.'
    ).toBe(LEGACY_FIXTURE_PLAINTEXT);
  });

  it('the fixture is a real discriminator, not something any key opens (anti-vacuity)', () => {
    // If a wrong key could also open it, the test above would prove nothing.
    for (const wrong of ['deadbeef', 'a'.repeat(61), shippedKey().slice(0, -1) + 'f']) {
      let opened;
      try {
        opened = CryptoJS.AES.decrypt(LEGACY_FIXTURE_CIPHERTEXT, wrong).toString(CryptoJS.enc.Utf8);
      } catch {
        opened = null; // threw — also a failure to open
      }
      expect(opened, `key ${wrong.slice(0, 12)}… must not open the fixture`).not.toBe(LEGACY_FIXTURE_PLAINTEXT);
    }
  });

  it('an environment variable still overrides it', () => {
    expect(SOURCE).toMatch(/process\.env\.AGNT_LEGACY_ENCRYPTION_KEY \|\|/);
  });

  it('is never used to encrypt — only to decrypt', () => {
    // The security property that makes shipping a published key acceptable.
    // encrypt() must not reference it, directly or via the module.
    const encryption = fs.readFileSync(path.join(HERE, 'encryption.js'), 'utf8');
    const encryptBody = encryption.slice(
      encryption.indexOf('export function encrypt('),
      encryption.indexOf('export function decrypt(')
    );

    expect(encryptBody).not.toMatch(/LEGACY_ENCRYPTION_KEY/);
    expect(encryptBody).toMatch(/installKey\(\)/);
  });
});

describe('the shared JWT secret is present, so sessions can be verified', () => {
  it('ships a secret rather than leaving every session unverifiable', () => {
    // Without it, process.env.JWT_SECRET is undefined, jwt.verify throws on
    // every request, and Middleware/AuthRoutes/authGuard each swallow the
    // throw and downgrade the caller to unauthenticated. Total lockout, with
    // no log line naming the cause.
    expect(
      hasSharedJwtSecret(),
      'SHARED_JWT_SECRET is empty. Every session on the machine will be rejected: ' +
        '"Session expired" in the browser, "backend rejected the session" on sign-in.'
    ).toBe(true);
    expect(shippedJwtSecret()).toBeTruthy();
  });

  it('actually verifies a token signed by the real issuer', () => {
    // Against a FROZEN token generated from git history — not one this test
    // just signed, which would pass for any secret whatsoever.
    //
    // Reads the SHIPPED CONSTANT, not the module export. The export is
    // `process.env.JWT_SECRET || constant`, and a developer machine inherits
    // JWT_SECRET from whichever backend spawned the test runner — so gating on
    // the export would pass or fail based on the shell rather than on the
    // artefact users actually receive. That is precisely the trap the OAuth
    // ship gate fell into, and it is how this very test first failed.
    expect(JWT_FIXTURE, 'fixture not generated').toBeTruthy();

    const decoded = jwt.verify(JWT_FIXTURE, shippedJwtSecret());

    expect(decoded.sub).toBe(JWT_FIXTURE_SUBJECT);
  });

  it('the export honours an operator override (and is therefore not what the gate reads)', () => {
    // Pins both halves: the override exists, and it is the reason the test
    // above reads the source literal instead of the export.
    expect(SHARED_JWT_SECRET).toBe(process.env.JWT_SECRET || shippedJwtSecret());
  });

  it('the fixture is a real discriminator, not something any secret opens (anti-vacuity)', () => {
    for (const wrong of ['deadbeef', 'a'.repeat(44), `${shippedJwtSecret().slice(0, -1)}X`]) {
      expect(
        () => jwt.verify(JWT_FIXTURE, wrong),
        `secret ${wrong.slice(0, 12)}… must not verify the fixture`
      ).toThrow();
    }
  });

  it('an environment variable still overrides it', () => {
    expect(SOURCE).toMatch(/SHARED_JWT_SECRET = process\.env\.JWT_SECRET \|\|/);
  });

  it('is reached by the five sites that read process.env.JWT_SECRET', () => {
    // The bug was not a wrong value, it was a value wired to nothing. Pin the
    // wiring: the bootstrap must populate the env var, and server.js must
    // import it before anything that reads it.
    const bootstrap = fs.readFileSync(path.join(HERE, '../config/secretsBootstrap.js'), 'utf8');
    expect(bootstrap).toMatch(/SHARED_JWT_SECRET/);
    expect(bootstrap).toMatch(/env\.JWT_SECRET = SHARED_JWT_SECRET/);

    const server = fs.readFileSync(path.join(REPO_ROOT, 'backend/server.js'), 'utf8');
    const bootstrapAt = server.indexOf("import './src/config/secretsBootstrap.js'");
    expect(bootstrapAt, 'server.js does not import secretsBootstrap').toBeGreaterThan(-1);

    // Anything that reads the secret must be imported AFTER the bootstrap.
    const middlewareAt = server.indexOf("from './src/routes/Middleware.js'");
    if (middlewareAt > -1) expect(bootstrapAt).toBeLessThan(middlewareAt);
  });

  it('does NOT default TRUST_REMOTE_AUTH on, which would stop verifying signatures', () => {
    // A tempting shortcut for this outage, and strictly weaker than what 0.6.5
    // shipped: TRUST_REMOTE_AUTH makes the backend jwt.decode instead of
    // jwt.verify, so forging a session against this machine would need no
    // secret at all rather than the published one.
    const bootstrap = fs.readFileSync(path.join(HERE, '../config/secretsBootstrap.js'), 'utf8');
    const code = bootstrap.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

    expect(code.filter((line) => /TRUST_REMOTE_AUTH/.test(line))).toEqual([]);
  });
});

describe(`SUNSET GATE: remove the legacy key by ${REMOVE_BY}`, () => {
  it(`fails once package.json reaches ${REMOVE_BY} while the key is still shipping`, () => {
    const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
    const due = atLeast(version, REMOVE_BY);

    if (!due) {
      expect(due).toBe(false); // not yet — nothing to do
      return;
    }

    const guidance =
      `Version ${version} has reached ${REMOVE_BY}, the agreed removal point. ` +
      'Installs have had several releases to migrate. Delete both constants ' +
      "(set them back to ''), then remove legacySecrets.js and its call sites in " +
      'encryption.js, encryptionMigration.js and config/secretsBootstrap.js. ' +
      'The JWT secret specifically requires the /users/sync-token exchange to ' +
      'have landed first, or sessions stop verifying. If more time is genuinely ' +
      'needed, move REMOVE_BY in this test deliberately rather than deleting the gate.';

    expect(shippedKey(), guidance).toBe('');
    expect(shippedJwtSecret(), guidance).toBe('');
  });

  it('the gate is capable of firing (anti-vacuity)', () => {
    // A date-based gate that never triggers is indistinguishable from no gate.
    // Prove the comparison works in both directions.
    expect(atLeast('0.6.9', REMOVE_BY)).toBe(true);
    expect(atLeast('0.7.0', REMOVE_BY)).toBe(true);
    expect(atLeast('1.0.0', REMOVE_BY)).toBe(true);
    expect(atLeast('0.6.8', REMOVE_BY)).toBe(false);
    expect(atLeast('0.6.5', REMOVE_BY)).toBe(false);
  });

  it('the removal instructions name every call site that must go with it', () => {
    // A sunset that leaves dangling imports is a sunset nobody completes.
    for (const file of ['encryption.js', 'encryptionMigration.js']) {
      expect(fs.readFileSync(path.join(HERE, file), 'utf8')).toMatch(/legacySecrets\.js/);
    }
    expect(fs.readFileSync(path.join(HERE, '../config/secretsBootstrap.js'), 'utf8')).toMatch(
      /legacySecrets\.js/
    );
  });
});
