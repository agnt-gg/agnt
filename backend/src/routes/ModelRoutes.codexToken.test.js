/**
 * INVARIANT: the Codex paths in ModelRoutes must resolve their token with
 * `getOAuthToken()`, never `getAccessToken()` / `ensureValidToken()`.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A ROUTE TEST
 * ----------------------------------------------
 * The rule is a property of every Codex call site, including ones not written
 * yet. It has already been broken by drift once: two sites needed the same
 * knowledge, one carried a comment explaining the hazard, and the other quietly
 * called the shadowable accessor for months. A test that exercised one route
 * would have passed while the other stayed wrong. Scanning the source states
 * the rule once and applies it to all of them.
 *
 * THE HAZARD ITSELF
 * -----------------
 * `getAccessToken()` and `ensureValidToken()` let `OPENAI_API_KEY` override the
 * ChatGPT OAuth token. These tokens are sent to chatgpt.com/backend-api/codex,
 * which rejects `sk-` keys with a 401. The failure is silent: the model fetch
 * catches it and returns the hardcoded fallback list, so on any machine with a
 * platform key the user just sees a stale model list and no error at all.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ModelRoutes.js'),
  'utf8',
);

/** Every line that assigns a token from CodexAuthManager. */
const codexTokenAssignments = SOURCE.split('\n')
  .map((text, i) => ({ text: text.trim(), line: i + 1 }))
  .filter(({ text }) => /CodexAuthManager\.(getOAuthToken|getAccessToken|ensureValidToken)/.test(text));

describe('Codex token resolution in ModelRoutes', () => {
  it('has Codex call sites to check (the scan is not silently matching nothing)', () => {
    // Without this, a rename of CodexAuthManager would turn every assertion
    // below into a vacuous pass.
    expect(codexTokenAssignments.length).toBeGreaterThanOrEqual(2);
  });

  it('never resolves a Codex token through an accessor OPENAI_API_KEY can override', () => {
    const offenders = codexTokenAssignments.filter(({ text }) =>
      /CodexAuthManager\.(getAccessToken|ensureValidToken)/.test(text),
    );

    expect(
      offenders.map((o) => `ModelRoutes.js:${o.line}  ${o.text}`),
      'These send a token to chatgpt.com, which rejects sk- keys with a 401 and '
        + 'silently collapses the model list to the hardcoded fallback. Use getOAuthToken().',
    ).toEqual([]);
  });

  it('every Codex call site uses getOAuthToken', () => {
    for (const { text, line } of codexTokenAssignments) {
      expect(text, `ModelRoutes.js:${line}`).toContain('getOAuthToken');
    }
  });
});
