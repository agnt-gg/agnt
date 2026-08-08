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

  it('builds at least two chains (agent chain and user chain)', () => {
    expect(chainCallSites(SRC).length).toBeGreaterThanOrEqual(2);
  });

  it('passes customProviderIds at EVERY buildProviderChain call site', () => {
    const sites = chainCallSites(SRC);
    const missing = sites.filter((s) => !s.includes('customProviderIds'));
    expect(missing).toEqual([]);
  });

  it('resolves the ids BEFORE the first chain is built', () => {
    const resolvedAt = SRC.indexOf('CustomOpenAIProviderService.getProvidersByUserId(');
    const firstChain = SRC.indexOf('buildProviderChain({');
    expect(resolvedAt).toBeGreaterThan(-1);
    expect(firstChain).toBeGreaterThan(-1);
    // Resolving after the chain is built would pass an always-empty list —
    // every positional check above would still pass while the feature is dead.
    expect(resolvedAt).toBeLessThan(firstChain);
  });

  it('fails safe: id resolution cannot break the turn', () => {
    // A custom-provider lookup failure must degrade to "no custom tiers", not
    // throw out of the turn. Both call sites already sit inside a try/catch
    // that falls back to a single-tier chain; assert the lookup is inside one.
    const resolvedAt = SRC.indexOf('CustomOpenAIProviderService.getProvidersByUserId(');
    const tryBefore = SRC.lastIndexOf('try {', resolvedAt);
    const catchAfter = SRC.indexOf('} catch', resolvedAt);
    expect(tryBefore).toBeGreaterThan(-1);
    expect(catchAfter).toBeGreaterThan(resolvedAt);
  });
});
