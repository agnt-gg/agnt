import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The freshness clock must advance DURING a turn, not only at the end of one.
 *
 * `agent_execution_completed` fires once, when a turn finishes. AGNT's agentic
 * turns routinely run 30-50 minutes, so a clock fed only by that event told the
 * user "prompt cache has probably gone cold" for the entire duration of the very
 * turn that was reading the cache on every round. The backend now emits
 * `cache_activity` per round; this pins that the chat consumes it.
 *
 * The handler is one case inside a ~50-case switch in a 2900-line setup(), so
 * rather than mount the whole screen this extracts the REAL case body and
 * executes it. That runs the shipped bytes: unlike a grep, it cannot pass
 * against a branch that has been commented out, emptied, or made unreachable.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'Chat.vue'), 'utf8');

function extractCaseBody(source, caseLabel) {
  const start = source.indexOf(`case '${caseLabel}':`);
  if (start === -1) throw new Error(`case '${caseLabel}' is not handled in Chat.vue`);
  const bodyStart = start + `case '${caseLabel}':`.length;
  const nextCase = source.indexOf('case ', bodyStart);
  if (nextCase === -1) throw new Error('could not find the end of the case body');
  return source.slice(bodyStart, nextCase).replace(/\bbreak;\s*$/, '');
}

const BODY = extractCaseBody(SRC, 'cache_activity');

/** Run the real case body against a stub monitoring slot. */
function runHandler(ms, data) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('ms', 'data', BODY);
  fn(ms, data);
  return ms;
}

describe("Chat.vue — 'cache_activity' handler", () => {
  it('stamps the freshness clock with the observation time from the round', () => {
    const ms = { lastCacheActivityAt: '2026-07-28T14:55:02.262Z' };
    const at = '2026-07-28T20:33:41.000Z';
    runHandler(ms, { at, round: 3, cacheReadTokens: 158539, cacheCreationTokens: 0 });
    expect(ms.lastCacheActivityAt).toBe(at);
  });

  it('REGRESSION: a mid-turn round clears a stale "cold" reading', () => {
    // Live reproduction: conversation 523e7fa5 had a turn in flight and its
    // last recorded cache activity was 348 minutes old against a 60-minute
    // window, because nothing updated the clock until the turn ended.
    const stale = new Date(Date.now() - 348 * 60_000).toISOString();
    const ms = { lastCacheActivityAt: stale };
    runHandler(ms, { at: new Date().toISOString(), round: 12, cacheReadTokens: 4_624_381 });
    const ageMs = Date.now() - Date.parse(ms.lastCacheActivityAt);
    expect(ageMs).toBeLessThan(60 * 60_000);
  });

  it('falls back to the local clock when the event carries no timestamp', () => {
    const ms = { lastCacheActivityAt: null };
    runHandler(ms, { round: 1, cacheReadTokens: 100 });
    expect(Number.isFinite(Date.parse(ms.lastCacheActivityAt))).toBe(true);
  });

  it('does not throw when no monitoring slot exists for the stream', () => {
    // Events can arrive for a background conversation whose slot was never
    // created; the handler must be a no-op rather than a crash that kills the
    // whole event loop for the visible chat.
    expect(() => runHandler(null, { at: new Date().toISOString() })).not.toThrow();
    expect(() => runHandler({ lastCacheActivityAt: null }, undefined)).not.toThrow();
  });

  it('is wired into the same switch that handles the other context events', () => {
    // Guards against the case being moved into a dead or unrelated handler.
    const idx = SRC.indexOf("case 'cache_activity':");
    const manifestIdx = SRC.indexOf("case 'context_manifest':");
    const statusIdx = SRC.indexOf("case 'context_status':");
    expect(idx).toBeGreaterThan(statusIdx);
    expect(manifestIdx).toBeGreaterThan(idx);
  });
});
