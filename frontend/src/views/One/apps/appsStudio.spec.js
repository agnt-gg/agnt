// The Apps page in Studio is One's page drawn in Studio's language. The look is one
// stylesheet that only Studio's Apps screen loads; AGNT One keeps its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { needYou } from './appsModel.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(DIR, 'appsStudio.css'), 'utf8');
const SCREEN = readFileSync(join(DIR, '../../Terminal/CenterPanel/screens/Connectors/AppsScreen.vue'), 'utf8');
/** A selector list split on its own commas, not those inside :is(…). */
function topLevel(list) {
  const out = [];
  let depth = 0;
  let part = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(part); part = ''; } else part += ch;
  }
  return [...out, part];
}
const ONE_APPS = readFileSync(join(DIR, 'OneApps.vue'), 'utf8');

describe('the Apps page in Studio', () => {
  it('is loaded by Studio\'s Apps screen only, never by AGNT One\'s page', () => {
    expect(SCREEN).toContain('<style src="@/views/One/apps/appsStudio.css"></style>');
    expect(ONE_APPS).not.toContain('appsStudio.css');
  });

  it('styles nothing outside Studio\'s Apps screen', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).flatMap(topLevel).map((s) => s.trim()).filter(Boolean);
    expect(rules.length).toBeGreaterThan(40);
    for (const selector of rules) expect(selector, selector).toMatch(/^\.studio-apps-page\b/);
  });

  it('uses the theme\'s colours, never literal ones', () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/rgba?\(\s*\d/);
  });

  it('draws Studio\'s screen title and create button', () => {
    expect(CSS).toMatch(/\.studio-apps-page \.za \.page-head h1 \{[^}]*text-transform: uppercase;[^}]*color: var\(--text-green\);/);
    expect(CSS).toMatch(/\.studio-apps-page \.za \.primary \{[^}]*background: rgba\(var\(--primary-rgb\), 0\.08\);/);
  });
});

describe('the centre between Studio\'s panels', () => {
  it('uses Studio\'s padding and does not repeat what the panels show', () => {
    expect(CSS).toMatch(/\.studio-apps-page \.za\.has-studio-panels \.page \{[^}]*padding: 16px 16px 48px;/);
    expect(CSS).toMatch(/\.studio-apps-page \.za\.has-studio-panels \.za-broken \{ display: none; \}/);
    expect(CSS).toMatch(/\.studio-apps-page \.za\.has-studio-panels \.page-head > \.row-gap:not\(\.head-title\) \{ display: none; \}/);
  });
});

describe('who needs you, in words', () => {
  it('agrees with its count', () => {
    expect(needYou(1)).toBe('1 needs you');
    expect(needYou(0)).toBe('0 need you');
    expect(needYou(3)).toBe('3 need you');
  });
});
