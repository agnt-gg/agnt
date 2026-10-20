/**
 * AGNT One is a FRAME, not a second client.
 *
 * Same guard as views/Focused/focusedDrift.spec.js, for the same reason: the
 * AGNT One demo was a parallel client (its own history, streaming and API
 * calls) that drifted from the app the moment the app changed. Data here comes
 * from the shared Vuex stores; chat goes through Chat.vue's own events.
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

describe('AGNT One drift guard', () => {
  it('scans the real files (anti-vacuity)', () => {
    expect(SOURCES.map((s) => s.file)).toEqual(expect.arrayContaining(['OneShell.vue', 'OneRail.vue', 'OneCapsule.vue', 'OneWelcome.vue', 'oneModel.js', 'one.css']));
  });

  it.each(BANNED)('no file %s', (pattern, why) => {
    const offenders = SOURCES.filter((s) => pattern.test(s.text)).map((s) => s.file);
    expect(offenders, `views/One ${why}: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the guard can see a violation (anti-vacuity)', () => {
    expect(BANNED.some(([p]) => p.test("await fetch('/api/x')"))).toBe(true);
  });

  it('every CSS rule is scoped under .ui-one (or body.custom-bg .ui-one), and keyframes are namespaced', () => {
    let css = SOURCES.find((s) => s.file === 'one.css').text.replace(/\/\*[\s\S]*?\*\//g, '');
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.filter((k) => !k.startsWith('ui-one-'))).toEqual([]);
    css = css.replace(/@keyframes\s+ui-one-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    css = css.replace(/@(?:media|container)[^{]*\{/g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(40);
    // The custom background is announced on <body> (theme.js), so its rules
    // start there; they still only reach inside One.
    const scoped = (s) => s.startsWith('.ui-one') || /^body\.custom-bg \.ui-one(?![\w-])/.test(s);
    expect(selectors.filter((s) => !scoped(s))).toEqual([]);
  });

  it('one.css draws over focused.css: loaded after it, by the frame itself', () => {
    const shell = SOURCES.find((s) => s.file === 'OneShell.vue').text;
    const focused = shell.indexOf('<style src="../Focused/focused.css"></style>');
    const one = shell.indexOf('<style src="./one.css"></style>');
    expect(focused).toBeGreaterThan(-1);
    expect(one).toBeGreaterThan(focused);
  });
});
