import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  selectAntigravityChatModels,
  antigravityQuotaFractions,
  antigravityMetadataRecords,
  parseGeminiCliQuotaModels,
  classifyCodeAssistError,
  humanizeModelId,
} from '../../src/services/ai/googleModelCatalog.js';

// Real :fetchAvailableModels response captured 2026-09-30 (prompt-experiment
// blobs stripped; structure, ids, flags and quota untouched).
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/antigravity-fetchAvailableModels-2026-09-30.json'),
  'utf8',
));
const clone = () => structuredClone(FIXTURE);
const ids = (payload) => selectAntigravityChatModels(payload).map((m) => m.id);

describe('selectAntigravityChatModels — against the live 2026-09-30 catalog', () => {
  it("mirrors Google's picker: Recommended sort first, then the current-tier pointers", () => {
    expect(ids(FIXTURE)).toEqual([
      'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
      'gemini-pro-agent', 'gemini-3.1-pro-low',
      'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
      // tieredModelIds in Google's key order: flashLite → 3.5-lite, flash → 3.8
      // (pro → 3.1-pro-low, already listed above)
      'gemini-3.5-flash-lite', 'gemini-3.8-flash-tiered',
    ]);
  });

  it('surfaces Gemini 3.8 Flash, which the Recommended-sort-only filter hid', () => {
    const [m] = selectAntigravityChatModels(FIXTURE).filter((x) => x.id === 'gemini-3.8-flash-tiered');
    expect(m).toMatchObject({ name: 'Gemini 3.8 Flash', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true });
  });

  it('never offers retired, aliased, tab, internal, image or deprecated entries', () => {
    const offered = new Set(ids(FIXTURE));
    for (const id of [
      'gemini-3-flash-agent', 'gemini-3.5-flash-low', 'gemini-3.5-flash-extra-low', // canned "no longer available"
      'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-thinking', // aliased onto 3.5 Flash Lite
      'chat_20706', 'chat_23310', 'tab_flash_lite_preview', 'tab_jump_flash_lite_preview',
      'gemini-3.1-flash-image', 'gemini-3.1-pro-high', // image-only; deprecated → gemini-pro-agent
    ]) expect(offered.has(id), id).toBe(false);
  });

  it('picks up a brand-new model the moment Google lists it — no code change', () => {
    const inSort = clone();
    inSort.models['gemini-4-argon'] = { displayName: 'Gemini 4 Argon', maxTokens: 2097152, maxOutputTokens: 131072, supportsImages: true, supportsThinking: true };
    inSort.agentModelSorts[0].groups[0].modelIds.unshift('gemini-4-argon');
    expect(ids(inSort)[0]).toBe('gemini-4-argon');

    const asTier = clone();
    asTier.models['gemini-4-argon'] = { displayName: 'Gemini 4 Argon' };
    asTier.tieredModelIds.pro = ['gemini-4-argon'];
    expect(ids(asTier)).toContain('gemini-4-argon');
  });

  it('drops a Recommended model once Google deprecates it or its quota is exhausted', () => {
    const payload = clone();
    payload.deprecatedModelIds['gemini-3.6-flash-low'] = { newModelId: 'gemini-3.8-flash-tiered' };
    payload.models['claude-sonnet-4-6'].quotaInfo = { remainingFraction: 0, isExhausted: true };
    const offered = ids(payload);
    expect(offered).not.toContain('gemini-3.6-flash-low');
    expect(offered).not.toContain('claude-sonnet-4-6');
  });

  it('ignores ids referenced by the picker but absent from the models map', () => {
    const payload = clone();
    payload.agentModelSorts[0].groups[0].modelIds.push('ghost-model');
    expect(ids(payload)).not.toContain('ghost-model');
  });

  it('degrades to an empty list on a malformed or empty payload, never throws', () => {
    for (const bad of [null, undefined, {}, { models: null }, { agentModelSorts: [{}], tieredModelIds: { flash: 'x' } }]) {
      expect(selectAntigravityChatModels(bad)).toEqual([]);
    }
  });
});

describe('Antigravity quota + metadata helpers', () => {
  it('reports known quota fractions only', () => {
    expect(antigravityQuotaFractions([{ quotaRemaining: 0.5 }, { quotaRemaining: null }, {}])).toEqual([0.5]);
  });

  it("records Google's own context window and capabilities at zero subscription cost", () => {
    const [record] = antigravityMetadataRecords(selectAntigravityChatModels(FIXTURE).filter((m) => m.id === 'gemini-3.8-flash-tiered'));
    expect(record).toEqual({
      id: 'gemini-3.8-flash-tiered', contextWindow: 1048576, maxOutputLength: 65536,
      supportsVision: true, reasoning: true, inputCostPer1M: 0, outputCostPer1M: 0,
    });
  });
});

describe('parseGeminiCliQuotaModels', () => {
  it('lists each entitled model once, in Google order, from retrieveUserQuota buckets', () => {
    expect(parseGeminiCliQuotaModels({
      buckets: [
        { modelId: 'gemini-3.8-flash', tokenType: 'REQUESTS', remainingFraction: 1 },
        { modelId: 'gemini-3.8-flash', tokenType: 'TOKENS', remainingFraction: 0.9 },
        { modelId: 'models/gemini-2.5-pro', remainingFraction: 0 },
        { tokenType: 'REQUESTS' },
        { modelId: '  ' },
      ],
    })).toEqual(['gemini-3.8-flash', 'gemini-2.5-pro']);
  });

  it('returns [] for a missing or empty payload', () => {
    expect(parseGeminiCliQuotaModels(null)).toEqual([]);
    expect(parseGeminiCliQuotaModels({ buckets: [] })).toEqual([]);
  });
});

describe('classifyCodeAssistError', () => {
  const httpError = (status, error) => ({ message: 'Request failed', response: { status, data: { error } } });

  it('flags the live "no valid license (#3501)" 403 as unlicensed', () => {
    expect(classifyCodeAssistError(httpError(403, {
      code: 403,
      message: 'You do not have a valid license of this product. Please contact your administrator to request a license. (#3501)',
    }))).toMatchObject({ status: 403, unlicensed: true });
  });

  it('does not treat transient or unrelated failures as unlicensed', () => {
    expect(classifyCodeAssistError(httpError(500, { message: 'backend error' })).unlicensed).toBe(false);
    expect(classifyCodeAssistError(httpError(403, { message: 'Rate limited by policy', status: 'RESOURCE_EXHAUSTED' })).unlicensed).toBe(false);
    expect(classifyCodeAssistError(new Error('socket hang up'))).toMatchObject({ status: null, unlicensed: false });
  });
});

describe('humanizeModelId', () => {
  it('names tiered ids after their generation', () => {
    expect(humanizeModelId('gemini-3.8-flash-tiered')).toBe('Gemini 3.8 Flash');
    expect(humanizeModelId('gemini-4-argon')).toBe('Gemini 4 Argon');
  });
});
