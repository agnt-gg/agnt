import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * A positional source-contract test for custom-provider failover wiring.
 *
 * buildProviderChain() only admits a custom provider when the caller hands it
 * that user's active custom-provider IDs. The unit tests prove the chain
 * builder honours the argument; they prove nothing about whether the callers
 * actually PASS it. Miss one call site and the failure is silent and specific:
 * that path drops the custom tier with no error, so failover looks configured
 * in the UI and never fires — which is exactly the bug this feature fixes,
 * reintroduced one layer up.
 *
 * There are two independent turn paths (interactive chat and autonomous
 * follow-ups) and each builds TWO chains (the agent's own chain, and the user's
 * global chain). All four must be fed, so this asserts on every call site
 * rather than on the presence of the feature somewhere in the file.
 *
 * The ids come from a SQLite query, and failover is OFF by default, so the
 * lookup must also be LAZY: paid only where a chain is actually built, never
 * once per turn regardless. That is a property of the call sites, not of the
 * resolver, so it is asserted here too.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILES = {
  OrchestratorService: path.join(__dirname, '../OrchestratorService.js'),
  AutonomousMessageService: path.join(__dirname, '../AutonomousMessageService.js'),
};

/** Every `buildProviderChain({ ... })` call in a source file. Args are flat. */
function chainCallSites(src) {
  return src.match(/buildProviderChain\(\{[^}]*\}\)/g) || [];
}

describe.each(Object.entries(FILES))('custom-provider failover is wired into %s', (name, file) => {
  const SRC = fs.readFileSync(file, 'utf8');

  it('imports CustomOpenAIProviderService', () => {
    expect(SRC).toMatch(
      /import\s+CustomOpenAIProviderService\s+from\s+'\.\.?\/(?:ai\/)?CustomOpenAIProviderService\.js'/
    );
  });

  it('resolves the active custom provider ids for the user', () => {
    expect(SRC).toMatch(/CustomOpenAIProviderService\.getProvidersByUserId\(/);
  });

  it('resolves them through the shared lazy resolver', () => {
    expect(SRC).toMatch(/createCustomProviderIdResolver\(/);
  });

  it('never awaits the lookup directly — that would query on every turn', () => {
    // Failover is off for almost every user, so an unconditional
    // `await …getProvidersByUserId(...)` buys a per-turn SQLite query that
    // nothing consumes. The lookup must be wrapped in a thunk instead.
    expect(SRC).not.toMatch(/await\s+CustomOpenAIProviderService\.getProvidersByUserId/);
  });

  it('builds at least two chains (agent chain and user chain)', () => {
    expect(chainCallSites(SRC).length).toBeGreaterThanOrEqual(2);
  });

  it('passes customProviderIds at EVERY buildProviderChain call site', () => {
    const sites = chainCallSites(SRC);
    const missing = sites.filter((s) => !s.includes('customProviderIds'));
    expect(missing).toEqual([]);
  });

  it('awaits the resolver AT every call site, so the query follows the chain', () => {
    // This is what makes it lazy in practice: the only place the ids are
    // resolved is inside a branch that has already decided to build a chain.
    const sites = chainCallSites(SRC);
    const missing = sites.filter((s) => !/await\s+resolveCustomProviderIds\(\)/.test(s));
    expect(missing).toEqual([]);
  });

  it('creates the resolver BEFORE the first chain is built', () => {
    const createdAt = SRC.indexOf('createCustomProviderIdResolver(');
    const firstChain = SRC.indexOf('buildProviderChain({');
    expect(createdAt).toBeGreaterThan(-1);
    expect(firstChain).toBeGreaterThan(-1);
    // Creating it after the chain is built would leave the call sites
    // referencing an undefined resolver.
    expect(createdAt).toBeLessThan(firstChain);
  });
});
