/**
 * Record the provider wire oracle.
 *
 * Iterates getAllProviderKeys() — the registry itself, never a hand-written
 * list (I5) — crossed with every scenario, and writes one golden per cell.
 *
 * Run from the repo root:  node backend/tests/provider-oracle/record.mjs
 * Add --check to verify against existing goldens instead of overwriting.
 *
 * ONE NON-HERMETIC INPUT, KNOWN AND BOUNDED.
 *
 * A cell's request depends on model METADATA (context window, max output
 * tokens), and that metadata is not purely static: providerConfigs accepts
 * dynamic entries learned from a provider's own /models response, and
 * modelMetadataPersistence mirrors those into model_metadata_cache and
 * hydrates them at boot. So a live provider call can, in principle, change
 * what a later run of this oracle sees — without any source change.
 *
 * Observed once, 2026-08-11: a --check immediately after a batch of live image
 * and model-list calls reported all 16 grokai cells changed. Re-recording
 * produced byte-identical goldens (git diff empty) and three consecutive
 * --check runs were clean, so the source was never at fault.
 *
 * IF YOU SEE AN UNEXPLAINED WHOLE-PROVIDER DIFF, do this before believing it:
 *   1. re-record and `git diff` the goldens — if there is no diff, the code
 *      reproduces them exactly and the check was perturbed, not the source;
 *   2. `git stash` and re-check to confirm against a clean tree;
 *   3. only then treat it as a real regression.
 * A single provider changing in ALL cells at once is the signature of a
 * metadata shift, not of a code change — a real code change almost always
 * moves one scenario, or the same scenario across many providers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAllProviderKeys, getProviderConfig } from '../../src/services/ai/providerConfigs.js';
import { createLlmAdapter } from '../../src/services/orchestrator/llmAdapters.js';
import { SCENARIOS, SCENARIO_KEYS } from './fixtures.js';
import { makeCaptureClient, captureWire } from './capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, 'goldens');
const CHECK = process.argv.includes('--check');

/** Both adapter entry points are guarded. See capture.js for why. */
export const PATHS = ['stream', 'nonStream'];

/**
 * The single comparison implementation, shared by `--check` and the vitest
 * suite so the two can never disagree about what "same" means.
 */
export function diffGolden(prev, fresh) {
  const semantic = [];
  const ordering = [];
  for (const name of SCENARIO_KEYS) {
    for (const p of PATHS) {
      const a = prev.scenarios?.[name]?.[p] || {};
      const b = fresh.scenarios?.[name]?.[p] || {};
      if (a.canonicalHash !== b.canonicalHash) {
        semantic.push(`${name}.${p}: ${a.canonicalHash || 'none'} -> ${b.canonicalHash || 'none'}`);
      } else if (a.orderHash !== b.orderHash) {
        ordering.push(`${name}.${p}: KEY ORDER ${a.orderHash} -> ${b.orderHash}`);
      }
    }
  }
  return { semantic, ordering };
}

/** Model choice is deterministic and derived from the registry. */
export function oracleModelFor(key) {
  const cfg = getProviderConfig(key);
  if (!cfg) return null;
  return (
    cfg.recommendedModels?.[0] ||
    cfg.fallbackModels?.[0] ||
    Object.keys(cfg.modelMetadata || {})[0] ||
    null
  );
}

export async function recordProvider(key) {
  const model = oracleModelFor(key);
  const out = { provider: key, model, scenarios: {} };
  if (!model) {
    out.error = 'no model resolvable from registry';
    return out;
  }

  for (const name of SCENARIO_KEYS) {
    const scenario = SCENARIOS[name];
    const { client, captured } = makeCaptureClient();
    let adapter;
    try {
      adapter = await createLlmAdapter(key, client, model, {
        ...(scenario.options || {}),
        conversationId: scenario.options?.conversationId ?? 'oracle-fixed-conversation-id',
      });
    } catch (err) {
      out.scenarios[name] = { ok: false, reason: `adapter construction: ${err.message}`.slice(0, 200) };
      continue;
    }
    adapter.__oracleClient = { client, captured };
    const result = await captureWire(adapter, scenario);
    // The full params blob is written to the golden file; the summary keeps
    // only the fingerprints so a diff is readable.
    out.scenarios[name] = result;
  }
  return out;
}

async function main() {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  const keys = getAllProviderKeys();
  const summary = [];
  let cells = 0, captured = 0;

  for (const key of keys) {
    const rec = await recordProvider(key);
    const file = path.join(GOLDEN_DIR, `${key}.json`);

    let status = [];
    for (const name of SCENARIO_KEYS) {
      for (const p of PATHS) {
        cells++;
        if (rec.scenarios[name]?.[p]?.ok) captured++;
      }
      const s = rec.scenarios[name];
      const tag = [s?.stream?.ok ? s.stream.canonicalHash.slice(0, 5) : 'SKIP',
                   s?.nonStream?.ok ? s.nonStream.canonicalHash.slice(0, 5) : 'SKIP'].join('/');
      status.push(`${name}=${tag}`);
    }

    if (CHECK) {
      if (!fs.existsSync(file)) { console.log(`MISSING GOLDEN ${key}`); continue; }
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { semantic, ordering } = diffGolden(prev, rec);
      const diffs = [...semantic, ...ordering];
      console.log(diffs.length ? `DIFF ${key}\n    ${diffs.join('\n    ')}` : `same ${key}`);
    } else {
      fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    }
    summary.push(`${key.padEnd(14)} ${status.join(' ')}`);
  }

  console.log(summary.join('\n'));
  console.log(`\n${captured}/${cells} cells captured across ${keys.length} providers x ${SCENARIO_KEYS.length} scenarios`);
  if (!CHECK) console.log(`goldens written to ${GOLDEN_DIR}`);
}

if (process.argv[1] && process.argv[1].endsWith('record.mjs')) {
  await main();
}
