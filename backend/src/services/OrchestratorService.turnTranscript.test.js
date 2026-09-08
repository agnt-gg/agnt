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
 *   3. settlement is bounded, so a wedged write cannot indefinitely delay
 *      the terminal receipt. Saved-row success must not be announced before
 *      settlement; timeout is unknown, not a failed/cancelled database write.
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

  it('bounds mirror settlement and only reports its actual result before done', () => {
    const idx = CODE.indexOf('persistTurnTranscript({');
    expect(CODE.slice(idx - 80, idx)).toContain('await settleTranscriptMirror(');
    expect(CODE.slice(idx, idx + 900)).toContain('savedRowPersisted: savedMirror.written === true');
    expect(CODE.indexOf('savedRowPersisted: savedMirror.written === true')).toBeLessThan(CODE.indexOf("sendEvent('done', terminalReceipt)"));
    expect(CODE).toContain('terminalReceipt = { ...terminalReceipt,');
  });

  it('runs after the conversation log, which owns the authoritative copy', () => {
    // If this ever ran first, a crash between the two would leave the sidebar
    // showing an answer the system has no record of.
    expect(CODE.indexOf('const logRaceResult')).toBeLessThan(CODE.indexOf('persistTurnTranscript({'));
  });
});
