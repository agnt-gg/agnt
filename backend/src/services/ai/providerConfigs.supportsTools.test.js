/**
 * providerSupportsTools — the tool-blind provider gate (PR #50 hardening).
 *
 * The subscription-CLI connectors grok-build and cursor-cli drive one-shot
 * print CLIs whose clients cannot forward function schemas. Declaring them
 * tool-blind here is what stops the orchestrator from shipping ~128 schemas
 * that never reach the model — which made it narrate tool calls that never
 * executed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { providerSupportsTools, getProviderConfig } from './providerConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('providerSupportsTools', () => {
  it('is false for the CLI print transports', () => {
    expect(providerSupportsTools('grok-build')).toBe(false);
    expect(providerSupportsTools('cursor-cli')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(providerSupportsTools('Grok-Build')).toBe(false);
    expect(providerSupportsTools('CURSOR-CLI')).toBe(false);
  });

  it('stays true for every tool-capable provider', () => {
    for (const key of ['openai', 'anthropic', 'claude-code', 'openai-codex', 'gemini', 'groq', 'grokai', 'deepseek']) {
      expect(providerSupportsTools(key), key).toBe(true);
    }
  });

  it('defaults permissive for unknown providers and empty input', () => {
    // Unknown providers keep the historical behaviour: tools are sent.
    expect(providerSupportsTools('some-future-provider')).toBe(true);
    expect(providerSupportsTools('')).toBe(true);
    expect(providerSupportsTools(null)).toBe(true);
  });

  it('reflects the explicit capability declaration, not a name list', () => {
    // The gate must read capabilities.text.supportsTools so a future CLI
    // provider opts out by declaration, not by editing a hardcoded set.
    expect(getProviderConfig('grok-build').capabilities.text.supportsTools).toBe(false);
    expect(getProviderConfig('cursor-cli').capabilities.text.supportsTools).toBe(false);
  });
});

describe('orchestrator honors the gate', () => {
  // The gate lives inline in OrchestratorService's turn setup. A full
  // orchestrator harness costs more than it verifies; this pins the two
  // load-bearing lines so a refactor cannot silently drop the mechanism.
  const src = fs.readFileSync(path.join(__dirname, '../../services/OrchestratorService.js'), 'utf8');

  it('imports and calls providerSupportsTools', () => {
    expect(src).toContain('providerSupportsTools');
    expect(src).toMatch(/if \(!providerSupportsTools\(normalizedProvider\)/);
  });

  it('empties the tool surface when the provider is tool-blind', () => {
    const gate = src.slice(src.indexOf('if (!providerSupportsTools(normalizedProvider)'));
    expect(gate.slice(0, 700)).toContain('finalToolSchemas = []');
  });
});
