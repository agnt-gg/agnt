import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAllProviderKeys } from '../../src/services/ai/providerConfigs.js';
import { SCENARIO_KEYS } from './fixtures.js';
import { recordProvider, diffGolden, PATHS } from './record.mjs';

/**
 * THE WIRE ORACLE.
 *
 * Records, for every provider x scenario, the exact request object the adapter
 * hands to the SDK, and requires it to stay identical.
 *
 * This is the safety net that makes restructuring the provider layer a
 * mechanical exercise instead of an act of faith: any change to what AGNT puts
 * on the wire — for any of the 20 providers, in any of the 8 scenarios — fails
 * here, loudly, with the provider and scenario named.
 *
 * TWO fingerprints, because they answer different questions:
 *
 *   canonicalHash  sorted-key. Changes when the request MEANS something
 *                  different. Always a real behavioural change.
 *   orderHash      natural-order. Changes when key ORDER moved but meaning did
 *                  not. Not cosmetic — providers match cache prefixes on
 *                  serialized bytes, so a reorder can silently destroy prefix
 *                  reuse while every semantic assertion still passes.
 *
 * UPDATING A GOLDEN IS A DELIBERATE ACT:
 *   node backend/tests/provider-oracle/record.mjs
 * Re-record only when you intend the wire to change, and say why in the commit.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, 'goldens');

const providers = getAllProviderKeys();

describe('provider wire oracle', () => {
  it('covers every provider in the registry (I5 — no omission)', () => {
    const files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    expect(files.sort()).toEqual([...providers].sort());
  });

  it('captured every provider x scenario x path cell (anti-vacuity)', () => {
    let cells = 0;
    const skipped = [];
    for (const key of providers) {
      const g = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${key}.json`), 'utf8'));
      for (const name of SCENARIO_KEYS) {
        for (const p of PATHS) {
          cells++;
          if (!g.scenarios?.[name]?.[p]?.ok) skipped.push(`${key}/${name}/${p}`);
        }
      }
    }
    // 20 providers x 8 scenarios x 2 entry points. A shrinking surface means
    // the oracle is guarding less than it claims.
    expect(cells).toBe(providers.length * SCENARIO_KEYS.length * PATHS.length);
    expect(skipped, 'every cell must capture a real request').toEqual([]);
  });

  describe.each(providers)('%s', (key) => {
    it('wire payloads are unchanged for all scenarios', async () => {
      const file = path.join(GOLDEN_DIR, `${key}.json`);
      expect(fs.existsSync(file), `missing golden for ${key} — run record.mjs`).toBe(true);
      const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fresh = await recordProvider(key);

      const { semantic, ordering } = diffGolden(golden, fresh);

      expect(semantic, `${key}: request MEANING changed`).toEqual([]);
      expect(ordering, `${key}: request key ORDER changed — can break prefix caching`).toEqual([]);
    }, 60000);
  });
});
