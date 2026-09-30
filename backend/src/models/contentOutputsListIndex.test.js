import { describe, it, expect, beforeAll } from 'vitest';
import db, { dbReady, CONTENT_LIST_INDEX } from './database/index.js';
import { LIST_COLUMNS, buildListQuery } from './ContentOutputModel.js';

/**
 * The conversation list must be answered from idx_content_outputs_list alone.
 *
 * Its columns sit physically after `content` (they arrived by ALTER TABLE), so
 * any list read that touches the table walks every row's content overflow
 * chain: 1,210 MB per GET /content-outputs on a real install. One list column
 * left out of the index and that is what happens again, silently.
 */
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

async function waitForIndex(name, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await all(`SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?`, [name])).length) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

beforeAll(async () => {
  await dbReady;
});

describe('conversation list covering index', () => {
  it('is built on a small table at boot', async () => {
    expect(await waitForIndex(CONTENT_LIST_INDEX.name)).toBe(true);
  });

  it('contains every column the list selects', async () => {
    const indexed = (await all(`PRAGMA index_info(${CONTENT_LIST_INDEX.name})`)).map((c) => c.name);
    const listed = LIST_COLUMNS.split(',').map((c) => c.trim());
    expect(listed.filter((column) => !indexed.includes(column))).toEqual([]);
  });

  it.each([
    ['all conversations', {}],
    ['one page', { limit: 50, offset: 0 }],
    ['ungrouped', { groupId: 'none' }],
    ['one group', { groupId: 'g1' }],
  ])('answers %s without reading the table', async (_label, options) => {
    const { sql, params } = buildListQuery('u1', options);
    const plan = (await all(`EXPLAIN QUERY PLAN ${sql}`, params)).map((row) => row.detail).join(' | ');
    expect(plan).toContain(`USING COVERING INDEX ${CONTENT_LIST_INDEX.name}`);
  });

  // Not asserted: a TEMP B-TREE for the ORDER BY. The COUNT(*) OVER() window
  // wraps the query in a co-routine, so SQLite sorts its (small, in-memory)
  // output regardless. That costs milliseconds; reading the table cost a GB.
});
