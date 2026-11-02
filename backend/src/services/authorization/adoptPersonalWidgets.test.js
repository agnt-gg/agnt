import { it, expect } from 'vitest';
import db, { dbReady } from '../../models/database/index.js';
import { databaseRepository, ensureSharedScope } from './ScopeRepository.js';
import { adoptPersonalWidgets } from './adoptPersonalWidgets.js';
import { migrateOwnership } from './OwnershipMigration.js';
import { installOwnershipTriggers } from './OwnershipTriggers.js';
import { OWNERSHIP_INVENTORY } from './OwnershipInventory.js';

// bravo retest #2: cw_dea6a39e0933 was made from a teammate's chat before the shared library, saved under the
// person; list_widgets showed it, /widget-definitions (team library) never did. Real schema and triggers here.
it("moves a person's widgets into the team library: same id, team owner, team scope, content intact", async () => {
  await dbReady;
  const repo = databaseRepository(db);
  // The instance schema: scoped tables and the ownership triggers that make owner and scope immutable.
  await migrateOwnership(repo); await installOwnershipTriggers(repo, OWNERSHIP_INVENTORY);
  const person = 'adopt-test-member-' + Date.now();
  await repo.run('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)', [person, 'Member']);
  await repo.run("INSERT INTO widget_definitions (id,user_id,name,source_code) VALUES (?,?,?,?)", ['cw_adopt_' + person, person, 'Legacy', '<p>legacy</p>']);
  const before = await repo.get('SELECT scope_id FROM widget_definitions WHERE id=?', ['cw_adopt_' + person]);
  const team = await ensureSharedScope(repo, 'adopt-test-team', 'adopt-test-ws');

  expect(await adoptPersonalWidgets(repo, person, team.resourceOwnerId)).toBe(1);
  const after = await repo.get('SELECT user_id, scope_id, name, source_code FROM widget_definitions WHERE id=?', ['cw_adopt_' + person]);
  expect(after).toEqual({ user_id: team.resourceOwnerId, scope_id: 'workspace:adopt-test-ws', name: 'Legacy', source_code: '<p>legacy</p>' });
  expect(after.scope_id).not.toBe(before.scope_id);
  expect(await adoptPersonalWidgets(repo, person, team.resourceOwnerId)).toBe(0); // idempotent
  await repo.run('DELETE FROM widget_definitions WHERE id=?', ['cw_adopt_' + person]);
});
