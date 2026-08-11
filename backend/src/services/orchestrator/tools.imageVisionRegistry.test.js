import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TOOLS } from './tools.js';
import { getImageGenProviders, supportsImageGeneration } from '../ai/ProviderRegistry.js';
import { getProvidersWithCapability } from '../ai/providerConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'tools.js'), 'utf8');

/**
 * THE TOOL SCHEMA AND THE RUNTIME CHECK MUST AGREE.
 *
 * They did not. `generate_image`'s schema offered `openai-codex` in its enum
 * and named it in the description, while the handler's own
 * supportsImageGeneration() check denies it — so the model could select a
 * provider that was guaranteed to be rejected, and the tool's documentation
 * actively encouraged it.
 *
 * `analyze_image` had the mirror problem: a hand-maintained vision array that
 * was wrong in 6 of 17 entries, blocking two capable providers and admitting
 * three incapable ones.
 *
 * Both now derive from the registry, so the advertisement and the enforcement
 * are the same fact rather than two copies of it.
 */

describe('generate_image schema is derived from the registry', () => {
  const schema = TOOLS.generate_image.schema.function.parameters.properties;

  it('the provider enum equals the registry image providers', () => {
    const registry = getImageGenProviders().map((p) => p.provider).sort();
    expect([...schema.provider.enum].sort()).toEqual(registry);
  });

  it('every advertised provider passes the handler\'s own check', () => {
    // The exact contradiction that shipped: advertised but denied at runtime.
    for (const p of schema.provider.enum) {
      expect(supportsImageGeneration(p), `${p} is advertised in the enum`).toBe(true);
    }
  });

  it('openai-codex is not advertised — the registry denies it', () => {
    expect(schema.provider.enum).not.toContain('openai-codex');
    expect(schema.provider.description).not.toContain('openai-codex');
  });

  it('the description no longer names specific stale model ids', () => {
    // It previously advertised 'nano-banana-pro-preview' and
    // 'grok-4-1-fast-reasoning', neither of which the registry lists.
    for (const dead of ['nano-banana-pro-preview', 'grok-4-1-fast-reasoning', 'grok-2-image']) {
      expect(schema.model.description).not.toContain(dead);
    }
  });

  it('ANTI-VACUITY: the enum is non-empty and the registry knows some providers', () => {
    expect(schema.provider.enum.length).toBeGreaterThanOrEqual(3);
  });
});

describe('analyze_image asks the registry which providers do vision', () => {
  it('the hardcoded array is gone', () => {
    const codeOnly = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(codeOnly).toMatch(/getProvidersWithCapability\('vision'\)/);
    // The literal list that had drifted.
    expect(codeOnly).not.toMatch(/'openai', 'openai-codex', 'anthropic', 'claude-code',/);
  });

  it('the registry list fixes the six wrong entries', () => {
    const keys = getProvidersWithCapability('vision').map((p) => p.key);
    // Were blocked despite declaring vision.
    expect(keys).toContain('cerebras');
    expect(keys).toContain('chutes');
    // Were allowed despite not declaring it — an image was sent and the
    // provider API rejected it with a far less actionable message.
    for (const p of ['deepseek', 'minimax', 'local']) {
      expect(keys, p).not.toContain(p);
    }
  });
});
