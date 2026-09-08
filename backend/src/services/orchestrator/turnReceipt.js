import { randomUUID, createHash } from 'node:crypto';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Server-owned receipt, not a provider-account attestation. No request body
 * identity or credentials enter this module. Acceptance remains historical;
 * completion requires a final and both authoritative persistence writes.
 */
export function createTurnReceipt({ userId, conversationId, requestId = randomUUID() }) {
  const identity = { requestId, conversationId, ...(id(userId) ? { userId } : {}) };
  let executionId = null, assistantMessageId = null, finalText = null, failed = false, sealed = null;
  const seenMessages = new Set();
  return {
    observe(name, data = {}) {
      if (sealed) return;
      if (!data || typeof data !== 'object' || Array.isArray(data)) { failed = true; return; }
      // Explicit lifecycle identity must agree with the authenticated origin.
      // conversation_started is stamped by the host (not accepted from a client).
      if (name !== 'conversation_started') {
        for (const key of ['userId', 'conversationId', 'requestId']) {
          if (Object.hasOwn(data, key) && data[key] !== identity[key]) failed = true;
        }
        if (Object.hasOwn(data, 'executionId') && name !== 'agent_execution_started'
            && (!id(data.executionId) || data.executionId !== executionId)) failed = true;
      }
      if (name === 'error' || name === 'run_ended') failed = true;
      if (name === 'agent_execution_completed' &&
          (!id(data.executionId) || data.executionId !== executionId ||
           data.error || data.success === false || data.completed === false ||
           !['completed', 'success', 'succeeded'].includes(data.status))) failed = true;
      if (name === 'agent_execution_started') {
        if (!id(data.executionId) || (executionId && executionId !== data.executionId)) failed = true;
        else executionId = data.executionId;
      }
      if (name === 'assistant_message') {
        if (!id(data.id)) failed = true;
        else if (assistantMessageId !== data.id) {
          if (finalText !== null || seenMessages.has(data.id)) failed = true;
          else { seenMessages.add(data.id); assistantMessageId = data.id; }
        }
      }
      if (name === 'final_content') {
        if (!id(assistantMessageId) || data.assistantMessageId !== assistantMessageId ||
            typeof data.content !== 'string' || data.content.length > 262144) failed = true;
        else if (finalText !== null && finalText !== data.content) failed = true;
        else finalText = data.content;
      }
    },
    stamp(data) { return { ...data, ...identity }; },
    finish({ aborted = false, error = false, executionPersisted = false, transcriptPersisted = false, provider, model } = {}) {
      if (sealed) return sealed;
      const accepted = Boolean(executionId && assistantMessageId && id(userId));
      const status = aborted ? 'cancelled' : error || failed ? 'failed'
        : accepted && finalText !== null && executionPersisted === true && transcriptPersisted === true ? 'completed' : 'unknown';
      sealed = Object.freeze({ ...identity, receiptVersion: 1, binding: 'authenticated-user-execution',
        accountBinding: 'unattested', ...(executionId ? { executionId } : {}),
        ...(assistantMessageId ? { assistantMessageId } : {}),
        ...(finalText !== null ? { finalContentSha256: createHash('sha256').update(finalText, 'utf8').digest('hex') } : {}),
        ...(id(provider) ? { provider } : {}), ...(id(model) ? { model } : {}),
        accepted, completed: status === 'completed', success: status === 'completed', status,
        executionPersisted: executionPersisted === true, transcriptPersisted: transcriptPersisted === true });
      return sealed;
    },
  };
}

/** Stamp lifecycle events at the shared production seam, before replay/mirror.
 * Provider/model are deliberately terminal-only: the normal text router may
 * have used a configured fallback; naming the requested tier as actual is false.
 */
export function wrapSendEventWithReceipt(receipt, sendEvent) {
  return (name, data) => {
    receipt.observe(name, data);
    const lifecycle = ['conversation_started', 'agent_execution_started', 'assistant_message', 'final_content', 'agent_execution_completed', 'done'];
    return sendEvent(name, lifecycle.includes(name) ? receipt.stamp(data) : data);
  };
}
