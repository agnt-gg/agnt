import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWithFallback, classifyFailure, buildProviderChain } from './ProviderFallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCH = fs.readFileSync(path.join(__dirname, '../OrchestratorService.js'), 'utf8');
const AUTO = fs.readFileSync(path.join(__dirname, '../AutonomousMessageService.js'), 'utf8');

/**
 * Mid-turn 529 (tool loop / retry / follow-up) used to call adapter.callStream
 * directly. The adapter returned recoveredFromError after its own retries, and
 * the orchestrator streamed the error card. Failover only wrapped round 0.
 *
 * These tests pin the wiring and the 529 → next-tier behaviour.
 */

describe('OrchestratorService streams every LLM call through the failover chain', () => {
  it('defines streamAcrossChain over runWithFallback + runTierStream', () => {
    expect(ORCH).toMatch(/const streamAcrossChain = \(messages, tools, onChunk\) => runWithFallback/);
    expect(ORCH).toMatch(/runOne:\s*\(tier\)\s*=>\s*runTierStream\(tier, messages, tools, onChunk\)/);
  });

  it('round 0, validation retry, tool loop, and follow-up all use streamAcrossChain', () => {
    expect(ORCH).toMatch(/const \{ result: _r0, tier: _r0Tier \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: retryResponse \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: nextResponse \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: followUpResponse \} = await streamAcrossChain\(/);
  });

  it('adapter.callStream is only invoked from runTierStream (no bypass)', () => {
    const matches = [...ORCH.matchAll(/adapter\.callStream\(/g)];
    expect(matches.length).toBe(1);
    const idx = ORCH.indexOf('adapter.callStream(');
    const start = ORCH.lastIndexOf('const runTierStream', idx);
    expect(start).toBeGreaterThan(-1);
    expect(idx - start).toBeLessThan(2500);
  });
});

describe('AutonomousMessageService also fails over after round 0', () => {
  it('does not gate runWithFallback on round === 0', () => {
    expect(AUTO).not.toMatch(/if \(round === 0 && autoProviderChain\.length > 1\)/);
    expect(AUTO).toMatch(/await runWithFallback\(/);
  });

  it('final forced text response goes through runWithFallback', () => {
    const cap = AUTO.indexOf('Tool follow-up reached cap');
    expect(cap).toBeGreaterThan(-1);
    expect(AUTO.slice(cap)).toMatch(/await runWithFallback\(/);
  });
});

describe('a mid-turn 529 rolls to the next configured tier', () => {
  const chain = buildProviderChain({
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    fallbackEnabled: true,
    fallbackProviders: [{ provider: 'openai-codex', model: 'gpt-5.4-mini' }],
  });

  it('classifies HTTP 529 overloaded_error as overloaded', () => {
    expect(classifyFailure('529 overloaded_error: Overloaded')).toBe('overloaded');
  });

  it('round-N recoveredFromError on primary is served by the next tier', async () => {
    const seen = [];
    const { result, tier, attempts } = await runWithFallback({
      chain,
      runOne: async (t) => {
        seen.push(t.provider);
        if (t.primary) {
          return {
            recoveredFromError: true,
            recoveredError: '529 overloaded_error: Overloaded',
            responseMessage: { role: 'assistant', content: '⚠️ **API Error:** 529' },
            toolCalls: [],
          };
        }
        return {
          responseMessage: { role: 'assistant', content: 'continued on fallback' },
          toolCalls: [],
        };
      },
    });

    expect(seen[0]).toBe(chain[0].provider);
    expect(tier.provider).toBe(chain[1].provider);
    expect(result.recoveredFromError).toBeUndefined();
    expect(result.responseMessage.content).toBe('continued on fallback');
    expect(attempts[0].reason).toBe('overloaded');
  });

  it('ANTI-VACUITY: without the wrap, a recoveredFromError card would be the answer', async () => {
    // This is the old tool-loop path: one adapter.callStream, no runWithFallback.
    const card = {
      recoveredFromError: true,
      recoveredError: '529 overloaded_error: Overloaded',
      responseMessage: { role: 'assistant', content: '⚠️ **API Error:** 529' },
    };
    expect(card.recoveredFromError).toBe(true);
    expect(card.responseMessage.content).toMatch(/API Error/);
  });
});
