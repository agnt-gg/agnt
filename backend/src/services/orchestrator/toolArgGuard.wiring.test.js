/**
 * Wiring contract for the universal required-parameter gate.
 *
 * WHY A SOURCE-LEVEL CONTRACT TEST
 * --------------------------------
 * The bug this gate prevents was itself a wiring failure, not a logic failure.
 * `toolValidator.js` was correct, well-written and fully functional — it was
 * simply only ever called from `OpenAiLikeAdapter`. Three of five adapter
 * families silently bypassed it for months, and the orchestrator's entire
 * validation-recovery pipeline sat downstream of a field
 * (`invalidToolCalls`) that those adapters never populated. Every unit test
 * of the validator passed the whole time.
 *
 * So unit-testing `findMissingRequiredParams` in isolation (toolArgGuard.test.js)
 * proves the logic and proves nothing about reachability. This file pins the
 * reachability: the gate is imported, it sits on the single dispatch path every
 * provider converges on, and it runs BEFORE the tool executes.
 *
 * `OrchestratorService.streamChat` is a very large function with heavy runtime
 * dependencies (DB, sockets, live adapters), which makes a full integration
 * harness disproportionate. A positional source contract is the proportionate
 * instrument, and it fails loudly if anyone deletes or reorders the gate.
 */
import { describe, it, expect } from 'vitest';
import { readAdapterSource } from './transports/adapterSource.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = path.resolve(here, '../OrchestratorService.js');
const src = fs.readFileSync(ORCHESTRATOR, 'utf8');

/** Index of a required marker; fails with a useful message when absent. */
function at(marker) {
  const i = src.indexOf(marker);
  expect(i, `marker not found in OrchestratorService.js: ${marker}`).toBeGreaterThan(-1);
  return i;
}

describe('the guard is reachable from the orchestrator', () => {
  it('is imported from the orchestrator', () => {
    expect(src).toMatch(
      /import \{[^}]*findBlockingMissingParams[^}]*\} from '\.\/orchestrator\/toolArgGuard\.js'/,
    );
    expect(src).toMatch(
      /import \{[^}]*formatMissingParamsError[^}]*\} from '\.\/orchestrator\/toolArgGuard\.js'/,
    );
  });

  it('is invoked exactly once, on the shared dispatch path', () => {
    const calls = src.match(/findBlockingMissingParams\(/g) || [];
    // One import binding + one call site.
    expect(calls.length).toBe(1);
  });

  it('gates on the BLOCKING predicate, never the raw reporter', () => {
    // `findMissingRequiredParams` reports what is absent; gating on it directly
    // blocks partial calls, which measured 248 false rejections against
    // production data. The orchestrator must only ever consult the blocking
    // decision.
    expect(src).not.toMatch(/findMissingRequiredParams\(/);
  });

  it('is checked against the live tool schema list, not a stale snapshot', () => {
    // finalToolSchemas is mutated in place when discover_tools loads tools
    // mid-turn, so reading it at dispatch time is what keeps newly discovered
    // tools from being judged against an outdated array.
    expect(src).toMatch(/findBlockingMissingParams\(functionName, functionArgs, finalToolSchemas\)/);
  });
});

describe('the guard runs at the right moment', () => {
  const parse = () => at('functionArgs = JSON.parse(toolCall.function.arguments)');
  const gate = () => at('const missingParams = findBlockingMissingParams');
  const exec = () => at('await executeTool(');

  it('runs AFTER arguments are parsed (it needs the parsed object)', () => {
    expect(gate()).toBeGreaterThan(parse());
  });

  it('runs BEFORE the tool is executed — the whole point', () => {
    expect(gate()).toBeLessThan(exec());
  });

  it('short-circuits with a tool result instead of falling through to execution', () => {
    const window = src.slice(gate(), gate() + 3000);
    expect(window).toMatch(/if \(missingParams\.length > 0\)/);
    expect(window).toMatch(/return \{/);
    expect(window).toMatch(/role: 'tool'/);
    expect(window).toMatch(/tool_call_id: toolCall\.id/);
  });

  it('records the block as a failed tool execution so it stays measurable', () => {
    // The production defect was diagnosed entirely from agent_tool_executions
    // rows. A gate that blocks silently would have removed the evidence trail
    // that made this fixable.
    const window = src.slice(gate(), gate() + 3000);
    expect(window).toMatch(/createToolExecution/);
    expect(window).toMatch(/updateToolExecution/);
    expect(window).toMatch(/'failed'/);
  });

  it('emits tool_end so the UI does not leave a pending pill spinning forever', () => {
    const window = src.slice(gate(), gate() + 3000);
    expect(window).toMatch(/sendEvent\('tool_end'/);
  });
});

describe('the Anthropic adapter feeds the recovery pipeline', () => {
  // The adapters were split into transports/, so the layer is what to scan.
  // Reading llmAdapters.js alone would now find zero occurrences and this
  // guard would pass while protecting nothing.
  const adapters = readAdapterSource();

  it('returns invalidToolCalls, which the orchestrator recovery path consumes', () => {
    // Before the fix only OpenAiLikeAdapter returned this field, so the
    // orchestrator's validation-feedback retry was unreachable for Anthropic.
    const occurrences = adapters.match(/invalidToolCalls: /g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(adapters).toMatch(/invalidToolCalls: truncatedToolCalls\.length > 0 \? truncatedToolCalls : undefined/);
  });

  it('never substitutes an empty object for unparseable tool arguments', () => {
    // The exact line that caused 73 production failures was `block.input = {}`
    // inside the parse-failure catch. Its absence is the fix.
    const stopHandler = adapters.slice(
      adapters.indexOf("if (event.type === 'content_block_stop')"),
      adapters.indexOf("if (event.type === 'content_block_stop')") + 4000,
    );
    expect(stopHandler).toMatch(/argumentsCorrupt = true/);
    expect(stopHandler).not.toMatch(/catch \(parseError\) \{[\s\S]{0,400}?block\.input = \{\}/);
  });
});
