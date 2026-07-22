import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProviderConfig } from '../../src/services/ai/providerConfigs.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(TEST_DIR, '../..');

function readBackendFile(relativePath) {
  return fs.readFileSync(path.join(BACKEND_DIR, relativePath), 'utf8');
}

describe('Antigravity gateway isolation', () => {
  it('keeps the Antigravity control plane on production and model discovery on daily', () => {
    const source = readBackendFile('src/services/auth/AntigravityAuthManager.js');

    expect(source).toContain("const ANTIGRAVITY_CONTROL_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';");
    expect(source).toContain('process.env.ANTIGRAVITY_MODEL_GATEWAY');
    expect(source).toContain('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal');
    expect(source).toContain("`${ANTIGRAVITY_CONTROL_BASE}:loadCodeAssist`");
    expect(source).toContain('this._onboardToTier(authClient, ANTIGRAVITY_CONTROL_BASE, META, tierId)');
    expect(source).toContain("`${ANTIGRAVITY_MODEL_BASE}:fetchAvailableModels`");
    expect(source).not.toContain("`${ANTIGRAVITY_MODEL_BASE}:loadCodeAssist`");
  });

  it('keeps Gemini CLI inference on production and Antigravity inference on daily', () => {
    const source = readBackendFile('src/services/ai/LlmService.js');

    expect(source).toContain("const GEMINI_OAUTH_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';");
    expect(source).toContain('process.env.ANTIGRAVITY_MODEL_GATEWAY');
    expect(source).toContain('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal');
    expect(source.match(/`\$\{GEMINI_OAUTH_BASE\}:generateContent`/g)).toHaveLength(1);
    expect(source.match(/`\$\{GEMINI_OAUTH_BASE\}:streamGenerateContent\?alt=sse`/g)).toHaveLength(1);
    expect(source.match(/`\$\{ANTIGRAVITY_OAUTH_BASE\}:generateContent`/g)).toHaveLength(1);
    expect(source.match(/`\$\{ANTIGRAVITY_OAUTH_BASE\}:streamGenerateContent\?alt=sse`/g)).toHaveLength(1);
  });
});

describe('Antigravity Gemini 3.6 fallback catalog', () => {
  it('advertises the three verified reasoning tiers with exact live metadata', () => {
    const config = getProviderConfig('antigravity');
    const expectedIds = [
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
    ];

    expect(config.recommendedModels).toEqual(expectedIds);
    expect(config.fallbackModels.slice(0, 3)).toEqual(expectedIds);
    expect(config.fallbackVisionModels.slice(0, 3)).toEqual(expectedIds);

    for (const modelId of expectedIds) {
      expect(config.modelMetadata[modelId]).toMatchObject({
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        supportsVision: true,
        supportsTools: true,
        reasoning: true,
      });
    }
  });

  it('does not advertise the unverified automatic tier', () => {
    const config = getProviderConfig('antigravity');
    expect(config.fallbackModels).not.toContain('gemini-3.6-flash-tiered');
    expect(config.modelMetadata).not.toHaveProperty('gemini-3.6-flash-tiered');
  });
});
