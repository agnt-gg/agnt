import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { setupFullTextSearch, syncSearchTriggers, replaceTriggerIfChanged, FTS_TABLES } from './fts.js';

/**
 * THE REGRESSION THIS PINS (2026-09-30).
 *
 * The update/delete triggers of the TEXT-keyed search tables deleted with
 * `WHERE doc_id = old.id`, a full scan of the FTS table: 1.3 GB read per chat
 * autosave on a real 32 GB database. The fix deletes by rowid through an index
 * on the shadow column that stores doc_id. These tests pin that the delete path
 * never scans, that search stays exactly 1:1 with its source, that an existing
 * database is upgraded in place without touching data, and that every doubtful
 * case falls back to the old (slow, correct) triggers instead of breaking
 * writes.
 *
 * Runs on a private in-memory database built from FTS_TABLES, so it exercises
 * the real trigger SQL without the app's import-time boot.
 */

const TEXT_SPECS = FTS_TABLES.filter((spec) => spec.pkType === 'text');

let db;
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const get = async (sql, params = []) => (await all(sql, params))[0];

// A source table with every column FTS mirrors, plus one it does not (scope_id).
async function createSourceTables() {
  for (const spec of FTS_TABLES) {
    const key = spec.pkType === 'integer' ? `${spec.pkCol} INTEGER PRIMARY KEY` : `${spec.pkCol} TEXT PRIMARY KEY`;
    const columns = [...spec.unindexed, ...spec.indexed].map((c) => `${c} TEXT`);
    await run(`CREATE TABLE ${spec.source} (${[key, ...columns, 'scope_id TEXT'].join(', ')})`);
  }
}

async function insertDoc(spec, id, text) {
  const columns = [spec.pkCol, ...spec.indexed];
  await run(`INSERT INTO ${spec.source} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, [id, ...spec.indexed.map(() => text)]);
}

const searchIds = async (spec, term) => (await all(`SELECT doc_id FROM ${spec.name} WHERE ${spec.name} MATCH ?`, [term])).map((r) => r.doc_id).sort();

async function expectOneToOne(spec) {
  const counts = await get(
    `SELECT (SELECT count(*) FROM ${spec.source}) AS source,
            (SELECT count(*) FROM ${spec.name}) AS search,
            (SELECT count(DISTINCT doc_id) FROM ${spec.name}) AS distinctIds`,
  );
  expect(counts.search).toBe(counts.source);
  expect(counts.distinctIds).toBe(counts.source);
}

// The exact DELETE each trigger runs, with old.<pk> bound as a parameter.
async function triggerDeletePlans(spec) {
  const triggers = await all(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name IN (?, ?)`, [
    spec.source, `${spec.source}_au`, `${spec.source}_ad`,
  ]);
  expect(triggers).toHaveLength(2);
  const plans = [];
  for (const trigger of triggers) {
    const statement = trigger.sql.match(/DELETE FROM [^;]+/i)[0].replace(new RegExp(`old\\.${spec.pkCol}\\b`, 'g'), '?');
    const plan = (await all(`EXPLAIN QUERY PLAN ${statement}`, ['x'])).map((row) => row.detail);
    plans.push({ trigger: trigger.name, statement, plan });
  }
  return plans;
}

// A legacy database, as every existing install has it: broad AFTER UPDATE, doc_id-scan deletes.
async function installLegacyTriggers(spec) {
  const columns = [...spec.unindexed, ...spec.indexed];
  const insert = `INSERT INTO ${spec.name}(doc_id, ${columns.join(', ')}) VALUES (new.${spec.pkCol}, ${columns.map((c) => `new.${c}`).join(', ')});`;
  await run(`DROP TRIGGER IF EXISTS ${spec.source}_au`);
  await run(`DROP TRIGGER IF EXISTS ${spec.source}_ad`);
  await run(`CREATE TRIGGER ${spec.source}_au AFTER UPDATE ON ${spec.source} BEGIN DELETE FROM ${spec.name} WHERE doc_id = old.${spec.pkCol}; ${insert} END`);
  await run(`CREATE TRIGGER ${spec.source}_ad AFTER DELETE ON ${spec.source} BEGIN DELETE FROM ${spec.name} WHERE doc_id = old.${spec.pkCol}; END`);
}

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await createSourceTables();
});

afterEach(() => new Promise((resolve) => db.close(resolve)));

describe('TEXT-keyed search triggers', () => {
  it('never scan the search table to find the row they delete', async () => {
    await setupFullTextSearch(db);
    for (const spec of TEXT_SPECS) {
      for (const { trigger, statement, plan } of await triggerDeletePlans(spec)) {
        // A bare "VIRTUAL TABLE INDEX 0:" is the unconstrained full scan this fix removes.
        expect(plan.some((line) => /VIRTUAL TABLE INDEX \d+:$/.test(line)), `${trigger}: ${statement}\n${plan.join('\n')}`).toBe(false);
        expect(plan.join(' | ')).toContain(`USING COVERING INDEX ${spec.name}_content_doc_id`);
      }
    }
  });

  it('keep search exactly 1:1 with the source through insert, edit, rename, unrelated writes and delete', async () => {
    await setupFullTextSearch(db);
    for (const spec of TEXT_SPECS) {
      for (let i = 0; i < 50; i++) await insertDoc(spec, `doc-${i}`, `alpha body ${i}`);
      const column = spec.indexed[spec.indexed.length - 1];

      await run(`UPDATE ${spec.source} SET ${column} = 'bravo' WHERE ${spec.pkCol} = 'doc-1'`);
      expect(await searchIds(spec, 'bravo')).toEqual(['doc-1']);

      await run(`UPDATE ${spec.source} SET ${spec.pkCol} = 'doc-renamed' WHERE ${spec.pkCol} = 'doc-2'`);
      expect(await get(`SELECT count(*) AS n FROM ${spec.name} WHERE doc_id = 'doc-2'`)).toEqual({ n: 0 });
      expect(await get(`SELECT count(*) AS n FROM ${spec.name} WHERE doc_id = 'doc-renamed'`)).toEqual({ n: 1 });

      // A column search does not mirror must not touch the index (the ownership-scope trap).
      await run(`UPDATE ${spec.source} SET scope_id = 'team' WHERE ${spec.pkCol} = 'doc-3'`);

      await run(`DELETE FROM ${spec.source} WHERE ${spec.pkCol} = 'doc-4'`);
      await run(`DELETE FROM ${spec.source} WHERE ${spec.pkCol} = 'no-such-doc'`);
      expect(await searchIds(spec, 'alpha')).not.toContain('doc-4');

      await expectOneToOne(spec);
    }
  });

  it('remove every legacy duplicate of a document on the next edit, never leaving a stale hit', async () => {
    await setupFullTextSearch(db);
    const spec = TEXT_SPECS.find((s) => s.source === 'content_outputs');
    await insertDoc(spec, 'dup', 'original words');
    await run(`INSERT INTO ${spec.name}(doc_id, ${spec.indexed[0]}) VALUES ('dup', 'stale words')`);

    await run(`UPDATE ${spec.source} SET ${spec.indexed[0]} = 'fresh words' WHERE id = 'dup'`);
    expect(await searchIds(spec, 'stale')).toEqual([]);
    await expectOneToOne(spec);
  });
});

describe('upgrading an existing database', () => {
  it('swaps legacy triggers in place without rewriting a single search row', async () => {
    await setupFullTextSearch(db);
    for (const spec of TEXT_SPECS) {
      await installLegacyTriggers(spec);
      for (let i = 0; i < 20; i++) await insertDoc(spec, `doc-${i}`, `legacy words ${i}`);
    }
    // Drop the index too, exactly as an install that predates this change has it.
    for (const spec of TEXT_SPECS) await run(`DROP INDEX IF EXISTS ${spec.name}_content_doc_id`);
    const before = {};
    for (const spec of TEXT_SPECS) before[spec.name] = await all(`SELECT rowid, * FROM ${spec.name} ORDER BY rowid`);

    await setupFullTextSearch(db);

    for (const spec of TEXT_SPECS) {
      expect(await all(`SELECT rowid, * FROM ${spec.name} ORDER BY rowid`)).toEqual(before[spec.name]);
      for (const { plan } of await triggerDeletePlans(spec)) {
        expect(plan.join(' | ')).toContain(`${spec.name}_content_doc_id`);
      }
      await run(`UPDATE ${spec.source} SET ${spec.indexed[0]} = 'upgraded' WHERE ${spec.pkCol} = 'doc-5'`);
      expect(await searchIds(spec, 'upgraded')).toEqual(['doc-5']);
      await expectOneToOne(spec);
    }
  });

  it('is a no-op on every boot after the first', async () => {
    await setupFullTextSearch(db);
    for (const spec of FTS_TABLES) {
      expect(await syncSearchTriggers(db, spec)).toEqual({ useDocIdIndex: spec.pkType === 'text', replaced: [] });
    }
  });
});

describe('fails safe', () => {
  it('keeps the doc_id-scan triggers when doc_id is not the first shadow column', async () => {
    const spec = TEXT_SPECS.find((s) => s.source === 'insights');
    // Same columns, different order: c0 would be user_id, and a c0 lookup would delete the wrong rows.
    const columns = [...spec.unindexed, 'doc_id', ...spec.indexed].map((c) => (spec.indexed.includes(c) ? c : `${c} UNINDEXED`));
    await run(`CREATE VIRTUAL TABLE ${spec.name} USING fts5(${columns.join(', ')})`);

    await setupFullTextSearch(db);

    for (const { statement } of await triggerDeletePlans(spec)) expect(statement).toMatch(/WHERE doc_id = \?/);
    for (let i = 0; i < 5; i++) await insertDoc(spec, `doc-${i}`, `words ${i}`);
    await run(`DELETE FROM ${spec.source} WHERE id = 'doc-2'`);
    await expectOneToOne(spec);
  });

  it('keeps the doc_id-scan triggers when the index cannot be created', async () => {
    const spec = TEXT_SPECS.find((s) => s.source === 'agent_memory');
    await run(`CREATE TABLE ${spec.name}_content_doc_id (blocker TEXT)`); // name collision forces CREATE INDEX to fail

    const result = await (async () => { await setupFullTextSearch(db); return syncSearchTriggers(db, spec); })();

    expect(result.useDocIdIndex).toBe(false);
    for (const { statement } of await triggerDeletePlans(spec)) expect(statement).toMatch(/WHERE doc_id = \?/);
    await insertDoc(spec, 'm1', 'kept working');
    await run(`UPDATE ${spec.source} SET content = 'still searchable' WHERE id = 'm1'`);
    expect(await searchIds(spec, 'searchable')).toEqual(['m1']);
  });

  it('leaves the previous trigger in place, and the connection usable, when a replacement fails', async () => {
    await run(`CREATE TRIGGER guard AFTER DELETE ON insights BEGIN SELECT 1; END`);
    const original = await get(`SELECT sql FROM sqlite_master WHERE name = 'guard'`);

    await expect(
      replaceTriggerIfChanged(db, 'guard', `CREATE TRIGGER guard AFTER DELETE ON no_such_table BEGIN SELECT 1; END`),
    ).rejects.toThrow(/no_such_table|no such table/i);

    expect(await get(`SELECT sql FROM sqlite_master WHERE name = 'guard'`)).toEqual(original);
    // Not stranded inside the failed transaction.
    await run('BEGIN IMMEDIATE');
    await run('COMMIT');
  });

  it('does not roll back a transaction it did not open', async () => {
    await run(`CREATE TRIGGER guard AFTER DELETE ON insights BEGIN SELECT 1; END`);
    await run('BEGIN');
    await run(`INSERT INTO insights (id, title) VALUES ('mine', 'caller work')`);

    await expect(
      replaceTriggerIfChanged(db, 'guard', `CREATE TRIGGER guard AFTER DELETE ON insights BEGIN SELECT 2; END`),
    ).rejects.toThrow(/within a transaction/i);

    await run('COMMIT');
    expect(await get(`SELECT id FROM insights WHERE id = 'mine'`)).toEqual({ id: 'mine' });
  });
});
