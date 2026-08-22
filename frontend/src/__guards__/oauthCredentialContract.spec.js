/**
 * CONTRACT: a call to the remote auth host must carry the credential that host
 * identifies the user by.
 *
 * WHY THIS EXISTS
 * ---------------
 * Connecting any OAuth provider failed at the last step with a raw database
 * error in a user-facing dialog:
 *
 *     Failed to connect to Github: SQLITE_CONSTRAINT: NOT NULL constraint
 *     failed: oauth_tokens.user_id
 *
 * The remote does not read the bearer token on /auth/connect and
 * /auth/callback: those routes answer identically with a valid JWT, a
 * malformed JWT, and no Authorization header at all. Its CORS reply echoes
 * the specific origin and sets `access-control-allow-credentials: true`,
 * which is the configuration a server uses when it expects cookie
 * credentials. Sign-in already talks to that host that way
 * (store/auth/userAuth.js passes withCredentials on every magic-link call),
 * but the OAuth call sites did not -- so the one request that had to be
 * attributed to a user carried nothing the remote reads, the token INSERT ran
 * with user_id = NULL, and SQLite rejected the row.
 *
 * It was a *class* of bug rather than one mistake, for the same reason
 * apiAuthContract.spec.js exists: `connectOAuthApp` and the callback exchange
 * are copy-pasted across six screens. Ten call sites, not the three a reader
 * of the composable would find. A subset fix is worse than none -- it makes
 * connecting work or fail depending on which screen the user clicked Connect
 * from, which is far harder to report than a consistent failure.
 *
 * This derives the call sites from the source itself rather than a
 * hand-maintained list, so a seventh copy cannot be added without either
 * carrying the credential or failing here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(HERE, '..');

/**
 * Remote auth paths that identify the caller. Every entry is a route observed
 * to depend on the session, not on the bearer token.
 */
const CREDENTIALED_PATHS = ['/auth/connect/', '/auth/callback'];

/**
 * Call sites that intentionally omit credentials. Every entry needs a reason.
 * The stale-entry test below fails if one stops being a violation, so dead
 * exceptions cannot quietly accumulate.
 */
const INTENTIONALLY_ANONYMOUS = [
  // e.g. { file: 'services/foo.js', line: 12, reason: 'pre-login bootstrap' }
];

// ---------------------------------------------------------------------------
// Source walking
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // Another spec's fixture dir may vanish mid-walk.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Vendored libraries are not ours to hold to this contract.
      if (entry.name === 'libs' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(vue|js)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Index of the `(` that opens the call enclosing `from`, or -1.
 *
 * Walks backward counting depth so that a URL built with a nested call --
 * `?origin=${encodeURIComponent(window.location.origin)}` -- resolves to the
 * outer fetch/post rather than to encodeURIComponent.
 */
function openingParenBefore(text, from) {
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * The full source of the call starting at `openIdx`, paren-matched.
 *
 * Bounding to the call itself matters: a fixed-width slice bleeds into the
 * NEXT call site in the same file and would report an uncredentialed call as
 * credentialed because a later one nearby happens to carry the flag. That is
 * a false negative, the only direction that matters for a guard.
 */
function callTextAt(text, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx); // unbalanced -- take the rest
}

/**
 * `text` with comments blanked out, so that a commented-out flag cannot
 * satisfy the contract.
 *
 * Without this, `// credentials: 'include',` left behind by someone debugging
 * reads as compliant and the guard waves through a real violation -- a false
 * negative, which is the failure this whole file exists to prevent.
 *
 * It has to be string-aware rather than a `//.*$` sweep: these call sites are
 * built around URLs, and a naive strip turns
 * `'github:http://localhost:3333'` into `'github:http:` -- corrupting the
 * source it is meant to be reading, and deleting any flag that sits after a
 * URL on the same line. That direction is a false POSITIVE, which is how a
 * guard loses the room's trust.
 *
 * Known limit: a regex literal containing `//` would confuse it. None of
 * these call sites contain one, and the assertion below would fail loudly
 * rather than silently pass if that changed.
 */
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Every call to a credentialed remote auth path in a source file, with a
 * verdict on whether it sends credentials.
 *
 * Exported so the self-test below can exercise the detector on a fixture
 * rather than trusting it.
 */
export function findRemoteAuthCalls(source, label = '<inline>') {
  const calls = [];
  const needle = '${API_CONFIG.REMOTE_URL}';

  let at = source.indexOf(needle);
  while (at !== -1) {
    const rest = source.slice(at + needle.length, at + needle.length + 80);
    const matchedPath = CREDENTIALED_PATHS.find((p) => rest.startsWith(p));
    if (matchedPath) {
      const open = openingParenBefore(source, at);
      const call = open === -1 ? '' : stripComments(callTextAt(source, open));
      const sendsCredentials =
        /credentials:\s*['"]include['"]/.test(call) || /withCredentials:\s*true/.test(call);
      calls.push({
        file: label,
        line: source.slice(0, at).split(/\r?\n/).length,
        path: matchedPath,
        sendsCredentials,
      });
    }
    at = source.indexOf(needle, at + needle.length);
  }
  return calls;
}

const ALL_CALLS = walk(FRONTEND_SRC).flatMap((file) =>
  findRemoteAuthCalls(fs.readFileSync(file, 'utf8'), path.relative(FRONTEND_SRC, file))
);

const isAllowed = (call) =>
  INTENTIONALLY_ANONYMOUS.some((entry) => entry.file === call.file && entry.line === call.line);

describe('remote auth calls carry the credential the remote authenticates', () => {
  it('finds the call sites at all, so a silent zero cannot pass', () => {
    // If a refactor renames API_CONFIG.REMOTE_URL this guard would find
    // nothing and vacuously pass. Assert it still sees the known duplication.
    expect(ALL_CALLS.length).toBeGreaterThanOrEqual(8);
  });

  it('every /auth/connect and /auth/callback call sends credentials', () => {
    const violations = ALL_CALLS.filter((c) => !c.sendsCredentials && !isAllowed(c));
    expect(
      violations.map((v) => `${v.file}:${v.line} -> ${v.path}`),
      'these calls reach the remote auth host without the session credential, so the '
        + 'remote cannot attribute them to a user and stores the token with user_id = NULL'
    ).toEqual([]);
  });

  it('keeps the allowlist honest (no stale entries)', () => {
    const stale = INTENTIONALLY_ANONYMOUS.filter(
      (entry) =>
        !ALL_CALLS.some((c) => c.file === entry.file && c.line === entry.line && !c.sendsCredentials)
    );
    expect(stale, 'allowlisted call sites that are no longer violations').toEqual([]);
  });

  it('detects a call that omits credentials (self-test)', () => {
    const fixture = `
      const response = await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/connect/\${app.id}?origin=\${encodeURIComponent(window.location.origin)}\`, {
        headers: { Authorization: \`Bearer \${token}\` },
      });
    `;
    const found = findRemoteAuthCalls(fixture, 'fixture.js');
    expect(found).toHaveLength(1);
    expect(found[0].sendsCredentials).toBe(false);
  });

  it('accepts fetch credentials and axios withCredentials alike (self-test)', () => {
    const withFetch = `
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/callback\`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    `;
    const withAxios = `
      axios.post(
        \`\${API_CONFIG.REMOTE_URL}/auth/callback\`,
        { code, state },
        { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
      );
    `;
    expect(findRemoteAuthCalls(withFetch, 'a.js')[0].sendsCredentials).toBe(true);
    expect(findRemoteAuthCalls(withAxios, 'b.js')[0].sendsCredentials).toBe(true);
  });

  it('does not accept a commented-out credential (self-test)', () => {
    // Reported by Copilot on this PR, and confirmed: before stripComments the
    // detector matched the flag inside a comment and reported compliance.
    const fixture = `
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/connect/\${id}\`, {
        // credentials: 'include',  <- disabled while debugging
        headers: { Authorization: \`Bearer \${token}\` },
      });
    `;
    const found = findRemoteAuthCalls(fixture, 'd.js');
    expect(found).toHaveLength(1);
    expect(found[0].sendsCredentials).toBe(false);
  });

  it('does not accept a block-commented credential either (self-test)', () => {
    const fixture = `
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/callback\`, {
        /* credentials: 'include', */
        headers: {},
      });
    `;
    expect(findRemoteAuthCalls(fixture, 'e.js')[0].sendsCredentials).toBe(false);
  });

  it('is not fooled by a URL inside a string (self-test)', () => {
    // The other direction: a `//.*$` sweep truncates the state string and can
    // delete a real flag, failing a call site that is perfectly correct.
    const fixture = `
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/callback\`, {
        credentials: 'include',
        body: JSON.stringify({ state: 'github:http://localhost:3333' }),
      });
    `;
    expect(findRemoteAuthCalls(fixture, 'f.js')[0].sendsCredentials).toBe(true);
  });

  it('does not let a neighbouring call vouch for an uncredentialed one (self-test)', () => {
    // The failure mode a fixed-width window would produce: the second call
    // borrows the first call's flag and the guard reports all clear.
    const fixture = `
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/callback\`, { credentials: 'include' });
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/connect/\${id}\`, { headers: {} });
    `;
    const found = findRemoteAuthCalls(fixture, 'c.js');
    expect(found.map((f) => f.sendsCredentials)).toEqual([true, false]);
  });
});
