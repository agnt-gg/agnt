import { createHash } from 'node:crypto';
import { serverMessagesToUi, applyStreamEvent } from './chatStreamReducer.mirror.js';

export const textDigest = text => createHash('sha256').update(text, 'utf8').digest('hex');

/** Only the exact named final provider row can authorize final-only projection.
 * Never copy the receipt ID onto an arbitrary payload to make validation pass.
 */
export function projectCompletedTranscript(messages, receipt) {
  const final = messages?.at(-1);
  if (!final || final.role !== 'assistant' || final.id !== receipt?.assistantMessageId
      || typeof final.content !== 'string' || textDigest(final.content) !== receipt.finalContentSha256
      || messages.filter(m => m?.id === final.id).length !== 1) return null;
  const projected = serverMessagesToUi(messages);
  let answer = projected.at(-1);
  // An empty final has no visible provider text, but remains an explicit final.
  if (!answer || answer.role !== 'assistant') {
    answer = { id: final.id, role: 'assistant', content: '', contentParts: [], toolCalls: [] };
    projected.push(answer);
  }
  answer.id = final.id;
  applyStreamEvent(answer, 'final_content', { content: final.content });
  return projected;
}

export function completionSeal(receipt, messages, revision) {
  const users = messages.filter(m => m?.role === 'user').map(m => ({ id: m.id || null, content: m.content }));
  return { version: 1, revision, requestId: receipt.requestId, executionId: receipt.executionId,
    assistantMessageId: receipt.assistantMessageId, finalContentSha256: receipt.finalContentSha256,
    userTurnsSha256: textDigest(JSON.stringify(users)), userTurnCount: users.length };
}
