// Wiring assertions complement the behavioral inference/transport tests. The
// orchestrator's source-only contract tests are not discoverable by `related`.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('./OrchestratorService.js', import.meta.url), 'utf8');

describe('local context wiring', () => {
  it('measures the loaded server before admitting tools', () => {
    const measure = source.indexOf('localContextBudget = await localInference.measure');
    const cap = source.indexOf('const capResult = capToolsToBudget');
    expect(measure).toBeGreaterThan(0);
    expect(measure).toBeLessThan(cap);
    expect(source).toContain('hardTokenLimit: !!localContextBudget');
    expect(source).toContain('getLocalToolBudget(model, localContextBudget, messages)');
  });
  it('carries the loaded window through every context-management call', () => {
    const calls = [...source.matchAll(/manageContext\(messages, model, finalToolSchemas, normalizedProvider, \{([\s\S]*?)\}\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) expect(call[1]).toContain('...localContextBudget');
  });
  it('re-budgets after discovery and does not undo local context reductions for caching', () => {
    const discovery = source.indexOf('// Dynamic tool loading:');
    const rebudget = source.indexOf('localContextBudget = await localInference.measure', discovery);
    expect(rebudget).toBeGreaterThan(discovery);
    expect(rebudget).toBeLessThan(source.indexOf('let loopContextResult = manageContext', discovery));
    expect(source).toContain("const canRevert = normalizedProvider !== 'openai-codex' && !localContextBudget");
  });
  it('keeps local on one tier and surfaces a failed local run as an error event', () => {
    expect(source).toContain('if (isLocalProvider(normalizedProvider)) providerChain = providerChain.slice(0, 1);');
    const recovery = source.slice(source.indexOf('LLM adapter recovered from error'), source.indexOf('LLM adapter recovered from error') + 1000);
    expect(recovery).toContain('isLocalProvider(normalizedProvider)');
    expect(recovery).toContain("sendEvent('error'");
  });
});
