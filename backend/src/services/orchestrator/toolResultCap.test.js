// #115: a tool result over the context cap lost its content. Anything that
// was not `{ success, result: [array] }` kept only its top-level KEY NAMES and
// was marked success:false, so an agent_chat reply (the other agent's answer
// plus every tool result it produced) arrived as an empty failure, and the
// answer could not be recovered. Over the cap, the full result must be stored
// where query_data reads it, the model must get a compact view of it, and a
// tool that succeeded must still read as a success.
import { describe, it, expect } from 'vitest';
import { capToolResult } from './toolResultCap.js';

const CAP = 100_000;
const call = (content, ctx = {}) => ({ out: capToolResult(content, { cap: CAP, functionName: 'agnt_chat', toolCallId: 'call_1', conversationContext: ctx }), ctx });
const storedRef = (ctx) => Object.keys(ctx.preservedContent || {})[0];

// The #115 shape: a reviewer's findings plus the big files it read on the way.
const FINDINGS = 'FINDINGS: pull/stash restoration lost 2 files. P1: stash pop skipped untracked. P2: no conflict check.';
const agentReply = JSON.stringify({
  success: true,
  operation: 'send_message',
  result: {
    response: FINDINGS,
    toolResults: [
      { name: 'read_file', result: { content: 'a'.repeat(40_000) } },
      { name: 'read_file', result: { content: 'b'.repeat(40_000) } },
      { name: 'git_diff', result: { content: 'c'.repeat(30_000) } },
    ],
  },
});

describe('a tool result over the cap', () => {
  it("keeps the other agent's answer in what the model sees (#115)", () => {
    const { out } = call(agentReply);
    expect(out.length).toBeLessThanOrEqual(CAP);
    expect(out).toContain(FINDINGS);
  });

  it('stores the whole original where query_data reads it, and names it', () => {
    const { out, ctx } = call(agentReply);
    const dataId = storedRef(ctx);
    expect(ctx.preservedContent[dataId]).toBe(agentReply);
    expect(ctx.dataRefSummaries[dataId]).toBeTruthy();
    expect(out).toContain(dataId);
    expect(out).toContain(`{{DATA_REF:${dataId}}}`);
  });

  it('a tool that succeeded still reads as a success', () => {
    const parsed = JSON.parse(call(agentReply).out);
    expect(parsed.success).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it('a tool that failed still reads as a failure, with its error', () => {
    const failed = JSON.stringify({ success: false, error: 'provider down', log: 'x'.repeat(150_000) });
    const parsed = JSON.parse(call(failed).out);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('provider down');
  });

  it('plain text over the cap keeps its beginning and is stored whole', () => {
    const text = 'HEADLINE ' + 'line of log\n'.repeat(20_000);
    const { out, ctx } = call(text);
    const parsed = JSON.parse(out);
    expect(out.length).toBeLessThanOrEqual(CAP);
    expect(parsed.view.startsWith('HEADLINE')).toBe(true);
    expect(ctx.preservedContent[storedRef(ctx)]).toBe(text);
  });

  it('a long list keeps its first items, its count and its success', () => {
    const list = JSON.stringify({ success: true, result: Array.from({ length: 5000 }, (_, i) => ({ id: i, body: 'z'.repeat(100) })) });
    const parsed = JSON.parse(call(list).out);
    expect(parsed.success).toBe(true);
    expect(parsed.view.result[0]).toEqual({ id: 0, body: 'z'.repeat(100) });
    expect(JSON.stringify(parsed.view)).toContain('5000');
  });

  it('is always valid JSON within the cap, even for one giant string field', () => {
    const giant = JSON.stringify({ success: true, result: { response: 'q'.repeat(400_000) } });
    const { out } = call(giant);
    expect(out.length).toBeLessThanOrEqual(CAP);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe('a tool result within the cap', () => {
  it('is returned untouched and nothing is stored', () => {
    const small = JSON.stringify({ success: true, result: { response: 'ok' } });
    const { out, ctx } = call(small);
    expect(out).toBe(small);
    expect(ctx.preservedContent).toBeUndefined();
  });
});
