import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fromAgntGatewayUsage } from './agntGatewayUsage.js';

const ORCH = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OrchestratorService.js'), 'utf8');

describe('AGNT Flash usage reaches the ledger', () => {
  // Measured 2026-10-06: the desktop logged this exact turn as 0 tokens.
  it('maps the gateway shape to OpenAI fields (prompt = fresh + cached)', () => {
    expect(fromAgntGatewayUsage({ inputTokens: 700, cachedInputTokens: 27776, outputTokens: 1307, credits: 6484 })).toMatchObject({
      prompt_tokens: 28476,
      completion_tokens: 1307,
      total_tokens: 29783,
      prompt_tokens_details: { cached_tokens: 27776 },
      credits: 6484,
    });
  });

  it('leaves usage that already speaks OpenAI alone, so nothing is counted twice', () => {
    const both = { inputTokens: 700, cachedInputTokens: 100, outputTokens: 5, prompt_tokens: 800, completion_tokens: 5 };
    expect(fromAgntGatewayUsage(both)).toBe(both);
    const anthropic = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 90 };
    expect(fromAgntGatewayUsage(anthropic)).toBe(anthropic);
  });

  it('passes through nothing-to-do inputs', () => {
    expect(fromAgntGatewayUsage(null)).toBe(null);
    expect(fromAgntGatewayUsage(undefined)).toBe(undefined);
    const empty = {};
    expect(fromAgntGatewayUsage(empty)).toBe(empty);
  });

  it('accumulateUsage normalises before it reads anything', () => {
    expect(ORCH).toMatch(/function accumulateUsage\(usage\) \{\s*\/\/[^\n]*\n\s*usage = fromAgntGatewayUsage\(usage\);/);
  });
});
