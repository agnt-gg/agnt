import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import db, { dbReady } from '../models/database/index.js';
import MemorySearchService from './MemorySearchService.js';

/**
 * RECALL STILL FINDS EVERY SAVED CHAT BY ITS TEXT.
 *
 * content_outputs_fts no longer stores a second copy of a saved chat's body
 * when the conversation's full history is indexed (fts.js). This pins, through
 * the real search entry point the `recall` tool and /api/memory/search use,
 * on a booted (isolated) database, that nothing a user could find before is
 * lost:
 *   - an all-source search still returns the chat as BOTH a conversation and
 *     an output, exactly as before;
 *   - an outputs-only search still finds a saved chat by its transcript;
 *   - chats without history and every other output are found by their body;
 *   - one result per output, user isolation, and date filters still hold.
 */

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

let user;
let otherUser;
const ids = {};

async function addUser() {
  const id = randomUUID();
  await run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [id, `${id}@test.local`, 'fixture']);
  return id;
}
const history = (text) => JSON.stringify([{ role: 'user', content: text }, { role: 'assistant', content: `Here is the plan for ${text}.` }]);
const transcript = (text) => JSON.stringify({ messages: [{ role: 'user', content: text }, { role: 'assistant', content: `Here is the plan for ${text}.` }] });

async function savedChat(userId, { title, text, withHistory }) {
  const conversationId = randomUUID();
  const outputId = randomUUID();
  if (withHistory) {
    await run(`INSERT INTO conversation_logs (conversation_id, user_id, initial_prompt, full_history, final_response) VALUES (?, ?, ?, ?, ?)`,
      [conversationId, userId, text, history(text), 'done']);
  }
  await run(`INSERT INTO content_outputs (id, user_id, content, content_type, conversation_id, title) VALUES (?, ?, ?, 'conversation', ?, ?)`,
    [outputId, userId, transcript(text), conversationId, title]);
  return { conversationId, outputId };
}

beforeAll(async () => {
  await dbReady;
  user = await addUser();
  otherUser = await addUser();
  ids.withHistory = await savedChat(user, { title: 'Trip planning', text: 'zebracorn itinerary for the coast', withHistory: true });
  ids.titleAlsoInHistory = await savedChat(user, { title: 'Pelican report', text: 'pelican migration counts', withHistory: true });
  ids.orphan = await savedChat(user, { title: 'Orphan chat', text: 'quokkafy the ingest pipeline', withHistory: false });
  ids.othersChat = await savedChat(otherUser, { title: 'Someone else', text: 'zebracorn secrets', withHistory: true });
  ids.artifact = randomUUID();
  await run(`INSERT INTO content_outputs (id, user_id, content, content_type, title) VALUES (?, ?, ?, 'html', ?)`,
    [ids.artifact, user, '<h1>narwhal hero section</h1>', 'Landing page']);
});

const find = (results, kind, id) => results.filter((r) => r.kind === kind && r.id === id);

describe('recall over saved chats', () => {
  it('does not store a second copy of a chat body that the history index already holds', async () => {
    const copy = await all('SELECT doc_id FROM content_outputs_fts WHERE content_outputs_fts MATCH ?', ['zebracorn']);
    expect(copy.map((r) => r.doc_id)).not.toContain(ids.withHistory.outputId);
  });

  it('an all-source search returns the chat as both a conversation and an output, as before', async () => {
    const results = await MemorySearchService.search({ userId: user, q: 'zebracorn' });
    expect(find(results, 'conversation', ids.withHistory.conversationId)).toHaveLength(1);
    const output = find(results, 'output', ids.withHistory.outputId);
    expect(output).toHaveLength(1);
    expect(output[0].title).toBe('Trip planning');
    expect(output[0].meta).toMatchObject({ output_id: ids.withHistory.outputId, content_type: 'conversation', conversation_id: ids.withHistory.conversationId });
    expect(output[0].snippet).toContain('«zebracorn»');
  });

  it('an outputs-only search still finds a saved chat by its transcript', async () => {
    const results = await MemorySearchService.search({ userId: user, q: 'itinerary coast', sources: ['outputs'] });
    expect(results.map((r) => r.id)).toEqual([ids.withHistory.outputId]);
  });

  it('finds chats without history, and other outputs, by their body', async () => {
    expect(find(await MemorySearchService.search({ userId: user, q: 'quokkafy', sources: ['outputs'] }), 'output', ids.orphan.outputId)).toHaveLength(1);
    expect(find(await MemorySearchService.search({ userId: user, q: 'narwhal', sources: ['outputs'] }), 'output', ids.artifact)).toHaveLength(1);
  });

  it('returns one result per output when its title and its transcript both match', async () => {
    const results = await MemorySearchService.search({ userId: user, q: 'pelican', sources: ['outputs'] });
    expect(results.map((r) => r.id)).toEqual([ids.titleAlsoInHistory.outputId]);
  });

  it('never returns another user\'s chat', async () => {
    const results = await MemorySearchService.search({ userId: user, q: 'secrets' });
    expect(results).toEqual([]);
    const theirs = await MemorySearchService.search({ userId: otherUser, q: 'zebracorn', sources: ['outputs'] });
    expect(theirs.map((r) => r.id)).toEqual([ids.othersChat.outputId]);
  });

  it('applies date filters to chats found through their history', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await MemorySearchService.search({ userId: user, q: 'zebracorn', sources: ['outputs'], since: future })).toEqual([]);
    expect(find(await MemorySearchService.search({ userId: user, q: 'zebracorn', sources: ['outputs'], until: future }), 'output', ids.withHistory.outputId)).toHaveLength(1);
  });
});
