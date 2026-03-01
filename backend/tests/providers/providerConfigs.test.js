/**
 * Config validation tests for providerConfigs.js
 *
 * Validates that every provider config is well-formed and complete.
 * These tests run on every CI build — no API keys required.
 *
 * Run with: npx vitest run backend/tests/providers/providerConfigs.test.js
 */

import { describe, test, expect } from 'vitest';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getAllProviderKeys,
  getProvidersWithCapability,
  getAllProviderTemplates,
  buildProviderCapabilities,
  buildBaseURLs,
} from '../../src/services/ai/providerConfigs.js';

const allConfigs = getAllProviderConfigs();

describe('providerConfigs', () => {
  test('has at least 14 provider configs', () => {
    expect(allConfigs.length).toBeGreaterThanOrEqual(14);
  });

  test('getAllProviderKeys returns all keys', () => {
    const keys = getAllProviderKeys();
    expect(keys.length).toBe(allConfigs.length);
    expect(keys).toContain('openai');
    expect(keys).toContain('anthropic');
    expect(keys).toContain('gemini');
  });

  test('getProviderConfig finds by key', () => {
    const config = getProviderConfig('groq');
    expect(config).toBeDefined();
    expect(config.name).toBe('Groq');
    expect(config.baseURL).toContain('groq.com');
  });

  test('getProviderConfig is case-insensitive', () => {
    const config = getProviderConfig('OpenAI');
    expect(config).toBeDefined();
    expect(config.key).toBe('openai');
  });

  test('getProvidersWithCapability returns correct providers for imageGen', () => {
    const providers = getProvidersWithCapability('imageGen');
    const keys = providers.map((p) => p.key);
    expect(keys).toContain('openai');
    expect(keys).toContain('gemini');
    expect(keys).toContain('grokai');
    expect(keys).not.toContain('groq');
    expect(keys).not.toContain('deepseek');
  });

  // Per-provider validation
  for (const config of allConfigs) {
    describe(`Provider: ${config.key}`, () => {
      test('has required fields', () => {
        expect(config.key).toBeTruthy();
        expect(config.name).toBeTruthy();
        expect(config.baseURL).toBeTruthy();
        expect(config.sdkType).toMatch(/^(openai|anthropic|gemini|cerebras)$/);
        expect(config.authScheme).toBeTruthy();
        expect(config.fallbackModels).toBeDefined();
        expect(config.fallbackModels.length).toBeGreaterThan(0);
      });

      test('baseURL is a valid URL', () => {
        expect(() => new URL(config.baseURL)).not.toThrow();
      });

      test('key is lowercase with hyphens only', () => {
        expect(config.key).toMatch(/^[a-z0-9-]+$/);
      });

      test('capabilities object exists', () => {
        expect(config.capabilities).toBeDefined();
        expect(typeof config.capabilities).toBe('object');
      });

      test('text capability has required fields', () => {
        if (config.capabilities.text) {
          expect(typeof config.capabilities.text.supportsStreaming).toBe('boolean');
          expect(typeof config.capabilities.text.supportsTools).toBe('boolean');
        }
      });

      test('imageGen capability has required fields when present', () => {
        if (config.capabilities.imageGen) {
          expect(config.capabilities.imageGen.models.length).toBeGreaterThan(0);
          expect(config.capabilities.imageGen.defaultModel).toBeTruthy();
          expect(config.capabilities.imageGen.operations.length).toBeGreaterThan(0);
        }
      });

      test('modelTransform is a function when present', () => {
        if (config.modelTransform) {
          expect(typeof config.modelTransform).toBe('function');
        }
      });

      test('modelFilter is a function when present', () => {
        if (config.modelFilter) {
          expect(typeof config.modelFilter).toBe('function');
        }
      });

      test('pagination config is valid when present', () => {
        if (config.pagination?.enabled) {
          expect(config.pagination.pageSize).toBeGreaterThan(0);
          expect(config.pagination.cursorParam).toBeTruthy();
          expect(config.pagination.hasMoreField).toBeTruthy();
        }
      });
    });
  }
});

describe('buildProviderCapabilities', () => {
  test('returns capabilities for all providers', () => {
    const caps = buildProviderCapabilities();
    expect(Object.keys(caps).length).toBe(allConfigs.length);
    expect(caps.openai.text).toBeDefined();
    expect(caps.openai.imageGen).toBeDefined();
    expect(caps.groq.imageGen).toBeNull();
  });
});

describe('buildBaseURLs', () => {
  test('returns URLs for all providers plus local', () => {
    const urls = buildBaseURLs();
    expect(urls.openai).toContain('openai.com');
    expect(urls.groq).toContain('groq.com');
    expect(urls.local).toContain('127.0.0.1');
  });
});

describe('PROVIDER_TEMPLATES', () => {
  const templates = getAllProviderTemplates();

  test('has at least 10 templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
  });

  for (const template of templates) {
    test(`template ${template.key} has required fields`, () => {
      expect(template.key).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.baseURL).toBeTruthy();
      expect(() => new URL(template.baseURL)).not.toThrow();
      expect(template.description).toBeTruthy();
    });
  }

  test('no template key duplicates a built-in provider key', () => {
    const builtInKeys = new Set(getAllProviderKeys());
    for (const template of templates) {
      expect(builtInKeys.has(template.key)).toBe(false);
    }
  });
});
