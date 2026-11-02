import { it, expect, afterEach } from 'vitest';
import db, { dbReady } from '../../../models/database/index.js';
import DatabaseOperation from './database-operation.js';
import { withToolActor } from '../../../services/security/toolRunAuthority.js';
import { closeIsolatedUserData } from '../../../services/security/isolatedUserData.js';

// A teamspace's database step writes to its own isolated file; the instance database never sees the row.
const instanceRows = (owner) => new Promise((resolve, reject) => db.all('SELECT id FROM user_data WHERE user_id = ?', [owner], (e, rows) => (e ? reject(e) : resolve(rows))));
afterEach(() => closeIsolatedUserData());

it("a teamspace's virtual table lives in its isolated store, not the instance database", async () => {
  await dbReady;
  const engine = { userId: 'scope:isolation-test-workspace' };
  const inserted = await withToolActor('owner-1', () => DatabaseOperation.execute({ operation: 'INSERT', tableName: 'leads', columns: 'name,score', values: "'Ada',7" }, {}, engine));
  expect(inserted).toMatchObject({ success: true, affectedRows: 1 });
  const selected = await DatabaseOperation.execute({ operation: 'SELECT', tableName: 'leads', columns: 'name,score' }, {}, engine);
  expect(selected.success).toBe(true);
  expect(selected.result.map((row) => [row.name, Number(row.score)])).toEqual([['Ada', 7]]);
  expect(await instanceRows('scope:isolation-test-workspace')).toEqual([]);
});
