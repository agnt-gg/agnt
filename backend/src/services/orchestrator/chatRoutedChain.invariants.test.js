/**
 * A routed chat turn keeps the account chain, and every chat attempt teaches
 * provider health. Source-level guards, in the style of
 * dynamicRouting.invariants.test.js: these are statements about the call site
 * in OrchestratorService, which no unit of the router can observe.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORCHESTRATOR = fs.readFileSync(path.join(SRC, 'services/OrchestratorService.js'), 'utf8');

describe('a routed chat turn never loses the account chain', () => {
  it('the routed chain is COMPOSED with the account chain, not used alone', () => {
    expect(ORCHESTRATOR).toMatch(/dynamicChain = composeChain\(\{\s*routed: routed\.chain,\s*defaults: routingAccountChain,/);
    expect(ORCHESTRATOR).not.toMatch(/dynamicChain = routed\.chain;/);
  });

  it('the account chain is built from the turn pair BEFORE the routed re-point', () => {
    const built = ORCHESTRATOR.indexOf('const routingAccountChain =');
    const repoint = ORCHESTRATOR.indexOf('normalizedProvider = String(dynamicChain[0].provider).toLowerCase()');
    expect(built).toBeGreaterThan(-1);
    expect(repoint).toBeGreaterThan(-1);
    expect(built, 'after the re-point, normalizedProvider is the ROUTED pick, not the user default').toBeLessThan(repoint);
  });

  it('the agent chain wins over the user chain, as on the static path', () => {
    expect(ORCHESTRATOR).toMatch(/const routingAccountChain = \(agentChain && agentChain\.length > 1\)\s*\?\s*agentChain/);
  });
});

describe('every chat attempt feeds provider health', () => {
  it('the one runWithFallback call passes the per-user health view', () => {
    const call = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('return await runWithFallback({'));
    expect(call.slice(0, 900)).toMatch(/health: providerHealth\.forUser\(userId\),/);
  });
});
