/**
 * providerSupportsTools — the tool-blind provider gate (PR #50 hardening).
 *
 * cursor-cli drives a one-shot print subprocess whose client cannot forward
 * function schemas. Declaring it tool-blind is what stops the orchestrator
 * from shipping ~128 schemas that never reach the model — which made it
 * narrate tool calls that never executed.
 *
 * grok-build was in the same bucket until the CLI's own endpoint
 * (cli-chat-proxy.grok.com) was verified live on 2026-07-27 to be a real
 * OpenAI-compatible API that accepts `tools` and returns tool_calls. It now
 * borrows the CLI's OAuth over HTTP — the openai-codex pattern — and gets the
 * full AGNT registry. The gate is what makes that a one-line capability flip.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { providerSupportsTools, getProviderConfig } from './providerConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('providerSupportsTools', () => {
  it('is false for the subprocess print transport', () => {
    expect(providerSupportsTools('cursor-cli')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(providerSupportsTools('CURSOR-CLI')).toBe(false);
    expect(providerSupportsTools('Grok-Build')).toBe(true);
  });

  it('stays true for every tool-capable provider', () => {
    for (const key of ['openai', 'anthropic', 'claude-code', 'openai-codex', 'gemini', 'groq', 'grokai', 'deepseek', 'grok-build']) {
      expect(providerSupportsTools(key), key).toBe(true);
    }
  });

  it('grok-build declares tools consistently at both levels', () => {
    // capabilities drives the orchestrator gate; modelMetadata drives the
    // model picker. They disagreeing is how a provider ends up half-enabled.
    const cfg = getProviderConfig('grok-build');
    expect(cfg.capabilities.text.supportsTools).toBe(true);
    expect(cfg.modelMetadata['grok-4.5'].supportsTools).toBe(true);
  });

  it('defaults permissive for unknown providers and empty input', () => {
    // Unknown providers keep the historical behaviour: tools are sent.
    expect(providerSupportsTools('some-future-provider')).toBe(true);
    expect(providerSupportsTools('')).toBe(true);
    expect(providerSupportsTools(null)).toBe(true);
  });

  it('reflects the explicit capability declaration, not a name list', () => {
    // The gate must read capabilities.text.supportsTools so a provider opts
    // out by declaration, not by editing a hardcoded set — which is what let
    // grok-build flip to true by changing one field.
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
