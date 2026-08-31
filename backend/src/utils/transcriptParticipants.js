/**
 * WHO SPOKE IN THIS CONVERSATION — derived from the transcript, server-side.
 *
 * The sidebar wants to show tiny avatars of everyone in a chat, but a sidebar
 * row deliberately has no transcript: LIST_COLUMNS excludes `content` because
 * rows average ~0.5MB and top out near 28MB. So the roster is derived ONCE,
 * here, at save time, and stored in a small `participants` column that the
 * list query can afford to read.
 *
 * WHY THE SERVER AND NOT THE CLIENT: the save handler already JSON.parses
 * this exact string for the truncation guard (countTranscriptMessages), so
 * deriving the roster costs one extra pass over an array we have in hand. A
 * client-sent roster would be a second source of truth for the same fact, and
 * the two would eventually disagree — this way the roster cannot drift from
 * the transcript it describes, because it IS the transcript.
 *
 * ANNIE IS DELIBERATELY NOT STORED. She is the orchestrator: present in every
 * conversation by definition, so recording her would be one wasted row-entry
 * per conversation for a fact that is already known. The UI paints her first
 * and always. An assistant message with no agent attribution IS Annie —
 * that is exactly how speakerOfMessage() classifies it on the client.
 *
 * ICONS ARE DELIBERATELY NOT STORED. Agent icons are inline data-URLs up to
 * ~233KB. Storing them per conversation would put megabytes of duplicated
 * base64 into a table whose whole point is to stay small, and would freeze a
 * stale copy of an avatar the user can change at any time. We store the id
 * (to resolve the live icon) and the name (the durable fallback for a deleted
 * agent, and the tooltip text).
 */

// Bound the column. Nothing renders more than a handful of avatars — past
// three the UI collapses to "+N" — but the COUNT must stay truthful, so the
// cap is generous enough that hitting it is a pathological conversation
// rather than a normal group chat.
const MAX_PARTICIPANTS = 12;

/**
 * Distinct agents that have spoken, in order of first appearance (join order).
 *
 * @param {unknown} messages an array of transcript messages
 * @returns {Array<{id: string|null, name: string}>}
 */
export function participantsOfMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const byKey = new Map();
  for (const message of messages) {
    if (!message || message.role !== 'assistant') continue;

    const id = typeof message.agentId === 'string' && message.agentId ? message.agentId : null;
    const name = typeof message.agentName === 'string' && message.agentName ? message.agentName : null;

    // No attribution = the orchestrator = Annie. Implicit, never stored.
    if (!id && !name) continue;

    // Key on the id when there is one so a renamed agent stays one
    // participant; fall back to the name for older messages that carry a
    // name only. Two DIFFERENT agents sharing a display name (this install
    // has three "Social Media Manager"s) stay distinct whenever ids exist.
    const key = id || `name:${name}`;
    if (byKey.has(key)) continue;

    byKey.set(key, { id, name: name || 'Agent' });
    if (byKey.size >= MAX_PARTICIPANTS) break;
  }

  return [...byKey.values()];
}

/**
 * Same, from the serialized transcript string a save carries.
 *
 * Returns null for "I cannot tell" rather than [] — the two mean different
 * things at the storage layer. [] is a real answer (a solo Annie chat, and
 * the overwhelmingly common case); null means unparseable, and the caller
 * must leave whatever is already stored alone rather than erasing a good
 * roster because one save happened to carry an HTML artifact or a legacy
 * payload shape. Same contract, and the same reasoning, as
 * countTranscriptMessages().
 *
 * @param {unknown} content
 * @returns {Array<{id: string|null, name: string}>|null}
 */
export function participantsOfTranscript(content) {
  if (typeof content !== 'string' || content.length === 0) return null;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return participantsOfMessages(parsed);
    if (parsed && Array.isArray(parsed.messages)) return participantsOfMessages(parsed.messages);
    return null;
  } catch {
    return null;
  }
}

/**
 * The value the `participants` column should hold: compact JSON, or null when
 * the transcript could not be read. Never stores "[]" — an empty roster is
 * the default meaning of NULL, and writing the two-byte string instead would
 * make every solo conversation carry a value that says nothing.
 *
 * @param {unknown} content
 * @returns {string|null}
 */
export function serializeParticipants(content) {
  const participants = participantsOfTranscript(content);
  if (participants === null) return null;
  if (participants.length === 0) return null;
  return JSON.stringify(participants);
}

export { MAX_PARTICIPANTS };
