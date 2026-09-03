/**
 * Structural gate: tool calls start while the model is still streaming.
 *
 * WHAT HAPPENED (measured 2026-09-03 on the live orchestrator)
 * -------------------------------------------------------------
 * Two-tool round, raw SSE timestamps:
 *
 *   2.73s tool_pending A      model names tool A
 *   3.59s tool_pending B      model names tool B
 *   3.61s tool_start   A+B    stream closed → BOTH start, together
 *   4.65s tool_end     A
 *   6.68s tool_end     B
 *
 * Nothing executed until the stream was over. In a fifteen-tool round with
 * write_file payloads that was minutes of every card sitting idle. This file
 * pins the wiring that lets a call run the moment its arguments are complete,
 * and the guards that make that safe. The behaviour of the ledger itself is
 * covered in orchestrator/eagerToolRuns.test.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(here, 'OrchestratorService.js'), 'utf8');
const ANTHROPIC = readFileSync(join(here, 'orchestrator/transports/anthropicMessages.js'), 'utf8');
const CHAT_COMPLETIONS = readFileSync(join(here, 'orchestrator/transports/chatCompletions.js'), 'utf8');

const indexOfOrThrow = (needle, from = 0) => {
  const i = CODE.indexOf(needle, from);
  if (i === -1) throw new Error(`not found: ${needle}`);
  return i;
};

describe('the per-call executor exists before the first stream starts', () => {
  it('runToolCall is defined ahead of the round-0 chunk handler', () => {
    const executor = indexOfOrThrow('const runToolCall = async (toolCall) => {');
    const chunkHandler = indexOfOrThrow('const onStreamChunk = (chunk) => {');
    expect(executor).toBeLessThan(chunkHandler);
  });

  it('the round claims runs instead of starting them itself', () => {
    expect(CODE).toContain('const toolPromises = toolCalls.map((toolCall) => claimToolRun(toolCall));');
    expect(CODE).not.toContain('toolCalls.map(async (toolCall) =>');
  });

  it('eager runs wait for the execution record so they are never unrecorded', () => {
    const ledger = CODE.slice(indexOfOrThrow('const eagerToolRuns = createEagerToolRuns('), indexOfOrThrow('const announceToolCallChunk'));
    expect(ledger).toContain('agentExecutionPromise.then(() => runToolCall(toolCall))');
  });
});

describe('every stream in the turn routes tool-call chunks through one handler', () => {
  it('tool_pending is announced from exactly one place', () => {
    const announcements = CODE.match(/sendEvent\('tool_pending'/g) || [];
    expect(announcements).toHaveLength(1);
    const handler = CODE.slice(indexOfOrThrow('const announceToolCallChunk = (chunk) => {'), indexOfOrThrow('const claimToolRun'));
    expect(handler).toContain("sendEvent('tool_pending'");
    expect(handler).toContain("chunk.type === 'tool_call_complete'");
  });

  it('no stream handler inspects tool_call_delta on its own any more', () => {
    const inline = CODE.match(/chunk\.type === 'tool_call_delta'/g) || [];
    // The single legitimate site is inside announceToolCallChunk.
    expect(inline).toHaveLength(1);
  });

  it('round 0, the validation retry and the tool loop all call it', () => {
    const calls = CODE.match(/announceToolCallChunk\(chunk\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('an aborted turn starts nothing new', () => {
    const handler = CODE.slice(indexOfOrThrow('const announceToolCallChunk = (chunk) => {'), indexOfOrThrow('const claimToolRun'));
    const completeBranch = handler.slice(handler.indexOf("'tool_call_complete'"));
    expect(completeBranch.indexOf('streamAbortController.signal.aborted')).toBeLessThan(completeBranch.indexOf('eagerToolRuns.start('));
  });
});

describe('work that started is never lost and never doubled', () => {
  it('a duplicate id reuses the first result re-keyed, with its own tool_start/tool_end', () => {
    const claim = CODE.slice(indexOfOrThrow('const claimToolRun = async (toolCall) => {'), indexOfOrThrow('const settleUnclaimedEagerRuns'));
    expect(claim).toContain('claimed.duplicateOf === null');
    expect(claim).toContain("sendEvent('tool_start', { assistantMessageId, toolCall: { id: toolCall.id");
    expect(claim).toContain("sendEvent('tool_end', { assistantMessageId, toolCall: { id: toolCall.id");
    expect(claim).toContain('return { ...result, tool_call_id: toolCall.id };');
  });

  it('a runner failure captured by the ledger becomes a tool error, not a hang', () => {
    const claim = CODE.slice(indexOfOrThrow('const claimToolRun = async (toolCall) => {'), indexOfOrThrow('const settleUnclaimedEagerRuns'));
    expect(claim).toContain('result.__eagerRunError');
  });

  it('every round drains unclaimed runs after it settles its own', () => {
    const round = indexOfOrThrow('const toolResponses = await Promise.all(toolPromises);');
    const drain = CODE.indexOf('await settleUnclaimedEagerRuns();', round);
    expect(drain).toBeGreaterThan(round);
    expect(drain - round).toBeLessThan(200);
  });

  it('eager runs land before the abort settlement tells the client they were interrupted', () => {
    const settlement = indexOfOrThrow('if (streamAbortController.signal.aborted && openToolCalls.size > 0) {');
    const drain = CODE.lastIndexOf('await settleUnclaimedEagerRuns();', settlement);
    expect(drain).toBeGreaterThan(-1);
    expect(settlement - drain).toBeLessThan(400);
  });

  it('a sync call already running rejects its async twin (the mirror of the existing rule)', () => {
    expect(CODE).toContain('const isDuplicateAsyncOfRunningSync =');
    expect(CODE).toContain('syncStartedFingerprints.has(callFingerprint)');
    expect(CODE).toContain('syncStartedFingerprints.clear();');
    expect(CODE).toContain('asyncQueuedFingerprints.clear();');
  });
});

describe('the transports say when a call is complete', () => {
  it('Anthropic announces completion at content_block_stop, after the JSON parsed', () => {
    const stop = ANTHROPIC.indexOf("if (event.type === 'content_block_stop')");
    const complete = ANTHROPIC.indexOf("type: 'tool_call_complete'", stop);
    expect(complete).toBeGreaterThan(stop);
    const between = ANTHROPIC.slice(stop, complete);
    expect(between).toContain('if (!argumentsCorrupt)');
  });

  it('Chat Completions announces the previous call when the next index opens, validated alone', () => {
    const site = CHAT_COMPLETIONS.indexOf("type: 'tool_call_complete'");
    expect(site).toBeGreaterThan(-1);
    const context = CHAT_COMPLETIONS.slice(site - 900, site);
    expect(context).toContain('validateToolCalls([previous], tools)');
    expect(context).toContain('completeAnnounced');
    // The marker must never ride on the tool-call object that goes back to the provider.
    expect(CHAT_COMPLETIONS).not.toMatch(/previous\.__\w+/);
  });
});
