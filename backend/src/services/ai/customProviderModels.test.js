import { describe, it, expect } from 'vitest';
import { serializeModelList, parseModelList } from './CustomOpenAIProviderService.js';
import { PROVIDER_TEMPLATES } from './providerConfigs.js';

/**
 * A tenant rewrote its own container because this path did not exist.
 *
 * The supported way to add an OpenAI-compatible provider assumed every gateway
 * publishes GET /v1/models. api.cline.bot answers that with 404, so the UI
 * reported a failed connection for a provider whose URL and key were both
 * correct, and offered no way forward. The agent patched the running app
 * instead, broke the frontend entry graph doing it, and the page went blank.
 *
 * These tests pin the alternative: a declared model list, and a 404 from
 * /models treated as a configuration state rather than a fault.
 */

describe('serializeModelList', () => {
  it('accepts the textarea shape the UI produces (one id per line)', () => {
    expect(serializeModelList('cline-pass/glm-5.2\ncline-pass/kimi-k2.5')).toBe(
      '["cline-pass/glm-5.2","cline-pass/kimi-k2.5"]'
    );
  });

  it('accepts an array from a direct API caller', () => {
    expect(serializeModelList(['a/b', 'c/d'])).toBe('["a/b","c/d"]');
  });

  it('tolerates commas, blank lines and stray whitespace', () => {
    expect(serializeModelList('  a/b , \n\n c/d  \r\n')).toBe('["a/b","c/d"]');
  });

  it('de-duplicates rather than pinning the same id twice into the picker', () => {
    expect(serializeModelList('a/b\na/b\nc/d')).toBe('["a/b","c/d"]');
  });

  // The anti-vacuity cases. "Never store an empty list" must not quietly become
  // "never store anything", and an empty submission must CLEAR rather than pin.
  it('returns null for nothing declared, which means auto-discover', () => {
    expect(serializeModelList(undefined)).toBeNull();
    expect(serializeModelList(null)).toBeNull();
    expect(serializeModelList('')).toBeNull();
    expect(serializeModelList('   \n  \n')).toBeNull();
    expect(serializeModelList([])).toBeNull();
  });

  it('round-trips through parseModelList', () => {
    const ids = ['cline-pass/glm-5.2', 'cline-pass/qwen3.7-plus'];
    expect(parseModelList(serializeModelList(ids))).toEqual(ids);
  });
});

describe('parseModelList', () => {
  it('returns an empty list for a NULL column, so discovery still runs', () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList('')).toEqual([]);
  });

  it('degrades to auto-discovery instead of throwing on a corrupt row', () => {
    // A hand-edited or truncated row must not break the model picker for every
    // other provider the user has configured.
    expect(parseModelList('{not json')).toEqual([]);
    expect(parseModelList('"a string"')).toEqual([]);
    expect(parseModelList('42')).toEqual([]);
  });

  it('drops non-string entries rather than passing them to the API', () => {
    expect(parseModelList('["a/b",null,7,"c/d"]')).toEqual(['a/b', 'c/d']);
  });
});

describe('cline-pass provider template', () => {
  const template = PROVIDER_TEMPLATES.find((t) => t.key === 'cline-pass');

  it('is registered', () => {
    expect(template).toBeDefined();
  });

  it('declares models, because this gateway publishes no catalog to discover', () => {
    expect(Array.isArray(template.models)).toBe(true);
    expect(template.models.length).toBeGreaterThan(0);
  });

  it('uses the family/name id format the API requires', () => {
    // A bare id is rejected upstream with 400 "invalid model format".
    for (const id of template.models) {
      expect(id).toMatch(/^[^/\s]+\/[^/\s]+$/);
    }
  });

  it('offers a default model that is in its own catalog', () => {
    expect(template.models).toContain(template.defaultModel);
  });

  it('serializes cleanly into the storage column', () => {
    expect(parseModelList(serializeModelList(template.models))).toEqual(template.models);
  });
});

describe('every provider template stays internally consistent', () => {
  it('has a key, name and baseURL', () => {
    for (const t of PROVIDER_TEMPLATES) {
      expect(t.key, JSON.stringify(t)).toBeTruthy();
      expect(t.name, t.key).toBeTruthy();
      expect(t.baseURL, t.key).toBeTruthy();
    }
  });

  it('has unique keys', () => {
    const keys = PROVIDER_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never declares an empty models array, which would pin an empty picker', () => {
    // Absent means "discover". Present-but-empty is the one state that would
    // silently leave a user with no models and no error.
    for (const t of PROVIDER_TEMPLATES) {
      if ('models' in t) expect(t.models.length, t.key).toBeGreaterThan(0);
    }
  });
});
