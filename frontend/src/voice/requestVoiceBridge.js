import { spokenRegister } from './voiceReplyPolicy.js';

/** One request's SSE receipt. Acceptance is historical, not completion.
 * Deliberate latency tradeoff: only the authoritative final is speakable, after
 * done AND stream settlement. Deltas are drafts; EOF alone authorizes nothing.
 */
export function createRequestVoiceBridge({ onAccepted = () => {}, onSpeech = () => {}, expected = {}, requireAuthenticatedReceipt = false } = {}) {
  let conversationId = null, messageId = null, executionId = null;
  let accepted = false, failure = null, done = false, finalText = null, settled = null;
  let acceptedKey = '';
  const seenMessages = new Set();
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const fail = reason => { failure ||= reason; };
  // The legacy route does not echo account/request IDs. Do not claim those
  // are server-attested: bind supplied fields and label legacy stream locality.
  const identities = {};
  const observedIdentity = {};
  for (const key of ['conversationId', 'executionId', 'requestId', 'accountId', 'userId', 'provider', 'model']) {
    if (expected[key] !== undefined) {
      if (!validId(expected[key])) fail('request_identity_invalid');
      else identities[key] = expected[key];
    }
  }
  function validateIdentity(name, data) {
    for (const key of ['conversationId', 'executionId', 'requestId', 'accountId', 'userId', 'provider', 'model']) {
      if (!Object.hasOwn(data, key)) continue;
      if (done && observedIdentity[key] !== data[key]) { fail('request_identity_conflict'); continue; }
      if (!validId(data[key]) || (identities[key] && identities[key] !== data[key])) fail('request_identity_conflict');
      else { identities[key] = data[key]; observedIdentity[key] = data[key]; }
    }
    if (name === 'done' || name === 'final_content') {
      for (const key of ['assistantMessageId', 'messageId']) {
        if (Object.hasOwn(data, key) && (!validId(data[key]) || data[key] !== messageId)) fail('request_identity_conflict');
      }
    }
  }
  function accept() {
    if (!conversationId || !messageId || !executionId || failure) return;
    accepted = true;
    const key = JSON.stringify([conversationId, messageId, executionId]);
    if (key === acceptedKey) return;
    acceptedKey = key;
    onAccepted({ accepted: true, completed: false, status: 'accepted', conversationId, assistantMessageId: messageId, executionId, identityKind: 'server-execution' });
  }
  return {
    event(name, data = {}) {
      if (settled) return;
      if (!data || typeof data !== 'object' || Array.isArray(data)) { fail('request_event_invalid'); return; }
      // Terminal seals identity establishment; errors may still invalidate it.
      if (done && ['conversation_started', 'agent_execution_started', 'assistant_message'].includes(name)) {
        fail('request_terminal_order'); return;
      }
      validateIdentity(name, data);
      if (name === 'error' || name === 'run_ended') { fail('request_failed'); return; }
      if (name === 'agent_execution_completed' &&
          (data.error || data.success === false || data.completed === false ||
           !['completed', 'success', 'succeeded'].includes(data.status))) fail('request_terminal_outcome');
      if (name === 'conversation_started') {
        if (!validId(data.conversationId) || (conversationId && conversationId !== data.conversationId)) fail('request_identity_conflict');
        else conversationId = data.conversationId;
      }
      if (name === 'agent_execution_started') {
        if (!validId(data.executionId) || (executionId && executionId !== data.executionId)) fail('request_identity_conflict');
        else executionId = data.executionId;
      }
      if (name === 'assistant_message') {
        const id = data.id || data.assistantMessageId;
        if (!validId(id)) fail('request_identity_missing');
        else if (id !== messageId) {
          if (done || seenMessages.has(id)) fail('request_identity_conflict');
          else { seenMessages.add(id); messageId = id; finalText = null; }
        }
      }
      if (name === 'final_content' && data.assistantMessageId === messageId) {
        if (typeof data.content !== 'string' || data.content.length > 262144) fail('request_final_invalid');
        else if (finalText !== null && finalText !== data.content) fail('request_final_conflict');
        else if (done && finalText === null) fail('request_terminal_order');
        else finalText = data.content;
      }
      if (name === 'done') {
        if (!accepted || finalText === null) fail('request_terminal_order');
        if (requireAuthenticatedReceipt || Object.hasOwn(data, 'receiptVersion')) {
          if (data.receiptVersion !== 1 || data.binding !== 'authenticated-user-execution' ||
              !['accepted', 'completed', 'success', 'executionPersisted', 'transcriptPersisted'].every(key => data[key] === true) ||
              data.status !== 'completed') fail('request_terminal_contract');
          if (!['requestId', 'userId', 'conversationId', 'executionId', 'assistantMessageId'].every(key => validId(data[key]))) fail('request_identity_unattested');
        }
        if (['accepted', 'executionPersisted', 'transcriptPersisted'].some(key => Object.hasOwn(data, key) && data[key] !== true)) fail('request_terminal_contract');
        for (const key of Object.keys(expected)) {
          if (Object.hasOwn(identities, key) && observedIdentity[key] !== expected[key]) fail('request_identity_unattested');
        }
        if (data.error || (Object.hasOwn(data, 'success') && data.success !== true) ||
            (Object.hasOwn(data, 'completed') && data.completed !== true)) fail('request_failed');
        if (Object.hasOwn(data, 'status') && !['completed', 'success', 'succeeded'].includes(data.status)) fail('request_terminal_outcome');
        done = true;
      }
      accept();
    },
    finish() {
      if (settled) return settled;
      const completed = accepted && !failure && done && finalText !== null;
      const reason = failure || (completed ? null : !executionId ? 'request_execution_missing' : !done ? 'request_terminal_missing' : finalText === null ? 'request_final_missing' : 'request_unconfirmed');
      settled = { submitted: true, accepted, completed, status: failure ? 'failed' : completed ? 'completed' : 'unknown', conversationId, assistantMessageId: messageId, executionId, identityKind: executionId ? 'server-execution' : 'unconfirmed', binding: 'stream-local', requestIdentity: { ...observedIdentity }, expectedIdentity: { ...expected }, reason };
      if (completed) {
        const text = spokenRegister(finalText);
        if (text.trim()) onSpeech(text, messageId);
      }
      return settled;
    },
  };
}
