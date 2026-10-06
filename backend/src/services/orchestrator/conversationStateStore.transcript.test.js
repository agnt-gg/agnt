// loadStoredTranscript: the restart fallback for history rehydration.
// Real in-memory SQLite, like conversationStateStore.test.js: the guarantee
// under test is a WHERE clause, and a mocked driver would accept any SQL.
import { describe, it, expect, vi } from 'vitest';
import sqlite3 from 'sqlite3';

const memDb = new sqlite3.Database(':memory:');
vi.mock('../../models/database/index.js', () => ({ default: memDb }));
const run = (sql, params = []) => new Promise((res, rej) => memDb.run(sql, params, (e) => (e ? rej(e) : res())));

await run(`CREATE TABLE conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT UNIQUE NOT NULL, user_id TEXT,
  initial_prompt TEXT, full_history TEXT, final_response TEXT, tool_calls TEXT, errors TEXT)`);
const transcript = [{ role: 'user', content: 'mine' }, { role: 'assistant', content: 'ok' }];
await run('INSERT INTO conversation_logs (conversation_id, user_id, full_history) VALUES (?, ?, ?)', ['conv-a', 'alice', JSON.stringify(transcript)]);
await run('INSERT INTO conversation_logs (conversation_id, user_id, full_history) VALUES (?, ?, ?)', ['conv-bad', 'alice', '{not json']);

const { loadStoredTranscript, PERSISTED_STATE_KEYS } = await import('./conversationStateStore.js');

describe('loadStoredTranscript', () => {
  it("returns the owner's transcript", async () => {
    expect(await loadStoredTranscript('conv-a', 'alice')).toEqual(transcript);
  });

  it("never returns another user's transcript for a known conversation id", async () => {
    expect(await loadStoredTranscript('conv-a', 'mallory')).toBeNull();
  });

  it('is null, not a throw, for a missing row, a missing user or unreadable JSON', async () => {
    expect(await loadStoredTranscript('conv-missing', 'alice')).toBeNull();
    expect(await loadStoredTranscript('conv-a', null)).toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadStoredTranscript('conv-bad', 'alice')).toBeNull();
  });
});

describe('the new cache-critical state survives a restart', () => {
  it('persists the resident profile and the tool-result aging watermark', () => {
    const keys = PERSISTED_STATE_KEYS.map((k) => k.key);
    expect(keys).toContain('_residentProfile');
    expect(keys).toContain('_agedToolCallIds');
  });
});
