/**
 * widget_layouts duplicate-page repair + structural guarantee.
 *
 * THE BUG (diagnosed and fixed 2026-07-26)
 * ────────────────────────────────────────
 * CanvasScreen.vue called ensurePageForScreen() synchronously on mount, before
 * fetchLayouts() had resolved. At that moment the Vuex `pages` array is EMPTY —
 * it is never hydrated from localStorage, despite a stale comment claiming it
 * was — so the "does a page already exist for this route?" lookup could not
 * distinguish "no page exists" from "pages not loaded yet". It always answered
 * "no", minted a fresh page and POSTed it to /api/layouts. The GET that was
 * already in flight then returned and replaced `pages` wholesale, orphaning the
 * row that had just been written. One leaked row per cold start, forever.
 *
 * The frontend fix (never CREATE before layouts are known) stops the bleeding.
 * This module is the other half: it heals the rows already written, and then
 * makes a recurrence structurally impossible with a partial UNIQUE index — so
 * no future caller, however it is written, can create a second page for a route.
 *
 * SURVIVOR SELECTION IS NOT ARBITRARY.
 * LayoutService.getAllLayouts serves `ORDER BY page_order ASC, created_at ASC`,
 * and the frontend resolves a route with `pages.find(p => p.route === route)` —
 * i.e. the FIRST row in that order. The dedupe keeps exactly that row, so the
 * page a user sees before the repair is the page they see after it.
 *
 * Rows with `route IS NULL` are user-created custom pages. They carry no route
 * identity, are never produced by this bug, and are never touched.
 */

const UNIQUE_INDEX = 'idx_widget_layouts_user_route';

/** Promise wrappers for sqlite3's callback API. */
const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const get = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

/**
 * Delete every widget_layouts row that is NOT the winner for its
 * (user_id, route) pair.
 *
 * Written without window functions or DELETE..USING so it runs on every SQLite
 * build AGNT ships against. Reads as: "delete this row if a better row exists
 * for the same user and route", where 'better' is the exact ordering the API
 * serves. `IS` (not `=`) compares user_id so legacy NULL-owner rows group
 * together instead of every NULL being distinct.
 *
 * @returns {Promise<number>} rows removed
 */
export async function deleteDuplicateRoutePages(db) {
  const res = await run(
    db,
    `DELETE FROM widget_layouts
      WHERE route IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM widget_layouts AS better
           WHERE better.route   =  widget_layouts.route
             AND better.user_id IS widget_layouts.user_id
             AND (
                    better.page_order <  widget_layouts.page_order
                 OR (better.page_order =  widget_layouts.page_order
                     AND better.created_at <  widget_layouts.created_at)
                 OR (better.page_order =  widget_layouts.page_order
                     AND better.created_at =  widget_layouts.created_at
                     AND better.rowid     <  widget_layouts.rowid)
                 )
        )`,
  );
  return res.changes || 0;
}

/** How many route rows are currently duplicated (diagnostics / tests). */
export async function countDuplicateRoutePages(db) {
  const row = await get(
    db,
    `SELECT COALESCE(SUM(n - 1), 0) AS extra
       FROM (SELECT COUNT(*) AS n
               FROM widget_layouts
              WHERE route IS NOT NULL
              GROUP BY user_id, route)`,
  );
  return row?.extra || 0;
}

/**
 * Heal, then guarantee. Idempotent and safe to run on every boot.
 *
 * Strategy: attempt the UNIQUE index FIRST. On a healthy database that succeeds
 * (or is a no-op via IF NOT EXISTS) and costs a single indexed pass — we never
 * pay for the O(n²) repair scan on a normal startup. Only when SQLite rejects
 * the index because the data is not unique do we run the repair and retry.
 *
 * Any failure here is non-fatal to boot: a database that cannot be deduped is
 * still a perfectly usable database with a cosmetic page-list problem.
 */
export async function ensureWidgetLayoutRouteUniqueness(db, logger = console) {
  const createIndex = () =>
    run(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
         ON widget_layouts(user_id, route)
       WHERE route IS NOT NULL`,
    );

  try {
    await createIndex();
    return { deleted: 0, indexed: true, repaired: false };
  } catch (err) {
    // Only a uniqueness violation means "there are duplicates to clean".
    // Anything else (missing table, disk error) is a real failure.
    if (!/not unique|UNIQUE constraint/i.test(err?.message || '')) throw err;
  }

  const deleted = await deleteDuplicateRoutePages(db);
  await createIndex();

  if (deleted > 0) {
    logger?.log?.(
      `✓ widget_layouts: removed ${deleted} duplicate route page(s); (user_id, route) is now unique`,
    );
  }
  return { deleted, indexed: true, repaired: true };
}

export const WIDGET_LAYOUT_ROUTE_INDEX = UNIQUE_INDEX;
