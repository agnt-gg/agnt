/**
 * Dynamic routing — the invariants, and the structural guards behind them.
 *
 * Two kinds of test live here.
 *
 * BEHAVIOURAL CONFORMANCE: the router's output must be indistinguishable in
 * SHAPE from the static chain builder's, because the same executor runs both.
 * A router that emitted a subtly different tier object would break failover in
 * a way no router test would ever catch.
 *
 * SOURCE-LEVEL GUARDS: a few properties cannot be asserted from outside —
 * "this code path never persists the routed provider" is a statement about the
 * call site, not the return value. This repo already uses source guards for
 * exactly this class of rule (providerCallContainment, ledgerContracts), and
 * the reason is the same: a corrector nobody calls is indistinguishable from
 * the bug.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildProviderChain, MAX_FALLBACKS as STATIC_MAX } from './ProviderFallback.js';
import { buildDynamicChain, MAX_FALLBACKS as DYNAMIC_MAX } from './DynamicChain.js';
import { classifyIntent } from './routingIntent.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(DIR, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ORCHESTRATOR = read('services/OrchestratorService.js');
const DYNAMIC_CHAIN = read('services/orchestrator/DynamicChain.js');
const ROUTING_MODE = read('services/orchestrator/routingMode.js');
const CANDIDATES = read('services/orchestrator/routingCandidates.js');

const candidate = (over = {}) => ({
  provider: 'anthropic', model: 'haiku',
  inputCostPer1M: 1, outputCostPer1M: 5,
  contextWindow: 200000, maxOutputTokens: 8192,
  supportsVision: true, supportsTools: true,
  cacheReadMult: 0.1, cacheKnown: true,
  ...over,
});

// ── CONFORMANCE ────────────────────────────────────────────────────────────

describe('the two chain builders emit the same shape', () => {
  const intent = classifyIntent({ origin: 'orchestrator', contextTokens: 5000 });

  const dynamic = buildDynamicChain({
    intent,
    candidates: [
      candidate(),
      candidate({ provider: 'openai', model: 'gpt', inputCostPer1M: 10, outputCostPer1M: 30 }),
      candidate({ provider: 'gemini', model: 'flash', inputCostPer1M: 2, outputCostPer1M: 6 }),
    ],
    policy: { lambda: 0.5 },
    hint: { provider: 'anthropic', model: 'haiku' },
  });

  const staticChain = buildProviderChain({
    provider: 'anthropic',
    model: 'haiku',
    fallbackEnabled: true,
    fallbackProviders: [{ provider: 'openai', model: 'gpt' }],
  });

  it('both cap at the same number of tiers', () => {
    // Duplicated constant (DynamicChain must stay dependency-free). If they
    // ever drift, one builder silently produces a longer chain than the
    // executor was sized for.
    expect(DYNAMIC_MAX).toBe(STATIC_MAX);
  });

  it('both produce tier 0 as the primary, numbered from zero, contiguous', () => {
    for (const chain of [dynamic, staticChain]) {
      expect(chain[0].primary).toBe(true);
      chain.forEach((t, i) => {
        expect(t.tier).toBe(i);
        expect(t.primary).toBe(i === 0);
      });
    }
  });

  it('every tier of both carries the four fields runWithFallback consumes', () => {
    for (const chain of [dynamic, staticChain]) {
      for (const tier of chain) {
        expect(typeof tier.provider).toBe('string');
        expect(tier.provider.length).toBeGreaterThan(0);
        expect('model' in tier).toBe(true);
        expect(Number.isInteger(tier.tier)).toBe(true);
        expect(typeof tier.primary).toBe('boolean');
      }
    }
  });

  it('neither repeats a provider', () => {
    for (const chain of [dynamic, staticChain]) {
      const providers = chain.map((t) => t.provider.toLowerCase());
      expect(new Set(providers).size).toBe(providers.length);
    }
  });
});

// ── PURITY ─────────────────────────────────────────────────────────────────

describe('the router core stays pure', () => {
  it('DynamicChain imports nothing at all', () => {
    // The moment it reaches for the database or the registry, it stops being
    // testable without a provider account and these tests become mocks.
    expect(DYNAMIC_CHAIN).not.toMatch(/^import\s/m);
  });

  it('routingMode imports nothing at all', () => {
    expect(ROUTING_MODE).not.toMatch(/^import\s/m);
  });

  it('neither touches Node built-ins or ambient globals', () => {
    for (const src of [DYNAMIC_CHAIN, ROUTING_MODE]) {
      expect(src).not.toMatch(/\brequire\(/);
      expect(src).not.toMatch(/\bprocess\./);
      expect(src).not.toMatch(/\b__dirname\b/);
    }
  });

  it('the impure half is the only place that reads credentials', () => {
    // Candidate gathering is allowed to be impure; the scorer is not.
    expect(CANDIDATES).toMatch(/getConnectedApps/);
    expect(DYNAMIC_CHAIN).not.toMatch(/getConnectedApps/);
  });
});

// ── THE PERSISTENCE INVARIANT ──────────────────────────────────────────────

describe('a routed turn never rewrites the account default', () => {
  /**
   * THE BUG THIS PREVENTS
   * ─────────────────────
   * The chat handler syncs the turn's provider back to users.default_provider
   * so background jobs see current values. Under routing that sync becomes
   * catastrophic: the router picks a cheap model for one low-stake turn, the
   * sync makes it the ACCOUNT DEFAULT, and every other surface silently
   * inherits it. ProviderFallback.js documents the same class of defect as the
   * historical cause of provider drift.
   */
  it('the write-back is gated on the routing mode', () => {
    const guard = /if \(persistDefaultNormalized && !workspaceHasAiOverride && !__dynamicRouting\)/;
    expect(
      guard.test(ORCHESTRATOR),
      'The default write-back must exclude dynamically-routed turns.'
    ).toBe(true);
  });

  it('routing mode is resolved BEFORE the write-back, or the guard reads undefined', () => {
    const resolvedAt = ORCHESTRATOR.indexOf('const __dynamicRouting =');
    const writeBackAt = ORCHESTRATOR.indexOf('if (persistDefaultNormalized');
    expect(resolvedAt).toBeGreaterThan(-1);
    expect(writeBackAt).toBeGreaterThan(-1);
    expect(
      resolvedAt,
      'Ordering matters: a guard that evaluates before its own input is a guard that never fires.'
    ).toBeLessThan(writeBackAt);
  });

  it('nothing in the routing path calls updateUserSettings', () => {
    for (const [name, src] of [
      ['DynamicChain', DYNAMIC_CHAIN],
      ['routingMode', ROUTING_MODE],
      ['routingCandidates', CANDIDATES],
      ['DynamicRouter', read('services/orchestrator/DynamicRouter.js')],
    ]) {
      expect(src, `${name} must not persist settings`).not.toMatch(/updateUserSettings/);
    }
  });

  it('the guard is checkable (negative control)', () => {
    // Without this, the regex above could rot into never matching and the
    // suite would pass while the invariant was gone.
    const preFix = 'if (persistDefaultNormalized && !workspaceHasAiOverride) {';
    const postFix = 'if (persistDefaultNormalized && !workspaceHasAiOverride && !__dynamicRouting) {';
    const guard = /if \(persistDefaultNormalized && !workspaceHasAiOverride && !__dynamicRouting\)/;
    expect(guard.test(preFix)).toBe(false);
    expect(guard.test(postFix)).toBe(true);
  });
});

// ── THE EXECUTOR IS UNTOUCHED ──────────────────────────────────────────────

describe('routing reuses the existing executor rather than forking it', () => {
  it('there is still exactly one runWithFallback call in the chat handler', () => {
    const calls = [...ORCHESTRATOR.matchAll(/await runWithFallback\(/g)];
    expect(
      calls.length,
      'A second execution path would fork the failover semantics — cancellation, ' +
        'rollover and the no-persist rule would each need proving twice.'
    ).toBe(1);
  });

  it('the dynamic chain feeds the same providerChain variable', () => {
    expect(ORCHESTRATOR).toMatch(/providerChain = dynamicChain;/);
    expect(ORCHESTRATOR).toMatch(/chain: providerChain,/);
  });

  it('the routed tier is applied before the client is built', () => {
    // Tier 0 reuses the outer client/adapter, so re-pointing after the client
    // exists would build the right chain and then ignore it.
    const repoint = ORCHESTRATOR.indexOf('normalizedProvider = String(dynamicChain[0].provider).toLowerCase()');
    const clientBuild = ORCHESTRATOR.indexOf('client = await createLlmClient(');
    expect(repoint).toBeGreaterThan(-1);
    expect(clientBuild).toBeGreaterThan(-1);
    expect(repoint).toBeLessThan(clientBuild);
  });
});

// ── FAILURE IS ALWAYS A DEGRADATION, NEVER AN ERROR ────────────────────────

describe('routing can never fail a request', () => {
  it('the router entry point swallows its own failures', () => {
    const src = read('services/orchestrator/DynamicRouter.js');
    expect(src).toMatch(/catch \(err\) \{[\s\S]*return null;/);
  });

  it('an empty pool degrades to the caller default rather than throwing', () => {
    const chain = buildDynamicChain({
      intent: classifyIntent({ origin: 'chat' }),
      candidates: [],
      policy: { lambda: 0.5 },
      hint: { provider: 'anthropic', model: 'sonnet' },
    });
    expect(chain).toHaveLength(1);
    expect(chain[0].provider).toBe('anthropic');
  });

  it('the decision log is never awaited on the hot path', () => {
    const src = read('services/orchestrator/DynamicRouter.js');
    expect(
      /await RoutingDecisionModel\.record/.test(src),
      'Observability must not sit between the user and their answer.'
    ).toBe(false);
    expect(src).toMatch(/RoutingDecisionModel\.record\(decision\)\.catch/);
  });
});
