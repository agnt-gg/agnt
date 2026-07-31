/**
 * UI CONTRACTS — four guards against defects the build cannot see.
 *
 * The first two are invisible: no console error, no build warning, no failing
 * test. You only find out because a human looks at the screen and says
 * "there's nothing there." The third is visible but only to someone who knows
 * what the control is supposed to look like.
 *
 * ---------------------------------------------------------------------------
 * GUARD 1 — icon names must exist in the VENDORED stylesheet
 * ---------------------------------------------------------------------------
 * AGNT self-hosts Font Awesome FREE 5.15.1. Font Awesome 6 renamed most of the
 * icon set (`fa-circle-check` was `fa-check-circle`, `fa-triangle-exclamation`
 * was `fa-exclamation-triangle`, ...). An FA6 name against an FA5 stylesheet
 * matches no rule, so <i> renders as an empty inline box.
 *
 * FA6 names are what current documentation, muscle memory and LLM autocomplete
 * all produce, so this will keep happening forever without a check. 15 had
 * already accumulated when this guard was written.
 *
 * ---------------------------------------------------------------------------
 * GUARD 2 — imported components must be REGISTERED
 * ---------------------------------------------------------------------------
 * In an Options API component, importing a .vue file does nothing on its own —
 * it must also appear in `components: {}`. Miss that and Vue resolves the tag
 * to nothing and renders an empty node. (`<script setup>` auto-registers, which
 * is why this only affects Options API files.)
 *
 * This is exactly how the Phone Access panel shipped blank: the import was
 * added, the registration was not, and the surrounding header markup made it
 * look like a styling bug rather than a missing component.
 *
 * ---------------------------------------------------------------------------
 * GUARD 3 — dropdowns must use the shared CustomSelect
 * ---------------------------------------------------------------------------
 * A native <select> renders the operating system's dropdown: OS chrome, OS
 * fonts, OS colours, ignoring the app theme entirely. It looks fine to whoever
 * wrote it and wrong to everyone looking at the product.
 *
 * 37 of them had accumulated across 21 files by the time this guard was added,
 * because nothing stopped the next one. `<select>` is what muscle memory and
 * autocomplete produce, so without a check this regrows indefinitely.
 *
 * ---------------------------------------------------------------------------
 * GUARD 4 — tooltips must use the app's tooltip, not the browser's
 * ---------------------------------------------------------------------------
 * A native `title` renders the OS tooltip: unstyled, ~1s delay, uncontrollable
 * position, invisible on touch. 79 had accumulated across 32 files.
 *
 * They persisted even though a Tooltip component existed because that component
 * is a WRAPPER, and a wrapper cannot go everywhere an attribute can — it breaks
 * `.parent > el`, `el + el`, `:first-child`, percentage widths and flex/grid
 * child sizing. `v-tooltip` is the attribute form and has no such limit.
 *
 * This guard also pins the directive's global registration, because an
 * unregistered directive is inert: the attribute simply does not render, with
 * no error in a production build.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FA_CSS = path.resolve(SRC, '..', 'public', 'vendor', 'fontawesome', 'css', 'all.min.css');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Read a file, returning null if it disappeared between the directory listing
 * and the read. A source tree is a live filesystem — editors, build tooling and
 * parallel test workers all create and remove files under it — so a walker that
 * assumes every entry it just listed still exists is a latent flake.
 */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function walk(dir, test, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out; // directory removed mid-walk
    throw err;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, test, out);
    else if (test(e.name)) out.push(fp);
  }
  return out;
}

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');

// ═══════════════════════════════════════════════════════════════════ GUARD 1

/**
 * Icons that are knowingly broken and deliberately not fixed. Every entry needs
 * a reason. "It's hard to find a replacement" is not a reason — the whole point
 * is that a blank icon ships to users.
 */
const ALLOWED_MISSING_ICONS = new Map([
  ['shield', 'Dead code: RightPanel/types/__old-panels/_MapPanel — no route renders it.'],
  ['sword', 'Dead code: __old-panels/_MapPanel.'],
  ['swords', 'Dead code: __old-panels/_MapPanel.'],
]);

/** Utility/style classes in the `fa-` namespace that are not icons. */
const FA_MODIFIERS =
  /^(solid|regular|brands|light|duotone|thin|sharp|spin|spin-pulse|spin-reverse|pulse|fw|border|li|inverse|stack|stack-1x|stack-2x|rotate-90|rotate-180|rotate-270|rotate-by|flip|flip-horizontal|flip-vertical|flip-both|beat|beat-fade|fade|bounce|shake|xs|sm|lg|xl|2xl|[2-9]x|10x|ul|pull-left|pull-right|swap-opacity|sr-only|sr-only-focusable)$/;

describe('icon names resolve against the vendored Font Awesome', () => {
  const css = fs.readFileSync(FA_CSS, 'utf8');
  const defined = new Set([...css.matchAll(/\.fa-([a-z0-9-]+):before/g)].map((m) => m[1]));

  it('finds the vendored stylesheet and a plausible icon count', () => {
    expect(defined.size).toBeGreaterThan(1000);
  });

  it('every fa-* class used in source exists in the stylesheet', () => {
    const offenders = new Map();
    for (const file of walk(SRC, (n) => /\.(vue|js)$/.test(n) && !/\.(spec|test)\./.test(n))) {
      const text = readIfPresent(file);
      if (text === null) continue;
      for (const m of text.matchAll(/\bfa-([a-z0-9-]+)/g)) {
        const name = m[1];
        if (FA_MODIFIERS.test(name) || defined.has(name) || ALLOWED_MISSING_ICONS.has(name)) continue;
        if (!offenders.has(name)) offenders.set(name, new Set());
        offenders.get(name).add(rel(file));
      }
    }
    const report = [...offenders.entries()]
      .map(([n, files]) => `  fa-${n}  (${[...files].slice(0, 3).join(', ')})`)
      .join('\n');
    expect(
      offenders.size,
      `\n${offenders.size} icon name(s) do not exist in the vendored Font Awesome ${/Free (\d+\.\d+\.\d+)/.exec(css)?.[1] || ''} stylesheet.\n` +
        `These render as an EMPTY BOX — no error, no warning.\n` +
        `Almost always an FA6 name (fa-circle-check) where FA5 wants the FA5 name (fa-check-circle).\n${report}\n`
    ).toBe(0);
  });

  it('keeps the allowlist honest (no stale entries)', () => {
    const used = new Set();
    for (const file of walk(SRC, (n) => /\.(vue|js)$/.test(n) && !/\.(spec|test)\./.test(n))) {
      const text = readIfPresent(file);
      if (text === null) continue;
      for (const m of text.matchAll(/\bfa-([a-z0-9-]+)/g)) used.add(m[1]);
    }
    const stale = [...ALLOWED_MISSING_ICONS.keys()].filter((n) => !used.has(n));
    expect(stale, `Stale allowlist entries (icon no longer used, or now valid): ${stale.join(', ')}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════ GUARD 2

/** Strip comments and <style> so matches come from real markup/code only. */
function stripNoise(src) {
  return src
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

describe('every imported component is registered', () => {
  it('no Options API component uses an imported component it never registered', () => {
    const offenders = [];

    for (const file of walk(SRC, (n) => n.endsWith('.vue'))) {
      const raw = readIfPresent(file);
      if (raw === null) continue;

      // <script setup> auto-registers imports — this class of bug can't occur.
      if (/<script[^>]*\ssetup[\s>]/.test(raw)) continue;

      const src = stripNoise(raw);
      const template = /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? '';
      if (!template) continue;

      // Dynamic <component :is> can reference anything; skip those files rather
      // than emit noise we'd have to allowlist.
      if (/<component\b[^>]*\bis\b/.test(template)) continue;

      const imported = [...src.matchAll(/^\s*import\s+(\w+)\s+from\s+['"][^'"]+\.vue['"]/gm)].map((m) => m[1]);
      if (!imported.length) continue;

      const registryBlock = /components:\s*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? '';
      const registered = new Set([...registryBlock.matchAll(/([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

      for (const name of imported) {
        if (registered.has(name)) continue;
        // Only a problem if the template actually renders it.
        const usedPascal = new RegExp(`<${name}[\\s/>]`).test(template);
        const usedKebab = new RegExp(`<${kebab(name)}[\\s/>]`).test(template);
        if (usedPascal || usedKebab) offenders.push(`${rel(file)} -> <${name}>`);
      }
    }

    const report = offenders.map((o) => `  ${o}`).join('\n');
    expect(
      offenders.length,
      `\n${offenders.length} component(s) are imported and used in a template but never registered in components: {}.\n` +
        `Vue renders these as NOTHING — the page looks empty with no error.\n${report}\n`
    ).toBe(0);
  });

  it('detects the missing registration it is meant to catch (self-test)', () => {
    // A miniature of the exact Phone Access bug, so this guard can never
    // silently degrade into a test that passes because it matches nothing.
    const broken = `
<template><div><PhoneAccessSection /></div></template>
<script>
import PhoneAccessSection from './PhoneAccessSection.vue';
export default { components: { SomethingElse } };
</script>`;
    const src = stripNoise(broken);
    const template = /<template>([\s\S]*)<\/template>/.exec(src)[1];
    const imported = [...src.matchAll(/^\s*import\s+(\w+)\s+from\s+['"][^'"]+\.vue['"]/gm)].map((m) => m[1]);
    const registryBlock = /components:\s*\{([\s\S]*?)\}/.exec(src)[1];
    const registered = new Set([...registryBlock.matchAll(/([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

    expect(imported).toContain('PhoneAccessSection');
    expect(registered.has('PhoneAccessSection')).toBe(false);
    expect(new RegExp(`<PhoneAccessSection[\\s/>]`).test(template)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════ GUARD 3

/**
 * Native <select> elements that are deliberately kept. Every entry needs a
 * reason. "It was already there" is not a reason — that is the condition this
 * guard exists to prevent.
 */
const ALLOWED_NATIVE_SELECTS = new Map();

const findNativeSelects = (raw) => {
  const template = /<template>([\s\S]*)<\/template>/.exec(stripNoise(raw))?.[1] ?? '';
  return (template.match(/<select[\s>]/g) || []).length;
};

describe('dropdowns use the shared select component', () => {
  it('no template renders a native <select>', () => {
    const offenders = [];

    for (const file of walk(SRC, (n) => n.endsWith('.vue'))) {
      const raw = readIfPresent(file);
      if (raw === null) continue;

      const count = findNativeSelects(raw);
      if (!count) continue;
      if (ALLOWED_NATIVE_SELECTS.has(rel(file))) continue;

      offenders.push(`${rel(file)} (${count})`);
    }

    const report = offenders.map((o) => `  ${o}`).join('\n');
    expect(
      offenders.length,
      `\n${offenders.length} file(s) render a native <select>.\n` +
        `These paint the OS dropdown instead of the app theme.\n` +
        `Use <CustomSelect :options="[{ label, value }]" v-model="x" /> from\n` +
        `@/views/_components/common/CustomSelect.vue instead.\n${report}\n`
    ).toBe(0);
  });

  it('keeps the allowlist honest (no stale entries)', () => {
    const stale = [...ALLOWED_NATIVE_SELECTS.keys()].filter((entry) => {
      const raw = readIfPresent(path.join(SRC, entry));
      return raw === null || findNativeSelects(raw) === 0;
    });
    expect(stale, `Stale allowlist entries (no native <select> there any more): ${stale.join(', ')}`).toEqual([]);
  });

  it('detects a native select it is meant to catch (self-test)', () => {
    // Without this the guard could pass simply because the matcher is broken.
    const broken = `<template><div><select v-model="x"><option value="a">A</option></select></div></template>`;
    expect(findNativeSelects(broken)).toBe(1);

    // ...and must not fire on the replacement, on a comment, or on CSS.
    const fixed =
      `<template><div><CustomSelect v-model="x" :options="opts" /></div></template>` +
      `<!-- was a <select> before -->` +
      `<style>select.custom-select { color: red; }</style>`;
    expect(findNativeSelects(fixed)).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════ GUARD 4

/**
 * Native `title` attributes that are deliberately kept. Every entry needs a
 * reason.
 */
const ALLOWED_NATIVE_TITLES = new Map([
  [
    'views/Terminal/CenterPanel/screens/__old-screens/_Goals/_Goals.vue',
    'Dead code: nothing imports __old-screens. Editing it is risk with no user-visible benefit.',
  ],
]);

/**
 * Count native `title` attributes in a template.
 *
 * Three things that look identical to a naive grep and are NOT tooltips:
 *   <Tooltip title="...">      a component prop
 *   <template #title="...">    a slot name
 *   <title> inside an <svg>    an accessibility label
 */
const findNativeTitles = (raw) => {
  const template = /<template>([\s\S]*)<\/template>/.exec(stripNoise(raw))?.[1] ?? '';
  let count = 0;

  for (const m of template.matchAll(/(:|v-bind:)?\btitle\s*=/g)) {
    const before = template.slice(Math.max(0, m.index - 10), m.index);
    if (/#$/.test(before) || /v-slot:?$/.test(before)) continue; // slot name

    const open = template.lastIndexOf('<', m.index);
    const tag = /^<\/?([A-Za-z][\w.-]*)/.exec(template.slice(open))?.[1];
    if (!tag) continue;
    if (tag === 'template' || tag === 'title') continue;
    if (/^[A-Z]/.test(tag) || tag.includes('-')) continue; // component prop

    count += 1;
  }
  return count;
};

describe('tooltips use the app tooltip, not the browser one', () => {
  it('no template uses a native title attribute', () => {
    const offenders = [];

    for (const file of walk(SRC, (n) => n.endsWith('.vue'))) {
      const raw = readIfPresent(file);
      if (raw === null) continue;

      const count = findNativeTitles(raw);
      if (!count) continue;
      if (ALLOWED_NATIVE_TITLES.has(rel(file))) continue;

      offenders.push(`${rel(file)} (${count})`);
    }

    const report = offenders.map((o) => `  ${o}`).join('\n');
    expect(
      offenders.length,
      `\n${offenders.length} file(s) use a native title attribute.\n` +
        `That renders the OS tooltip: unstyled, slow, and invisible on touch.\n` +
        `Use v-tooltip="'text'" (attribute, safe anywhere) or wrap in <Tooltip text="...">.\n${report}\n`
    ).toBe(0);
  });

  it('keeps the allowlist honest (no stale entries)', () => {
    const stale = [...ALLOWED_NATIVE_TITLES.keys()].filter((entry) => {
      const raw = readIfPresent(path.join(SRC, entry));
      return raw === null || findNativeTitles(raw) === 0;
    });
    expect(stale, `Stale allowlist entries: ${stale.join(', ')}`).toEqual([]);
  });

  it('registers v-tooltip globally, since an unregistered directive is inert', () => {
    // Vue warns in dev and does nothing at all in a production build, so every
    // v-tooltip in the app would silently stop existing.
    const main = readIfPresent(path.join(SRC, 'main.js')) ?? '';
    expect(main).toMatch(/app\.directive\(\s*['"]tooltip['"]\s*,\s*vTooltip\s*\)/);
    expect(main).toMatch(/import\s*\{\s*vTooltip\s*\}\s*from\s*['"]@\/directives\/tooltip\.js['"]/);
  });

  it('detects a native title it is meant to catch (self-test)', () => {
    expect(findNativeTitles(`<template><button title="Delete">x</button></template>`)).toBe(1);
    expect(findNativeTitles(`<template><span :title="reason">x</span></template>`)).toBe(1);

    // ...and must not fire on the replacement, a component prop, a slot name,
    // a comment or CSS.
    const fine =
      `<template>` +
      `<button v-tooltip="'Delete'">x</button>` +
      `<Tooltip text="a" title="b"><i/></Tooltip>` +
      `<ScreenToolbar title="Traces" />` +
      `<BaseCardGrid><template #title="p">{{ p.x }}</template></BaseCardGrid>` +
      `<!-- <button title="old">x</button> -->` +
      `</template>` +
      `<style>[title] { color: red; }</style>`;
    expect(findNativeTitles(fine)).toBe(0);
  });
});
