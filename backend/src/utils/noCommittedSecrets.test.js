import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guards against re-committing a secret.
 *
 * ---------------------------------------------------------------------------
 * WHY GUARDS AND NOT JUST A FIX
 * ---------------------------------------------------------------------------
 * `backend/.env` carried the production JWT_SECRET, SESSION_SECRET and
 * ENCRYPTION_KEY into a public repository on 2026-01-20 and stayed there for
 * 197 days, across 64 forks. It was touched twice more in that window without
 * anyone noticing, because the values sat in the diff as unchanged context and
 * the file was already labelled "LOCAL PUBLIC KEYS".
 *
 * Deleting the file fixes today. Only a guard fixes next year — nothing about
 * adding a key to a .env looks wrong at the moment you do it, and there is no
 * type error, no lint rule and no review step that catches it.
 *
 * Three independent failure modes, three guards:
 *   1. the file gets tracked by git again;
 *   2. it stays untracked but gets PACKAGED into the shipped app anyway;
 *   3. someone skips the file and puts the literal straight into source.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The one .env that may exist: a documented template with no real values. */
const ALLOWED_ENV_FILES = new Set(['.env.example']);

describe('guard 1 — no .env is tracked by git', () => {
  it('tracks no environment file other than .env.example', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => /(^|\/)\.env($|\.)/.test(file))
      .filter((file) => !ALLOWED_ENV_FILES.has(path.basename(file)));

    expect(tracked, `these environment files are tracked in git: ${tracked.join(', ')}`).toEqual([]);
  });

  it('gitignore actually covers .env (anti-vacuity)', () => {
    // The rule existed the whole time. It never applied, because git ignores
    // .gitignore for files that are ALREADY tracked — which is precisely how
    // this survived. Assert the rule exists so nobody removes it thinking the
    // deletion made it redundant.
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore.split('\n').map((l) => l.trim())).toContain('.env');
  });

  it('.env.example contains placeholders rather than real values', () => {
    const example = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
    const assignments = example.split('\n').filter((line) => /^[A-Z_]+=.+/.test(line.trim()));

    for (const line of assignments) {
      const [name, ...rest] = line.trim().split('=');
      const value = rest.join('=');
      if (!/SECRET|KEY|TOKEN|PASSWORD/i.test(name)) continue;
      expect(
        /your|change|placeholder|example|here|xxx|<|\.\.\./i.test(value),
        `.env.example ${name} looks like a real value, not a placeholder`
      ).toBe(true);
    }
  });
});

describe('guard 2 — no .env is packaged into the shipped app', () => {
  it('electron-builder explicitly excludes backend/.env', () => {
    // Necessary as well as guard 1, and this is the non-obvious half: the
    // packaging glob is `backend/**/*`, which SWEEPS UP DOTFILES. A verified
    // 0.5.10 build had ['.env', '.agnt'] inside the asar, so the published
    // secrets shipped to every user independently of git.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const files = pkg.build?.files ?? [];

    expect(files).toContain('!backend/.env');
    expect(files).toContain('!backend/.env.*');
  });

  it('the exclusion comes after the include that would otherwise match it', () => {
    // electron-builder applies patterns in order; an exclusion listed before
    // `backend/**/*` would be silently overridden.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const files = pkg.build?.files ?? [];

    expect(files.indexOf('!backend/.env')).toBeGreaterThan(files.indexOf('backend/**/*'));
  });
});

describe('guard 3 — no secret literal in source', () => {
  const SCAN_ROOTS = ['backend/src', 'backend/server.js', 'electron', 'main.js', 'preload.js'];
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'plugins', 'skills', 'tools']);

  /**
   * Names that mean "this is a credential".
   *
   * The first version of this listed specific compounds — api_key, private_key,
   * access_token — and the anti-vacuity test below immediately caught that it
   * did NOT match `ENCRYPTION_KEY`: the exact variable at the centre of this
   * incident would have sailed straight past its own guard. Match `key`
   * generally and subtract the words that merely contain it.
   */
  const SECRETISH = /(secret|passw|passphrase|credential|token|key)/i;

  /** `key` appears in plenty of names that hold nothing sensitive. */
  const NOT_SECRETISH = /(public|keyboard|keyword|keypath|keyname|keyof|hotkey|monkey|keyframe)/i;

  const isCredentialName = (name) => SECRETISH.test(name) && !NOT_SECRETISH.test(name);

  /**
   * The one exemption, deliberately narrow.
   *
   * config/oauthClients.js holds four PUBLIC installed-app OAuth client
   * identifiers that Google publishes in their own open-source CLIs. They are
   * not AGNT secrets and cannot be treated as such: an installed application
   * cannot keep a secret (RFC 8252 §8.5), and AGNT cannot sign in to Gemini CLI
   * or Antigravity without using Google's exact client.
   *
   * Scoped to FILE **and** NAME rather than blanket-skipping the file, so a
   * genuine secret added to it later is still caught. An anti-vacuity test
   * below asserts the exemption stays this narrow.
   */
  const ALLOWED = [
    ['config/oauthClients.js', 'GEMINI_CLI_CLIENT_ID'],
    ['config/oauthClients.js', 'GEMINI_CLI_CLIENT_SECRET'],
    ['config/oauthClients.js', 'ANTIGRAVITY_CLIENT_ID'],
    ['config/oauthClients.js', 'ANTIGRAVITY_CLIENT_SECRET'],

    // The second exemption is a genuine secret, and is allowed anyway.
    //
    // LEGACY_ENCRYPTION_KEY is the published key AGNT <= 0.6.5 encrypted with.
    // It is in 64 forks, in this repository's history, and inside every shipped
    // app.asar, so writing it here adds no exposure — while omitting it would
    // silently destroy every user's stored credentials on upgrade. It is
    // decrypt-only, and legacySecrets.test.js fails the build once the version
    // reaches 0.6.9 with it still present.
    //
    // This is the ONLY entry in this list that guards real secret material.
    // Anything similar arriving later should be argued on its own merits, not
    // waved through by pointing at this line.
    ['utils/legacySecrets.js', 'LEGACY_ENCRYPTION_KEY'],
  ];

  const isAllowed = (relPath, name) =>
    ALLOWED.some(([file, allowedName]) => relPath.replace(/\\/g, '/').endsWith(file) && name === allowedName);

  /** `NAME = '…'` or `NAME: '…'`, capturing the identifier and the literal. */
  const ASSIGNMENT = /([A-Za-z_$][\w$]*)\s*[:=]\s*['"`]([^'"`\n]{24,})['"`]/g;

  const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

  /**
   * Does this look like entropy rather than prose?
   * A URL, a file path, a sentence or an error message is not a secret, and a
   * guard that flags them gets disabled within a week.
   */
  function looksHighEntropy(value) {
    if (/^https?:\/\//.test(value)) return false;
    if (/\s/.test(value)) return false;
    if (/[/\\]/.test(value) && !/^[A-Za-z0-9+/=]+$/.test(value)) return false;
    if (/^[a-z-]+$/.test(value)) return false; // kebab-case identifier
    if (/^[A-Z_]+$/.test(value)) return false; // CONSTANT_NAME
    if (/\$\{/.test(value)) return false; // template expression

    const distinct = new Set(value).size;
    const hasDigit = /\d/.test(value);
    const hasAlpha = /[A-Za-z]/.test(value);
    return distinct >= 12 && hasDigit && hasAlpha;
  }

  function walk(target, out = []) {
    const full = path.join(REPO_ROOT, target);
    if (!fs.existsSync(full)) return out;
    if (fs.statSync(full).isFile()) {
      if (/\.(js|mjs|cjs)$/.test(full)) out.push(full);
      return out;
    }
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(target, entry.name), out);
      } else if (/\.(js|mjs|cjs)$/.test(entry.name) && !/\.(test|spec)\.js$/.test(entry.name)) {
        out.push(path.join(full, entry.name));
      }
    }
    return out;
  }

  function findings() {
    const hits = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (isComment(line)) return;
          for (const match of line.matchAll(ASSIGNMENT)) {
            const [, name, value] = match;
            if (!isCredentialName(name)) continue;
            if (!looksHighEntropy(value)) continue;
            if (isAllowed(path.relative(REPO_ROOT, file), name)) continue;
            hits.push(`${path.relative(REPO_ROOT, file)}:${index + 1} ${name}`);
          }
        });
      }
    }
    return hits;
  }

  it('assigns no high-entropy literal to a credential-shaped name', () => {
    expect(findings(), 'a secret appears to be hardcoded in source').toEqual([]);
  });

  it('the detector actually detects (anti-vacuity)', () => {
    // Without this, a broken scanner passes forever and looks healthy — the
    // same failure mode as the version-telemetry column that read
    // '[object Object]' for months while appearing populated.
    const positives = [
      ['JWT_SECRET', 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg'],
      ['apiKey', 'aB3dE6fG9hJ2kL5mN8pQ1rS4tU7vW0xY3z'],
      ['ENCRYPTION_KEY', '4f9a2c8d1e5b7f3a9c4d6e1f8a2b3c7d4e5f6a7b'],
      ['SESSION_SECRET', '7f66cf1d40fc68c8274ab24e350325a70e65d894'],
      ['clientSecret', 'aQ7wE2rT5yU8iO1pA4sD7fG0hJ3kL6zX9c'],
    ];
    for (const [name, value] of positives) {
      expect(isCredentialName(name), `${name} should be credential-shaped`).toBe(true);
      expect(looksHighEntropy(value), `${value.slice(0, 8)}… should look like entropy`).toBe(true);
    }

    // And must NOT fire on ordinary code, or it gets switched off.
    const negatives = [
      ['REMOTE_URL', 'https://api.agnt.gg/some/endpoint'],
      ['errorMessage', 'Failed to decrypt the stored credential'],
      ['SECRET_HEADER_NAME', 'X_AGNT_SIGNATURE'],
      ['keyPath', 'backend/src/utils/secretResolver.js'],
    ];
    for (const [, value] of negatives) {
      expect(looksHighEntropy(value), `${value} must not be treated as a secret`).toBe(false);
    }

    // Names that merely contain 'key' must not be treated as credentials, or
    // the guard produces noise and gets switched off.
    for (const name of ['keyboardShortcut', 'PUBLIC_KEY', 'keyframeOffset', 'keyPath']) {
      expect(isCredentialName(name), `${name} must not be credential-shaped`).toBe(false);
    }
  });

  it('scans a non-empty set of files (anti-vacuity)', () => {
    const scanned = SCAN_ROOTS.flatMap((root) => walk(root));
    expect(scanned.length).toBeGreaterThan(100);
  });

  it('the exemption stays narrow (anti-vacuity)', () => {
    // An allowlist that grows quietly is how a guard stops guarding. Pin both
    // its size and its shape: four public OAuth constants in one file, plus
    // exactly one time-limited legacy key in another.
    expect(ALLOWED).toHaveLength(5);

    const oauth = ALLOWED.filter(([file]) => file === 'config/oauthClients.js');
    expect(oauth).toHaveLength(4);
    for (const [, name] of oauth) {
      expect(name).toMatch(/^(GEMINI_CLI|ANTIGRAVITY)_CLIENT_(ID|SECRET)$/);
    }

    // Exactly one exemption covers real secret material, and it is the one
    // with a sunset gate attached.
    const legacy = ALLOWED.filter(([file]) => file !== 'config/oauthClients.js');
    expect(legacy).toEqual([['utils/legacySecrets.js', 'LEGACY_ENCRYPTION_KEY']]);
    expect(fs.existsSync(path.join(REPO_ROOT, 'backend/src/utils/legacySecrets.test.js'))).toBe(true);

    // And the exemption must not leak to the same NAME in a different file, or
    // to a different name in the exempted file.
    expect(isAllowed('backend/src/config/oauthClients.js', 'GEMINI_CLI_CLIENT_SECRET')).toBe(true);
    expect(isAllowed('backend/src/services/auth/Elsewhere.js', 'GEMINI_CLI_CLIENT_SECRET')).toBe(false);
    expect(isAllowed('backend/src/config/oauthClients.js', 'ENCRYPTION_KEY')).toBe(false);
  });
});
