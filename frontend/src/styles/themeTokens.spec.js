/**
 * Guard: the theme layer cannot silently invert again.
 *
 * WHY (2026-08-02)
 * ────────────────
 * The light themes were built by REDEFINING the dark base scale in place:
 * --color-white became #ffffff, --color-black-navy became #fcfcfc,
 * --color-primary went from neon green to dark pink. That works only while
 * both halves of every foreground/background pair flip together, and 285
 * pairs did not. Each one was legible in whichever theme its author used and
 * unreadable in the other, which is precisely the bug no one sees.
 *
 * Three failure modes, three checks, in the order they actually bit:
 *
 *   1. GHOST TOKENS. 192 `var(--x)` references named tokens defined in NO
 *      theme (--Dark-Navy, --terminal-bg, --cyan …). CSS has no
 *      undefined-variable error, so the fallback after the comma painted in
 *      every theme: a hardcoded colour wearing a token's clothing.
 *
 *   2. UNPAIRED FILLS. `color:#fff` on `background:var(--color-primary)`
 *      measured 5.15:1 in light and 1.53:1 in dark, because primary is dark
 *      pink in one theme and neon green in the other. The fix is structural:
 *      every --fill-x ships with an --on-fill-x, so contrast is a property of
 *      a token PAIR defined once, not of every call site.
 *
 *   3. NEW HARDCODED TEXT. Someone types `rgba(255,255,255,0.5)` because it
 *      looks right in the theme they have open.
 *
 * ─── HOW THIS TEST STAYS USEFUL ────────────────────────────────────────────
 * Check 3 is frozen against a BASELINE COUNT, not zero. There are still
 * legitimate hardcoded colours (self-contained dark surfaces, brand-mandated
 * colours, syntax themes) and a rule that opens red with 80 failures gets
 * commented out inside a week — that is exactly how this codebase's own test
 * suite rotted before. The number may only go DOWN. If you fix some, lower it;
 * the test tells you the new value.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = path.join(SRC, 'styles', 'themes');

/* ─────────────────────────── file walking ─────────────────────────── */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|dist|\.git/.test(e.name)) walk(p, out);
    } else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const ALL_FILES = walk(SRC);
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const blankComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Style text only — a .vue template may contain colours in prose or data. */
function styleText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.css')) return raw;
  return [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}

/* ─────────────────────── check 1: every token exists ─────────────────────── */
describe('theme tokens: nothing references a token that does not exist', () => {
  /**
   * CSS custom property names are CASE-SENSITIVE — --Dark-Navy is a different
   * property from --dark-navy. Matching case-insensitively here would hide
   * exactly the bug this test exists to catch.
   */
  const NAME = '--[A-Za-z0-9_-]+';

  const declared = new Set();
  for (const f of ALL_FILES) {
    for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(new RegExp(`(${NAME})\\s*:`, 'g'))) {
      declared.add(m[1]);
    }
  }

  /**
   * Set at runtime rather than in a stylesheet: inline :style bindings, JS,
   * and per-instance widget knobs. Each is genuinely defined where it is used.
   */
  const RUNTIME_DEFINED = new Set([
    '--i', '--steps', '--bg-blur', '--bg-opacity', '--rotation', '--delay', '--index',
    '--progress', '--angle', '--scale', '--duration', '--x', '--y', '--w', '--h',
  ]);

  it('every var(--x) in a stylesheet resolves to a declared token', () => {
    const missing = new Map();
    for (const f of ALL_FILES) {
      const r = rel(f);
      if (/base\/js\/libs|\.min\.|__old-/.test(r)) continue;
      const css = blankComments(styleText(f));
      css.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(new RegExp(`var\\(\\s*(${NAME})`, 'g'))) {
          const tok = m[1];
          if (declared.has(tok) || RUNTIME_DEFINED.has(tok)) continue;
          if (!missing.has(tok)) missing.set(tok, []);
          missing.get(tok).push(`${r}:${i + 1}`);
        }
      });
    }
    const report = [...missing.entries()]
      .map(([tok, at]) => `  ${tok}  (${at.length}x, first at ${at[0]})`)
      .join('\n');
    expect(
      missing.size,
      `These tokens are referenced but declared nowhere, so the fallback after the comma\n`
      + `paints in EVERY theme — a hardcoded colour wearing a token's clothing.\n`
      + `Either declare them, or point the call site at a semantic token:\n${report}\n`
    ).toBe(0);
  });

  it('finds a realistic number of declared tokens (anti-vacuity)', () => {
    // If the declaration scan silently broke, everything would look "missing";
    // if the reference scan broke, nothing would. Pin both ends.
    expect(declared.size).toBeGreaterThan(200);
    expect(declared.has('--color-primary')).toBe(true);
    expect(declared.has('--Dark-Navy')).toBe(true); // mixed case, from _aliases.css
  });
});

/* ─────────────────── check 2: fills are paired with a label ─────────────────── */
describe('theme tokens: every fill ships with its on-fill companion', () => {
  const semantic = stripComments(fs.readFileSync(path.join(THEMES, '_semantic.css'), 'utf8'));

  /** Token map for one selector block. Case-sensitive, deliberately. */
  const blockOf = (css, selector) => {
    const out = {};
    const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'g');
    for (const m of css.matchAll(re)) {
      for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
    }
    return out;
  };

  const base = blockOf(semantic, ':root,\nbody');
  const light = blockOf(semantic, 'body:not(.dark)');

  it('declares at least the 8 documented fill roles', () => {
    const fills = Object.keys(base).filter((k) => /^--fill-/.test(k));
    expect(fills.length).toBeGreaterThanOrEqual(8);
  });

  it('every --fill-x has a matching --on-fill-x in the SAME block', () => {
    for (const [blockName, block] of [['dark defaults', base], ['light', light]]) {
      const fills = Object.keys(block).filter((k) => /^--fill-/.test(k));
      expect(fills.length, `${blockName} declares no fills`).toBeGreaterThan(0);
      for (const f of fills) {
        const companion = f.replace('--fill-', '--on-fill-');
        expect(
          block[companion],
          `${blockName}: ${f} has no ${companion} in the same block. A fill without its\n`
          + `label is how the inverse-bug class starts: the call site then has to guess,\n`
          + `and the correct guess differs per theme.`
        ).toBeDefined();
      }
    }
  });

  it('light and dark declare the same set of fill roles', () => {
    const l = Object.keys(light).filter((k) => /^--fill-/.test(k)).sort();
    const d = Object.keys(base).filter((k) => /^--fill-/.test(k)).sort();
    expect(l).toEqual(d);
  });

  /**
   * I broke this while adding a `body.rose` block: I closed `body:not(.dark)`
   * early, so --shadow-*, --focus-ring and every --status-*-text silently moved
   * into the rose block and vanished from light mode.
   *
   * Braces stayed balanced, so cssIntegrity.spec.js could not see it, and no
   * component test renders light mode. Only reading the file back caught it.
   * Pin the light block's contents so the next person gets a failure instead.
   */
  it('the light block still declares its whole token set', () => {
    const REQUIRED = [
      '--surface-canvas', '--surface-raised', '--surface-sunken',
      '--text-primary', '--text-secondary', '--text-tertiary', '--text-quaternary',
      '--fill-accent', '--on-fill-accent', '--field-bg', '--field-border', '--field-border-focus',
      '--canvas-grid-dot', '--gradient-wash', '--border-subtle', '--border-strong',
      '--shadow-xs', '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-overlay',
      '--scrim', '--focus-ring',
      '--status-blue-text', '--status-purple-text', '--status-amber-text',
      '--status-green-text', '--status-yellow-text',
    ];
    const missing = REQUIRED.filter((t) => light[t] === undefined);
    expect(
      missing,
      'These tokens are no longer inside the body:not(.dark) block of _semantic.css.\n'
      + 'The usual cause is a stray `}` that closed the block early and dropped the\n'
      + 'rest into whatever selector follows — braces stay balanced, so nothing else\n'
      + 'catches it, and light mode loses the tokens entirely.'
    ).toEqual([]);
  });

  /**
   * _semantic.css is imported LAST and its light block is `body:not(.dark)`,
   * specificity (0,1,1). `body.rose` in _rose.css is also (0,1,1). Equal
   * specificity, later wins — so any token _rose.css declares that _semantic.css
   * also declares for light is dead on arrival.
   *
   * Measured when this bit: rose's grid dot rendered the cool navy from the light
   * block, not the warm tone _rose.css asked for.
   */
  it('_rose.css declares no token that the semantic light block overrides', () => {
    const roseCss = stripComments(fs.readFileSync(path.join(THEMES, '_rose.css'), 'utf8'));
    const roseBlock = roseCss.match(/(^|\})\s*body\.rose\s*\{([^{}]*)\}/);
    expect(roseBlock, 'expected a body.rose token block').toBeTruthy();

    const declared = [...roseBlock[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]);
    const dead = declared.filter((t) => light[t] !== undefined);
    expect(
      dead,
      'These _rose.css declarations are DEAD: _semantic.css declares the same tokens\n'
      + 'for body:not(.dark) at equal specificity and is imported later, so it always\n'
      + 'wins. Move the override into the body.rose block in _semantic.css.'
    ).toEqual([]);
  });
});

/* ─────────── check 2b: a form field is a well, not a card ─────────── */
describe('theme tokens: form fields are inset in every theme', () => {
  /**
   * --field-bg once pointed at --surface-raised in light mode: the RAISED
   * surface token, used for a RECESSED control. Dark inset its fields (ΔL* -0.68
   * below the panel) while light lifted them (+1.04 above the canvas, and dead
   * flush with a white panel) — the metaphor was inverted between themes.
   *
   * On a small input the border hides that. On a textarea the fill IS most of
   * the control, so it rendered as a bright white slab.
   *
   * Pinning the VALUE would be brittle. Pinning the RELATIONSHIP is what
   * actually matters: whatever a theme picks, a field must composite DARKER
   * than the surface it sits on, in every theme.
   */
  const readTheme = (f) => stripComments(fs.readFileSync(path.join(THEMES, f), 'utf8'));
  const VARS = stripComments(fs.readFileSync(path.join(SRC, 'styles', 'base', '_variables.css'), 'utf8'));

  const blockOf = (css, selector) => {
    const out = {};
    const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'g');
    for (const m of css.matchAll(re)) {
      for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
    }
    return out;
  };

  const semanticCss = readTheme('_semantic.css');
  const MAPS = {
    light: {
      ...blockOf(VARS, ':root'),
      ...blockOf(semanticCss, ':root,\nbody'),
      ...blockOf(readTheme('_light.css'), 'body:not(.dark):not(.rose)'),
      ...blockOf(semanticCss, 'body:not(.dark)'),
    },
    dark: {
      ...blockOf(VARS, ':root'),
      ...blockOf(semanticCss, ':root,\nbody'),
      ...blockOf(readTheme('_dark.css'), 'body.dark'),
      ...blockOf(semanticCss, 'body.dark'),
    },
  };

  /** Resolve a value to {rgb, a}, following var() chains through the theme map. */
  function resolve(value, map, depth = 0) {
    if (value == null || depth > 8) return null;
    const v = String(value).trim();
    const varM = v.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (varM) return resolve(map[varM[1]] ?? varM[2], map, depth + 1);
    const hex = v.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = [...h].map((c) => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
      const p = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
      return { rgb: p.slice(0, 3), a: p[3] === undefined ? 1 : p[3] };
    }
    return null;
  }

  const chan = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg) => (fg.a >= 0.999 ? fg.rgb : fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a)));

  for (const theme of ['light', 'dark']) {
    it(`${theme}: --field-bg composites DARKER than --surface-raised`, () => {
      const map = MAPS[theme];
      const raised = resolve('var(--surface-raised)', map);
      const field = resolve('var(--field-bg)', map);
      expect(raised, `${theme}: --surface-raised did not resolve`).toBeTruthy();
      expect(field, `${theme}: --field-bg did not resolve`).toBeTruthy();

      expect(
        lum(over(field, raised.rgb)),
        `${theme}: --field-bg is the same as, or lighter than, --surface-raised.\n`
        + 'A text field is a recessed well, not a raised card. Pointing --field-bg at\n'
        + '--surface-raised makes it flush with the panel it sits on, so a large\n'
        + 'control like a textarea renders as a bright slab.'
      ).toBeLessThan(lum(raised.rgb));
    });

    it(`${theme}: text on a field still clears AA`, () => {
      const map = MAPS[theme];
      const field = over(resolve('var(--field-bg)', map), resolve('var(--surface-raised)', map).rgb);
      const text = resolve('var(--text-primary)', map);
      expect(text, `${theme}: --text-primary did not resolve`).toBeTruthy();
      expect(ratio(over(text, field), field)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('resolves real values rather than silently comparing nulls (anti-vacuity)', () => {
    expect(resolve('var(--field-bg)', MAPS.light)).toBeTruthy();
    expect(resolve('var(--field-bg)', MAPS.dark)).toBeTruthy();
    // Negative control: a field that IS the raised surface must not be darker.
    const raised = resolve('var(--surface-raised)', MAPS.light);
    expect(lum(over(raised, raised.rgb))).toBe(lum(raised.rgb));
  });
});

/* ───────────────── check 3: no NEW hardcoded text colours ───────────────── */
describe('theme tokens: hardcoded text colours do not grow', () => {
  const DARK_T = ['dark', 'cyberpunk', 'ember', 'hacker', 'midnight', 'nord'];
  const LIGHT_T = ['rose', 'light'];
  const isThemeScoped = (sel) => {
    const s = sel.toLowerCase();
    if (/:not\(\s*\.dark\s*\)/.test(s)) return true;
    return DARK_T.some((t) => new RegExp(`(^|[\\s,>+~])(body)?\\.${t}\\b`).test(s))
      || LIGHT_T.some((t) => new RegExp(`(^|[\\s,>+~])(body)?\\.${t}\\b`).test(s));
  };

  /**
   * Surfaces that paint their OWN background and therefore do not follow the
   * theme. Their hardcoded light text is CORRECT. Each was verified by reading
   * the container rule, not guessed from the path:
   *   MobileLite    .ml-screen { background:#12121c }, .qr-scan { background:#000 }
   *   Minigames     full-bleed game canvases
   *   Marketplace   generated HSL card art, dark in every theme (ART-INK RULE)
   *   CodePreview   a syntax-highlighting palette is its own design system
   *   LoginSection  Google sign-in is #111827 on white by brand requirement
   */
  const SELF_CONTAINED = /MobileLite|Minigames|Marketplace\.vue|CodePreview|LoginSection|AgentUtilization|__old-|base\/js\/libs|\.min\./;

  function rulesOf(css) {
    const out = []; const stack = []; let buf = ''; let i = 0;
    while (i < css.length) {
      const c = css[i];
      if (c === '{') {
        const h = buf.trim(); buf = '';
        stack.push(h.startsWith('@') ? { at: 1 } : { sel: h, start: i + 1 });
        i += 1; continue;
      }
      if (c === '}') {
        const t = stack.pop();
        if (t?.sel !== undefined) out.push({ sel: t.sel, body: css.slice(t.start, i) });
        buf = ''; i += 1; continue;
      }
      buf += c; i += 1;
    }
    return out;
  }

  const offenders = [];
  for (const f of ALL_FILES) {
    const r = rel(f);
    if (SELF_CONTAINED.test(r) || /^styles\/themes\//.test(r)) continue;
    const css = blankComments(styleText(f));
    for (const rule of rulesOf(css)) {
      if (isThemeScoped(rule.sel)) continue;
      for (const m of rule.body.matchAll(/(?:^|[;{])\s*color\s*:\s*([^;}]+)/gi)) {
        const v = m[1].trim().toLowerCase().replace(/\s*!important\s*$/, '');
        if (/^var\(/.test(v) || /^(inherit|currentcolor|transparent|unset|initial)$/.test(v)) continue;
        offenders.push(`${r}  ${rule.sel.replace(/\s+/g, ' ').slice(0, 50)}  {color:${v}}`);
      }
    }
  }

  /**
   * FROZEN BASELINE. Lower it when you fix some; never raise it.
   * A guard that opens red is a guard that gets deleted.
   */
  const BASELINE = 33;

  it(`has no MORE than the ${BASELINE} known hardcoded text colours`, () => {
    expect(
      offenders.length,
      `Hardcoded \`color:\` in theme-agnostic rules went UP.\n`
      + `A literal colour cannot invert, so it is legible in whichever theme you had\n`
      + `open and broken in the other. Use --text-primary/secondary/tertiary/quaternary,\n`
      + `or --on-fill-<role> when it sits on an accent fill.\n\n`
      + `New offenders are somewhere in:\n${offenders.slice(0, 25).join('\n')}\n`
    ).toBeLessThanOrEqual(BASELINE);
  });

  it('the baseline is not stale (ratchet it down when it drops)', () => {
    expect(
      offenders.length,
      `Hardcoded text colours dropped to ${offenders.length}. Lower BASELINE in this file to match `
      + `so the ratchet keeps its grip.`
    ).toBeGreaterThan(BASELINE - 10);
  });
});

/* ───────────── check 4: the cascade trap that started all this ───────────── */
describe('theme tokens: no blanket element rule outranks component colours', () => {
  /**
   * `body:not(.dark) button { color: var(--color-text) }` is specificity
   * (0,2,1) and beat every component's own `.btn-primary { color: … }` at
   * (0,1,0). Every filled button in light mode rendered dark ink on a dark
   * accent fill — measured 1.67:1 in a real browser.
   *
   * The declaration in the component was present and looked correct. It just
   * never won. That is why this check is structural rather than a contrast
   * assertion: no amount of measuring the component's CSS would have found it.
   */
  const ELEMENTS = ['button', 'input', 'select', 'textarea', 'a', 'label'];

  it('no theme sheet sets `color` on a bare element via a body-scoped selector', () => {
    const found = [];
    for (const file of fs.readdirSync(THEMES).filter((f) => f.endsWith('.css'))) {
      const css = blankComments(fs.readFileSync(path.join(THEMES, file), 'utf8'));
      for (const m of css.matchAll(/(^|\})\s*([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[2].trim();
        const body = m[3];
        if (!/(?:^|[;{])\s*color\s*:/i.test(body)) continue;
        // Only bare-element selectors qualified by body/theme, e.g. `body.dark button`.
        for (const part of sel.split(',')) {
          const s = part.trim();
          if (!/^body[^\s]*\s+[a-z]+$/i.test(s)) continue;
          const el = s.split(/\s+/).pop().toLowerCase();
          if (ELEMENTS.includes(el)) found.push(`${file}:  ${s}`);
        }
      }
    }
    expect(
      found.length,
      `A theme sheet sets \`color\` on a bare <${ELEMENTS.join('|')}> through a body-scoped\n`
      + `selector. That is specificity (0,2,1) and silently outranks every component's own\n`
      + `(0,1,0) colour rule, so components cannot style their own controls.\n`
      + `Give the element \`color: inherit\` in the component layer instead:\n${found.join('\n')}\n`
    ).toBe(0);
  });
});
