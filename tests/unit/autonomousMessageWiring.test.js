/**
 * Wiring test for AutonomousMessageService.triggerToolCompletion().
 *
 * The pure inspector logic is covered by asyncResultInspector.test.js. This
 * file tests the assembly: that the inspector's verdict actually drives the
 * banner, headline, and instructions in the system message that gets pushed
 * into the conversation. Without this test, a future refactor that swapped
 * the inspector or rewrote the wrapper could quietly break the honest-banner
 * fix and unit tests would still pass.
 *
 * Strategy: monkey-patch triggerAutonomousMessage on the singleton so we
 * capture the system message instead of dispatching to the LLM. Restore in
 * test.after() so we don't leak state across files.
 *
 * Run: npm test  (vitest run)
 *   or: node --test tests/unit/autonomousMessageWiring.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import autonomousMessageService from '../../backend/src/services/AutonomousMessageService.js';

let originalDispatch;
let captured;

before(() => {
  originalDispatch = autonomousMessageService.triggerAutonomousMessage.bind(autonomousMessageService);
  autonomousMessageService.triggerAutonomousMessage = async (conversationId, systemMessage) => {
    captured = { conversationId, systemMessage };
  };
});

after(() => {
  autonomousMessageService.triggerAutonomousMessage = originalDispatch;
  // Importing AutonomousMessageService transitively boots the DB and the
  // EmailReceiver / LocalWebhookReceiver pollers, which keep the event loop
  // alive after the tests finish. Force an exit so `node --test` returns
  // promptly. Vitest already force-exits on its own, so this is only a
  // node:test concern. Tests have already run by the time this fires, so
  // exiting 0 is safe.
  setImmediate(() => process.exit(0));
});

function baseEventData(overrides = {}) {
  return {
    toolCallId: 'call_test_123',
    functionName: 'roll_dice',
    executionId: 'exec-uuid-abc',
    duration: 1300,
    result: null,
    ...overrides,
  };
}

describe('AutonomousMessageService.triggerToolCompletion (wiring)', () => {
  it('emits a success banner + completion directive for a successful one-shot result', async () => {
    captured = null;
    await autonomousMessageService.triggerToolCompletion('conv-1', baseEventData({
      result: { success: true, total: 17 },
    }));
    assert.ok(captured, 'system message should have been captured');
    const content = captured.systemMessage.content;
    assert.match(content, /✅ ASYNC TOOL COMPLETED/);
    assert.match(content, /\[System: Async tool completed\]/);
    assert.match(content, /completed successfully/);
    assert.match(content, /confirm the completion/);
    // The honesty directive must NOT leak into the success path.
    assert.doesNotMatch(content, /Do NOT claim success/);
    assert.doesNotMatch(content, /⚠️/);
  });

  it('emits a warning banner + honesty directive for a single-failure result (ENOENT shape)', async () => {
    captured = null;
    await autonomousMessageService.triggerToolCompletion('conv-2', baseEventData({
      functionName: 'file_operations',
      result: { success: false, error: 'ENOENT: no such file or directory, open ...' },
    }));
    assert.ok(captured, 'system message should have been captured');
    const content = captured.systemMessage.content;
    assert.match(content, /⚠️ ASYNC TOOL FINISHED WITH ERROR/);
    assert.match(content, /\[System: Async tool finished with errors\]/);
    assert.match(content, /Do NOT claim success/);
    assert.match(content, /ENOENT/);
    // The success-path checkmark must not appear.
    assert.doesNotMatch(content, /✅ ASYNC TOOL COMPLETED/);
  });

  it('emits a warning banner when ANY periodic iteration failed', async () => {
    captured = null;
    await autonomousMessageService.triggerToolCompletion('conv-3', baseEventData({
      duration: 6000,
      result: {
        periodicExecution: true,
        totalIterations: 3,
        results: [
          { iteration: 1, result: '{"success":true}' },
          { iteration: 2, result: '{"success":false,"error":"flaky api"}' },
          { iteration: 3, result: '{"success":true}' },
        ],
        totalDuration: 6000,
      },
    }));
    assert.ok(captured, 'system message should have been captured');
    const content = captured.systemMessage.content;
    assert.match(content, /⚠️ ASYNC TOOL FINISHED WITH ERROR/);
    assert.match(content, /1 of 3 iteration\(s\) failed/);
    assert.match(content, /Do NOT claim success/);
  });

  it('emits a success banner when every periodic iteration succeeded', async () => {
    captured = null;
    await autonomousMessageService.triggerToolCompletion('conv-4', baseEventData({
      duration: 3000,
      result: {
        periodicExecution: true,
        totalIterations: 3,
        results: [
          { iteration: 1, result: '{"success":true}' },
          { iteration: 2, result: '{"success":true}' },
          { iteration: 3, result: '{"success":true}' },
        ],
        totalDuration: 3000,
      },
    }));
    assert.ok(captured, 'system message should have been captured');
    const content = captured.systemMessage.content;
    assert.match(content, /✅ ASYNC TOOL COMPLETED/);
    assert.doesNotMatch(content, /⚠️/);
    assert.doesNotMatch(content, /Do NOT claim success/);
  });
});
