import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Source-contract tests for the group-chat wiring in OrchestratorService.
 *
 * The defect class here is WIRING, not logic: a correct contextManager whose
 * watermark is never persisted, a terminal tool whose break never fires, or
 * an identity hack that quietly returns are all invisible to unit tests of
 * the components themselves (same family as routeSecurity.test.js and
 * toolArgGuard.wiring.test.js). These assertions read the real source.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'OrchestratorService.js'), 'utf8');
const toolsSrc = fs.readFileSync(path.join(__dirname, 'orchestrator', 'tools.js'), 'utf8');
const selectorSrc = fs.readFileSync(path.join(__dirname, 'orchestrator', 'toolSelector.js'), 'utf8');

// Strip comments so assertions are decided by CODE, never by prose in a
// rationale comment (a trap that has bitten before — see memory).
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const code = stripComments(src);
const toolsCode = stripComments(toolsSrc);
const selectorCode = stripComments(selectorSrc);

describe('eviction watermark wiring', () => {
  it('restores _evictedUnits from priorContext', () => {
    expect(code).toMatch(/priorContext\._evictedUnits === 'number'/);
    expect(code).toMatch(/conversationContext\._evictedUnits = priorContext\._evictedUnits/);
  });

  it('every manageContext call site passes evictedUnits and persists the result', () => {
    const callSites = code.match(/manageContext\(messages, model, finalToolSchemas, normalizedProvider, \{[^}]*\}/g) || [];
    expect(callSites.length).toBe(3);
    for (const site of callSites) {
      expect(site).toContain('evictedUnits: conversationContext._evictedUnits || 0');
    }
    const persists = code.match(/conversationContext\._evictedUnits = \w+\.evictedUnits \|\| 0/g) || [];
    expect(persists.length).toBe(3);
  });

  it('the mid-turn cache revert can NEVER restore evicted units', () => {
    const canRevertIdx = code.indexOf('const canRevert');
    expect(canRevertIdx).toBeGreaterThan(-1);
    const canRevertExpr = code.slice(canRevertIdx, code.indexOf(';', canRevertIdx));
    expect(canRevertExpr).toContain('!(loopContextResult.evictedUnits > 0)');
  });
});

describe('identity is structural, not prompt-injected', () => {
  it('the [Identity: You are X] injection is gone', () => {
    expect(code).not.toContain('[Identity: You are');
    expect(code).not.toContain('NOT as Annie');
  });

  it('agentMeta carries agentId for speaker attribution', () => {
    expect(code).toMatch(/agentMeta = \{ agentId, agentName: agent\.name, agentIcon: agent\.icon \|\| null \}/);
  });
});

describe('mention_agent terminal floor pass', () => {
  it('floorPassed is declared before the tool loop', () => {
    expect(code).toMatch(/let floorPassed = false;/);
  });

  it('the tool loop breaks when mention_agent executed, after tool results landed', () => {
    // Pin the LIVE conditional exactly — asserting substring presence alone is
    // vacuous (a negative control proved `if (false && ...)` passed it).
    expect(code).toMatch(/if \(toolCalls\.some\(\(tc\) => tc\.function\?\.name === 'mention_agent'\)\) \{/);
    const breakIdx = code.indexOf("if (toolCalls.some((tc) => tc.function?.name === 'mention_agent'))");
    expect(breakIdx).toBeGreaterThan(-1);
    const after = code.slice(breakIdx, breakIdx + 400);
    expect(after).toContain('floorPassed = true');
    expect(after).toMatch(/sendEvent\('floor_passed'/);
    expect(after).toContain('break;');
    // Ordering: the terminal check sits AFTER tool_executions (results already
    // streamed) and BEFORE the next round's streaming call.
    //
    // That next call is no longer a bare `adapter.callStream` — the tool loop
    // streams through streamAcrossChain so a mid-turn overload can fail over to
    // the next provider tier. The ORDERING is the contract here, not the callee,
    // so the pin follows the call to its current spelling.
    const toolExecIdx = code.indexOf("sendEvent('tool_executions'");
    const nextCallIdx = code.indexOf('const { result: nextResponse } = await streamAcrossChain(');
    expect(toolExecIdx).toBeGreaterThan(-1);
    expect(nextCallIdx).toBeGreaterThan(-1);
    expect(breakIdx).toBeGreaterThan(toolExecIdx);
    expect(breakIdx).toBeLessThan(nextCallIdx);
  });

  it('the no-text follow-up safety net is gated off after a floor pass', () => {
    expect(code).toMatch(/currentRound > 0 && !finalContentForLogging && !floorPassed/);
  });
});

describe('mention_agent tool registration', () => {
  it('is registered with a terminal-contract schema', () => {
    expect(toolsCode).toContain('mention_agent: {');
    expect(toolsCode).toMatch(/name: 'mention_agent'/);
    // The schema must declare agentId required.
    const schemaIdx = toolsCode.indexOf("name: 'mention_agent'");
    const block = toolsCode.slice(schemaIdx, schemaIdx + 2500);
    expect(block).toMatch(/required: \['agentId'\]/);
  });

  it('is in the always-on DEFAULT_TOOLS set', () => {
    const setIdx = selectorCode.indexOf('export const DEFAULT_TOOLS');
    const setBlock = selectorCode.slice(setIdx, selectorCode.indexOf(']);', setIdx));
    expect(setBlock).toContain("'mention_agent'");
  });
});
