/**
 * Schema build ORDER — structural guards.
 *
 * THE BUG THIS EXISTS FOR
 * ───────────────────────
 * `CREATE INDEX IF NOT EXISTS idx_content_outputs_channel
 *    ON content_outputs(user_id, channel_key)`
 * lived inline in createTables(), while the `channel_key` column was added by
 * runMigrations(). On a FRESH database that is fine — CREATE TABLE declares
 * every column, so the index builds. On an EXISTING one the CREATE TABLE is a
 * no-op, the column does not exist yet, and the index fails with
 *
 *   SQLITE_ERROR: no such column: channel_key
 *
 * Two things then went wrong at once, and both were silent:
 *   1. The index was never created. `IF NOT EXISTS` does not help; the
 *      statement errored, so nothing was built and nothing said so.
 *   2. The db.run had no callback. node-sqlite3 emits that error on the
 *      *Statement* object — NOT the Database — so no `db.on('error')` can
 *      catch it and it surfaces as an UNCAUGHT EXCEPTION during boot.
 *
 * Measured on this repo the day channel_key shipped: every upgrading install
 * threw at startup. A scan found it was the FOURTH index with this shape
 * (idx_groups_parent_id, idx_content_outputs_group_id,
 * idx_widget_layouts_user_id) — the other three only escaped notice because
 * they predate any install still running, and the failure self-heals on the
 * SECOND boot once the migration has landed. That is precisely why a one-off
 * fix is not enough: the shape is invisible until the exact release that
 * introduces it, and then it is invisible again forever after.
 *
 * THE INVARIANT
 * ─────────────
 * An index is derived from a table's columns, so it can only be built once the
 * schema is FINAL. CREATE TABLE finalises a fresh database; migrations
 * finalise an existing one. Therefore: indexes come last, always, and any DDL
 * that can fail carries a callback so a mistake is a log line and not a dead
 * process.
 *
 * These are source-structure guards. schemaUpgrade.integration.test.js proves
 * the same rule against a real sqlite file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const src = fs.readFileSync(FILE, 'utf8');

/** Body of createTables(), i.e. everything that runs BEFORE migrations. */
function createTablesBody(source = src) {
  const start = source.indexOf('function createTables() {');
  const end = source.indexOf('// --- Guarded build for the activity-chart covering index');
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      'Could not locate createTables(). This guard is anchored to that function — ' +
        're-anchor it rather than deleting it.'
    );
  }
  return source.slice(start, end);
}

// db.run(`CREATE [UNIQUE] INDEX ...`) — an index EXECUTED at this point.
const INDEX_RUN = /db\.run\(\s*`CREATE\s+(?:UNIQUE\s+)?INDEX/g;

describe('indexes are built after migrations, never inside createTables()', () => {
  it('createTables() executes no CREATE INDEX of its own', () => {
    const offenders = [...createTablesBody().matchAll(INDEX_RUN)];
    expect(
      offenders.length,
      'An index is being built before migrations have run. On an upgrading install the\n' +
        'column it names may not exist yet: the index is silently skipped and boot dies\n' +
        'with an uncaught SQLITE_ERROR. Register it with createIndex(`...`) instead — it\n' +
        'will run after runMigrations(), which is the only point the schema is final.'
    ).toBe(0);
  });

  it('createTables() still declares its indexes, via createIndex()', () => {
    // Guards the guard: if someone "fixes" the rule above by deleting every
    // index, this fails. The indexes must still be declared, just deferred.
    const declared = [...createTablesBody().matchAll(/createIndex\(\s*`CREATE\s+(?:UNIQUE\s+)?INDEX/g)];
    expect(declared.length).toBeGreaterThan(50);
  });

  it('createIndexes() runs after runMigrations() in the boot chain', () => {
    const migrations = src.indexOf('return runMigrations();');
    const indexes = src.indexOf('return createIndexes();');
    expect(migrations, 'runMigrations() call not found in the boot chain').toBeGreaterThan(-1);
    expect(indexes, 'createIndexes() is never called — deferred indexes would never be built').toBeGreaterThan(-1);
    expect(
      indexes,
      'createIndexes() must be sequenced AFTER runMigrations(); deferring the DDL is\n' +
        'only half the fix if it still executes first.'
    ).toBeGreaterThan(migrations);
  });

  it('every deferred index is executed with an error callback', () => {
    // The whole reason a schema slip became a crash: a callback-less db.run
    // emits on the Statement, which nothing listens to.
    const body = src.slice(src.indexOf('function createIndexes()'), src.indexOf('function createTables()'));
    expect(body, 'createIndexes() not found').toContain('deferredIndexes');
    expect(
      /db\.run\(sql,\s*\(err\)\s*=>/.test(body),
      'createIndexes() must pass a callback to db.run. Without one, a failed index\n' +
        'build is an uncaught exception at boot instead of a logged warning.'
    ).toBe(true);
  });
});

describe('DDL that can fail always carries a callback', () => {
  /**
   * ALTER TABLE and CREATE INDEX are the two statements here that fail on
   * real, reachable schema states (duplicate column, missing column). Both
   * MUST report their errors. CREATE TABLE IF NOT EXISTS cannot fail this way
   * and is deliberately out of scope — a rule wider than the evidence gets
   * exemptions bolted on until it means nothing.
   *
   * On first run this caught two more of exactly the original bug's shape,
   * inside runMigrations(): idx_agent_memory_shape and
   * idx_conversation_prompt_state_updated, both callback-less. A third,
   * idx_agent_executions_root, passed `() => {}` — not fatal, just invisible,
   * which is the same failure wearing a disguise. All three now go through
   * createIndex().
   */
  const RISKY = /db\.run\(\s*`(ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)[\s\S]*?`\s*(,|\))/g;

  it('no ALTER TABLE or CREATE INDEX is executed without one', () => {
    const bare = [];
    for (const m of src.matchAll(RISKY)) {
      if (m[2] === ')') bare.push(m[0].slice(0, 90).replace(/\s+/g, ' '));
    }
    expect(bare, `Callback-less DDL found:\n  ${bare.join('\n  ')}`).toEqual([]);
  });

  it('no index is built inline anywhere — every one is declared via createIndex()', () => {
    // Single invariant, no exemptions: index DDL is DECLARED next to its
    // table and EXECUTED once, in createIndexes(), after migrations. Inline
    // builds are the bug; an inline build with a hand-written callback is a
    // second code path that will drift.
    const inline = [...src.matchAll(INDEX_RUN)].map((m) => m[0]);
    expect(
      inline,
      'Use createIndex(`CREATE INDEX ...`) instead of db.run for index DDL.'
    ).toEqual([]);
  });

  it('an empty callback does not count as reporting (it is how one of these hid)', () => {
    // `[^`]*` keeps the match INSIDE the SQL string. An unbounded [\s\S]*?
    // here happily reaches across a thousand lines to find some unrelated
    // `() => {}` and reports a phantom — which it did, on the first run of
    // this very test.
    const EMPTY_CB =
      /db\.run\(\s*`(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)[^`]*`\s*,\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g;
    const swallowed = [...src.matchAll(EMPTY_CB)].map((m) => m[0].slice(0, 90).replace(/\s+/g, ' '));
    expect(
      swallowed,
      `DDL whose errors go nowhere:\n  ${swallowed.join('\n  ')}\n` +
        'An empty callback is not error handling — it is the same lost failure as no\n' +
        'callback, minus the crash that would have told you.'
    ).toEqual([]);
  });

  it('the empty-callback rule is checkable (negative control)', () => {
    const EMPTY_CB =
      /db\.run\(\s*`(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)[^`]*`\s*,\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g;
    expect('db.run(`ALTER TABLE skills ADD COLUMN slug TEXT`, () => {});'.match(EMPTY_CB)).toHaveLength(1);
    expect('db.run(`ALTER TABLE skills ADD COLUMN slug TEXT`, (e) => { log(e); });'.match(EMPTY_CB)).toBeNull();
  });

  it('the callback rule is actually checkable (negative control)', () => {
    // Written out rather than asserted in the abstract: if the regex above
    // stops matching real code, this fails and the guard above cannot pass
    // vacuously.
    const bad = 'db.run(`ALTER TABLE content_outputs ADD COLUMN x TEXT`);';
    const good = 'db.run(`ALTER TABLE content_outputs ADD COLUMN x TEXT`, (err) => {});';
    const tails = (s) => [...s.matchAll(RISKY)].map((m) => m[2]);
    expect(tails(bad)).toEqual([')']);
    expect(tails(good)).toEqual([',']);
  });
});

describe('negative controls — each guard fails on the code it was written for', () => {
  it('the pre-fix source shape is rejected', () => {
    const preFix = `
function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(\`CREATE TABLE IF NOT EXISTS content_outputs (id TEXT PRIMARY KEY)\`);
      db.run(\`CREATE INDEX IF NOT EXISTS idx_content_outputs_channel ON content_outputs(user_id, channel_key)\`);
    });
  });
}
// --- Guarded build for the activity-chart covering index
`;
    expect([...createTablesBody(preFix).matchAll(INDEX_RUN)].length).toBe(1);
  });

  it('the post-fix source shape is accepted', () => {
    const postFix = `
function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(\`CREATE TABLE IF NOT EXISTS content_outputs (id TEXT PRIMARY KEY)\`);
      createIndex(\`CREATE INDEX IF NOT EXISTS idx_content_outputs_channel ON content_outputs(user_id, channel_key)\`);
    });
  });
}
// --- Guarded build for the activity-chart covering index
`;
    expect([...createTablesBody(postFix).matchAll(INDEX_RUN)].length).toBe(0);
  });
});
