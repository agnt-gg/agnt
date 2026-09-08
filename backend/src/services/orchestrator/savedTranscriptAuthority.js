import { textDigest } from './transcriptCompletion.js';

/** Only a server-owned DB revision can attest a saved-row completion. Client
 * JSON with an impressive-looking seal is insufficient. Appended drafts are
 * not completed even when they retain a prior turn's seal. */
export function savedTranscriptAuthority(row) {
  if (!row || !Number.isSafeInteger(row.server_revision) || row.server_revision < 1) return null;
  try {
    const payload = JSON.parse(row.content), seal = payload.serverCompletion;
    const final = payload.messages?.at(-1);
    if (seal?.revision !== row.server_revision || !seal.executionId
      || final?.role !== 'assistant' || final.id !== seal.assistantMessageId
      || typeof final.content !== 'string' || textDigest(final.content) !== seal.finalContentSha256) return null;
    return { conversationId: row.conversation_id, status: 'completed', executionId: seal.executionId,
      revision: row.server_revision, assistantMessageId: seal.assistantMessageId,
      messageFormat: 'ui', messages: payload.messages, savedRowPersisted: true };
  } catch { return null; }
}
