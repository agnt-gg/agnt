import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWithFallback, classifyFailure, buildProviderChain } from './ProviderFallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCH = fs.readFileSync(path.join(__dirname, '../OrchestratorService.js'), 'utf8');
const AUTO = fs.readFileSync(path.join(__dirname, '../AutonomousMessageService.js'), 'utf8');

/**
 * A mid-turn overload used to end the turn.
 *
 * Only round 0 was wrapped in the failover chain. The tool loop, the validation
 * retry and the no-text follow-up each called adapter.callStream directly, so
 * once tools had run a 529 came back as the adapter's recoveredFromError card,
 * the orchestrator streamed it as an error, and the configured fallback tiers
 * never got a turn.
 *
 * Four call sites now share ONE wrapper. That consolidation is the thing worth
 * guarding: dynamicRouting.invariants.test.js requires exactly one
 * `await runWithFallback(` in this file precisely so cancellation, rollover and
 * the no-persist rule cannot fork. The three "semantics hold once" blocks below
 * discharge that requirement rather than leaving it asserted by comment.
 */

describe('every LLM stream in a turn goes through one failover call site', () => {
  it('streamAcrossChain is the single wrapper over runWithFallback + runTierStream', () => {
    expect(ORCH).toMatch(/const streamAcrossChain = async \(messages, tools, onChunk\) => \{/);
    expect(ORCH).toMatch(/return await runWithFallback\(\{/);
    expect(ORCH).toMatch(/runOne:\s*\(tier\)\s*=>\s*runTierStream\(tier, messages, tools, onChunk\)/);
  });

  it('there is exactly ONE chain-execution call site in the orchestrator', () => {
    // Mirrors dynamicRouting.invariants.test.js. Duplicated deliberately: that
    // file owns the routing invariant, this one owns the failover wiring, and
    // whichever is read first should state the constraint it depends on.
    const calls = [...ORCH.matchAll(/await runWithFallback\(/g)];
    expect(
      calls.length,
      'Four streaming sites share one executor. A second call site would mean '
      + 'proving cancellation, rollover and no-persist twice.'
    ).toBe(1);
  });

  it('round 0, validation retry, tool loop and follow-up all call the wrapper', () => {
    expect(ORCH).toMatch(/const \{ result: _r0, tier: _r0Tier \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: retryResponse \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: nextResponse \} = await streamAcrossChain\(/);
    expect(ORCH).toMatch(/const \{ result: followUpResponse \} = await streamAcrossChain\(/);
  });

  it('adapter.callStream is reachable ONLY from runTierStream (no bypass)', () => {
    // The funnel is what makes four call sites safe. A new stream that reached
    // for the adapter directly would silently lose failover again — the exact
    // regression this file exists to prevent.
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

  it('the forced final text response goes through runWithFallback', () => {
    const cap = AUTO.indexOf('Tool follow-up reached cap');
    expect(cap).toBeGreaterThan(-1);
    expect(AUTO.slice(cap)).toMatch(/await runWithFallback\(/);
  });
});

// ── THE THREE SEMANTICS, PROVEN ONCE ───────────────────────────────────────
//
// The invariant permits a single execution path on the grounds that these hold
// there. Asserted against the real executor, not a mock of it.

const twoTier = () => buildProviderChain({
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  fallbackEnabled: true,
  fallbackProviders: [{ provider: 'openai-codex', model: 'gpt-5.4-mini' }],
});

describe('SEMANTIC 1 — a mid-turn overload rolls to the next tier', () => {
  it('classifies HTTP 529 overloaded_error as overloaded', () => {
    expect(classifyFailure('529 overloaded_error: Overloaded')).toBe('overloaded');
  });

  it('round-N recoveredFromError on the primary is served by the fallback', async () => {
    const seen = [];
    const { result, tier, attempts } = await runWithFallback({
      chain: twoTier(),
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

    expect(seen).toEqual(['anthropic', 'openai-codex']);
    expect(tier.provider).toBe('openai-codex');
    expect(result.recoveredFromError).toBeUndefined();
    expect(result.responseMessage.content).toBe('continued on fallback');
    expect(attempts[0].reason).toBe('overloaded');
  });

  it('ANTI-VACUITY: the same card on a ONE-tier chain is still the answer', async () => {
    // The real control. Without a tier to roll to, the executor returns the
    // error card — which is exactly the old behaviour every mid-turn 529 hit.
    // If this passed AND the test above passed for the wrong reason, the two
    // would agree; they do not.
    const single = buildProviderChain({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      fallbackEnabled: false,
      fallbackProviders: [],
    });
    expect(single).toHaveLength(1);

    const { result, tier } = await runWithFallback({
      chain: single,
      runOne: async () => ({
        recoveredFromError: true,
        recoveredError: '529 overloaded_error: Overloaded',
        responseMessage: { role: 'assistant', content: '⚠️ **API Error:** 529' },
        toolCalls: [],
      }),
    });

    expect(tier.provider).toBe('anthropic');
    expect(result.recoveredFromError).toBe(true);
    expect(result.responseMessage.content).toMatch(/API Error/);
  });

  it('each tier is attempted exactly once — a rollover never double-charges', async () => {
    const counts = {};
    await runWithFallback({
      chain: twoTier(),
      runOne: async (t) => {
        counts[t.provider] = (counts[t.provider] || 0) + 1;
        if (t.primary) {
          return {
            recoveredFromError: true,
            recoveredError: '529 overloaded_error: Overloaded',
            responseMessage: { role: 'assistant', content: 'x' },
            toolCalls: [],
          };
        }
        return { responseMessage: { role: 'assistant', content: 'ok' }, toolCalls: [] };
      },
    });
    expect(counts).toEqual({ anthropic: 1, 'openai-codex': 1 });
  });
});

describe('SEMANTIC 2 — cancellation is never failed over', () => {
  it('an abort on the primary propagates and the fallback is NOT tried', async () => {
    // A cancelled turn that quietly restarted on another provider would bill the
    // user for work they stopped, and stream a reply they did not ask for.
    const seen = [];
    await expect(runWithFallback({
      chain: twoTier(),
      runOne: async (t) => {
        seen.push(t.provider);
        throw new Error('Request aborted by user');
      },
    })).rejects.toThrow(/aborted/i);

    expect(seen).toEqual(['anthropic']);
  });

  it('a non-cancellation throw DOES roll over (negative control)', async () => {
    // Proves the assertion above is about cancellation specifically, not about
    // throws in general.
    const seen = [];
    const { tier } = await runWithFallback({
      chain: twoTier(),
      runOne: async (t) => {
        seen.push(t.provider);
        if (t.primary) throw new Error('529 overloaded_error: Overloaded');
        return { responseMessage: { role: 'assistant', content: 'ok' }, toolCalls: [] };
      },
    });
    expect(seen).toEqual(['anthropic', 'openai-codex']);
    expect(tier.provider).toBe('openai-codex');
  });
});

describe('SEMANTIC 3 — a rolled-over turn never rewrites the account default', () => {
  it('neither the wrapper nor the tier runner persists settings', () => {
    // The turn's winning tier is for THIS TURN ONLY. Persisting it would make a
    // transient overload permanently re-point the account, which is the drift
    // class ProviderFallback.js documents.
    const from = ORCH.indexOf('const runTierStream');
    const to = ORCH.indexOf('const { result: _r0, tier: _r0Tier } = await streamAcrossChain(');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    const region = ORCH.slice(from, to);
    expect(region).toMatch(/adapter\.callStream\(/);        // right region
    expect(region).toMatch(/await runWithFallback\(\{/);     // right region
    expect(
      region,
      'The failover region must not write user settings.'
    ).not.toMatch(/updateUserSettings/);
  });
});
