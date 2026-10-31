import { it, expect } from 'vitest';
import { inspectOwnershipInventory } from './OwnershipInventory.js';
it('classifies instance plugin policy and the route-authorized approval queue on restart', async () => {
  const repository = { all: async sql => sql.includes('sqlite_master') ? [{name:'plugin_install_requests'}, {name:'plugin_install_policy'}] : [] };
  const result = await inspectOwnershipInventory(repository);
  expect(result.ready).toBe(true);
  expect(result.tables.map(t=>t.kind)).toEqual(['system','system']);
});
