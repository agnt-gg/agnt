/**
 * Focused is a FRAME, not a second client.
 *
 * The AGNT One demo was a parallel client: its own history builder, stream
 * handling and API calls, all of which drifted from the app the moment the
 * app changed. This guard keeps the in-app Focused shell from growing back
 * into that. Data comes from the shared Vuex stores; opening things goes
 * through canvas/jumpActions.js; chat goes through Chat.vue's own events.
 *
 * If you need data Focused cannot get from a store, add it to the store —
 * then Studio has it too.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const SOURCES = readdirSync(DIR)
  .filter((f) => /\.(vue|js|css)$/.test(f) && !f.endsWith('.spec.js'))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), 'utf8') }));

const BANNED = [
  [/\bfetch\s*\(/, 'calls fetch() directly'],
  [/\baxios\b/, 'uses axios'],
  [/\bXMLHttpRequest\b/, 'uses XMLHttpRequest'],
  [/\bAPI_CONFIG\b/, 'reads API_CONFIG (builds its own URLs)'],
  [/['"`]\/api\//, 'hardcodes an /api/ path'],
  [/localhost:\d+/, 'hardcodes a localhost URL'],
];

describe('Focused shell drift guard', () => {
  it('scans the real files (anti-vacuity)', () => {
    const names = SOURCES.map((s) => s.file);
    expect(names).toEqual(expect.arrayContaining(['FocusedShell.vue', 'FocusedSidebar.vue', 'focusedModel.js', 'focused.css']));
  });

  it.each(BANNED)('no file %s', (pattern, why) => {
    const offenders = SOURCES.filter((s) => pattern.test(s.text)).map((s) => s.file);
    expect(offenders, `views/Focused ${why}: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the guard can see a violation (anti-vacuity)', () => {
    expect(BANNED.some(([p]) => p.test("await fetch('/api/x')"))).toBe(true);
  });

  it('every CSS rule is scoped under .ui-focused, so nothing leaks into Studio', () => {
    let css = SOURCES.find((s) => s.file === 'focused.css').text.replace(/\/\*[\s\S]*?\*\//g, '');
    // Keyframe names are global, so they are namespaced by prefix instead.
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(keyframes.filter((k) => !k.startsWith('ui-focused-'))).toEqual([]);
    css = css.replace(/@keyframes\s+ui-focused-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    // Container names are global too: prefixed like keyframes.
    // A declaration (after { or ;), never a selector like .x-container:has(...).
    const containers = [...css.matchAll(/[{;]\s*container(?:-name)?\s*:\s*([\w-]+)/g), ...css.matchAll(/@container\s+([\w-]+)/g)].map((m) => m[1]);
    expect(containers.length).toBeGreaterThan(0);
    expect(containers.filter((c) => !c.startsWith('ui-focused-'))).toEqual([]);
    // An @media or @container line is a condition, not a selector. Drop only
    // the header, so every rule INSIDE it is still held to the same check.
    css = css.replace(/@(?:media|container)[^{]*\{/g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(40);
    const unscoped = selectors.filter((s) => !s.startsWith('.ui-focused'));
    expect(unscoped).toEqual([]);
  });
});
