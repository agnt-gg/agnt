/**
 * The API documentation must describe the API that exists.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `docs/_API-DOCUMENTATION.md` is the contract every integrator, plugin author
 * and agent reads. Nothing checked it, so it drifted — silently, and in the two
 * ways that actually cost people time:
 *
 *   1. A whole subsystem shipped undocumented. `/api/pairing` (5 routes) existed
 *      for weeks with zero mentions anywhere in `docs/`.
 *
 *   2. Worse: 24 routes were documented "Authentication: None" AFTER a security
 *      pass had guarded them. A doc that says "no credentials needed" for a
 *      route that 401s sends the reader to debug their own code. The reverse —
 *      a doc claiming auth on an open route — hides a hole behind the doc.
 *
 * Both are mechanically detectable, so they should never have been a human's
 * job. This walks the REAL express layer stacks rather than grepping for
 * `router.get(`, because a grep cannot see router-level `use()` guards and
 * cannot see the method.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT ASSERT
 * ---------------------------------------------------------------------------
 * This used to exempt ~244 routes that carried only the permissive
 * `authenticateToken`, on the reasoning that the doc was "accurate about the
 * observable contract". That reasoning was wrong: the observable contract was
 * that an unauthenticated caller could read, write and delete the workspace.
 * `authenticateToken` now rejects, those routes are genuinely guarded, and this
 * test counts it as a real guard. `routeSecurity.test.js` owns the tiering.
 *
 * This file asserts only the unambiguous direction: a route documented as
 * needing NO credentials must actually need none.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOC_PATH = path.join(REPO, 'docs/_API-DOCUMENTATION.md');
const SERVER_PATH = path.join(REPO, 'backend/server.js');

/**
 * Guards that actually reject. Anything else (notably `authenticateToken`)
 * degrades to an anonymous request and is NOT a guard, whatever its name
 * suggests.
 */
const HARD_GUARDS = /^(requireAuth|requireAuthHeader|requireAuthMedia|requireAdmin|authenticateGateway|(bound )?authenticateToken$)/;

/**
 * Mounts whose routes are documented somewhere other than a section with their
 * own `Base path:` line. Each entry must name a string the doc has to contain,
 * so the exemption still proves the routes are described — it is not a blanket
 * pass, and it goes stale loudly if the doc is reorganised.
 */
const DOCUMENTED_ELSEWHERE = new Map([
  ['/api/auth', { proof: '**GET** `/api/auth/connected`', why: 'Documented inside the Authentication section using absolute paths.' }],
  ['/api/evolution', { proof: '**POST** `/api/evolution/core/run`', why: 'Documented inside Evolution / Insight Routes using absolute paths.' }],
  ['/api/openrouter', { proof: '### OpenRouter legacy mount', why: 'Legacy alias of ModelRoutes; the mount is described, the routes are documented under Model Routes.' }],
]);

let ALL_ROUTES = [];
let doc = '';
let sections = new Map();

/** Section text keyed by the base path it declares. */
function indexSections(text) {
  const out = new Map();
  for (const part of text.split(/^## /m)) {
    const base = part.match(/Base path:\s*`([^`]+)`/);
    if (base) out.set(base[1].replace(/\/$/, ''), part);
  }
  return out;
}

/**
 * The doc lists each route as:
 *     **GET** `/path`
 *     - **Authentication**: <claim>
 * so slice the section on `**METHOD**` markers and read the claim under the one
 * whose path matches.
 */
/**
 * Does a documented path refer to this route?
 *
 * The doc writes some paths relative to the section's base (`/status`) and some
 * absolutely (`/api/auth/connected`), so a bare equality check misses half of
 * them. But a bare `includes` is worse: for the root route `/` it matches
 * EVERY documented path, so six root routes silently adopted the auth claim of
 * their section's `GET /health` block. Anchor on a segment boundary instead.
 */
function pathMatches(docPath, routePath) {
  const norm = (s) => (s.length > 1 ? s.replace(/\/$/, '') : s);
  const d = norm(docPath);
  const r = norm(routePath);
  if (d === r) return true;
  if (r === '/') return false; // only an exact match can mean the root route
  return d.endsWith(r) && '/'.includes(d[d.length - r.length - 1] ?? '/');
}

function claimFor(section, method, routePath) {
  for (const block of section.split(/\n(?=\*\*(?:GET|POST|PUT|PATCH|DELETE)\*\*)/)) {
    const head = block.match(/^\*\*(\w+)\*\*\s+`([^`]+)`/);
    if (!head || head[1] !== method || !pathMatches(head[2], routePath)) continue;
    const auth = block.match(/\*\*Authentication\*\*:\s*([^\n\r]+)/);
    return auth ? auth[1].trim() : null;
  }
  return null;
}

// 60s, not the 10s default. This hook imports ~44 route modules, each of which
// drags in the DB layer, plugin installer and pollers. It completes in ~5s when
// the file runs alone and blew past 10s under full-suite parallel load — i.e.
// the default makes this test flaky by machine speed rather than by
// correctness, which is the worst kind of red.
beforeAll(async () => {
  doc = fs.readFileSync(DOC_PATH, 'utf8');
  sections = indexSections(doc);

  const server = fs.readFileSync(SERVER_PATH, 'utf8');
  const mounts = [...server.matchAll(/app\.use\('(\/api\/[^']*)',\s*(\w+)\)/g)].map((m) => ({
    base: m[1],
    moduleVar: m[2],
  }));
  const importMap = new Map(
    [...server.matchAll(/import\s+(\w+)\s+from\s+'\.\/src\/routes\/([\w.]+)\.js'/g)].map((m) => [m[1], m[2]])
  );

  for (const { base, moduleVar } of mounts) {
    const file = importMap.get(moduleVar);
    const full = file && path.join(__dirname, `${file}.js`);
    if (!full || !fs.existsSync(full)) continue;

    let router;
    try {
      router = (await import(pathToFileURL(full))).default;
    } catch {
      continue; // routeSecurity.test.js owns "module failed to load"
    }
    if (!router || !Array.isArray(router.stack)) continue;

    const routerGuarded = router.stack.some((l) => !l.route && HARD_GUARDS.test(l.handle?.name || ''));

    for (const layer of router.stack) {
      if (!layer.route || typeof layer.route.path !== 'string') continue;
      const guarded =
        routerGuarded || (layer.route.stack || []).some((s) => HARD_GUARDS.test(s.handle?.name || ''));
      for (const [m, on] of Object.entries(layer.route.methods || {})) {
        if (on) ALL_ROUTES.push({ base, file, method: m.toUpperCase(), path: layer.route.path, guarded });
      }
    }
  }
}, 60_000);

describe('API documentation contract', () => {
  it('walked a plausible number of real routes', () => {
    // Guards the guard: if the layer walk silently returned nothing, every
    // assertion below would pass vacuously.
    expect(ALL_ROUTES.length).toBeGreaterThan(250);
  });

  it('every mounted base path is documented', () => {
    const undocumented = [];
    for (const base of new Set(ALL_ROUTES.map((r) => r.base))) {
      if (sections.has(base)) continue;
      const exemption = DOCUMENTED_ELSEWHERE.get(base);
      if (exemption && doc.includes(exemption.proof)) continue;
      undocumented.push(base);
    }

    expect(
      undocumented,
      `These mounts have no section in docs/_API-DOCUMENTATION.md:\n` +
        undocumented.map((b) => `  ${b}`).join('\n') +
        `\n\nAdd a "## <Name> Routes" section with a "Base path: \`${undocumented[0] || '/api/x'}\`" line ` +
        `(and a Table of Contents entry), or add it to DOCUMENTED_ELSEWHERE with proof text.`
    ).toEqual([]);
  });

  it('every exemption in DOCUMENTED_ELSEWHERE is still earned', () => {
    // An exemption whose proof text has been edited away is silently excusing a
    // gap. Fail on the stale entry rather than on the route.
    const stale = [...DOCUMENTED_ELSEWHERE.entries()]
      .filter(([, v]) => !doc.includes(v.proof))
      .map(([k, v]) => `${k} (looked for: ${v.proof})`);
    expect(stale, 'Exemptions whose proof text no longer appears in the doc').toEqual([]);
  });

  it('no route is documented as needing no credentials while it is guarded', () => {
    const lies = [];
    for (const r of ALL_ROUTES) {
      const section = sections.get(r.base);
      if (!section) continue;
      const claim = claimFor(section, r.method, r.path);
      if (claim === null) continue;
      if (/^none/i.test(claim) && r.guarded) {
        lies.push(`${r.method} ${r.base}${r.path === '/' ? '' : r.path}  (${r.file})`);
      }
    }

    expect(
      lies,
      'Documented "Authentication: None" but hard-guarded — callers will get a 401 the doc does not predict:\n' +
        lies.map((l) => `  ${l}`).join('\n')
    ).toEqual([]);
  });

  it('the pairing subsystem is documented, including the claim endpoint being deliberately open', () => {
    // Pairing is the case that motivated this file: it shipped with zero doc
    // coverage. /claim is the one route that MUST stay unauthenticated (the code
    // is the credential), so the doc has to say that on purpose rather than by
    // omission.
    const section = sections.get('/api/pairing');
    expect(section, 'No "Base path: `/api/pairing`" section found').toBeTruthy();
    for (const p of ['/status', '/lan-access', '/code', '/claim', '/revoke']) {
      expect(section, `pairing ${p} is not documented`).toContain(`\`${p}\``);
    }
    expect(claimFor(section, 'POST', '/claim')).toMatch(/none\b.*by design/i);
    // The origin-resolution rules are the part a self-hoster behind a proxy
    // needs; losing them turns a working setup into an unexplained dead QR.
    //
    // Matched in the doc's backticked code form rather than as a bare
    // substring: `expect(section).toContain('PUBLIC_ORIGIN')` is also satisfied
    // by `PUBLIC_ORIGIN_X`, so it would pass while documenting a variable that
    // does not exist. (Caught by negative control ND4.)
    expect(section).toMatch(/`PUBLIC_ORIGIN`/);
    expect(section).toMatch(/`TRUST_PROXY`/);
    expect(section).toMatch(/### Which origin goes in the QR/);
  });

  // -------------------------------------------------------------------------
  // PHANTOM ENVIRONMENT VARIABLES
  // -------------------------------------------------------------------------
  // The third drift class, and the most user-hostile: five docs instructed
  // readers to set `USE_EXTERNAL_BACKEND=true` and `BACKEND_URL=...` for the
  // remote-backend feature. Neither string appears anywhere in the source. The
  // reader follows the guide exactly, nothing happens, and there is no error
  // message because nothing is listening for those names. The real mechanism
  // (`AGNT_REMOTE_URL`) was documented nowhere.
  //
  // A variable that appears in a doc's shell block is a promise. Keep it.
  it('every environment variable the docs tell users to set is actually read', () => {
    const known = new Set();

    // Every filesystem call here tolerates the entry disappearing between the
    // moment it was listed and the moment it is read. This walk covers
    // backend/src AND frontend/src, and other suites legitimately create and
    // delete fixture files in those trees while it runs — so an ENOENT here
    // means "something else was busy", never "the docs are wrong". Swallowing
    // it cannot hide a real violation: a file that vanished contributed no
    // env names either way, and the `known.size > 100` sanity check below
    // still fails loudly if the scan silently collapses.
    const CODE_FILE = /\.(js|mjs|cjs|ts|vue)$/;
    const SKIP_DIR = new Set(['node_modules', 'dist', '.git']);

    const harvest = (text) => {
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) known.add(m[1]);
      for (const m of text.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) known.add(m[1]);
      for (const m of text.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) known.add(m[1]);
    };

    // `withFileTypes` returns each entry's kind from the directory read that
    // already happened, instead of a statSync per entry, and the extension
    // filter runs before any I/O touches the file. Measured on this repo:
    // 1,244 files / 18.7 MB, 484ms -> 423ms, with a byte-identical result set
    // (same 1,244 files, same 103 names) — verified before adopting it.
    const scanDir = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (SKIP_DIR.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(full);
          continue;
        }
        if (!e.isFile() || !CODE_FILE.test(e.name)) continue;
        let t;
        try {
          t = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        harvest(t);
      }
    };

    const scan = (p) => {
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        return;
      }
      if (st.isDirectory()) return scanDir(p);
      if (!CODE_FILE.test(p)) return;
      try {
        harvest(fs.readFileSync(p, 'utf8'));
      } catch {
        /* vanished mid-walk; contributes nothing either way */
      }
    };
    for (const d of [
      'backend/src',
      'backend/server.js',
      'main.js',
      'preload.js',
      'electron',
      'frontend/src',
      'scripts', // notarize.js reads APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD
    ]) {
      scan(path.join(REPO, d));
    }

    // Deployment files legitimately define names consumed by Docker, compose or
    // make rather than by our JavaScript, so they count as declarations too.
    for (const f of ['docker-compose.yml', 'Dockerfile', '.env.example', 'Makefile']) {
      const p = path.join(REPO, f);
      if (!fs.existsSync(p)) continue;
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/gm)) known.add(m[1]);
      for (const m of t.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) known.add(m[1]);
      for (const m of t.matchAll(/\$\(([A-Z][A-Z0-9_]{2,})\)/g)) known.add(m[1]); // make's $(VAR)
    }

    // Consumed directly by a third-party tool, so they appear in no file we own.
    for (const n of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_IDENTITY_AUTO_DISCOVERY']) known.add(n);

    // Sanity: if the scan found almost nothing, the assertion below is vacuous.
    // Also the flake tripwire — a scan degraded by a bad filter shows up here
    // as a shrinking number rather than as a mysteriously fast green run.
    expect(known.size).toBeGreaterThan(100);

    const docsDir = path.join(REPO, 'docs');
    const phantom = new Map();
    let fencesScanned = 0;
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(docsDir, f), 'utf8');
      // `\r?\n`, not `\n`: docs/ is CRLF. The first version of this matcher
      // required a bare LF, matched ZERO fences, and therefore reported a clean
      // bill of health while two phantom variables sat in five files. The
      // fencesScanned assertion below exists so that can never recur silently.
      for (const fence of text.matchAll(/```(?:bash|sh|shell|env|dotenv|yaml|yml)?\r?\n([\s\S]*?)```/g)) {
        fencesScanned++;
        for (const line of fence[1].split(/\r?\n/)) {
          const m = line.match(/^\s*(?:export\s+|-\s+|#\s*)?([A-Z][A-Z0-9_]{2,})=/);
          if (!m || known.has(m[1])) continue;
          if (!phantom.has(m[1])) phantom.set(m[1], new Set());
          phantom.get(m[1]).add(f);
        }
      }
    }

    // A matcher that scans nothing passes everything.
    expect(fencesScanned, 'No fenced code blocks were parsed — the matcher is broken, not the docs').toBeGreaterThan(100);

    const report = [...phantom].map(([n, files]) => `${n} (in ${[...files].join(', ')})`);
    expect(
      report,
      'Documented environment variables that no source file reads. Setting one ' +
        'does nothing and reports no error, so the reader has no way to tell:\n' +
        report.map((r) => `  ${r}`).join('\n')
    ).toEqual([]);
    // 60s, not the 5s default. This is repo-wide static analysis wearing a unit
    // test's clothes: it reads 1,244 files / 18.7 MB synchronously. Measured at
    // 423ms on an idle disk in a single process — only 8x under the default —
    // and the full backend suite runs it alongside ~20 workers that are each
    // doing their own file I/O and sqlite init. It passed 9/9 in isolation and
    // timed out at 5000ms in the full run: a pure contention overrun, never a
    // real failure. A gate that fires randomly on green code gets ignored
    // exactly like a permanently red one, so the budget now reflects what the
    // work actually costs instead of asserting a speed it never had.
  }, 60_000);

  // -------------------------------------------------------------------------
  // TOPOLOGY COVERAGE
  // -------------------------------------------------------------------------
  // The reference material (env vars, API routes) was documented while the
  // end-to-end SCENARIOS were not — someone could read every variable and still
  // not know that pairing works over Tailscale, or that a remote-connected
  // desktop administers the SERVER's phone access. Tailscale in particular
  // appeared zero times in docs/ despite being the best answer for remote
  // access. Pin each supported deployment so it cannot quietly disappear.
  it('the topology guide covers every supported deployment', () => {
    const guide = fs.readFileSync(path.join(REPO, 'docs/REMOTE_ACCESS_TOPOLOGIES.md'), 'utf8');

    // Assert each topology's own SECTION, not merely its keyword. The first
    // version of this test matched /tailscale/i anywhere in the file, which the
    // one-line summary table satisfies on its own — so the entire Tailscale
    // walkthrough could be deleted and the test stayed green. (Caught by
    // negative control ND7.) A heading plus one operational detail cannot be
    // satisfied by a table row.
    const headings = new Set(
      [...guide.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase())
    );
    expect(headings.size, 'no section headings parsed — the matcher is broken').toBeGreaterThan(5);

    for (const [topology, heading, detail] of [
      ['same machine / LAN', '1. desktop is the server', /same Wi-Fi/i],
      ['home server + remote desktop', '2. home server, everyone on the lan', /Remote backend/i],
      ['administering a server remotely', '3. administer the server while you are away from it', /cannot pair a phone to \*itself\*/i],
      ['tailscale / VPN', '4. tailscale / vpn — private access from anywhere', /tailscale ip -4/],
      ['reverse proxy + HTTPS', '5. public hostname behind a reverse proxy', /`TRUST_PROXY=private`/],
      ['multi-homed host', '6. a machine on several networks at once', /the QR re-renders/i],
    ]) {
      expect([...headings], `topology section missing: ${topology}`).toContain(heading);
      expect(guide, `topology documented but not actionable: ${topology}`).toMatch(detail);
    }

    // The one setting a self-hoster cannot guess from anything observable.
    expect(guide).toMatch(/`PUBLIC_ORIGIN=/);

    // Discoverability: an unlinked guide is a guide nobody reads.
    expect(fs.readFileSync(path.join(REPO, 'docs/QUICKSTART_INDEX.md'), 'utf8')).toContain(
      'REMOTE_ACCESS_TOPOLOGIES.md'
    );
  });

  // -------------------------------------------------------------------------
  // INTERNAL LINKS
  // -------------------------------------------------------------------------
  // Written after shipping `SELF_HOSTING.md#reverse-proxy-setup` when the real
  // heading is "Reverse Proxy Configuration". A broken anchor fails silently:
  // the page loads, the reader lands at the top, and concludes the section they
  // were promised does not exist.
  it('every relative link between docs resolves, including anchors', () => {
    const docsDir = path.join(REPO, 'docs');
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));

    /** GitHub's slug algorithm, close enough for our headings. */
    const slug = (h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    const anchorsFor = (text) =>
      new Set([...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])));

    const broken = [];
    let checked = 0;

    for (const f of files) {
      const text = fs.readFileSync(path.join(docsDir, f), 'utf8');
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|#)/.test(href)) continue; // external / same-page
        const [rel, anchor] = href.split('#');
        if (!rel) continue;
        const target = path.resolve(docsDir, rel);
        checked++;

        if (!fs.existsSync(target)) {
          broken.push(`${f} -> ${href}  (file not found)`);
          continue;
        }
        if (anchor && target.endsWith('.md')) {
          const available = anchorsFor(fs.readFileSync(target, 'utf8'));
          if (!available.has(anchor.toLowerCase())) {
            broken.push(`${f} -> ${href}  (no such heading)`);
          }
        }
      }
    }

    // A link checker that found no links is not a passing link checker.
    expect(checked, 'No relative doc links were parsed — the matcher is broken').toBeGreaterThan(20);
    expect(broken, `Broken internal doc links:\n${broken.map((b) => `  ${b}`).join('\n')}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // SELF-TEST
  // -------------------------------------------------------------------------
  // Without this, every assertion above could rot into a matcher that passes
  // because it matches nothing. Reproduce both real defects against synthetic
  // input and prove the machinery reports them.
  it('the matchers actually catch the two defects they exist to prevent', () => {
    const fakeDoc = `
## Example Routes

Base path: \`/api/example\`

### Do A Thing

**POST** \`/do-thing\`

- **Authentication**: None
- **Description**: whatever
`;
    const fakeSections = indexSections(fakeDoc);

    // Defect 1: a mount with no section is detected.
    expect(fakeSections.has('/api/missing')).toBe(false);

    // Defect 2: a "None" claim is read back correctly, so the guarded check has
    // something to compare against.
    expect(claimFor(fakeSections.get('/api/example'), 'POST', '/do-thing')).toBe('None');

    // The root-route trap: '/health'.includes('/') is true, so a substring
    // matcher gives EVERY root route the health endpoint's auth claim. Six
    // routes were mis-reported this way before pathMatches() existed.
    const rootTrap = indexSections(`
## Trap Routes

Base path: \`/api/trap\`

### Health Check

**GET** \`/health\`

- **Authentication**: None

### List Things

**GET** \`/\`

- **Authentication**: Required
`);
    expect(claimFor(rootTrap.get('/api/trap'), 'GET', '/')).toBe('Required');
    expect(claimFor(rootTrap.get('/api/trap'), 'GET', '/health')).toBe('None');

    // And a corrected doc reads back as fixed — proving the matcher
    // discriminates rather than always reporting "None".
    const fixed = indexSections(fakeDoc.replace('**Authentication**: None', '**Authentication**: Required'));
    expect(claimFor(fixed.get('/api/example'), 'POST', '/do-thing')).toBe('Required');
  });
});
