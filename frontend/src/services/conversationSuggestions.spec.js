/**
 * Suggestions belong to one conversation, at one point in it.
 *
 * The anchor is what makes that true once suggestions are stored: a set is
 * shown only while it still answers the conversation's latest user turn, so
 * every stale case resolves to "none" rather than to another turn's pills.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));

import {
  anchorSuggestions,
  isAnchoredTo,
  normalizeStoredSuggestions,
  suggestionAnchor,
  suggestionsFor,
} from './conversationSuggestions.js';
import { parseTranscript, serializeTranscript } from './conversationTranscript.js';

const u = (content, id = `u-${content}`) => ({ id, role: 'user', content, timestamp: 1 });
const a = (content, id = `a-${content}`) => ({ id, role: 'assistant', content, timestamp: 2 });
const ITEMS = [{ id: 1, text: 'Show the logs', prompt: 'Show me the logs' }];

describe('suggestionAnchor', () => {
  it('is null until the user has said something — a fresh chat shows starters', () => {
    expect(suggestionAnchor([])).toBeNull();
    expect(suggestionAnchor([a('Hi, I am Annie')])).toBeNull();
  });

  it('ignores message ids, which the server re-mints when it rewrites a transcript', () => {
    const client = [u('fix it', 'msg-client-1'), a('done', 'msg-client-2')];
    const server = [u('fix it', 'srv-0-99'), a('done', 'srv-1-99')];
    expect(suggestionAnchor(server)).toEqual(suggestionAnchor(client));
  });

  it('ignores leading/trailing whitespace on the user turn', () => {
    expect(suggestionAnchor([u('  fix it \n')])).toEqual(suggestionAnchor([u('fix it')]));
  });
});

describe('suggestionsFor — a stored set only shows at the turn it answers', () => {
  const conversation = [u('build the page'), a('built')];
  const stored = anchorSuggestions(ITEMS, conversation);

  it('shows the set for the conversation it was generated for', () => {
    expect(suggestionsFor(stored, conversation)).toEqual(ITEMS);
    expect(isAnchoredTo(stored, conversation)).toBe(true);
  });

  it('shows nothing once the user has taken another turn', () => {
    expect(suggestionsFor(stored, [...conversation, u('now deploy it')])).toEqual([]);
  });

  it('shows nothing after an edit-and-resend of the last turn (same count, new text)', () => {
    expect(suggestionsFor(stored, [u('build the other page'), a('built')])).toEqual([]);
  });

  it('NEGATIVE CONTROL: another conversation at a different point never matches', () => {
    expect(suggestionsFor(stored, [u('what is the weather'), a('sunny')])).toEqual([]);
  });

  it('survives a new assistant reply with no new user turn (a floor pass)', () => {
    expect(suggestionsFor(stored, [...conversation, a('and one more thing')])).toEqual(ITEMS);
  });
});

describe('normalizeStoredSuggestions', () => {
  it('rejects the old unanchored array shape — its conversation cannot be known', () => {
    expect(normalizeStoredSuggestions(ITEMS)).toBeNull();
  });

  it('rejects malformed values instead of trusting them', () => {
    expect(normalizeStoredSuggestions(null)).toBeNull();
    expect(normalizeStoredSuggestions({ items: ITEMS })).toBeNull();
    expect(normalizeStoredSuggestions({ items: [], anchor: { userTurns: 1, lastUserHash: 'x' } })).toBeNull();
    expect(normalizeStoredSuggestions({ items: ITEMS, anchor: { userTurns: '1', lastUserHash: 'x' } })).toBeNull();
  });

  it('drops individual items that are not renderable pills', () => {
    const out = normalizeStoredSuggestions({ items: [...ITEMS, { text: '' }, 'junk'], anchor: { userTurns: 1, lastUserHash: 'x' } });
    expect(out.items).toEqual(ITEMS);
  });
});

describe('saved with the transcript', () => {
  const messages = [u('build the page'), a('built')];

  it('round-trips through serializeTranscript → parseTranscript', () => {
    const suggestions = anchorSuggestions(ITEMS, messages);
    const parsed = parseTranscript(serializeTranscript({ conversationId: 'c1', title: 'T', messages, suggestions }));
    expect(parsed.suggestions).toEqual(suggestions);
    expect(suggestionsFor(parsed.suggestions, parsed.messages)).toEqual(ITEMS);
  });

  it('omits the field when there are none, so a plain transcript is unchanged', () => {
    expect(JSON.parse(serializeTranscript({ conversationId: 'c1', messages }))).not.toHaveProperty('suggestions');
  });

  it('reads a transcript saved before suggestions were stored as having none', () => {
    const legacy = JSON.stringify({ conversationId: 'c1', messages });
    expect(parseTranscript(legacy).suggestions).toBeNull();
  });
});
