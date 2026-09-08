import { describe, it, expect, vi } from 'vitest';
import { createCodexFinalTurnBridge } from './codexFinalTurnBridge.js';
import { createRequestVoiceBridge } from './requestVoiceBridge.js';
import { parseCodexEvent } from './codexVoiceProtocol.js';
const accepted = { accepted: true, completed: true, conversationId: 'c', assistantMessageId: 'm', executionId: 'e' };
const start = id => ({ type: 'user-turn-start', id });
const final = (id, text) => ({ type: 'transcript', role: 'user', final: true, id, text });
const partial = text => ({ type: 'transcript', role: 'user', final: false, text });
const delegation = (turnId, text) => ({ type: 'delegation', id: `d-${turnId}`, turnId, text });
function pendingTurn() {
  let args, release;
  const emit = vi.fn(), onError = vi.fn(), allow = vi.fn();
  const submitTurn = vi.fn(a => { args = a; return new Promise(r => { release = r; }); });
  const bridge = createCodexFinalTurnBridge({ submitTurn, emit, onError, setPlaybackAllowed: allow });
  return { bridge, submitTurn, emit, onError, allow, get args() { return args; }, release: () => release(accepted) };
}
function request() {
  const onSpeech = vi.fn(), onAccepted = vi.fn();
  const bridge = createRequestVoiceBridge({ onSpeech, onAccepted });
  bridge.event('conversation_started', { conversationId: 'c' });
  bridge.event('agent_execution_started', { executionId: 'e' });
  bridge.event('assistant_message', { id: 'm' });
  return { bridge, onSpeech, onAccepted };
}
describe('audit: turn causality and isolation', () => {
  it('submits full correlated delegation, never promotes a partial to verbatim final', async () => {
    const f = pendingTurn(); await f.bridge.handle(start('u')); await f.bridge.handle(partial('Move the file'));
    const p = f.bridge.handle(delegation('u', 'Move the file only after making a backup.'));
    expect(f.args).toMatchObject({ text: 'Move the file only after making a backup.', transcript: 'Move the file', commitKind: 'correlated-delegation' });
    f.release(); await p;
  });
  it('differing later native final reports conflict and blocks speech without replaying side effects', async () => {
    const f = pendingTurn(); await f.bridge.handle(start('u'));
    const p = f.bridge.handle(delegation('u', 'Move the file.'));
    await f.bridge.handle(final('u', 'No, do not move the file.'));
    f.args.onAccepted(accepted); f.args.onSpeech('Moved.', 'm');
    expect(f.onError).toHaveBeenCalledWith('voice_final_conflict'); expect(f.emit).not.toHaveBeenCalled();
    expect(f.submitTurn).toHaveBeenCalledTimes(1); f.release(); await p;
  });
  it('final-first retains qualifier and suppresses later delegation', async () => {
    const f = pendingTurn(); const p = f.bridge.handle(final('u', 'Move only after backup.'));
    await f.bridge.handle(delegation('u', 'Move.'));
    expect(f.args.text).toBe('Move only after backup.'); expect(f.submitTurn).toHaveBeenCalledTimes(1); f.release(); await p;
  });
  it('busy rejected partial cannot contaminate the next utterance', async () => {
    const f = pendingTurn(); const p = f.bridge.handle(final('a', 'First'));
    await f.bridge.handle(start('b')); await f.bridge.handle(partial('Rejected words. ')); await f.bridge.handle(final('b', 'Rejected words.'));
    f.release(); await p; await f.bridge.handle(start('c')); await f.bridge.handle(partial('New'));
    const q = f.bridge.handle(delegation('c', 'New instruction.'));
    expect(f.args.text).toBe('New instruction.'); expect(f.args.transcript).toBe('New'); f.release(); await q;
  });
});
describe('audit: truthful terminal receipts and authoritative speech', () => {
  it('never speaks drafts at EOF, but retains accepted execution facts', () => {
    const f = request(); f.bridge.event('content_delta', { assistantMessageId: 'm', delta: 'Yes, do it.' });
    expect(f.onSpeech).not.toHaveBeenCalled();
    expect(f.bridge.finish()).toMatchObject({ accepted: true, completed: false, status: 'unknown', executionId: 'e' });
    expect(f.onSpeech).not.toHaveBeenCalled();
  });
  it('replaces non-prefix draft with authoritative final only after done and EOF', () => {
    const f = request(); f.bridge.event('content_delta', { assistantMessageId: 'm', delta: 'Yes, do it.' });
    f.bridge.event('final_content', { assistantMessageId: 'm', content: 'No, do not do it.' });
    expect(f.onSpeech).not.toHaveBeenCalled(); f.bridge.event('done', {});
    expect(f.bridge.finish()).toMatchObject({ accepted: true, completed: true, status: 'completed' });
    expect(f.onSpeech).toHaveBeenCalledTimes(1); expect(f.onSpeech).toHaveBeenCalledWith('No, do not do it.', 'm'); f.bridge.finish(); expect(f.onSpeech).toHaveBeenCalledTimes(1);
  });
  it.each(['execution', 'final', 'done'])('missing %s cannot complete', missing => {
    const onSpeech = vi.fn(), b = createRequestVoiceBridge({ onSpeech });
    b.event('conversation_started', { conversationId: 'c' }); b.event('assistant_message', { id: 'm' });
    if (missing !== 'execution') b.event('agent_execution_started', { executionId: 'e' });
    if (missing !== 'final') b.event('final_content', { assistantMessageId: 'm', content: 'Result.' });
    if (missing !== 'done') b.event('done', {});
    expect(b.finish().completed).toBe(false); expect(onSpeech).not.toHaveBeenCalled();
  });
  it('accepted execution remains accepted after explicit error', () => {
    const f = request(); f.bridge.event('error', {});
    expect(f.bridge.finish()).toMatchObject({ accepted: true, completed: false, status: 'failed', reason: 'request_failed' }); expect(f.onSpeech).not.toHaveBeenCalled();
  });
  it('conflicting duplicate finals fail closed, identical duplicates are harmless', () => {
    for (const conflict of [true, false]) {
      const f = request(); f.bridge.event('final_content', { assistantMessageId: 'm', content: 'No.' });
      f.bridge.event('final_content', { assistantMessageId: 'm', content: conflict ? 'Yes.' : 'No.' }); f.bridge.event('done', {});
      expect(f.bridge.finish().completed).toBe(!conflict); expect(f.onSpeech).toHaveBeenCalledTimes(conflict ? 0 : 1);
    }
  });
  it('stale message finals do not authorize a continuation draft', () => {
    const f = request(); f.bridge.event('assistant_message', { id: 'm2' }); f.bridge.event('final_content', { assistantMessageId: 'm', content: 'Old.' }); f.bridge.event('done', {});
    expect(f.bridge.finish().completed).toBe(false); expect(f.onSpeech).not.toHaveBeenCalled();
  });
  it('contradictory execution identities fail closed', () => {
    const f = request(); f.bridge.event('agent_execution_started', { executionId: 'other' }); f.bridge.event('final_content', { assistantMessageId: 'm', content: 'Result.' }); f.bridge.event('done', {});
    expect(f.bridge.finish().completed).toBe(false); expect(f.onSpeech).not.toHaveBeenCalled();
  });
  it('error following done cannot leak speech', () => {
    const f = request(); f.bridge.event('final_content', { assistantMessageId: 'm', content: 'Result.' }); f.bridge.event('done', {}); f.bridge.event('error', {});
    expect(f.bridge.finish().completed).toBe(false); expect(f.onSpeech).not.toHaveBeenCalled();
  });
});
describe('audit: request-to-native production bridge integration', () => {
  it.each([false, true])('only terminal request speech reaches native output (interrupted=%s)', async interrupted => {
    const emit = vi.fn(), onError = vi.fn();
    let result;
    const b = createCodexFinalTurnBridge({ emit, onError, submitTurn: async callbacks => {
      const request = createRequestVoiceBridge(callbacks);
      request.event('conversation_started', { conversationId: 'c' });
      request.event('agent_execution_started', { executionId: 'e' });
      request.event('assistant_message', { id: 'm' });
      request.event('content_delta', { assistantMessageId: 'm', delta: 'Yes, do it.' });
      expect(emit).not.toHaveBeenCalled();
      if (!interrupted) {
        request.event('final_content', { assistantMessageId: 'm', content: 'No, do not do it.' });
        request.event('done', {});
      }
      result = request.finish();
      return result;
    } });
    await b.handle(final('u', 'May I do it?'));
    expect(result).toMatchObject({ accepted: true, completed: !interrupted, executionId: 'e' });
    if (interrupted) {
      expect(emit).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith('request_terminal_missing');
    } else {
      expect(emit).toHaveBeenCalledTimes(1); expect(emit).toHaveBeenCalledWith('No, do not do it.', null);
    }
    b.close();
  });
});
describe('audit: native assistant identities', () => {
  it('parses assistant created before transcript', () => {
    expect(parseCodexEvent(JSON.stringify({ type: 'turn.created', turn: { role: 'assistant', id: 'a' } }))).toEqual({ type: 'assistant-turn-start', id: 'a' });
  });
  it('unknown or stale done cannot release a known active assistant response', async () => {
    const f = pendingTurn(); const p = f.bridge.handle(final('u', 'Question'));
    await f.bridge.handle({ type: 'assistant-turn-start', id: 'active' });
    f.args.onAccepted(accepted); f.args.onSpeech('Answer.', 'm');
    await f.bridge.handle({ type: 'transcript', role: 'assistant', id: 'stale', final: true, text: 'Old' });
    expect(f.emit).not.toHaveBeenCalled(); expect(f.allow).not.toHaveBeenCalledWith(true);
    await f.bridge.handle({ type: 'transcript', role: 'assistant', id: 'active', final: true, text: 'Unsolicited' });
    expect(f.emit).toHaveBeenCalledTimes(1); f.release(); await p;
  });
  it('assistant done before created cannot resurrect an old response', async () => {
    const f = pendingTurn(); const p = f.bridge.handle(final('u', 'Question'));
    await f.bridge.handle({ type: 'transcript', role: 'assistant', id: 'old', final: true, text: 'Old' });
    await f.bridge.handle({ type: 'assistant-turn-start', id: 'old' });
    f.args.onAccepted(accepted); f.args.onSpeech('Answer.', 'm'); expect(f.emit).toHaveBeenCalledTimes(1); f.release(); await p;
  });
});
