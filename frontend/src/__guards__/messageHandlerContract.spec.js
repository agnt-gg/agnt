/**
 * CONTRACT: every `message` listener establishes trust, then checks the
 * payload's shape, and only then reads it.
 *
 * WHY THIS EXISTS
 * ---------------
 * `window.addEventListener('message', ...)` is a GLOBAL receiver. It gets every
 * message the window is sent, from anyone who can reach it — an attacker page
 * that framed us, a browser extension, a dev-server client, another widget.
 * Cross-origin *sending* is permitted by design and cannot be prevented, so
 * whatever the handler checks first IS the trust boundary.
 *
 * Three separate defects in this codebase came from getting that sequence
 * wrong, and each was found only after shipping:
 *
 *   1. NO TRUST CHECK. Connectors.vue redeemed an OAuth authorization code
 *      with the signed-in user's bearer token, from any sender at all.
 *
 *   2. A TRUST CHECK THAT DID NOT WORK. Two handlers shared
 *      `allowedOrigins.some((origin) => event.origin === origin ||
 *      event.origin.includes('localhost'))` — whose second term never
 *      references the callback's own parameter, making it an unconditional
 *      substring test that admitted `localhost.evil.com` and friends.
 *
 *   3. TRUST WITHOUT SHAPE. Handlers that had cleared the origin then read
 *      `event.data.type` directly, so a trusted-origin sender posting `null`
 *      threw a TypeError. The handlers are `async`, so that surfaced as an
 *      unhandled rejection: nothing crashed, nothing was logged where anyone
 *      looked, and the handler silently did not run.
 *
 * Every one of those is an ORDERING or PRESENCE property of a handler body.
 * None of them is visible in review, none makes a test go red on its own, and
 * two of the three were shipped for months. That is precisely the shape of
 * defect a mechanical check earns its keep against.
 *
 * WHY THE RULE IS "TRUST", NOT "ORIGIN"
 * -------------------------------------
 * Three of the handlers here do not check `event.origin` at all, and are right
 * not to. They compare the SENDER instead:
 *
 *   widgetSdk.js       `widgetWindows.has(event.source)`  — a WeakSet allowlist
 *   Artifacts.vue      `event.source !== previewFrame.value.contentWindow`
 *
 * Identity is strictly stronger than origin: same-origin does not mean "the
 * window I opened", which is exactly the hole Copilot found in the Google
 * sign-in handler — artifact and widget iframes are `allow-scripts
 * allow-same-origin`, so authored HTML runs at our own origin and passes any
 * origin check. Demanding a redundant origin comparison from those handlers
 * would be cargo-cult, so the contract accepts either mechanism.
 *
 * Which handlers are origin-gated is DERIVED from the code, never listed. Turn
 * an identity-gated handler into an origin-gated one and the ordering rule
 * starts applying to it automatically, with nobody having to remember this
 * file exists.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK
 * -------------------------------------
 * That the trust check is CORRECT. A predicate can be present and still be
 * wrong — defect 2 above was exactly that. Correctness is pinned by the unit
 * tests for each predicate; this file pins that one is called, and called
 * first. The two jobs are complementary and neither substitutes for the other.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(HERE, '..');

/**
 * The predicates allowed to answer "may this sender act?". Both parse and
 * compare origins properly; see their own specs for why each exists.
 */
const ORIGIN_PREDICATES = ['isTrustedOAuthMessageOrigin', 'isTrustedAuthMessage'];

/** The predicate allowed to answer "is this payload actionable?". */
const PAYLOAD_PREDICATE = 'hasOAuthMessagePayload';

/**
 * Modules that DEFINE the predicates, and their specs. They necessarily
 * mention `event.origin` and `event.data` without being message handlers.
 */
const PREDICATE_MODULES = [
  'utils/oauthMessageOrigin.js',
  'utils/oauthMessageOrigin.spec.js',
  'utils/googleAuthPopup.js',
  'utils/googleAuthPopup.spec.js',
];

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------

/**
 * Remove comments, string- and template-aware.
 *
 * A naive `//.*$` sweep truncates any line containing a URL — `'http://x'`
 * becomes `'http:` — which deletes real code from the text being scanned and
 * turns every assertion below into a false pass. Self-tested at the bottom.
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

/**
 * Blank the CONTENTS of template literals, preserving length so every index
 * computed afterwards still lines up with the original text.
 *
 * This is what excludes the widget-side listener in widgetSdk.js: that code
 * lives inside a backtick template, is injected into the widget iframe's
 * srcdoc, and runs over there rather than in this application. Treating it as
 * a host handler would be wrong — and it is worth noting it satisfies the
 * contract anyway, opening with `if (event.source !== parent) return;`.
 *
 * The exclusion is asserted below rather than assumed, so moving that listener
 * into real host code brings it back under every rule here.
 */
function blankTemplateContents(code) {
  let out = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];
    if (ch === '`') {
      out += ch;
      i++;
      while (i < n && code[i] !== '`') {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '`';
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          out += code[i] + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === quote) {
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

/** Scan forward from an opening brace to its match, skipping quoted strings. */
function matchBrace(code, openIndex) {
  let depth = 0;
  let i = openIndex;
  const n = code.length;

  while (i < n) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Handler discovery
// ---------------------------------------------------------------------------

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(js|vue)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Every `window.addEventListener('message', ...)` in host code, with the body
 * of the function it registers.
 *
 * Registrations on a DataChannel or an EventSource are deliberately not
 * matched: `dc.addEventListener('message')` is a negotiated WebRTC peer and
 * `eventSource.addEventListener('message')` is a same-origin SSE stream, so
 * neither is spoofable by a third party and neither has an `event.origin` to
 * check. Only `window` receives postMessage.
 */
function messageHandlers() {
  const handlers = [];

  for (const full of walk(FRONTEND_SRC)) {
    const rel = path.relative(FRONTEND_SRC, full).split(path.sep).join('/');
    if (PREDICATE_MODULES.includes(rel)) continue;
    if (rel.endsWith('messageHandlerContract.spec.js')) continue;

    const code = blankTemplateContents(stripComments(fs.readFileSync(full, 'utf8')));
    const re = /window\.addEventListener\(\s*['"]message['"]\s*,\s*/g;
    let m;

    while ((m = re.exec(code))) {
      const after = code.slice(m.index + m[0].length);

      // Inline: `function (event) {` or `(event) => {`
      const inline = after.match(/^(?:async\s+)?(?:function\s*)?\(?[\w$]*\)?\s*(?:=>)?\s*\{/);
      if (inline) {
        const open = m.index + m[0].length + inline[0].length - 1;
        const close = matchBrace(code, open);
        if (close > -1) handlers.push({ rel, name: '<inline>', body: code.slice(open, close + 1) });
        continue;
      }

      // Named: resolve the identifier to its declaration.
      const named = after.match(/^([A-Za-z_$][\w$]*)\s*\)/);
      if (!named) continue;
      const name = named[1];

      const declRe = new RegExp(
        `(?:const|let|var|function)\\s+${name}\\b[\\s\\S]{0,200}?\\{`,
        'g',
      );
      const decl = declRe.exec(code);
      if (!decl) continue;

      const open = decl.index + decl[0].length - 1;
      const close = matchBrace(code, open);
      if (close > -1) handlers.push({ rel, name, body: code.slice(open, close + 1) });
    }
  }

  return handlers;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const originGateIndex = (body) => {
  const hits = ORIGIN_PREDICATES.map((p) => body.indexOf(`${p}(`)).filter((i) => i > -1);
  return hits.length ? Math.min(...hits) : -1;
};

/** A comparison against the sending window, which is stronger than an origin. */
const identityGateIndex = (body) => {
  const m = body.match(/event\.source\s*(?:!==|===)|\.has\(\s*event\.source\s*\)/);
  return m ? m.index : -1;
};

/**
 * Where this handler first establishes that the payload is safe to read.
 *
 * Three spellings count, because all three are sound:
 *   - the shared predicate, `hasOAuthMessagePayload(event)`
 *   - optional chaining, `event.data?.`
 *   - a falsy test on the payload or an alias of it, `if (!data || ...)`
 */
function shapeGuardIndex(body) {
  const candidates = [];

  const shared = body.indexOf(`${PAYLOAD_PREDICATE}(`);
  if (shared > -1) candidates.push(shared);

  const optional = body.indexOf('event.data?.');
  if (optional > -1) candidates.push(optional);

  const direct = body.match(/!\s*event\.data\b/);
  if (direct) candidates.push(direct.index);

  for (const alias of aliasesOfEventData(body)) {
    const falsy = body.match(new RegExp(`!\\s*${alias}\\b`));
    if (falsy) candidates.push(falsy.index);
  }

  return candidates.length ? Math.min(...candidates) : -1;
}

/** Local names bound to `event.data`, e.g. `const data = event.data;`. */
function aliasesOfEventData(body) {
  const names = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*event\.data\b/g;
  let m;
  while ((m = re.exec(body))) names.push(m[1]);
  return names;
}

/**
 * Where this handler first dereferences a property off the payload WITHOUT
 * optional chaining — the read that throws when the payload is absent.
 *
 * Destructuring (`const { code } = event.data`) is out of scope: it is only
 * ever reached inside a branch already gated on `?.`, and proving that
 * mechanically would need real flow analysis. The dot-dereference above is the
 * exact shape that actually threw in production.
 */
function unguardedReadIndex(body) {
  const candidates = [];

  const directRe = /event\.data\.[A-Za-z_$]/g;
  let m;
  while ((m = directRe.exec(body))) candidates.push(m.index);

  for (const alias of aliasesOfEventData(body)) {
    // Negative lookbehind so `event.data.` is not counted twice via alias `data`.
    const aliasRe = new RegExp(`(?<![.\\w$])${alias}\\.[A-Za-z_$]`, 'g');
    let a;
    while ((a = aliasRe.exec(body))) candidates.push(a.index);
  }

  return candidates.length ? Math.min(...candidates) : -1;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe('every window message handler: trust, then shape, then read', () => {
  const handlers = messageHandlers();
  const describeOne = (h) => `${h.rel} (${h.name})`;

  it('discovers the handlers, so a silent zero cannot pass this suite', () => {
    // Without this, renaming addEventListener or breaking the body extractor
    // would empty the set and every assertion below would vacuously succeed.
    const files = handlers.map((h) => h.rel);

    expect(handlers.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain('canvas/widgetSdk.js');
    expect(files).toContain('composables/useProviderConnection.js');
    expect(files).toContain('views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue');
    expect(files).toContain('views/Terminal/CenterPanel/screens/Connectors/Connectors.vue');
    expect(files).toContain(
      'views/Terminal/CenterPanel/screens/Settings/components/LoginSection/LoginSection.vue',
    );
    expect(files).toContain(
      'views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue',
    );
  });

  it('extracts a real body for each, not an empty match', () => {
    // A zero-length body would satisfy "no unguarded read" for free.
    const tiny = handlers.filter((h) => h.body.length < 40).map(describeOne);

    expect(tiny, 'these bodies are too short to be real handlers').toEqual([]);
  });

  it('establishes sender trust before acting, in every handler', () => {
    // Either mechanism is accepted. Identity is the stronger of the two:
    // same-origin does not mean "the window I opened", and this app runs
    // authored HTML in allow-same-origin iframes.
    const untrusted = handlers
      .filter((h) => originGateIndex(h.body) === -1 && identityGateIndex(h.body) === -1)
      .map(describeOne);

    // Phrased as "approved" on purpose: a hand-rolled origin comparison is a
    // check, and two of these once had one that silently did not work. Being
    // present is not the bar; delegating to a tested predicate is.
    expect(
      untrusted,
      'these establish trust via neither an approved origin predicate nor a sender-identity check',
    ).toEqual([]);
  });

  it('checks the payload is there before dereferencing it', () => {
    const unguarded = handlers
      .filter((h) => {
        const read = unguardedReadIndex(h.body);
        if (read === -1) return false; // never dot-dereferences the payload
        const shape = shapeGuardIndex(h.body);
        return shape === -1 || shape > read;
      })
      .map(describeOne);

    expect(
      unguarded,
      'these read a property off event.data before establishing it is an object',
    ).toEqual([]);
  });

  it('orders origin-gated handlers origin -> payload -> read', () => {
    // The literal sequence, applied to the handlers whose trust mechanism IS
    // the origin. Membership is derived from the code above, so converting a
    // handler to origin-gating brings it under this rule automatically.
    const misordered = handlers
      .filter((h) => originGateIndex(h.body) > -1)
      .filter((h) => {
        const origin = originGateIndex(h.body);
        const shape = shapeGuardIndex(h.body);
        const read = unguardedReadIndex(h.body);
        if (shape === -1) return true; // origin-gated but never shape-checked
        if (origin > shape) return true; // payload trusted before the sender was
        return read > -1 && read < shape;
      })
      .map(describeOne);

    expect(misordered, 'these break the origin -> payload -> read sequence').toEqual([]);
  });

  it('leaves origin comparison to the shared predicates', () => {
    // The two guards that existed were copy-pasted, and the copy is what let
    // them drift apart until one of them silently stopped working.
    const handRolled = handlers
      .filter(({ body }) =>
        /event\.origin\s*(?:===|!==|\.includes|\.startsWith|\.indexOf|\.match)/.test(body),
      )
      .map(describeOne);

    expect(
      handRolled,
      `these compare event.origin inline instead of using ${ORIGIN_PREDICATES.join(' / ')}`,
    ).toEqual([]);
  });
});

/**
 * The widget-side listener in widgetSdk.js is injected into an iframe's srcdoc
 * and runs in the widget, not here. It is excluded by blanking template
 * contents rather than by name, so the exclusion cannot rot — and if anyone
 * lifts that code into the host, discovery picks it up and every rule applies.
 */
describe('the injected widget-side listener', () => {
  const raw = fs.readFileSync(path.join(FRONTEND_SRC, 'canvas/widgetSdk.js'), 'utf8');

  it('exists in the source as a template literal', () => {
    expect(raw).toContain("window.addEventListener('message', function(event)");
  });

  it('is not counted as a host handler', () => {
    const inlineHandlers = messageHandlers().filter(
      (h) => h.rel === 'canvas/widgetSdk.js' && h.name === '<inline>',
    );

    expect(inlineHandlers).toEqual([]);
  });

  it('satisfies the contract anyway, by checking the sender first', () => {
    // Not enforced here, but worth pinning: it opens by comparing the sender,
    // so lifting it into host code would not suddenly fail the suite.
    const idx = raw.indexOf("window.addEventListener('message', function(event)");
    expect(raw.slice(idx, idx + 160)).toContain('event.source !== parent');
  });
});

/**
 * Self-tests. A normaliser that eats real code turns every assertion above
 * into a false pass, which is the failure mode Copilot caught in the sibling
 * guard on #78.
 */
describe('the source normalisers this contract depends on', () => {
  it('removes a commented-out trust check', () => {
    expect(stripComments('// isTrustedOAuthMessageOrigin(event.origin)')).not.toContain(
      'isTrustedOAuthMessageOrigin',
    );
  });

  it('keeps a URL that contains a double slash', () => {
    const line = `const state = 'github:http://localhost:3333';`;
    expect(stripComments(line)).toBe(line);
  });

  it('keeps code that follows a URL on the same line', () => {
    const line = `send('https://api.agnt.gg'); check(event.origin);`;
    expect(stripComments(line)).toContain('check(event.origin)');
  });

  it('blanks template contents but preserves every index', () => {
    const src = 'a(`  hidden(x)  `);b();';
    const out = blankTemplateContents(src);

    expect(out.length).toBe(src.length);
    expect(out).not.toContain('hidden');
    expect(out.indexOf('b()')).toBe(src.indexOf('b()'));
  });

  it("leaves ordinary quoted strings alone, so 'message' stays findable", () => {
    const src = `window.addEventListener('message', h)`;
    expect(blankTemplateContents(src)).toBe(src);
  });

  it('matches braces across a string containing an unbalanced one', () => {
    const src = 'f() { const s = "}"; g(); }';
    const open = src.indexOf('{');

    expect(matchBrace(src, open)).toBe(src.length - 1);
  });

  it('does not count event.data. twice when an alias is also named data', () => {
    // `event.data.type` contains the substring `data.`, so a naive alias scan
    // would report a read at the wrong index.
    const body = '{ const data = event.data; if (!data) return; x = event.data.type; }';
    expect(unguardedReadIndex(body)).toBe(body.indexOf('event.data.type'));
  });
});
