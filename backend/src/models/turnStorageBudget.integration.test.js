import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import db, { dbReady } from './database/index.js';
import ConversationLogModel from './ConversationLogModel.js';
import ContentOutputModel from './ContentOutputModel.js';
import { FTS_TABLES } from './database/fts.js';

/**
 * THE STORAGE BUDGET OF ONE CHAT TURN.
 *
 * Measured on a real install (2026-10-28): one 60 s turn on a 2 MB chat wrote
 * 164.6 MB, because the transcript was rewritten in full every 5 s while it
 * streamed and every rewrite re-indexed the whole body a second time. The
 * client no longer saves mid-stream (chat.streamPersistence.spec.js); this
 * pins the server side: what each remaining turn-end write may cost, measured
 * as the bytes SQLite actually appends to the write-ahead log (auto-checkpoint
 * off, so WAL growth is exactly what was written).
 *
 * Budgets are multiples of the transcript size with headroom; the negative
 * control proves they are tight enough to catch the regression that matters
 * (a saved chat's body being indexed again).
 */

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

const SPEC = FTS_TABLES.find((spec) => spec.name === 'content_outputs_fts');
const WORDS = 'database transcript index search history agent tool result message stream token model provider cache budget turn save'.split(' ');
let walPath;
let user;
let conversationId;
let outputId;
let history;
let messages;
const measured = {};

function prose(chars, seed) {
  let text = '';
  let i = seed;
  while (text.length < chars) {
    i = (i * 1103515245 + 12345) % 2147483648;
    text += `${WORDS[i % WORDS.length]}${i % 97} `;
  }
  return text.slice(0, chars);
}
const uiTranscript = () => JSON.stringify({ conversationId, title: 'Budget chat', messages });
const walBytes = () => (fs.existsSync(walPath) ? fs.statSync(walPath).size : 0);
async function bytesWrittenBy(work) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await all('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = walBytes();
    await work(i);
    samples.push(walBytes() - before);
  }
  return samples.sort((a, b) => a - b)[1]; // median: insulated from one-off background writes
}

beforeAll(async () => {
  await dbReady;
  walPath = `${(await all("SELECT file FROM pragma_database_list WHERE name = 'main'"))[0].file}-wal`;
  user = randomUUID();
  conversationId = randomUUID();
  outputId = randomUUID();
  await run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [user, `${user}@test.local`, 'fixture']);

  // ~2 MB of conversation, the size of a typical long chat on a real install.
  history = [];
  messages = [];
  for (let i = 0; i < 200; i++) {
    const text = prose(10_000, i + 1);
    history.push({ role: i % 2 ? 'assistant' : 'user', content: text });
    messages.push({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: text });
  }
  await ConversationLogModel.create({ conversationId, userId: user, initial_prompt: 'start', full_history: JSON.stringify(history), final_response: 'ok', tool_calls: '[]', errors: null });
  await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
  await run('PRAGMA wal_autocheckpoint = 0');
});

afterAll(async () => {
  await run('PRAGMA wal_autocheckpoint = 1000');
  await all('PRAGMA wal_checkpoint(TRUNCATE)');
});

// Each case writes a 2 MB transcript three times; generous timeout so a
// saturated disk during the full parallel suite cannot turn a pass into a timeout.
describe('storage budget of one chat turn', { timeout: 120_000 }, () => {
  it('the transcript under test is ~2 MB', () => {
    expect(uiTranscript().length).toBeGreaterThan(1_900_000);
    expect(JSON.stringify(history).length).toBeGreaterThan(1_900_000);
  });

  it('a saved-chat save costs about one copy of the transcript, never a second indexed copy', async () => {
    const size = uiTranscript().length;
    measured.savedChatSave = await bytesWrittenBy(async (i) => {
      messages.push({ id: `save-${i}`, role: 'assistant', content: prose(3000, 1000 + i) });
      await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
    });
    console.log(`[budget] saved-chat save: ${(measured.savedChatSave / 1e6).toFixed(2)} MB for a ${(size / 1e6).toFixed(2)} MB transcript`);
    expect(measured.savedChatSave).toBeLessThan(1.6 * size);
  });

  it('negative control: the old body-indexing triggers blow the same budget', async () => {
    const size = uiTranscript().length;
    const original = await all("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('content_outputs_ai', 'content_outputs_au')");
    const columns = ['doc_id', ...SPEC.unindexed, ...SPEC.indexed];
    const values = ['new.id', ...columns.slice(1).map((c) => `new.${c}`)].join(', ');
    await run('DROP TRIGGER content_outputs_au');
    await run(`CREATE TRIGGER content_outputs_au AFTER UPDATE OF ${['id', ...SPEC.unindexed, ...SPEC.indexed].join(', ')} ON content_outputs BEGIN
      DELETE FROM content_outputs_fts WHERE rowid IN (SELECT id FROM content_outputs_fts_content WHERE c0 = old.id);
      INSERT INTO content_outputs_fts(${columns.join(', ')}) VALUES (${values}); END`);
    try {
      const legacy = await bytesWrittenBy(async (i) => {
        messages.push({ id: `legacy-${i}`, role: 'assistant', content: prose(3000, 2000 + i) });
        await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
      });
      console.log(`[budget] same save with legacy body indexing: ${(legacy / 1e6).toFixed(2)} MB`);
      expect(legacy).toBeGreaterThan(1.6 * size);
    } finally {
      await run('DROP TRIGGER content_outputs_au');
      await run(original.find((t) => t.name === 'content_outputs_au').sql);
      // Re-save once so the row is title-only again for the tests after this.
      await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
    }
  });

  it('the turn-end history write stays within its budget (history stays fully searchable)', async () => {
    const size = JSON.stringify(history).length;
    measured.historyWrite = await bytesWrittenBy(async (i) => {
      history.push({ role: 'assistant', content: prose(3000, 3000 + i) });
      await ConversationLogModel.update({ conversationId, full_history: JSON.stringify(history), final_response: 'ok', tool_calls: '[]', errors: null });
    });
    console.log(`[budget] history write: ${(measured.historyWrite / 1e6).toFixed(2)} MB for a ${(size / 1e6).toFixed(2)} MB history`);
    expect(measured.historyWrite).toBeLessThan(4 * size);
    const hits = await all(`SELECT cl.conversation_id FROM conversation_logs_fts JOIN conversation_logs cl ON cl.id = conversation_logs_fts.rowid
      WHERE conversation_logs_fts MATCH ? AND cl.conversation_id = ?`, ['budget3', conversationId]);
    expect(hits).toHaveLength(1);
  });

  it('a whole server-side turn (history + saved row + client final save) stays under 6x the transcript', async () => {
    const size = uiTranscript().length;
    const turn = await bytesWrittenBy(async (i) => {
      const reply = prose(35_000, 4000 + i);
      history.push({ role: 'assistant', content: reply });
      messages.push({ id: `turn-${i}`, role: 'assistant', content: reply });
      await ConversationLogModel.update({ conversationId, full_history: JSON.stringify(history), final_response: reply.slice(0, 200), tool_calls: '[]', errors: null });
      await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
      await ContentOutputModel.createOrUpdate(outputId, user, null, null, uiTranscript(), false, 'conversation', conversationId, 'Budget chat');
    });
    console.log(`[budget] whole turn: ${(turn / 1e6).toFixed(2)} MB for a ${(size / 1e6).toFixed(2)} MB transcript`);
    expect(turn).toBeLessThan(6 * size);
  });
});
