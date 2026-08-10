// SERVER-SAVED == CLIENT-RECONCILED. The second half of the transcript contract.
//
// WHY THIS FILE EXISTS
// --------------------
// chatTranscriptParity.spec.js pins LIVE == RELOADED: a turn watched as it
// streams renders the same as the same turn read back from storage. This file
// pins the axis that opened up when the server started writing that storage
// itself.
//
// At turn end the backend now projects the provider transcript into the saved
// row, so a conversation whose client walked away still finishes on screen
// (backend/src/services/orchestrator/persistTurnTranscript.js). The client does
// the same projection when it reconciles a dead stream — chat.js →
// recoverInterruptedStream → serverMessagesToUi. Same input, two runtimes.
//
// They cannot share a module: neither tree is shipped to the other (Docker
// copies backend/ + frontend/dist; the frontend build stage sees only
// frontend/). So the backend holds a byte-identical mirror, and byte-identity
// is enforced by chatStreamReducer.mirror.test.js.
//
// That test proves the two COPIES agree. This one proves the two PIPELINES
// agree — mirror, plus serialization, plus the client's own parser reading it
// back — which is the thing the user actually experiences. A mirror can be
// perfect while the serializer around it drops contentParts, and the symptom
// would be tool cards silently reordered after the prose.
//
// The assertion is deliberately end-to-end and in the user's terms:
//
//   parseTranscript(what the SERVER stored)  ===  what the CLIENT would render
//
import { describe, it, expect } from 'vitest';
import { serverMessagesToUi } from './chatStreamReducer.js';
import { parseTranscript } from './conversationTranscript.js';
import { projectTranscript } from '../../../backend/src/services/orchestrator/transcriptProjection.js';

/** What a surface actually shows. Ids and timestamps are storage detail. */
const renderSignature = (message) => ({
  role: message.role,
  text: (message.content || '').replace(/\s+/g, ''),
  parts: (message.contentParts || []).map((p) =>
    (p.type === 'text' ? `text:${(p.text || '').trim()}` : `tool:${p.toolCallId}`)),
  tools: (message.toolCalls || []).map((tc) => ({
    name: tc.name, status: tc.status, result: tc.result, error: tc.error,
  })),
});

const render = (messages) => messages.map(renderSignature);

/**
 * The transcripts below are provider-shaped — the exact contents of
 * conversation_logs.full_history, which is what both sides consume.
 */
const CORPUS = {
  'a plain exchange': [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'Hi there.' },
  ],

  'anthropic block form with a tool round-trip': [
    { role: 'user', content: 'check the disk' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'call_a', name: 'shell', input: { cmd: 'df -h' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_a', content: '80% used' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'The disk is 80% full.' }] },
  ],

  'openai form with tool_calls beside the content': [
    { role: 'user', content: 'weather?' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_b', type: 'function', function: { name: 'getWeather', arguments: '{"city":"Oslo"}' } }],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_b', content: 'sunny' }] },
    { role: 'assistant', content: 'It is sunny in Oslo.' },
  ],

  'several tools interleaved with prose': [
    { role: 'user', content: 'do three things' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'First.' },
        { type: 'tool_use', id: 'c1', name: 'one', input: {} },
        { type: 'text', text: 'Second.' },
        { type: 'tool_use', id: 'c2', name: 'two', input: {} },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'ok1' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'ok2' },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'Both done.' }] },
  ],

  'a failed tool': [
    { role: 'user', content: 'break it' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c_err', name: 'boom', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c_err', content: 'nope', is_error: true }] },
    { role: 'assistant', content: [{ type: 'text', text: 'That tool failed.' }] },
  ],

  'reasoning blocks the user never sees as prose': [
    { role: 'user', content: 'think' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal deliberation' },
        { type: 'text', text: 'Here is my answer.' },
      ],
    },
  ],

  'several turns, so merging cannot run away': [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c3', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c3', content: 'r' }] },
    { role: 'assistant', content: 'second answer' },
  ],
};

describe('what the server saves is what the client would have rendered', () => {
  for (const [name, providerMessages] of Object.entries(CORPUS)) {
    it(name, () => {
      // The server's pipeline: project, serialize, store.
      const stored = projectTranscript({ conversationId: 'c1', providerMessages });
      // The client's pipeline: read that row back with its own parser.
      const readBack = parseTranscript(stored.content).messages;
      // What the client would have produced on its own from the same log.
      const clientSide = serverMessagesToUi(providerMessages);

      expect(render(readBack)).toEqual(render(clientSide));
    });
  }
});

describe('the properties a transcript is allowed to rely on', () => {
  const providerMessages = CORPUS['anthropic block form with a tool round-trip'];

  it('keeps text/tool ORDER, not just contents', () => {
    const readBack = parseTranscript(projectTranscript({ conversationId: 'c1', providerMessages }).content).messages;
    const assistant = readBack.find((m) => m.role === 'assistant');
    // contentParts is what makes a multi-tool answer readable; losing the
    // order re-renders every tool card after all the prose.
    expect(assistant.contentParts.map((p) => p.type)).toEqual(['text', 'tool_call', 'text']);
  });

  it('never stores the coercion artefact that shipped twice before', () => {
    for (const messages of Object.values(CORPUS)) {
      const { content } = projectTranscript({ conversationId: 'c1', providerMessages: messages });
      expect(content).not.toMatch(/\[object \w+\]/);
    }
  });

  it('drops the synthetic tool-result turn instead of rendering an empty bubble', () => {
    const readBack = parseTranscript(projectTranscript({ conversationId: 'c1', providerMessages }).content).messages;
    expect(readBack.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('derives the same title the client would', () => {
    const { title } = projectTranscript({ conversationId: 'c1', providerMessages });
    expect(title).toBe('check the disk');
  });

  it('prefers an existing title over deriving one', () => {
    const { title } = projectTranscript({ conversationId: 'c1', providerMessages, title: 'User chose this' });
    expect(title).toBe('User chose this');
  });

  it('returns null for a transcript with nothing to show', () => {
    expect(projectTranscript({ conversationId: 'c1', providerMessages: [] })).toBeNull();
    expect(projectTranscript({ conversationId: 'c1', providerMessages: [{ role: 'system', content: 'x' }] })).toBeNull();
  });
});
