/**
 * CONTRACT: code that redeems an OAuth code must first vet the message origin.
 *
 * WHY THIS EXISTS
 * ---------------
 * `providerAuthService.completeRemoteOAuthCallback({ code, state })` POSTs a
 * forwarded authorization code to `/auth/callback` **with the signed-in user's
 * bearer token**. Every caller of it sits inside a `message` listener, so the
 * origin check in front of it is the entire trust boundary: cross-origin
 * *sending* is permitted by design and cannot be prevented.
 *
 * Three call sites existed and they did three different things. One had no
 * origin check at all. Two shared a copy-pasted guard whose second term never
 * referenced its own loop variable:
 *
 *   allowedOrigins.some((origin) =>
 *     event.origin === origin || event.origin.includes('localhost'))
 *
 * making it an unconditional substring test that admitted `localhost.evil.com`
 * and friends. Redeeming an attacker's code grafts the ATTACKER'S Google /
 * Gmail / Drive account onto the victim's AGNT user, so the victim's later
 * agent runs operate on someone else's data.
 *
 * It was a *class* of bug rather than one mistake because no single module
 * owned the rule — the same reasoning as apiAuthContract.spec.js in this
 * directory, and the same remedy: one shared predicate, enforced mechanically
 * at every call site.
 *
 * Neither Connectors.vue nor IntegrationHealth.vue has a unit spec, so without
 * this guard the check could be deleted from either and nothing would fail.
 *
 * The call sites are DISCOVERED from source rather than listed here, so a
 * fourth handler added tomorrow is covered without anyone remembering to come
 * back and update this file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(HERE, '..');

/** The dangerous operation: redeeming a code against the current user. */
const REDEEM = 'completeRemoteOAuthCallback';
/** The one predicate allowed to answer "may this sender do that?". */
const GUARD = 'isTrustedOAuthMessageOrigin';

/**
 * Where the function is defined and where it is mocked. Neither redeems
 * anything on a real user's behalf.
 */
const NOT_CALL_SITES = [
  'services/providerAuthService.js',
  'services/providerAuthService.spec.js',
];

/**
 * Remove comments so that prose discussing these identifiers cannot vouch for
 * a file that never calls them — and so a commented-out guard reads as absent.
 *
 * String- and template-aware on purpose: a naive `//.*$` sweep truncates any
 * line containing a URL, which would silently delete real code from the text
 * being scanned and turn this guard into a source of false passes.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (/\.(js|vue)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function callSites() {
  return walk(FRONTEND_SRC)
    .map((full) => ({
      rel: path.relative(FRONTEND_SRC, full).split(path.sep).join('/'),
      code: stripComments(fs.readFileSync(full, 'utf8')),
    }))
    .filter(({ rel, code }) => !NOT_CALL_SITES.includes(rel) && code.includes(`${REDEEM}(`));
}

describe('every OAuth code redemption is behind an origin check', () => {
  it('finds the call sites at all, so a silent zero cannot pass this suite', () => {
    // Without this, renaming the service method would empty the set and every
    // assertion below would vacuously succeed.
    const sites = callSites().map((s) => s.rel);

    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(sites).toContain('composables/useProviderConnection.js');
    expect(sites).toContain('views/Terminal/CenterPanel/screens/Connectors/Connectors.vue');
    expect(sites).toContain(
      'views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue',
    );
  });

  it('vets the sender before redeeming, at every call site', () => {
    const unguarded = callSites()
      .filter(({ code }) => !code.includes(`${GUARD}(`))
      .map(({ rel }) => rel);

    expect(unguarded, `these redeem an OAuth code without calling ${GUARD}`).toEqual([]);
  });

  it('nobody has reintroduced a hand-rolled origin comparison', () => {
    // The two guards that existed were copy-pasted, and the copy is what let
    // them drift apart. One predicate, or the class of bug comes back.
    const handRolled = callSites()
      .filter(({ code }) => /event\.origin\s*(===|!==|\.includes|\.startsWith|\.indexOf)/.test(code))
      .map(({ rel }) => rel);

    expect(handRolled, `these compare event.origin inline instead of using ${GUARD}`).toEqual([]);
  });

  it('the guard is called before the redemption in each file', () => {
    // Ordering is the whole point: a check that runs afterwards is decoration.
    const tooLate = callSites()
      .filter(({ code }) => code.indexOf(`${GUARD}(`) > code.indexOf(`${REDEEM}(`))
      .map(({ rel }) => rel);

    expect(tooLate, `these call ${REDEEM} before ${GUARD}`).toEqual([]);
  });
});

describe('the comment stripper this guard depends on', () => {
  // Self-tests, because a stripper that eats real code turns the assertions
  // above into false passes — the exact failure mode Copilot caught in the
  // sibling guard on PR #78.
  it('removes a commented-out guard call', () => {
    expect(stripComments(`// ${GUARD}(event.origin)`)).not.toContain(GUARD);
  });

  it('keeps a URL that contains a double slash', () => {
    const line = `const state = 'github:http://localhost:3333';`;
    expect(stripComments(line)).toBe(line);
  });

  it('keeps code that follows a URL on the same line', () => {
    const line = `send('https://api.agnt.gg'); ${GUARD}(event.origin);`;
    expect(stripComments(line)).toContain(`${GUARD}(event.origin)`);
  });

  it('removes a block comment without touching adjacent code', () => {
    expect(stripComments(`a();/* ${GUARD}( */b();`)).toBe('a();b();');
  });
});
