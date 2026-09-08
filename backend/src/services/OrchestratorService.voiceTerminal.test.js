import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('./OrchestratorService.js', import.meta.url), 'utf8');
describe('production terminal wiring (not evidence of live provider completion)', () => {
  it('does not equate socket EOF with successful execution', () => {
    expect(code).not.toContain("sendEvent('done', { message: 'Stream ended' })");
    expect(code).toContain("sendEvent('done', terminalReceipt)");
    expect(code).toContain('endRun(conversationId, terminalReceipt.status)');
  });
  it('settles asynchronous acceptance on early errors before finalizing execution', () => {
    const cleanup = code.slice(code.indexOf('  } finally {', code.indexOf('const tokenAccumulator')));
    expect(cleanup.indexOf('await agentExecutionPromise')).toBeGreaterThan(-1);
    expect(cleanup.indexOf('await agentExecutionPromise')).toBeLessThan(cleanup.indexOf('if (agentExecutionId)'));
  });
  it('passes the finalized server receipt to the saved-row mirror', () => {
    expect(code).toContain('providerMessages: messages, completionReceipt: terminalReceipt');
    expect(code.indexOf('let terminalReceipt = turnReceipt.finish')).toBeLessThan(code.indexOf('completionReceipt: terminalReceipt'));
  });
  it('only attests durable writes after their promises complete', () => {
    expect(code).toContain('executionPersisted = true');
    expect(code).toContain('transcriptPersisted: Boolean(logRaceResult?.conversationId === conversationId)');
    expect(code).toContain('wrapSendEventWithReceipt');
  });
});
