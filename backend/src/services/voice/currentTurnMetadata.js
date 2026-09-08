import { normalizeVoiceMetadata } from './voiceMetadata.js';

/** Client-reported provenance, NOT an authentication or permission assertion.
 * The wire field is separate from history: never search backwards and accidentally
 * stamp a previous user turn when the current request ends in a tool/assistant.
 */
export function attachCurrentVoiceMetadata(messages, wireMetadata) {
  if (!Array.isArray(messages) || messages.at(-1)?.role !== 'user') return messages;
  if (typeof wireMetadata === 'string') {
    if (wireMetadata.length > 280000) return messages;
    try { wireMetadata = JSON.parse(wireMetadata); } catch { return messages; }
  }
  if (!Array.isArray(wireMetadata)) return messages;
  const voice = normalizeVoiceMetadata(wireMetadata.filter(m => m?.type === 'voice-input').slice(0, 8));
  if (!voice.length) return messages;
  const last = messages.at(-1);
  const other = Array.isArray(last.metadata) ? last.metadata.filter(m => m?.type !== 'voice-input') : [];
  return [...messages.slice(0, -1), { ...last, metadata: [...other, ...voice] }];
}

/** Clone the canonical ledger without dropping bounded voice provenance.
 * Provider adapters remain responsible for their provider-specific wire fields.
 */
/** Strip local ledger annotations without mutating history or protocol fields. */
export function withoutLedgerMetadata(messages) {
  return messages.map(({ metadata, id, ...message }) => message);
}

export function cloneLedgerMessage(msg) {
  return {
    role: msg.role,
    content: msg.content,
    name: msg.name,
    tool_calls: msg.tool_calls,
    tool_call_id: msg.tool_call_id,
    ...(Array.isArray(msg.metadata) ? { metadata: normalizeVoiceMetadata(msg.metadata) } : {}),
  };
}
