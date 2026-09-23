// PR145 Stage C (STAGED COPY — not applied) — child-side worker used by
// childLifecycle.test.js. Not a test file: node --test only collects
// *.test.js, and the root vitest config excludes tests/unit/**.
//
// Modes (argv[2]):
//   shared — expects AGNT_SYNTHETIC_CHILD_STORE (adopted via --import preload);
//            reads marker A, writes marker B through its OWN adopted context +
//            real sqlite, prints the resolution proof.
//   own    — no descriptor; self-admits a fresh root FIRST (R01 direct entry),
//            then reports whether the parent's marker table is visible and
//            where its own write landed.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sqlite3 from 'sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const fromRepo = (p) => import(pathToFileURL(path.join(here, '../../..', p)).href);
const mode = process.argv[2] || 'shared';

// Import the context module first (it has no PathManager dependency), admit if
// this is a self-provisioning child, and only THEN import PathManager — whose
// module-eval singleton resolution is exactly the F7-A probe under test.
const ctxMod = await fromRepo('backend/src/utils/testStorageContext.js');
if (mode === 'own') ctxMod.initializeTestStorage();
const pathManager = (await fromRepo('backend/src/utils/PathManager.js')).default;
const ctx = ctxMod.getStorageContext();
const dbFile = pathManager.getDataDir() + '/agnt.db';
const db = new sqlite3.Database(dbFile);

const q = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

if (mode === 'shared') {
  await q(`CREATE TABLE IF NOT EXISTS markers (k TEXT PRIMARY KEY, v TEXT)`);
  const a = await q(`SELECT v FROM markers WHERE k='A'`);
  if (!a.length || a[0].v !== 'from-parent') throw new Error('child could not read parent marker A');
  await q(`INSERT OR REPLACE INTO markers (k, v) VALUES ('B','from-child')`);
  db.close();
  console.log(JSON.stringify({
    ok: true, mode, root: ctx.root, bootRole: ctx.bootRole,
    sharedRoot: ctx.sharedStore?.root ?? null,
    dataDir: pathManager.getDataDir(), markerA: a[0].v,
  }));
} else {
  const rows = await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='markers'`).catch(() => []);
  if (rows.length) await q(`INSERT OR REPLACE INTO markers (k, v) VALUES ('SIBLING','unrelated-child')`).catch(() => {});
  db.close();
  console.log(JSON.stringify({
    ok: true, mode, root: ctx.root, bootRole: ctx.bootRole,
    sharedStore: ctx.sharedStore, seesMarkerTable: rows.length > 0,
    dataDir: pathManager.getDataDir(),
  }));
}
