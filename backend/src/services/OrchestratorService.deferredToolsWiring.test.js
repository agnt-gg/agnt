/**
 * Source contract for deferred tool loading inside the chat orchestrator.
 * Behaviour is pinned against the real adapters in deferredTools.wire.test.js;
 * this file pins the WIRING in a method too large to boot in a unit test, so a
 * refactor cannot silently unwire it while every behavioural test stays green.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'OrchestratorService.js'), 'utf8');
const at = (needle) => {
  const i = SRC.indexOf(needle);
  if (i < 0) throw new Error(`not found: ${needle}`);
  return i;
};

describe('OrchestratorService deferred-tool wiring', () => {
  it('chooses the mode once, from the primary adapter, only for a conversation with no prior turns, BEFORE tools are selected', () => {
    const choose = at("conversationContext._toolLoadingMode = hasPriorTurns ? 'legacy' : chooseToolLoadingMode(adapter);");
    expect(choose).toBeLessThan(at('const toolSchemas = await config.getToolSchemas(conversationContext);'));
    expect(SRC).toContain("const hasPriorTurns = messages.some((m) => m?.role === 'assistant');");
  });

  it('restores the frozen mode on later turns', () => {
    expect(SRC).toMatch(/if \(priorContext\._toolLoadingMode\) \{\s*conversationContext\._toolLoadingMode = priorContext\._toolLoadingMode;/);
  });

  it('renders tools per tier transport, and fingerprints only the resident part', () => {
    const tier = SRC.slice(at('const runTierStream = async'), at('const onProviderFallback'));
    expect(tier).toContain('prepareTierRequest(adapter.deferredToolStyle?.() || null, { tools, messages, catalog: conversationContext._deferredToolCatalog })');
    expect(tier).toContain('tools: wire.fingerprintTools');
    expect(tier).toMatch(/adapter\.callStream\(\s*wire\.messages,\s*wire\.tools,/);
    expect(tier.indexOf('prepareTierRequest')).toBeLessThan(tier.indexOf('adapter.callStream('));
  });

  it('records a load on the result before the adapter formats it into the ledger', () => {
    expect(at('toolResponses.map((result) => attachToolLoad(result, deferredCatalog))'))
      .toBeLessThan(at('const formattedToolResponses = adapter.formatToolResults(ledgerToolResponses);'));
  });

  it('keeps what the budget cap drops reachable as deferred definitions', () => {
    expect(at('conversationContext._deferredToolCatalog = buildDeferredCatalog(')).toBeLessThan(at('finalToolSchemas = capResult.schemas;'));
  });
});
