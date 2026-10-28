import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupFullTextSearch, syncSearchTriggers, FTS_TABLES } from './fts.js';
import { compactSavedChatSearchIndex, readMaintenanceState } from '../../services/storage/savedChatSearchCompaction.js';

/**
 * A SAVED CHAT'S TRANSCRIPT IS INDEXED ONCE.
 *
 * content_outputs_fts used to index every saved chat's body, which is the UI
 * copy of conversation_logs.full_history — already indexed by
 * conversation_logs_fts. So every transcript was stored and tokenized twice.
 * The rule now: a saved chat's body is indexed only when no history row exists
 * for its conversation; titles and every non-chat output are indexed exactly
 * as before. These tests pin that rule on a new install, on the upgrade of an
 * existing one (legacy triggers + the one-time compaction), across older and
 * newer builds taking turns on one database, and that no source row is ever
 * modified.
 *
 * Private in-memory database with the real column layout of the two tables
 * involved, so the real trigger SQL runs without the app's import-time boot.
 */

const SPEC = FTS_TABLES.find((spec) => spec.name === 'content_outputs_fts');
const MIRRORED = ['doc_id', ...SPEC.unindexed, ...SPEC.indexed];
const BODY_COLUMN = `c${MIRRORED.indexOf('content')}`;

let db;
let dir;
let statePath;
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const get = async (sql, params = []) => (await all(sql, params))[0];

async function createSchema() {
  for (const spec of FTS_TABLES) {
    if (spec.source === 'conversation_logs' || spec.source === 'content_outputs') continue;
    const key = spec.pkType === 'integer' ? `${spec.pkCol} INTEGER PRIMARY KEY` : `${spec.pkCol} TEXT PRIMARY KEY`;
    const columns = [...spec.unindexed, ...spec.indexed].map((c) => `${c} TEXT`);
    await run(`CREATE TABLE ${spec.source} (${[key, ...columns].join(', ')})`);
  }
  // The real layouts (backend/src/models/database/index.js), plus scope_id as
  // the ownership migration adds it.
  await run(`CREATE TABLE conversation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT UNIQUE NOT NULL, user_id TEXT,
    initial_prompt TEXT, full_history TEXT, final_response TEXT, tool_calls TEXT, errors TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE content_outputs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workflow_id TEXT, tool_id TEXT, content TEXT NOT NULL,
    content_type TEXT DEFAULT 'html', conversation_id TEXT, title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, scope_id TEXT)`);
}

const transcript = (text) => JSON.stringify({ messages: [{ role: 'user', content: text }, { role: 'assistant', content: `about ${text}` }] });
const addHistory = (conversationId, text) => run(
  `INSERT INTO conversation_logs (conversation_id, user_id, initial_prompt, full_history, final_response) VALUES (?, 'u1', 'start', ?, 'done')`,
  [conversationId, JSON.stringify([{ role: 'user', content: text }, { role: 'assistant', content: `about ${text}` }])],
);
const addSavedChat = (id, conversationId, title, text) => run(
  `INSERT INTO content_outputs (id, user_id, content, content_type, conversation_id, title) VALUES (?, 'u1', ?, 'conversation', ?, ?)`,
  [id, transcript(text), conversationId, title],
);
const addArtifact = (id, title, text) => run(
  `INSERT INTO content_outputs (id, user_id, content, content_type, title) VALUES (?, 'u1', ?, 'html', ?)`, [id, text, title],
);
const saveChat = (id, text) => run(`UPDATE content_outputs SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [transcript(text), id]);

const outputHits = async (term) =>
  (await all(`SELECT doc_id FROM content_outputs_fts WHERE content_outputs_fts MATCH ?`, [term])).map((r) => r.doc_id).sort();
const historyHits = async (term) =>
  (await all(`SELECT cl.conversation_id FROM conversation_logs_fts JOIN conversation_logs cl ON cl.id = conversation_logs_fts.rowid
              WHERE conversation_logs_fts MATCH ?`, [term])).map((r) => r.conversation_id).sort();
const storedBody = async (docId) => (await get(`SELECT ${BODY_COLUMN} AS body FROM content_outputs_fts_content WHERE c0 = ?`, [docId]))?.body;
const sourceSnapshot = () => all('SELECT rowid, * FROM content_outputs ORDER BY rowid');

async function expectOutputsOneToOne() {
  const counts = await get(`SELECT (SELECT count(*) FROM content_outputs) AS source, (SELECT count(*) FROM content_outputs_fts) AS search,
    (SELECT count(DISTINCT doc_id) FROM content_outputs_fts) AS ids`);
  expect(counts.search).toBe(counts.source);
  expect(counts.ids).toBe(counts.source);
}

// The triggers every install created before this change has: the body is
// mirrored verbatim. Built by hand so the test does not depend on the builders
// it is checking.
async function installLegacyContentOutputTriggers() {
  const columns = MIRRORED.join(', ');
  const values = ['new.id', ...MIRRORED.slice(1).map((c) => `new.${c}`)].join(', ');
  const mirroredSource = ['id', ...SPEC.unindexed, ...SPEC.indexed].join(', ');
  await run('DROP TRIGGER IF EXISTS content_outputs_ai');
  await run('DROP TRIGGER IF EXISTS content_outputs_au');
  await run(`CREATE TRIGGER content_outputs_ai AFTER INSERT ON content_outputs BEGIN
    INSERT INTO content_outputs_fts(${columns}) VALUES (${values}); END`);
  await run(`CREATE TRIGGER content_outputs_au AFTER UPDATE OF ${mirroredSource} ON content_outputs BEGIN
    DELETE FROM content_outputs_fts WHERE rowid IN (SELECT id FROM content_outputs_fts_content WHERE c0 = old.id);
    INSERT INTO content_outputs_fts(${columns}) VALUES (${values}); END`);
}

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-chat-fts-'));
  statePath = path.join(dir, 'storage-maintenance.json');
  await createSchema();
});

afterEach(async () => {
  await new Promise((resolve) => db.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a saved chat is indexed once, on a new install', () => {
  it('a chat with history is found by its title in outputs and by its text in history, with no body copy stored', async () => {
    await setupFullTextSearch(db);
    await addHistory('conv-a', 'zebracorn migration plan');
    await addSavedChat('out-a', 'conv-a', 'Trip planning', 'zebracorn migration plan');

    expect(await storedBody('out-a')).toBe('');
    expect(await outputHits('zebracorn')).toEqual([]);
    expect(await outputHits('trip')).toEqual(['out-a']);
    expect(await historyHits('zebracorn')).toEqual(['conv-a']);
    await expectOutputsOneToOne();
  });

  it('a chat without history, and every other output, keep their body indexed exactly as before', async () => {
    await setupFullTextSearch(db);
    await addSavedChat('out-b', 'conv-b', 'Orphan chat', 'quokkafy the pipeline');
    await addSavedChat('out-null', null, 'No conversation id', 'axolotl notes');
    await addArtifact('out-c', 'Landing page', 'narwhal hero section');

    expect(await outputHits('quokkafy')).toEqual(['out-b']);
    expect(await outputHits('axolotl')).toEqual(['out-null']);
    expect(await outputHits('narwhal')).toEqual(['out-c']);
    expect(await storedBody('out-c')).toBe('narwhal hero section');
    await expectOutputsOneToOne();
  });

  it('a chat saved before its history exists is indexed until its next save, then the copy is dropped', async () => {
    await setupFullTextSearch(db);
    await addSavedChat('out-d', 'conv-d', 'Early save', 'first words');
    expect(await outputHits('first')).toEqual(['out-d']);

    await addHistory('conv-d', 'first words then more');
    await saveChat('out-d', 'first words then more');

    expect(await storedBody('out-d')).toBe('');
    expect(await outputHits('first')).toEqual([]);
    expect(await historyHits('first')).toEqual(['conv-d']);
    expect(await outputHits('early')).toEqual(['out-d']);
    await expectOutputsOneToOne();
  });

  it('stays 1:1 with its source through insert, edit, rename and delete', async () => {
    await setupFullTextSearch(db);
    for (let i = 0; i < 20; i++) {
      await addHistory(`conv-${i}`, `topic${i} words`);
      await addSavedChat(`out-${i}`, `conv-${i}`, `Title ${i}`, `topic${i} words`);
      await addArtifact(`art-${i}`, `Artifact ${i}`, `artifact body ${i}`);
    }
    await saveChat('out-1', 'topic1 words edited');
    await run(`UPDATE content_outputs SET title = 'Renamed' WHERE id = 'out-2'`);
    await run(`UPDATE content_outputs SET id = 'out-3-renamed' WHERE id = 'out-3'`);
    await run(`UPDATE content_outputs SET scope_id = 'team' WHERE id = 'out-4'`);
    await run(`DELETE FROM content_outputs WHERE id = 'out-5'`);

    expect(await outputHits('renamed')).toEqual(['out-2']);
    expect(await get(`SELECT count(*) AS n FROM content_outputs_fts WHERE doc_id = 'out-3'`)).toEqual({ n: 0 });
    expect(await outputHits('title')).toContain('out-3-renamed');
    expect(await outputHits('title')).not.toContain('out-5');
    expect(await outputHits('artifact')).toHaveLength(20);
    await expectOutputsOneToOne();
  });
});

describe('upgrading an existing database', () => {
  async function legacyDatabase() {
    await setupFullTextSearch(db);
    await installLegacyContentOutputTriggers();
    for (let i = 0; i < 12; i++) await addHistory(`conv-${i}`, `subject${i} details`);
    for (let i = 0; i < 12; i++) await addSavedChat(`out-${i}`, `conv-${i}`, `Chat ${i}`, `subject${i} details`);
    await addSavedChat('out-orphan', 'conv-orphan', 'Orphan', 'orphanword text');
    await addArtifact('out-art', 'Artifact', 'artifactword text');
    // Every legacy row carries its full body, exactly as installs have them today.
    expect(await storedBody('out-0')).toBe(transcript('subject0 details'));
  }

  it('replaces the legacy insert and update triggers without rewriting a single search row', async () => {
    await legacyDatabase();
    const before = await all('SELECT rowid, * FROM content_outputs_fts ORDER BY rowid');

    const result = await syncSearchTriggers(db, SPEC);

    expect(result.replaced).toEqual(['content_outputs_ai', 'content_outputs_au']);
    expect(await all('SELECT rowid, * FROM content_outputs_fts ORDER BY rowid')).toEqual(before);
    // and the next boot is a no-op
    expect((await syncSearchTriggers(db, SPEC)).replaced).toEqual([]);
  });

  it('compaction drops only the copies that history covers, keeps search results, and never touches a source row', async () => {
    await legacyDatabase();
    await setupFullTextSearch(db);
    const sourceBefore = await sourceSnapshot();

    const result = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0, batchSize: 5 });

    expect(result).toMatchObject({ status: 'complete', examined: 12, reindexed: 12 });
    expect(await sourceSnapshot()).toEqual(sourceBefore);
    for (let i = 0; i < 12; i++) {
      expect(await storedBody(`out-${i}`)).toBe('');
      expect(await outputHits(`subject${i}`)).toEqual([]);
      expect(await historyHits(`subject${i}`)).toEqual([`conv-${i}`]);
      expect(await outputHits(`chat`)).toContain(`out-${i}`);
    }
    expect(await outputHits('orphanword')).toEqual(['out-orphan']);
    expect(await outputHits('artifactword')).toEqual(['out-art']);
    await expectOutputsOneToOne();
  });

  it('a second run does nothing, and a mark beyond the table end (a restored database) is re-checked from the start', async () => {
    await legacyDatabase();
    await setupFullTextSearch(db);
    await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });

    const again = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });
    expect(again).toMatchObject({ status: 'complete', examined: 0, reindexed: 0 });

    fs.writeFileSync(statePath, JSON.stringify({ contentOutputsFtsCheckedThroughRowid: 10_000_000 }));
    await installLegacyContentOutputTriggers();
    await saveChat('out-3', 'subject3 details again');
    await setupFullTextSearch(db);
    const restored = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });
    expect(restored).toMatchObject({ status: 'complete', reindexed: 1 });
    expect(await storedBody('out-3')).toBe('');
  });

  it('stops between batches when asked and resumes from its mark', async () => {
    await legacyDatabase();
    await setupFullTextSearch(db);
    // shouldStop is consulted once before each scan and once before each batch:
    // call 1 (scan) and call 2 (first batch) continue, call 3 stops.
    let calls = 0;
    const first = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0, batchSize: 4, shouldStop: () => calls++ >= 2 });
    expect(first.status).toBe('stopped');
    expect(first.reindexed).toBe(4);
    const mark = readMaintenanceState(statePath).contentOutputsFtsCheckedThroughRowid;
    expect(mark).toBe(first.checkedThrough);

    const second = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0, batchSize: 4 });
    expect(second).toMatchObject({ status: 'complete', reindexed: 8 });
    for (let i = 0; i < 12; i++) expect(await storedBody(`out-${i}`)).toBe('');
    await expectOutputsOneToOne();
  });

  it('picks up rows an older build re-indexed after it ran (builds taking turns on one database)', async () => {
    await legacyDatabase();
    await setupFullTextSearch(db);
    await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });

    // An older build starts: its syncSearchTriggers puts the verbatim triggers back.
    await installLegacyContentOutputTriggers();
    await saveChat('out-7', 'subject7 details revised');
    expect(await outputHits('revised')).toEqual(['out-7']); // the old build's search still works its own way

    // This build starts again.
    await setupFullTextSearch(db);
    const result = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });
    expect(result).toMatchObject({ status: 'complete', reindexed: 1 });
    expect(await outputHits('revised')).toEqual([]);
    expect(await historyHits('subject7')).toEqual(['conv-7']);
    await expectOutputsOneToOne();
  });

  it('bounds each transaction by stored body bytes, so a huge transcript is re-indexed on its own', async () => {
    await setupFullTextSearch(db);
    await installLegacyContentOutputTriggers();
    const big = 'word '.repeat(600_000); // ~3 MB of text; transcript() stores it twice, so each body is ~6 MB
    for (let i = 0; i < 3; i++) {
      await addHistory(`conv-big-${i}`, `big${i}`);
      await addSavedChat(`out-big-${i}`, `conv-big-${i}`, `Big ${i}`, `big${i} ${big}`);
    }
    for (let i = 0; i < 4; i++) {
      await addHistory(`conv-small-${i}`, `small${i}`);
      await addSavedChat(`out-small-${i}`, `conv-small-${i}`, `Small ${i}`, `small${i}`);
    }
    await setupFullTextSearch(db);

    const result = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0, batchSize: 10, maxBatchBytes: 4 * 1024 * 1024 });

    // Each ~6 MB body exceeds the 4 MB bound and goes alone; the four small ones share one.
    expect(result).toMatchObject({ status: 'complete', reindexed: 7, transactions: 4 });
    for (let i = 0; i < 3; i++) expect(await storedBody(`out-big-${i}`)).toBe('');
    await expectOutputsOneToOne();
  });

  it('skips, without writing, a search table whose layout it does not recognise', async () => {
    await run(`CREATE VIRTUAL TABLE content_outputs_fts USING fts5(user_id UNINDEXED, doc_id UNINDEXED, title, content)`);
    const result = await compactSavedChatSearchIndex(db, { statePath, pauseMs: 0 });
    expect(result.status).toBe('skipped:unexpected-layout');
    expect(fs.existsSync(statePath)).toBe(false);
  });
});
