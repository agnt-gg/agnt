/** Correlate native turns without treating partial observations as instructions.
 * Delegation can precede native final (the provider waits for the client reply).
 * Commit its complete interpretation with explicit provenance, once per turn.
 * A later conflicting final cannot undo accepted work: surface uncertainty and
 * suppress narration, never replay it as a second request.
 */
export function createCodexFinalTurnBridge({ submitTurn, emit, onState = () => {}, onTranscript = () => {}, onError = () => {}, setPlaybackAllowed = () => {}, maxTurns = 1024, nativePlayback = true }) {
  // Generative native output has no exact response/generation binding to the
  // accepted text. Keep that mode muted even after emitting a reply; only the
  // explicitly selected separate exact-final TTS graph may receive permission.
  let closed = false, epoch = 0, pending = false, currentId = null;
  let hasIssuedSpeech = false, queuedSpeech = [], unidentifiedAssistant = false;
  let requireFreshStart = false;
  function invalidateInput() {
    requireFreshStart = true;
    // Do not advance the task/playback epoch: submitted work may finish while
    // listening is paused. Only uncommitted provider input is invalidated.
    for (const turn of turns.values()) if (!turn.committed) { turn.invalid = true; turn.partial = ''; }
  }
  function discardInput(event) {
    const id = event.turnId || event.id;
    if (!id) return;
    if (!turns.has(id)) {
      if (turns.size >= maxTurns) throw new Error('voice_session_limit');
      turns.set(id, { invalid: true, committed: false, partial: '' });
    } else if (!turns.get(id).committed) turns.get(id).invalid = true;
  }
  const turns = new Map(), activeAssistants = new Set(), endedAssistants = new Set();
  const assistantActive = () => unidentifiedAssistant || activeAssistants.size > 0;
  function begin(id) {
    if (turns.has(id)) return turns.get(id);
    if (turns.size >= maxTurns) throw new Error('voice_session_limit');
    const turn = { partial: '', committed: false, text: null, kind: null, conflict: false };
    turns.set(id, turn); currentId = id; epoch++;
    queuedSpeech = []; hasIssuedSpeech = false; setPlaybackAllowed(false); onState('listening');
    return turn;
  }
  function assistant(event) {
    // Exact-final TTS owns its own playback; native response lifecycle must
    // neither release nor interrupt that separate audio graph.
    if (!nativePlayback) return;
    const id = event.id;
    if (event.type === 'assistant-turn-start' || !event.final) {
      if (id && endedAssistants.has(id)) return;
      if (id) activeAssistants.add(id); else unidentifiedAssistant = true;
      // Creation is significant even when no transcript has arrived yet.
      // Unsolicited creation never inherits permission from earlier speech.
      setPlaybackAllowed(false);
      return;
    }
    if (id && endedAssistants.has(id)) return;
    if (id) {
      if (endedAssistants.size >= maxTurns) throw new Error('voice_session_limit');
      endedAssistants.add(id);
      const known = activeAssistants.delete(id);
      // An unrelated/stale done cannot release a known active response.
      if (!known && activeAssistants.size) return;
    } else if (activeAssistants.size) return;
    unidentifiedAssistant = false;
    if (assistantActive()) return;
    setPlaybackAllowed(false);
    if (queuedSpeech.length) {
      const text = queuedSpeech.join(' '); queuedSpeech = [];
      hasIssuedSpeech = true; emit(text, null); setPlaybackAllowed(!nativePlayback); onState('speaking');
    } else { hasIssuedSpeech = false; onState(pending ? 'working' : 'listening'); }
  }
  async function handle(event) {
    if (closed) return;
    if (event.type === 'user-turn-start') { begin(event.id); return; }
    if (event.type === 'assistant-turn-start') { assistant(event); return; }
    const delegated = event.type === 'delegation';
    if (!delegated && event.type !== 'transcript') return;
    if (!delegated) {
      onTranscript(event);
      if (event.role === 'assistant') { assistant(event); return; }
      if (!event.final) {
        const turn = turns.get(event.id || currentId);
        if (turn && !turn.invalid && !turn.committed && (!event.id || event.id === currentId)) turn.partial = (turn.partial + event.text).slice(-16384);
        return;
      }
    }
    const id = delegated ? event.turnId : event.id;
    if (delegated && (!id || !turns.has(id))) { onError('voice_uncorrelated_delegation'); return; }
    if (!id) throw new Error('voice_final_missing_id');
    if (requireFreshStart && !turns.has(id)) { onError('voice_fresh_turn_required'); return; }
    const turn = begin(id);
    if (turn.invalid) return;
    const text = event.text.trim();
    if (turn.committed) {
      if (!delegated && turn.kind === 'correlated-delegation' && turn.text !== text && !turn.conflict) {
        turn.conflict = true;
        if (id === currentId) { queuedSpeech = []; hasIssuedSpeech = false; setPlaybackAllowed(false); }
        onError('voice_final_conflict');
      }
      return;
    }
    turn.committed = true;
    const observedTranscript = turn.partial.trim() || null;
    turn.partial = '';
    if (currentId !== id) { onError('voice_stale_final'); return; }
    if (!text) return;
    if (pending) { onError('voice_turn_busy'); return; }
    turn.text = text; turn.kind = delegated ? 'correlated-delegation' : 'native-final';
    pending = true;
    const ownEpoch = epoch, delegationId = delegated ? event.id : null;
    let accepted = false, messageId = null;
    const live = () => !closed && ownEpoch === epoch && !turn.conflict;
    onState('working');
    try {
      const result = await submitTurn({ text, transcript: delegated ? observedTranscript : text, commitKind: turn.kind, utteranceId: id, delegationId, delegatedInterpretation: delegated ? text : null,
        onAccepted: receipt => {
          if (!live()) return;
          if (receipt?.accepted && typeof receipt.conversationId === 'string' && receipt.conversationId && typeof receipt.assistantMessageId === 'string' && receipt.assistantMessageId) {
            accepted = true; messageId = receipt.assistantMessageId;
          }
        },
        onSpeech: (speech, speechMessageId) => {
          if (!live() || !accepted || speechMessageId !== messageId || !speech?.trim()) return;
          if (assistantActive() && !hasIssuedSpeech) {
            queuedSpeech.push(speech);
            if (queuedSpeech.join(' ').length > 16384) throw new Error('voice_narration_limit');
            return;
          }
          hasIssuedSpeech = true; emit(speech, delegationId); setPlaybackAllowed(!nativePlayback); onState('speaking');
        },
      });
      if (live() && (!accepted || !result?.accepted || result.completed === false)) onError(result?.reason || 'voice_turn_unconfirmed');
    } catch {
      if (live()) { queuedSpeech = []; hasIssuedSpeech = false; setPlaybackAllowed(false); onError('voice_turn_failed'); }
    } finally {
      pending = false;
      if (!closed && ownEpoch === epoch && !hasIssuedSpeech) onState(queuedSpeech.length ? 'working' : 'listening');
    }
  }
  return { handle, invalidateInput, discardInput, close() { closed = true; epoch++; queuedSpeech = []; setPlaybackAllowed(false); } };
}
