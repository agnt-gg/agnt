import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEMINI_CLI_OAUTH, ANTIGRAVITY_OAUTH, isOAuthClientConfigured } from './oauthClients.js';

/**
 * Ship-gate for the third-party OAuth clients.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * Deleting the committed backend/.env removed four PUBLIC Google OAuth client
 * identifiers along with the three real secrets it was carrying. The secrets
 * needed to go. The client identifiers did not — they are Google's own
 * published installed-app clients, and AGNT cannot sign in to Gemini CLI or
 * Antigravity without them.
 *
 * They were briefly blank between the removal commit and the commit that put
 * them back, and this gate was written during that window precisely so the
 * gap could not be forgotten. It stays afterwards because nothing else would
 * notice the same mistake again: an empty client produces no build error, no
 * type error and no startup warning — only an opaque HTTP 400 from Google, in
 * a user's token refresh, an hour later.
 *
 * A RED test here means: OAuth sign-in is broken, do not ship.
 * Fix it by filling in the constants at the top of oauthClients.js.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT MERELY A "NEW SIGN-IN" PROBLEM
 * ---------------------------------------------------------------------------
 * This was initially reported — wrongly — as affecting only sign-in performed
 * inside AGNT, on the reasoning that users who authenticated with the real CLI
 * keep working because their credential file carries its own client_id.
 *
 * That reasoning was checked against a real machine and does not hold. Both
 * ~/.gemini/oauth_creds.json and ~/.antigravity/oauth_creds.json on a live
 * install contained ONLY:
 *
 *     access_token, refresh_token, scope, token_type, id_token, expiry_date
 *
 * No client_id, no client_secret. Both refresh paths do:
 *
 *     const clientId = data.client_id || OAUTH_CONFIG.CLIENT_ID;
 *
 * so with an empty constant they send an empty client_id to Google's token
 * endpoint and the refresh fails. Access tokens last about an hour. An empty
 * client therefore signs out ALREADY-CONNECTED users within the hour — a far
 * bigger blast radius than "new sign-ins fail", and silent until it happens.
 */

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(CONFIG_DIR, '..');
const SOURCE = fs.readFileSync(path.join(CONFIG_DIR, 'oauthClients.js'), 'utf8');

/**
 * Read a constant's literal value out of the SOURCE, not from the module.
 *
 * This gate must not consult process.env, and the first version of it did —
 * via the module's own `process.env.X || CONSTANT` fallback. It passed on the
 * machine it was written on and would have failed for every user, because a
 * developer box inherits GEMINI_CLI_CLIENT_ID and friends from the old
 * backend/.env through dotenv, while a shipped app has no such variables. A
 * green suite would then have certified an app whose OAuth was broken.
 *
 * The shipped artefact is the source file. Assert that.
 */
function literalConstant(name) {
  const match = SOURCE.match(new RegExp(`^const ${name} = '([^']*)';`, 'm'));
  if (!match) throw new Error(`constant ${name} not found in oauthClients.js`);
  return match[1];
}

const SHIPPED = {
  GEMINI_CLI: {
    CLIENT_ID: literalConstant('GEMINI_CLI_CLIENT_ID'),
    CLIENT_SECRET: literalConstant('GEMINI_CLI_CLIENT_SECRET'),
  },
  ANTIGRAVITY: {
    CLIENT_ID: literalConstant('ANTIGRAVITY_CLIENT_ID'),
    CLIENT_SECRET: literalConstant('ANTIGRAVITY_CLIENT_SECRET'),
  },
};

describe('SHIP GATE: OAuth clients are present', () => {
  const FIX = 'Paste the values into the constants at the top of ' +
    'backend/src/config/oauthClients.js — get them from `git show main:backend/.env`. ' +
    'Setting an environment variable is NOT sufficient: the shipped app has none.';

  it('Gemini CLI client is present IN THE SHIPPED SOURCE', () => {
    expect(
      isOAuthClientConfigured(SHIPPED.GEMINI_CLI),
      `GEMINI_CLI_CLIENT_ID / GEMINI_CLI_CLIENT_SECRET are empty. Gemini CLI ` +
        `sign-in is broken, and already-connected users will be signed out at ` +
        `their next hourly token refresh. ${FIX}`
    ).toBe(true);
  });

  it('Antigravity client is present IN THE SHIPPED SOURCE', () => {
    expect(
      isOAuthClientConfigured(SHIPPED.ANTIGRAVITY),
      `ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET are empty. Antigravity ` +
        `sign-in is broken, and already-connected users will be signed out at ` +
        `their next hourly token refresh. ${FIX}`
    ).toBe(true);
  });

  it('the two clients are distinct', () => {
    // Antigravity's extra scopes (cclog, experimentsandconfigs) are authorised
    // only for its own client; reusing Gemini's returns HTTP 400 invalid_scope.
    // A copy-paste slip here produces an error that looks nothing like its cause.
    if (!isOAuthClientConfigured(SHIPPED.GEMINI_CLI) || !isOAuthClientConfigured(SHIPPED.ANTIGRAVITY)) return;

    expect(SHIPPED.ANTIGRAVITY.CLIENT_ID).not.toBe(SHIPPED.GEMINI_CLI.CLIENT_ID);
    expect(SHIPPED.ANTIGRAVITY.CLIENT_SECRET).not.toBe(SHIPPED.GEMINI_CLI.CLIENT_SECRET);
  });

  it('the values look like Google OAuth clients, not placeholders', () => {
    if (!isOAuthClientConfigured(SHIPPED.GEMINI_CLI) || !isOAuthClientConfigured(SHIPPED.ANTIGRAVITY)) return;

    for (const client of [SHIPPED.GEMINI_CLI, SHIPPED.ANTIGRAVITY]) {
      expect(client.CLIENT_ID).toMatch(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
      expect(client.CLIENT_SECRET.length).toBeGreaterThan(20);
      expect(client.CLIENT_SECRET).not.toMatch(/your|change|placeholder|example|here|xxx/i);
    }
  });

  it('the gate does not consult the ambient environment (anti-vacuity)', () => {
    // A developer machine inherits these variables from the old backend/.env,
    // so a gate that read process.env would pass here and fail for every user.
    // Prove the gate reads literals: temporarily clearing the env must not
    // change what SHIPPED contains, because SHIPPED came from the source text.
    const saved = process.env.GEMINI_CLI_CLIENT_ID;
    delete process.env.GEMINI_CLI_CLIENT_ID;
    expect(literalConstant('GEMINI_CLI_CLIENT_ID')).toBe(SHIPPED.GEMINI_CLI.CLIENT_ID);
    if (saved !== undefined) process.env.GEMINI_CLI_CLIENT_ID = saved;

    // And the module-level export IS env-aware — which is why it is the wrong
    // thing to gate on, and the right thing for an operator override.
    expect(GEMINI_CLI_OAUTH).toHaveProperty('CLIENT_ID');
    expect(ANTIGRAVITY_OAUTH).toHaveProperty('CLIENT_ID');
  });

  it('an environment variable still overrides', () => {
    // For anyone who registers their own OAuth client.
    expect(
      fs.readFileSync(path.join(CONFIG_DIR, 'oauthClients.js'), 'utf8')
    ).toMatch(/process\.env\.GEMINI_CLI_CLIENT_ID\s*\|\|/);
  });
});

describe('wiring', () => {
  /** Both managers must read the client from here, not from process.env. */
  const MANAGERS = [
    ['GeminiCliAuthManager.js', 'GEMINI_CLI_OAUTH'],
    ['AntigravityAuthManager.js', 'ANTIGRAVITY_OAUTH'],
  ];

  for (const [file, symbol] of MANAGERS) {
    it(`${file} sources its client from config/oauthClients.js`, () => {
      const source = fs.readFileSync(path.join(SRC, 'services', 'auth', file), 'utf8');

      expect(source).toMatch(new RegExp(`import \\{ ${symbol} \\} from '\\.\\./\\.\\./config/oauthClients\\.js'`));
      expect(source).toMatch(new RegExp(`CLIENT_ID: ${symbol}\\.CLIENT_ID`));
      expect(source).toMatch(new RegExp(`CLIENT_SECRET: ${symbol}\\.CLIENT_SECRET`));
    });

    it(`${file} no longer reads the deleted .env variables directly`, () => {
      const source = fs.readFileSync(path.join(SRC, 'services', 'auth', file), 'utf8');
      const code = source.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

      const offenders = code.filter((line) => /process\.env\.(GEMINI_CLI|ANTIGRAVITY)_CLIENT_(ID|SECRET)/.test(line));
      expect(offenders, `${file} still reads the client from process.env`).toEqual([]);
    });
  }

  it('the refresh path falls back to the constant, which is why empty breaks live users', () => {
    // Pins the mechanism this whole gate exists for. If a future refactor stops
    // falling back here, the blast radius of an empty client shrinks to new
    // sign-ins only — and this test should be revisited rather than deleted.
    for (const file of ['GeminiCliAuthManager.js', 'AntigravityAuthManager.js']) {
      const source = fs.readFileSync(path.join(SRC, 'services', 'auth', file), 'utf8');
      expect(source, `${file} refresh path`).toMatch(/data\.client_id \|\| OAUTH_CONFIG\.CLIENT_ID/);
      expect(source, `${file} refresh path`).toMatch(/data\.client_secret \|\| OAUTH_CONFIG\.CLIENT_SECRET/);
    }
  });
});
