// Executed by scripts/nodeTestDataIsolation.contract.test.js under `node --test`.
// Not a *.test.js file, so no runner discovers it on its own.
//
// Fails if PathManager — the resolver every backend module uses for user data —
// resolves to the directory the parent passed in as the "real" user data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const pathManager = (await import('../../backend/src/utils/PathManager.js')).default;

test('backend user data resolves to a throwaway directory', () => {
  const realRoot = path.resolve(process.env.PROBE_REAL_USER_DATA);
  const resolved = path.resolve(pathManager.getPath('last-models.json'));
  assert.ok(!resolved.startsWith(realRoot + path.sep), `resolved into real user data: ${resolved}`);
});
