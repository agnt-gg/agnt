/**
 * Direct unit + wiring tests for BaseAdapter._reconcileToolCallsWithContent.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This guard was first written inline in the Anthropic return path, and a
 * negative control caught it being VACUOUS: after the root-cause fix, no stream
 * the adapter can currently receive produces a desync, so deleting the guard
 * left the whole suite green. A structural invariant with no reachable trigger
 * is exactly the kind of code the next reader deletes as dead.
 *
 * So it is a named helper, tested directly on the desynced input the integration
 * path can no longer produce, plus a positional source-contract test proving the
 * Anthropic boundary actually calls it. Same discipline as
 * toolArgGuard.wiring.test.js: unit-testing logic proves nothing about
 * reachability, and the original outage WAS a reachability failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseAdapter } from './llmAdapters.js';

const reconcile = (calls, blocks, label) =>
  BaseAdapter._reconcileToolCallsWithContent(calls, blocks, label);

const call = (id, name = 'scan_page_elements') => ({
  id, type: 'function', function: { name, arguments: '{}' },
});
const useBlock = (id, name = 'scan_page_elements') => ({ type: 'tool_use', id, name, input: {} });

describe('_reconcileToolCallsWithContent', () => {
  let errSpy;
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it('drops a call whose tool_use block was removed from the message', () => {
    const kept = reconcile([call('toolu_GOOD'), call('toolu_GONE')], [useBlock('toolu_GOOD')]);
    expect(kept.map((c) => c.id)).toEqual(['toolu_GOOD']);
  });

  it('drops EVERY call when no tool_use block survived — the production shape', () => {
    // This is execution 3b4cb1d4 exactly: the assistant message was padded down
    // to a single text block while the call list still held the tool call.
    const kept = reconcile(
      [call('toolu_012beTc8LA58curo33tHEius')],
      [{ type: 'text', text: '[The model returned an empty response.]' }],
    );
    expect(kept).toEqual([]);
  });

  it('is identity when every call has its block', () => {
    const calls = [call('a'), call('b')];
    expect(reconcile(calls, [useBlock('a'), useBlock('b')])).toEqual(calls);
  });

  it('reports what it dropped, by name and id', () => {
    reconcile([call('toolu_X', 'edit_file')], [], 'anthropic');
    const msg = errSpy.mock.calls.flat().join(' ');
    expect(msg).toContain('edit_file');
    expect(msg).toContain('toolu_X');
    expect(msg).toContain('anthropic');
  });

  it('says nothing when there is nothing to drop', () => {
    reconcile([call('a')], [useBlock('a')]);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('tolerates empty / absent inputs without throwing', () => {
    expect(reconcile([], [useBlock('a')])).toEqual([]);
    expect(reconcile(undefined, [])).toBeUndefined();
    expect(reconcile(null, [])).toBeNull();
    expect(reconcile([call('a')], undefined)).toEqual([]);
    expect(reconcile([call('a')], null)).toEqual([]);
  });

  it('ignores non-tool_use blocks when collecting valid ids', () => {
    const blocks = [
      { type: 'text', text: 'hi' },
      { type: 'thinking', thinking: '...', signature: 's' },
      useBlock('toolu_A'),
    ];
    expect(reconcile([call('toolu_A')], blocks).map((c) => c.id)).toEqual(['toolu_A']);
  });

  it('drops malformed entries rather than trusting them', () => {
    expect(reconcile([null, undefined, call('a')], [useBlock('a')]).map((c) => c.id)).toEqual(['a']);
  });

  it('a block with no id cannot vouch for a call', () => {
    expect(reconcile([call('a')], [{ type: 'tool_use', name: 'x', input: {} }])).toEqual([]);
  });

  it('is idempotent', () => {
    const once = reconcile([call('a'), call('b')], [useBlock('a')]);
    expect(reconcile(once, [useBlock('a')])).toEqual(once);
  });
});

describe('wiring: the Anthropic return boundary must actually call it', () => {
  const SRC = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'llmAdapters.js'),
    'utf8',
  );

  it('the helper is defined on BaseAdapter', () => {
    expect(typeof BaseAdapter._reconcileToolCallsWithContent).toBe('function');
  });

  it('the streaming path assigns its result back to accumulatedToolCalls', () => {
    expect(SRC).toMatch(
      /accumulatedToolCalls\s*=\s*BaseAdapter\._reconcileToolCallsWithContent\(/,
    );
  });

  it('it runs BEFORE the assistant message is built, not after', () => {
    const guardAt = SRC.indexOf('accumulatedToolCalls = BaseAdapter._reconcileToolCallsWithContent(');
    const messageAt = SRC.indexOf('const responseMessage = {\n          role: \'assistant\',\n          content: cleanedContentBlocks');
    expect(guardAt).toBeGreaterThan(-1);
    expect(messageAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(messageAt);
  });

  it('it is fed the CLEANED blocks — feeding it the raw ones would make it a no-op', () => {
    // Scope this to the ARGUMENT LIST, not a fixed-width window. A 240-char
    // slice reached past the closing paren into `content: cleanedContentBlocks`
    // on the next statement, so the assertion passed even when the call site
    // was rewritten to pass the raw blocks. Caught by negative control NC6.
    const at = SRC.indexOf('BaseAdapter._reconcileToolCallsWithContent(');
    expect(at).toBeGreaterThan(-1);
    const argsEnd = SRC.indexOf(');', at);
    const argList = SRC.slice(at, argsEnd);

    expect(argList).toContain('cleanedContentBlocks');
    expect(argList).toContain('accumulatedToolCalls');
  });
});
