import { describe, it, expect } from 'vitest';
import { getAllProviderConfigs, getReasoningControl } from '../ai/providerConfigs.js';
import { buildOpenAiLikeReasoningExtraBody } from './llmAdapters.js';

/**
 * WIRE PARITY (invariant I1) — if the UI offers a reasoning option, the request
 * must carry something for it.
 *
 * getReasoningControl (providerConfigs) decides what the UI SHOWS.
 * buildOpenAiLikeReasoningExtraBody (llmAdapters) decides what the request
 * SENDS. Before they shared one set of predicates the two disagreed for Groq:
 * the config matched startsWith('openai/gpt-oss-') and startsWith('qwen/qwen3-')
 * while the adapter matched three exact ids. A user on a model in that gap saw
 * the toggle, paid for the request, and had nothing sent.
 *
 * Crucially, that gap is NOT reachable through the models a golden fixture
 * happens to pick — it opens when a VENDOR lists a new model, which no commit
 * triggers. So this enumerates every model the registry can currently expose
 * AND pins the specific gap ids that used to fall through.
 */

const OPENAI_LIKE = [
  'groq', 'cerebras', 'togetherai', 'chutes', 'zai',
  'kimi', 'kimi-code', 'deepseek', 'openrouter', 'grokai', 'minimax',
];

function reachableModels(cfg) {
  return [...new Set([...(cfg.fallbackModels || []), ...Object.keys(cfg.modelMetadata || {})])];
}

const triples = [];
for (const cfg of getAllProviderConfigs()) {
  if (!OPENAI_LIKE.includes(cfg.key)) continue;
  for (const model of reachableModels(cfg)) {
    const control = getReasoningControl(cfg.key, model);
    if (!control) continue;
    for (const opt of control.options || []) {
      if (opt.value === 'default') continue; // null means "send nothing" by contract
      triples.push({ provider: cfg.key, model, option: opt.value });
    }
  }
}

describe('reasoning wire parity (UI option => wire payload)', () => {
  it('ANTI-VACUITY: there is a meaningful surface to check', () => {
    // 75 triples measured 2026-08-08. A collapse toward zero means the option
    // shape changed and the loop above silently stopped matching anything.
    expect(triples.length).toBeGreaterThanOrEqual(50);
  });

  it.each(triples)('$provider / $model / "$option" produces a payload', ({ provider, model, option }) => {
    const wire = buildOpenAiLikeReasoningExtraBody(provider, model, option);
    expect(
      wire,
      `UI offers "${option}" for ${provider}/${model} but the adapter sends nothing — a silent no-op the user pays for`
    ).not.toBeNull();
    expect(typeof wire).toBe('object');
  });
});

describe('the specific gap the drifted predicates left open', () => {
  // These ids are NOT in any shipped fallback list today. They are exactly the
  // shape a vendor adds without warning, and each one used to show a toggle
  // that sent nothing. Regression-pinned so the drift cannot silently return.
  it.each([
    ['groq', 'qwen/qwen3-14b'],
    ['groq', 'qwen/qwen3-8b'],
    ['groq', 'openai/gpt-oss-safeguard-20b'],
    ['groq', 'openai/gpt-oss-40b'],
  ])('%s / %s: UI and wire agree', (provider, model) => {
    const control = getReasoningControl(provider, model);
    expect(control, `config should recognise ${model} as a reasoning model`).toBeTruthy();
    for (const opt of control.options) {
      if (opt.value === 'default') continue;
      expect(
        buildOpenAiLikeReasoningExtraBody(provider, model, opt.value),
        `${model} offers "${opt.value}" but sends nothing`
      ).not.toBeNull();
    }
  });
});
