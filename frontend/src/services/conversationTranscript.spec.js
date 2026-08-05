// The transcript is an artifact: what we save is what we render.
//
// This is the module that makes a conversation durable. It exists because
// "saved" used to mean two different things — the main chat wrote its rendered
// transcript to content_outputs, while every unified chat wrote to localStorage
// and rebuilt itself from the provider wire log. A conversation you can lose by
// clearing site data was never saved, and a conversation rebuilt from a wire
// format is a re-enactment, not a recording.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  serializeTranscript,
  parseTranscript,
  toStoredMessage,
  deriveTitle,
  saveTranscript,
  loadTranscriptByConversationId,
  scopeTranscriptToChannel,
} from './conversationTranscript.js';

/** The canvas turn, as it lives in memory after streaming. */
const LIVE_TURN = [
  { id: 'u1', role: 'user', content: 'make the sim bigger', timestamp: 1 },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Let me look.\n\nDone — 9×8. 🛫',
    timestamp: 2,
    reasoning: 'read the layout first',
    contentParts: [
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_call', toolCallId: 't1' },
      { type: 'tool_call', toolCallId: 't2' },
      { type: 'text', text: 'Done — 9×8. 🛫' },
    ],
    toolCalls: [
      { id: 't1', name: 'get_canvas_state', status: 'completed', result: '{"widgets":2}' },
      { id: 't2', name: 'move_canvas_widget', status: 'completed', result: 'ok' },
    ],
  },
];

describe('a saved transcript round-trips exactly', () => {
  it('reads back the messages it was given', () => {
    const parsed = parseTranscript(serializeTranscript({ conversationId: 'c1', title: 'T', messages: LIVE_TURN }));

    expect(parsed.conversationId).toBe('c1');
    expect(parsed.title).toBe('T');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].content).toBe('Let me look.\n\nDone — 9×8. 🛫');
    expect(parsed.messages[1].reasoning).toBe('read the layout first');
  });

  it('preserves the text/tool ORDER, which is what makes an answer readable', () => {
    const parsed = parseTranscript(serializeTranscript({ conversationId: 'c1', messages: LIVE_TURN }));
    expect(parsed.messages[1].contentParts.map((p) => p.type)).toEqual([
      'text', 'tool_call', 'tool_call', 'text',
    ]);
  });

  it('preserves each tool call with its result and status', () => {
    const parsed = parseTranscript(serializeTranscript({ conversationId: 'c1', messages: LIVE_TURN }));
    expect(parsed.messages[1].toolCalls).toEqual(LIVE_TURN[1].toolCalls);
  });

  it('is not vacuous: dropping contentParts changes what comes back', () => {
    const stripped = LIVE_TURN.map((m) => ({ ...m, contentParts: [] }));
    const parsed = parseTranscript(serializeTranscript({ conversationId: 'c1', messages: stripped }));
    // hydrateMessage rebuilds a *plausible* order — text first, then every
    // tool card — which is exactly the wrong order the old save produced.
    expect(parsed.messages[1].contentParts.map((p) => p.type)).toEqual([
      'text', 'tool_call', 'tool_call',
    ]);
  });

  it('rebuilds contentParts for transcripts saved before they existed', () => {
    const legacy = JSON.stringify({
      conversationId: 'c1',
      messages: [{ id: 'a', role: 'assistant', content: 'hi', toolCalls: [{ id: 't1', name: 'x' }] }],
    });
    expect(parseTranscript(legacy).messages[0].contentParts.map((p) => p.type)).toEqual(['text', 'tool_call']);
  });

  it('survives an unparseable or empty payload instead of throwing', () => {
    for (const bad of ['not json', '', null, undefined]) {
      expect(parseTranscript(bad).messages).toEqual([]);
    }
  });

  it('keeps image refs as tokens rather than inlining base64', () => {
    const withImage = [{ id: 'a', role: 'assistant', content: 'see {{IMAGE_REF:img-1}}', timestamp: 1 }];
    expect(serializeTranscript({ conversationId: 'c1', messages: withImage })).toContain('{{IMAGE_REF:img-1}}');
  });

  it('omits optional fields entirely when absent, so a plain chat stays small', () => {
    const stored = toStoredMessage({ id: 'u', role: 'user', content: 'hi', timestamp: 1 });
    expect(Object.keys(stored).sort()).toEqual(
      ['contentParts', 'content', 'id', 'metadata', 'role', 'timestamp', 'toolCalls'].sort(),
    );
  });
});

describe('deriveTitle', () => {
  it('names a conversation after the first thing the user said', () => {
    expect(deriveTitle(LIVE_TURN)).toBe('make the sim bigger');
  });

  it('ignores assistant messages, including a welcome message', () => {
    expect(deriveTitle([
      { role: 'assistant', content: 'Your workspace. Ask for anything.' },
      { role: 'user', content: 'add the flight sim' },
    ])).toBe('add the flight sim');
  });

  it('truncates at a word boundary rather than mid-word', () => {
    const title = deriveTitle([{ role: 'user', content: `${'alpha '.repeat(40)}omega` }]);
    expect(title.length).toBeLessThanOrEqual(101);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/alph…$/);
  });

  it('falls back when the user has not spoken yet', () => {
    expect(deriveTitle([{ role: 'assistant', content: 'hi' }])).toBe('Untitled Conversation');
  });
});

describe('saveTranscript', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'tok');
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'out-9' }) }));
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('POSTs the transcript and returns the row id to update next time', async () => {
    const res = await saveTranscript({ conversationId: 'c1', title: 'T', messages: LIVE_TURN });

    expect(res).toEqual({ ok: true, outputId: 'out-9' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/content-outputs\/save$/);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ contentType: 'conversation', conversationId: 'c1', title: 'T', isShareable: false });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('updates the SAME row when given an output id', async () => {
    await saveTranscript({ outputId: 'out-9', conversationId: 'c1', messages: LIVE_TURN });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).id).toBe('out-9');
  });

  it('tells the server which channel owns the transcript', async () => {
    // Absent this, the row is indistinguishable from a main-chat conversation
    // and the sidebar lists every workspace and widget chat.
    await saveTranscript({ conversationId: 'c1', messages: LIVE_TURN, channelKey: 'workspace:ws-1' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).channelKey).toBe('workspace:ws-1');
  });

  it('sends no channel for a main-chat save', async () => {
    await saveTranscript({ conversationId: 'c1', messages: LIVE_TURN });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).channelKey).toBeNull();
  });

  it('refuses to save without a conversation id, rather than orphaning a row', async () => {
    expect(await saveTranscript({ messages: LIVE_TURN })).toEqual({ ok: false, error: 'no_conversation_id' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not create a row for an empty conversation', async () => {
    expect(await saveTranscript({ conversationId: 'c1', messages: [] })).toEqual({ ok: false, error: 'empty' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports a network failure instead of throwing into the caller', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await saveTranscript({ conversationId: 'c1', messages: LIVE_TURN })).toMatchObject({ ok: false });
    expect(warn).toHaveBeenCalled();
  });
});

describe('scopeTranscriptToChannel', () => {
  beforeEach(() => localStorage.setItem('token', 'tok'));
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('PATCHes the row with its owning channel', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    expect(await scopeTranscriptToChannel('out-9', 'workspace:ws-1')).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/content-outputs\/out-9\/channel$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ channelKey: 'workspace:ws-1' });
  });

  it('treats a missing row as repaired, so the sweep never retries it forever', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await scopeTranscriptToChannel('gone', 'workspace:ws-1')).toBe(true);
  });

  it('reports failure when the server errors, so the sweep retries next launch', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(await scopeTranscriptToChannel('out-9', 'workspace:ws-1')).toBe(false);
  });

  it('reports failure when offline rather than throwing', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await scopeTranscriptToChannel('out-9', 'workspace:ws-1')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('does nothing without both an id and a channel', async () => {
    global.fetch = vi.fn();
    expect(await scopeTranscriptToChannel(null, 'workspace:ws-1')).toBe(false);
    expect(await scopeTranscriptToChannel('out-9', null)).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('loadTranscriptByConversationId', () => {
  beforeEach(() => localStorage.setItem('token', 'tok'));
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('returns the saved transcript, hydrated', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'out-9',
        content: serializeTranscript({ conversationId: 'c1', title: 'T', messages: LIVE_TURN }),
        updated_at: '2026-08-04T14:16:58Z',
      }),
    }));

    const got = await loadTranscriptByConversationId('c1');
    expect(got.outputId).toBe('out-9');
    expect(got.title).toBe('T');
    expect(got.messages).toHaveLength(2);
    expect(got.messages[1].contentParts.map((p) => p.type)).toEqual(['text', 'tool_call', 'tool_call', 'text']);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/content-outputs\/by-conversation\/c1$/);
  });

  it('returns null for a conversation that was never saved', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await loadTranscriptByConversationId('c1')).toBeNull();
  });

  it('returns null rather than an empty shell when the row holds no messages', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'o', content: '{}' }) }));
    expect(await loadTranscriptByConversationId('c1')).toBeNull();
  });

  it('never asks for a transcript without an id', async () => {
    global.fetch = vi.fn();
    expect(await loadTranscriptByConversationId(null)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
