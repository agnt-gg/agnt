import { it, expect, vi, afterEach } from 'vitest';
import { saveTranscript, loadTranscriptByConversationId, serializeTranscript, parseTranscript } from './conversationTranscript.js';
const metadata = [{ type: 'voice-input', kind: 'correlated-delegation', utteranceId: 'u', observedTranscript: 'Move the file', delegatedInterpretation: 'Move the file only after backup.' }];
afterEach(() => vi.unstubAllGlobals());
it('preserves voice provenance through real serializer, HTTP payload and production hydrator', async () => {
  let row;
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (options.method === 'POST') { row = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'fixture-output' }) }; }
    return { ok: true, json: async () => ({ id: 'fixture-output', content: row.content }) };
  }));
  const saved = await saveTranscript({ conversationId: 'fixture-private', messages: [{ id: 'u', role: 'user', content: 'Move the file only after backup.', metadata }] });
  expect(saved.ok).toBe(true); expect(row.isShareable).toBe(false);
  const loaded = await loadTranscriptByConversationId('fixture-private');
  expect(loaded.messages[0].metadata).toEqual(metadata);
  expect(loaded.messages[0].content).toBe('Move the file only after backup.');
  expect(loaded.messages[0].metadata[0].kind).not.toBe('native-final');
});
it('bounds voice fields without promoting unknown kinds to native-final', () => {
  const dirty = [{ type: 'voice-input', kind: 'untrusted', utteranceId: 'x'.repeat(500), observedTranscript: 'x'.repeat(20000), delegatedInterpretation: 'y'.repeat(20000), extra: 'do not carry' }];
  const value = parseTranscript(serializeTranscript({ messages: [{ role: 'user', metadata: dirty }] })).messages[0].metadata[0];
  expect(value.kind).toBe('unknown'); expect(value.utteranceId).toHaveLength(256);
  expect(value.observedTranscript).toHaveLength(16384); expect(value.delegatedInterpretation).toHaveLength(16384); expect(value.extra).toBeUndefined();
});
it('malformed metadata is safe and nonvoice metadata survives unchanged', () => {
  expect(parseTranscript({ messages: [{ metadata: 'bad' }] }).messages[0].metadata).toEqual([]);
  const ordinary = [{ type: 'existing-feature', value: 1 }];
  expect(parseTranscript({ messages: [{ metadata: ordinary }] }).messages[0].metadata).toEqual(ordinary);
});
