import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWithFallback, buildProviderChain } from './ProviderFallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../OrchestratorService.js'), 'utf8');

/**
 * A MISSING CREDENTIAL ON THE PRIMARY PROVIDER MUST FAIL OVER, NOT SUCCEED EMPTY.
 *
 * Measured live 2026-08-10:
 *   keyless `zai`  → failed over to openai-codex, user got a real answer
 *   keyless `kimi` → status "completed", tokenUsage undefined, cost 0, no
 *                    context_manifest emitted, no answer
 *
 * Same user-facing fault, opposite outcomes. The cause was not the failover
 * machinery — ProviderFallback already rolls over on a thrown error, and
 * ProviderFallback.test.mjs covers that. The cause was the CALL SITE: every
 * fallback tier built its client inside runWithFallback, while the primary
 * tier built its client eagerly ~700 lines earlier, outside the failover
 * boundary. zai's key exists and is rejected at request time (inside); kimi's
 * is absent and threw at construction (outside).
 *
 * So these tests pin the wiring, not the mechanism. A helper that works but is
 * bypassed is indistinguishable from a helper that does not work.
 */

describe('primary-tier init failure is inside the failover boundary', () => {
  it('does NOT build the primary client eagerly outside a try', () => {
    // The exact shape of the original bug: an un-guarded await whose rejection
    // escapes to the outer handler instead of reaching runWithFallback.
    expect(SRC).not.toMatch(
      /\n\s*let client = await createLlmClient\(normalizedProvider, userId/
    );
  });

  it('captures a primary init failure instead of throwing out of the turn', () => {
    expect(SRC).toMatch(/let primaryTierInitError = null;/);
    expect(SRC).toMatch(/}\s*catch \(initError\) \{\s*\n\s*primaryTierInitError = initError;/);
  });

  it('re-throws that failure from inside runTierStream, where failover can see it', () => {
    const start = SRC.indexOf('const runTierStream = async (tier, messages, tools, onChunk) => {');
    expect(start, 'runTierStream must exist').toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 900);
    expect(body).toMatch(/if \(tier\.primary && !adapter\)/);
    expect(body).toMatch(/throw primaryTierInitError/);
  });

  it('runTierStream is the runOne passed to runWithFallback (reachability)', () => {
    // Without this, the throw above would sit in a function nobody calls.
    expect(SRC).toMatch(/runOne:\s*\(tier\)\s*=>\s*runTierStream\(tier,/);
    expect(SRC).toMatch(/const streamAcrossChain = /);
  });

  it('ANTI-VACUITY: the primary client is still constructed somewhere', () => {
    // A "fix" that simply deleted the construction would satisfy every
    // assertion above while breaking every turn.
    expect(SRC).toMatch(/client = await createLlmClient\(normalizedProvider, userId/);
    expect(SRC).toMatch(/adapter = await createLlmAdapter\(normalizedProvider, client, model/);
  });
});

describe('a stopped chat cannot roll over to another provider', () => {
  it('passes the run abort state into the one failover call site', () => {
    // Every stream in the turn goes through streamAcrossChain, so the guard
    // must live THERE — a Stop mid-tool-loop is as much a Stop as one at round 0.
    expect(SRC).toMatch(
      /const streamAcrossChain = [\s\S]*?runWithFallback\(\{[\s\S]*?shouldStop:\s*\(\)\s*=>\s*streamAbortController\.signal\.aborted,[\s\S]*?runOne:\s*\(tier\)\s*=>\s*runTierStream\(tier,/
    );
  });
});

describe('the resulting behaviour, against the real failover helper', () => {
  const chain = buildProviderChain({
    provider: 'kimi',
    model: 'kimi-k2-turbo-preview',
    fallbackEnabled: true,
    fallbackProviders: [{ provider: 'openai-codex', model: 'gpt-5.4-mini' }],
  });

  it('builds a two-tier chain for the measured scenario', () => {
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ provider: 'kimi', primary: true });
    expect(chain[1]).toMatchObject({ provider: 'openai-codex', primary: false });
  });

  it('a missing-credential throw on the primary rolls over and the user gets an answer', async () => {
    // Exactly the error LlmService raises when no token is stored.
    const seen = [];
    const { result, tier } = await runWithFallback({
      chain,
      runOne: async (t) => {
        seen.push(t.provider);
        if (t.primary) throw new Error('Missing access token for provider: kimi');
        return { responseMessage: { role: 'assistant', content: 'OK' }, toolCalls: [] };
      },
    });

    expect(seen).toEqual(['kimi', 'openai-codex']);
    expect(tier.provider).toBe('openai-codex');
    expect(result.recoveredFromError).toBeUndefined();
    expect(result.responseMessage.content).toBe('OK');
  });

  it('classifies a missing credential as an auth failure, so the log names the real cause', async () => {
    let reason = null;
    await runWithFallback({
      chain,
      runOne: async (t) => {
        if (t.primary) throw new Error('Missing access token for provider: kimi');
        return { responseMessage: { content: 'OK' } };
      },
      onFallback: (info) => { reason = info.reason; },
    });
    expect(reason).toBe('auth');
  });

  it('with no fallback configured it surfaces the error rather than a blank success', async () => {
    const soloChain = buildProviderChain({
      provider: 'kimi', model: 'kimi-k2-turbo-preview', fallbackEnabled: false, fallbackProviders: [],
    });
    const { result } = await runWithFallback({
      chain: soloChain,
      runOne: async () => { throw new Error('Missing access token for provider: kimi'); },
    });
    // The turn is marked as recovered-from-error and carries the real reason,
    // instead of reporting a completed turn with no usage at all.
    expect(result.recoveredFromError).toBe(true);
    expect(result.recoveredError).toMatch(/Missing access token/);
  });
});
