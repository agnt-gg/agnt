/**
 * The turn-end transcript write must be WIRED, and wired harmlessly.
 *
 * persistTurnTranscript.test.js proves the write behaves. It cannot prove the
 * orchestrator calls it — and an unreferenced module is a fix that exists only
 * in the test suite. This is the same reason OrchestratorService.streamLifetime
 * asserts on source: the property is about the CALL SITE, and the call site
 * lives inside a 3,700-line handler that no unit test drives end to end.
 *
 * Three properties, each protecting a different failure:
 *   1. it is called at all;
 *   2. it is called with the SANITIZED provider history — the same array
 *      written to full_history, not the raw pre-sanitize one, or the stored
 *      transcript would contain orphaned tool calls the client's parser has to
 *      cope with;
 *   3. it is NOT awaited, so a slow or wedged write cannot delay the tail of a
 *      turn the user is waiting on. The conversation-log write immediately
 *      above it needed a 30s timeout race for exactly that reason; this one
 *      avoids the problem rather than mitigating it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CODE = fs.readFileSync(
  fileURLToPath(new URL('./OrchestratorService.js', import.meta.url)),
  'utf8',
);

describe('turn-end transcript persistence', () => {
  it('is imported and called exactly once', () => {
    expect(CODE).toMatch(/import \{ persistTurnTranscript \} from '\.\/orchestrator\/persistTurnTranscript\.js'/);
    expect(CODE.match(/persistTurnTranscript\(\{/g) || []).toHaveLength(1);
  });

  it('is handed the same history that goes into the conversation log', () => {
    const call = CODE.slice(CODE.indexOf('persistTurnTranscript({'));
    expect(call.slice(0, 200)).toMatch(/providerMessages:\s*messages/);

    // `messages` is reassigned by the sanitizers; the call has to come after
    // them or it stores a transcript the log itself would not accept.
    expect(CODE.indexOf('sanitizeEmptyAssistantMessages(messages)'))
      .toBeLessThan(CODE.indexOf('persistTurnTranscript({'));
  });

  it('is fire-and-forget, never awaited', () => {
    const idx = CODE.indexOf('persistTurnTranscript({');
    expect(CODE.slice(idx - 20, idx)).not.toMatch(/await\s*$/);
    // A floating promise with no rejection handler surfaces as an
    // unhandledRejection and can take the process down.
    expect(CODE.slice(idx, idx + 700)).toMatch(/\.catch\(/);
  });

  it('runs after the conversation log, which owns the authoritative copy', () => {
    // If this ever ran first, a crash between the two would leave the sidebar
    // showing an answer the system has no record of.
    expect(CODE.indexOf('const logRaceResult')).toBeLessThan(CODE.indexOf('persistTurnTranscript({'));
  });
});
