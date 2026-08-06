/**
 * ONE NAME, ONE ORDER — every screen that shows providers agrees.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "Which AI providers do we offer, in what order, labelled how?" was answered
 * independently by the onboarding modal and the setup card in an empty chat.
 * Twelve identical lines each. Then one of them was fixed.
 *
 * The result was the same provider appearing as "ChatGPT" in the C group on one
 * screen and "OpenAI Codex" in the O group on the other, in the same build.
 * Not a missed edit — a second copy, which is a thing that gets missed by
 * construction.
 *
 * A guard naming those two files would not help: the next screen is written by
 * someone who has never read this comment. So these DISCOVER every component
 * that renders provider records and hold all of them to the rule.
 *
 * SCOPE, AND WHY IT IS NOT WIDER
 * ------------------------------
 * The first version of this scan required every file touching
 * `appAuth.allProviders` to call `connectableAiProviders`. That is false for
 * two of them and the failures were the scan's fault, not the code's: the
 * connectors directory lists EVERY category, not just AI, and the integration
 * health tiles are a status readout rather than a setup grid. A guard that
 * cries wolf gets deleted by the next person who hits it. So the rules below
 * are only the ones that are true everywhere:
 *
 *   1. do not re-implement the AI-category setup filter — call the function
 *   2. do not show the user a raw provider name — call providerLabel
 *   3. do not order a provider list by an identifier — order by the label
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STORE = path.join(SRC, 'store/app/aiProvider.js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = walk(SRC).filter((f) => /\.(vue|js)$/.test(f) && !/\.spec\.js$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

/**
 * Files that render the auth API's provider RECORDS — `{ id, name, icon }` —
 * as opposed to the provider name STRINGS the agent config dropdowns use.
 * Those are a different question over different data that happens to share the
 * variable name `aiProviders`, and matching on that name flagged them as
 * offenders for code that was entirely correct.
 */
const PROVIDER_SCREENS = ALL_FILES.filter((f) => f !== STORE && /appAuth\.allProviders/.test(read(f)));

describe('every screen that shows providers', () => {
  it('anti-vacuity: the scan actually finds them', () => {
    // Without this, renaming the store field would empty the scan and turn
    // every assertion below into a vacuous pass.
    expect(PROVIDER_SCREENS.length).toBeGreaterThanOrEqual(3);
  });

  it('never re-implements the AI-category setup filter', () => {
    // This is the copy that drifted. There is one definition now.
    const offenders = PROVIDER_SCREENS.filter((f) =>
      /categories[\s\S]{0,200}includes\(['"]ai['"]\)/i.test(read(f)),
    );
    expect(offenders.map(rel), 'Call connectableAiProviders instead.').toEqual([]);
  });

  it('never renders a raw provider name', () => {
    // `{{ provider.name }}` shows "OpenAI Codex" where the rest of the app says
    // "ChatGPT". Every visible provider string goes through providerLabel.
    const offenders = PROVIDER_SCREENS.filter((f) => /\{\{\s*\w*[Pp]rovider\.name\s*\}\}/.test(read(f)));
    expect(offenders.map(rel), 'Render providerLabel(provider) instead.').toEqual([]);
  });

  it('never orders a provider list by the auth API name', () => {
    // `.sort((a, b) => a.name.localeCompare(b.name))` over provider RECORDS is
    // the exact line that put ChatGPT under O: it orders by the identifier
    // while the row renders a label.
    //
    // Sorting mapped objects whose `.name` is ALREADY the resolved label is
    // correct and common, so this only looks at files that have not resolved
    // one — the presence of PROVIDER_DISPLAY_NAMES or providerLabel is the
    // signal that they have.
    const offenders = PROVIDER_SCREENS.filter((f) => {
      const src = read(f);
      const sortsByName = /\.sort\(\s*\([^)]*\)\s*=>\s*\w+\.name\.localeCompare/.test(src);
      const resolvesLabel = /providerLabel|PROVIDER_DISPLAY_NAMES/.test(src);
      return sortsByName && !resolvesLabel;
    });
    expect(offenders.map(rel), 'Sort with byProviderLabel.').toEqual([]);
  });

  it('anti-vacuity: the shared helpers exist to be called', () => {
    const store = read(STORE);
    expect(store).toMatch(/export function connectableAiProviders\s*\(/);
    expect(store).toMatch(/export function providerLabel\s*\(/);
    expect(store).toMatch(/export const byProviderLabel\s*=/);
  });
});

describe('the two AI setup grids specifically', () => {
  /**
   * These are the screens a user with no provider sees, and they are the two
   * that drifted. Named explicitly because they are the load-bearing case:
   * if either stops using the shared list, the ChatGPT tile goes missing or
   * lands in the wrong group again, and nothing else would catch it.
   */
  const GRIDS = [
    'components/OnboardingModal.vue',
    'views/Terminal/CenterPanel/screens/Chat/components/ProviderSetup.vue',
  ];

  it.each(GRIDS)('%s exists', (file) => {
    expect(fs.existsSync(path.join(SRC, file))).toBe(true);
  });

  it.each(GRIDS)('%s builds its list with connectableAiProviders', (file) => {
    expect(read(path.join(SRC, file))).toMatch(/connectableAiProviders\s*\(/);
  });

  it.each(GRIDS)('%s renders tiles with providerLabel', (file) => {
    expect(read(path.join(SRC, file))).toMatch(/providerLabel\(provider\)/);
  });
});
