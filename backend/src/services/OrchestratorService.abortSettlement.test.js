/**
 * Source-contract tests for abort settlement of open tool calls (#88).
 *
 * openToolCalls.test.js proves the ledger. This file pins the WIRING: that the
 * service's `sendEvent` actually passes through the ledger, and that the abort
 * settlement iterates the ledger rather than `toolCalls`. Both are the kind of
 * defect a passing unit test cannot see — the ledger can be perfect and never
 * consulted.
 *
 * Structural, like streamLifetime.test.js, because the tool loop cannot be
 * provoked from a unit test without a provider, an HTTP server and a socket.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = fs.readFileSync(path.join(__dirname, 'OrchestratorService.js'), 'utf8');
const ANTHROPIC = fs.readFileSync(
  path.join(__dirname, 'orchestrator/transports/anthropicMessages.js'), 'utf8');

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = stripComments(SERVICE);

function blockAfter(src, anchor, from = 0) {
  const start = src.indexOf(anchor, from);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

describe('every tool-call event the client sees passes through the ledger', () => {
  it('sendEvent is wrapped with the ledger once, after the transport is chosen', () => {
    const wraps = CODE.match(/wrapSendEventWithLedger\(/g) || [];
    expect(wraps).toHaveLength(1);
    // After the unfirehose wrapper, so both see the same events in the same order.
    const ledgerIdx = CODE.indexOf('wrapSendEventWithLedger(');
    const unfirehoseIdx = CODE.indexOf('wrapUnfirehoseSendEvent(');
    expect(unfirehoseIdx).toBeGreaterThan(-1);
    expect(ledgerIdx).toBeGreaterThan(unfirehoseIdx);
  });

  it('the by-hand id set the ledger replaces is gone', () => {
    // Two trackers of the same fact would drift; the ledger is the only one.
    expect(CODE).not.toMatch(/announcedToolIds/);
  });
});

describe('abort settles what the ledger says is open', () => {
  it('iterates the ledger, not the completed-stream toolCalls array', () => {
    const settlement = blockAfter(CODE, 'if (streamAbortController.signal.aborted && openToolCalls');
    expect(settlement, 'abort settlement block not found (guard must read the ledger)').toBeTruthy();
    expect(settlement).toMatch(/interruptionEvents\(assistantMessageId\)/);
    expect(settlement).toMatch(/sendEvent\('tool_end'/);
    // THE REGRESSION THIS EXISTS TO CATCH: guarding on `toolCalls` is the #88 bug.
    expect(settlement).not.toMatch(/for \(const toolCall of toolCalls\)/);
  });

  it('the guard no longer requires a completed stream', () => {
    expect(CODE).not.toMatch(/signal\.aborted && toolCalls && toolCalls\.length/);
  });
});

describe('the pending announcement is dedup-gated by the ledger', () => {
  it('the one announcement site asks the ledger first, and every stream routes through it', () => {
    // Three inline sites were consolidated into announceToolCallChunk when
    // eager execution landed; the gate now lives in exactly one place and
    // every streaming call in the turn feeds it.
    const sites = CODE.match(/sendEvent\('tool_pending'/g) || [];
    expect(sites).toHaveLength(1);
    const gates = CODE.match(/!openToolCalls\.has\(tc\.id\)/g) || [];
    expect(gates).toHaveLength(1);
    const routed = CODE.match(/announceToolCallChunk\(chunk\)/g) || [];
    expect(routed.length).toBeGreaterThanOrEqual(3);
  });
});

describe('no per-delta debug logging in production', () => {
  it('OrchestratorService does not console.log every tool_call_delta', () => {
    expect(SERVICE).not.toMatch(/tool_pending DEBUG/);
  });
  it('the Anthropic transport does not console.log every content_block_start', () => {
    expect(ANTHROPIC).not.toMatch(/Anthropic DEBUG/);
  });
});
