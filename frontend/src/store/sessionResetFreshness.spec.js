/**
 * The wiring between "the store was reset" and "the caches were dropped".
 *
 * `withFreshness.spec.js` proves `invalidateAllFreshness()` works when it is
 * CALLED. That says nothing about whether anything calls it, and the defect
 * here was never a wrong function — it was a correct one that did not exist at
 * the junction where state is destroyed.
 *
 * So this asserts the call site itself. A source scan rather than a behavioural
 * one, because instantiating the whole Vuex store pulls in every feature
 * module and its network layer; the property under test is one line of wiring,
 * and this fails for exactly the reason it is named for.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(HERE, 'state.js'), 'utf8');

/** A scanner must never match its own explanatory prose. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The loop that empties every user-scoped module. */
const RESET_MARKER = 'RESET_MUTATION';

describe('resetUserScopedData drops the freshness caches', () => {
  it('imports the invalidator', () => {
    expect(code).toMatch(/import\s*\{[^}]*invalidateAllFreshness[^}]*\}\s*from\s*['"][^'"]*withFreshness/);
  });

  it('calls it inside resetUserScopedData', () => {
    const start = code.indexOf('async resetUserScopedData');
    expect(start, 'resetUserScopedData was renamed or removed').toBeGreaterThan(-1);

    // The action body, up to the closing brace of its block.
    const body = code.slice(start, code.indexOf('\n    },', start));

    expect(
      body,
      'the store is emptied but the caches describing it are left warm, so the\n'
        + 'next call is a hit, the commit never re-runs, and the state stays empty',
    ).toContain('invalidateAllFreshness()');
  });

  it('calls it AFTER the modules have been reset', () => {
    // Order matters. Invalidating first would leave a window in which a
    // concurrent read re-populates the cache from state that is about to be
    // wiped — reinstating the very mismatch this closes.
    const start = code.indexOf('async resetUserScopedData');
    const body = code.slice(start, code.indexOf('\n    },', start));

    expect(body.indexOf('invalidateAllFreshness()')).toBeGreaterThan(body.indexOf(RESET_MARKER));
  });
});
