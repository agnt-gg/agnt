const isLegacySteer = message => message?.role === 'user' && /^msg-steer-\d+$/.test(message.id || '');

/** Old reconnects appended all prior steers as a rapid, uninterrupted block.
 * Recover only that signature: at least two copies, same order, with each
 * original between assistant segments in the SAME human turn. Never globally
 * deduplicate text or erase an isolated repeated utterance.
 */
export function repairLegacySteerReplayBlocks(messages = []) {
  const repaired = [];
  for (let index = 0; index < messages.length;) {
    if (!isLegacySteer(messages[index])) { repaired.push(messages[index++]); continue; }
    const block = [];
    while (index < messages.length && isLegacySteer(messages[index])) {
      const previous = block.at(-1);
      if (previous && Number(messages[index].timestamp) - Number(previous.timestamp) > 5000) break;
      block.push(messages[index++]);
    }
    let turnStart = repaired.length - 1;
    while (turnStart >= 0 && (repaired[turnStart]?.role !== 'user' || isLegacySteer(repaired[turnStart]))) turnStart--;
    let previousMatch = turnStart;
    const originals = block.map(copy => {
      const match = repaired.findIndex((message, position) => position > previousMatch
        && isLegacySteer(message) && message.content === copy.content
        && repaired[position - 1]?.role === 'assistant' && repaired[position + 1]?.role === 'assistant');
      previousMatch = match >= 0 ? match : repaired.length;
      return match;
    });
    const times = block.map(message => Number(message.timestamp || message.id.slice('msg-steer-'.length)));
    const replayBurst = block.length >= 2 && times.every(Number.isFinite)
      && times.every((time, position) => position === 0 || time >= times[position - 1])
      && times.at(-1) - times[0] <= 5000;
    if (!(replayBurst && originals.every(position => position > turnStart))) repaired.push(...block);
  }
  return repaired;
}

/** Keep saved human interruptions when an older capped server replays only
 * assistant segments. Anchors come from the saved order, never a timestamp. */
export function captureReplaySteers(messages, firstIndex) {
  const steers = [];
  let anchorId = null;
  for (let index = firstIndex; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'assistant') anchorId = message.id;
    else if (message.role === 'user' && (message.steered || isLegacySteer(message)) && anchorId) {
      steers.push({ ...message, steered: true, steerAfterMessageId: message.steerAfterMessageId || anchorId });
    }
  }
  return steers;
}

export function restoreReplaySteers(messages, steers, assistantMessageId) {
  for (const message of steers || []) {
    if (message.steerAfterMessageId !== assistantMessageId) continue;
    applySteerToTranscript(messages, {
      content: message.content,
      assistantMessageId,
      round: message.steerRound,
      steerMessageId: message.id,
      timestamp: message.timestamp,
    });
  }
}

/** Reconcile a saved transcript with local replay without moving steers to
 * the tail. Ordinary unsaved messages keep the existing id-based policy. */
export function mergeSteeredTranscripts(stored, local) {
  const merged = repairLegacySteerReplayBlocks(stored).slice();
  const storedIds = new Set(merged.map(message => message.id).filter(Boolean));
  for (const message of local) {
    if (message.id && storedIds.has(message.id)) continue;
    if (message.steered && message.steerAfterMessageId) {
      applySteerToTranscript(merged, {
        content: message.content,
        assistantMessageId: message.steerAfterMessageId,
        round: message.steerRound,
        steerMessageId: message.id,
        timestamp: message.timestamp,
      });
    } else merged.push(message);
  }
  return repairLegacySteerReplayBlocks(merged);
}

/** A steer belongs to a server-named assistant seam, not to its delivery time.
 * Live SSE, socket mirrors and reconnect replay all apply the SAME event.
 * Content alone is never identity: saying "yes" at two seams is two messages.
 */
export function applySteerToTranscript(messages, event, { fallbackId, now = Date.now() } = {}) {
  if (!Array.isArray(messages) || typeof event?.content !== 'string' || !event.content) return;
  const anchorId = typeof event.assistantMessageId === 'string' ? event.assistantMessageId : null;
  const round = Number.isInteger(event.round) ? event.round : null;
  const stableId = event.steerMessageId || (anchorId ? `msg-steer-${anchorId}-${round ?? 'seam'}` : fallbackId);
  const anchorIndex = anchorId ? messages.findIndex(message => message.id === anchorId && message.role === 'assistant') : -1;
  const seamMessage = anchorIndex >= 0 ? messages[anchorIndex + 1] : null;
  // Before the identity fields existed, saves even dropped `steered`. Adopt
  // only the user bubble DIRECTLY at this exact seam, never an earlier turn.
  const legacySeam = seamMessage?.role === 'user' && seamMessage.content === event.content
    && (seamMessage.steered || /^msg-steer-\d+$/.test(seamMessage.id || ''));
  const existing = messages.find(message => message.role === 'user' && (
    (stableId && message.id === stableId)
    || (anchorId && message.steerAfterMessageId === anchorId && message.steerRound === round)
  )) || (legacySeam ? seamMessage : null);
  if (existing) {
    existing.steered = true;
    if (anchorId) existing.steerAfterMessageId = anchorId;
    if (round !== null) existing.steerRound = round;
    return existing;
  }
  const message = {
    id: stableId || `msg-steer-${now}`,
    role: 'user',
    content: event.content,
    timestamp: event.timestamp || now,
    steered: true,
  };
  if (anchorId) message.steerAfterMessageId = anchorId;
  if (round !== null) message.steerRound = round;
  messages.splice(anchorIndex >= 0 ? anchorIndex + 1 : messages.length, 0, message);
  return message;
}
