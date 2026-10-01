import { describe, it, expect } from 'vitest';
import { replaceLastReplyText, replaceFinalResponse, rowText } from './lastReplyEdit.js';

const openAiTranscript = () => [
  { role: 'user', content: 'Fix it.' },
  { role: 'assistant', content: 'Editing.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 't1', content: 'ok' },
  { role: 'assistant', content: 'Fixed: off-by-one.', reasoning_content: 'loop bound' },
];

const anthropicTranscript = () => [
  { role: 'user', content: [{ type: 'text', text: 'Fix it.' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Editing.' }, { type: 'tool_use', id: 't1', name: 'edit_file', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'loop bound', signature: 'sig' },
      { type: 'text', text: 'Fixed: ' },
      { type: 'text', text: 'off-by-one.' },
    ],
  },
];

describe('replaceLastReplyText', () => {
  it('rewrites the closing row of an OpenAI-shaped transcript and drops its reasoning', () => {
    const input = openAiTranscript();
    const result = replaceLastReplyText(input, { previousText: 'Fixed: off-by-one.', content: 'Fixed: bound.' });
    expect(result.ok).toBe(true);
    expect(result.messages[3]).toEqual({ role: 'assistant', content: 'Fixed: bound.' });
    expect(result.messages.slice(0, 3)).toEqual(input.slice(0, 3));
  });

  it('rewrites an Anthropic-shaped row: one text block, thinking removed, order kept', () => {
    const result = replaceLastReplyText(anthropicTranscript(), { previousText: 'Fixed: off-by-one.', content: 'Fixed: bound.' });
    expect(result.ok).toBe(true);
    expect(result.messages[3].content).toEqual([{ type: 'text', text: 'Fixed: bound.' }]);
  });

  it('never mutates its input', () => {
    const input = openAiTranscript();
    const snapshot = JSON.stringify(input);
    replaceLastReplyText(input, { previousText: 'Fixed: off-by-one.', content: 'x' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('matches through surrounding whitespace', () => {
    const result = replaceLastReplyText(openAiTranscript(), { previousText: '  Fixed: off-by-one.\n', content: 'x' });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['text-mismatch', openAiTranscript(), { previousText: 'something else', content: 'x' }],
    ['last-row-not-assistant', openAiTranscript().slice(0, 3), { previousText: 'ok', content: 'x' }],
    ['last-row-has-tool-calls', openAiTranscript().slice(0, 2), { previousText: 'Editing.', content: 'x' }],
    ['last-row-has-tool-calls', anthropicTranscript().slice(0, 2), { previousText: 'Editing.', content: 'x' }],
    ['empty-transcript', [], { previousText: 'a', content: 'x' }],
    ['invalid-edit', openAiTranscript(), { previousText: 'Fixed: off-by-one.', content: '   ' }],
    ['invalid-edit', openAiTranscript(), { content: 'x' }],
  ])('refuses: %s', (reason, messages, edit) => {
    expect(replaceLastReplyText(messages, edit)).toEqual({ ok: false, reason });
  });
});

describe('rowText', () => {
  it('joins text blocks and ignores everything else', () => {
    expect(rowText(anthropicTranscript()[3])).toBe('Fixed: off-by-one.');
    expect(rowText({ role: 'assistant', content: null })).toBe('');
  });
});

describe('replaceFinalResponse', () => {
  const edit = { previousText: 'Fixed: off-by-one.', content: 'Fixed: bound.' };
  it('replaces an exact match', () => expect(replaceFinalResponse('Fixed: off-by-one.', edit)).toBe('Fixed: bound.'));
  it('replaces the tail', () => expect(replaceFinalResponse('Editing.\nFixed: off-by-one.', edit)).toBe('Editing.\nFixed: bound.'));
  it('leaves unrelated text alone', () => expect(replaceFinalResponse('Something else', edit)).toBe('Something else'));
  it('passes empty values through', () => expect(replaceFinalResponse(null, edit)).toBeNull());
});
