/**
 * widget_layouts dedupe + uniqueness guarantee.
 *
 * The survivor must be the row the API actually serves
 * (`ORDER BY page_order ASC, created_at ASC`), because that is the row the
 * frontend resolves a route to. Keeping any other row would silently swap the
 * user's page out from under them.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteDuplicateRoutePages,
  countDuplicateRoutePages,
  ensureWidgetLayoutRouteUniqueness,
  WIDGET_LAYOUT_ROUTE_INDEX,
} from './widgetLayoutDedupe.js';

let ROOT;
let db;

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

/** Mirrors the production schema exactly (see database/index.js). */
const CREATE_TABLE = `CREATE TABLE widget_layouts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_icon TEXT DEFAULT 'fas fa-th',
  page_order INTEGER DEFAULT 0,
  route TEXT,
  layout_data TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

let seq = 0;
async function insert({ user = 'u1', route = 'ChatScreen', order = 0, created = '2026-01-01 00:00:00', layout = '[]', pageId } = {}) {
  const id = `row_${++seq}`;
  const page_id = pageId || `page_${seq}`;
  await run(
    `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data, created_at)
     VALUES (?, ?, ?, ?, 'fas fa-th', ?, ?, ?, ?)`,
    [id, user, page_id, route || 'Custom', order, route, layout, created],
  );
  return page_id;
}

const survivingPageIds = async (route = 'ChatScreen') =>
  (await all('SELECT page_id FROM widget_layouts WHERE route IS ? ORDER BY rowid', [route])).map((r) => r.page_id);

const indexExists = async () =>
  (await all(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`, [WIDGET_LAYOUT_ROUTE_INDEX])).length === 1;

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-wldedupe-'));
  db = new sqlite3.Database(path.join(ROOT, 'test.db'));
  // Throwaway database — durability is irrelevant, fsync latency is not.
  // With the default DELETE journal + FULL sync, every individually-committed
  // INSERT is a disk flush; under full-suite parallel load those flushes
  // stalled tests past the 5s timeout. MEMORY/OFF makes them near-instant.
  await run('PRAGMA journal_mode = MEMORY');
  await run('PRAGMA synchronous = OFF');
  await run(CREATE_TABLE);
  seq = 0;
});

afterEach(async () => {
  await new Promise((r) => db.close(r));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('deleteDuplicateRoutePages — survivor selection', () => {
  it('keeps the row the API serves first (lowest page_order)', async () => {
    const winner = await insert({ order: 0, created: '2026-05-01 00:00:00' });
    await insert({ order: 7, created: '2026-02-01 00:00:00' });
    await insert({ order: 2004, created: '2026-03-01 00:00:00' });

    expect(await countDuplicateRoutePages(db)).toBe(2);
    expect(await deleteDuplicateRoutePages(db)).toBe(2);
    expect(await survivingPageIds()).toEqual([winner]);
  });

  it('breaks page_order ties with the oldest created_at', async () => {
    await insert({ order: 0, created: '2026-06-01 00:00:00' });
    const winner = await insert({ order: 0, created: '2026-02-17 18:48:17' });
    await insert({ order: 0, created: '2026-07-26 06:01:40' });

    await deleteDuplicateRoutePages(db);
    expect(await survivingPageIds()).toEqual([winner]);
  });

  it('breaks a total tie deterministically by rowid, keeping exactly one', async () => {
    const winner = await insert({ order: 0, created: '2026-01-01 00:00:00' });
    await insert({ order: 0, created: '2026-01-01 00:00:00' });
    await insert({ order: 0, created: '2026-01-01 00:00:00' });

    expect(await deleteDuplicateRoutePages(db)).toBe(2);
    expect(await survivingPageIds()).toEqual([winner]);
  });

  it("preserves the survivor's layout_data verbatim", async () => {
    const customized = JSON.stringify([{ instanceId: 'w_keepme', widgetId: 'chat', col: 3, row: 1, cols: 6, rows: 4 }]);
    const winner = await insert({ order: 0, created: '2026-01-01 00:00:00', layout: customized });
    await insert({ order: 5, created: '2026-01-02 00:00:00', layout: '[]' });

    await deleteDuplicateRoutePages(db);
    const rows = await all('SELECT page_id, layout_data FROM widget_layouts');
    expect(rows).toEqual([{ page_id: winner, layout_data: customized }]);
  });
});

describe('deleteDuplicateRoutePages — what it must NOT touch', () => {
  it('never deletes custom pages (route IS NULL), even identical ones', async () => {
    await insert({ route: null, order: 0 });
    await insert({ route: null, order: 0 });
    await insert({ route: null, order: 1 });

    expect(await deleteDuplicateRoutePages(db)).toBe(0);
    expect((await all('SELECT id FROM widget_layouts')).length).toBe(3);
  });

  it('scopes per user — each user keeps their own page for the same route', async () => {
    const a = await insert({ user: 'u1', order: 0, created: '2026-01-01 00:00:00' });
    await insert({ user: 'u1', order: 3, created: '2026-01-02 00:00:00' });
    const b = await insert({ user: 'u2', order: 0, created: '2026-01-01 00:00:00' });
    await insert({ user: 'u2', order: 9, created: '2026-01-03 00:00:00' });

    expect(await deleteDuplicateRoutePages(db)).toBe(2);
    expect((await survivingPageIds()).sort()).toEqual([a, b].sort());
  });

  it('groups legacy NULL-owner rows together instead of treating each as unique', async () => {
    const winner = await insert({ user: null, order: 0, created: '2026-01-01 00:00:00' });
    await insert({ user: null, order: 1, created: '2026-01-02 00:00:00' });

    expect(await deleteDuplicateRoutePages(db)).toBe(1);
    expect(await survivingPageIds()).toEqual([winner]);
  });

  it('leaves distinct routes alone', async () => {
    await insert({ route: 'ChatScreen' });
    await insert({ route: 'SettingsScreen' });
    await insert({ route: 'GoalsScreen' });

    expect(await countDuplicateRoutePages(db)).toBe(0);
    expect(await deleteDuplicateRoutePages(db)).toBe(0);
    expect((await all('SELECT id FROM widget_layouts')).length).toBe(3);
  });
});

describe('ensureWidgetLayoutRouteUniqueness', () => {
  it('repairs a duplicated table and then makes duplicates impossible', async () => {
    const winner = await insert({ order: 0, created: '2026-02-17 18:48:17' });
    for (let i = 0; i < 12; i++) await insert({ order: i + 1, created: `2026-03-0${(i % 9) + 1} 00:00:00` });

    const res = await ensureWidgetLayoutRouteUniqueness(db, { log() {} });
    expect(res).toMatchObject({ deleted: 12, indexed: true, repaired: true });
    expect(await survivingPageIds()).toEqual([winner]);
    expect(await indexExists()).toBe(true);

    // The structural guarantee: a second page for the same route is now
    // rejected by the database, not merely avoided by the client.
    await expect(insert({ order: 99 })).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('still allows a different user and a different route through the index', async () => {
    await insert({ user: 'u1', route: 'ChatScreen' });
    await ensureWidgetLayoutRouteUniqueness(db, { log() {} });

    await expect(insert({ user: 'u2', route: 'ChatScreen' })).resolves.toBeTruthy();
    await expect(insert({ user: 'u1', route: 'GoalsScreen' })).resolves.toBeTruthy();
    // Custom pages carry route NULL; SQLite's partial index must not collide.
    await expect(insert({ user: 'u1', route: null })).resolves.toBeTruthy();
    await expect(insert({ user: 'u1', route: null })).resolves.toBeTruthy();
  });

  it('is a cheap no-op on a healthy database (no repair scan)', async () => {
    await insert({ route: 'ChatScreen' });
    await insert({ route: 'GoalsScreen' });

    const res = await ensureWidgetLayoutRouteUniqueness(db, { log() {} });
    expect(res).toEqual({ deleted: 0, indexed: true, repaired: false });
  });

  it('is idempotent — a second run deletes nothing and still succeeds', async () => {
    await insert({ order: 0 });
    await insert({ order: 1 });

    const first = await ensureWidgetLayoutRouteUniqueness(db, { log() {} });
    const second = await ensureWidgetLayoutRouteUniqueness(db, { log() {} });

    expect(first.deleted).toBe(1);
    expect(second).toEqual({ deleted: 0, indexed: true, repaired: false });
    expect((await all('SELECT id FROM widget_layouts')).length).toBe(1);
  });

  it('propagates non-uniqueness failures instead of silently swallowing them', async () => {
    await run('DROP TABLE widget_layouts');
    await expect(ensureWidgetLayoutRouteUniqueness(db, { log() {} })).rejects.toThrow(/no such table/i);
  });
});

describe('regression: the exact production shape', () => {
  it('collapses 1,455 identical ChatScreen rows to the one the app resolves to', async () => {
    // Reproduces the observed production table: one real page from February,
    // then one orphan per cold start, each created with order = pages.length.
    // Seeded in a single transaction — 1,455 individually-committed inserts is
    // a benchmark of sqlite3's fsync, not of the code under test.
    const real = await insert({ order: 0, created: '2026-02-17 18:48:17' });
    await run('BEGIN');
    for (let i = 0; i < 1454; i++) {
      await insert({ order: i % 2 === 0 ? 0 : i, created: '2026-07-26 06:01:40' });
    }
    await run('COMMIT');

    expect(await countDuplicateRoutePages(db)).toBe(1454);
    const res = await ensureWidgetLayoutRouteUniqueness(db, { log() {} });
    expect(res.deleted).toBe(1454);
    expect(await survivingPageIds()).toEqual([real]);
  }, 30000);
});
