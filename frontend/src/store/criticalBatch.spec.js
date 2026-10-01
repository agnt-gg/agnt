import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What `criticalDataReady` waits for.
 *
 * Promise.allSettled waits for its SLOWEST member, so anything in the awaited
 * critical batch sets the floor on when the Dashboard and Agents screens stop
 * showing their loading state. Two members set that floor needlessly:
 *
 *   userStats/fetchStats        a side-panel number; 1.1 GB per call before the
 *                               incremental count, still a network round trip
 *                               to agnt.gg for credits
 *   appAuth/fetchConnectedApps  agnt.gg (5 s timeout) and the CLI probes
 *                               (923 ms cold); neither gated screen reads it
 *
 * Both still load; they just are not waited on. Read from initializeStore's
 * own source, the same way sessionReset.spec.js derives its module list.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = stripComments(fs.readFileSync(path.join(HERE, 'state.js'), 'utf8'));

function awaitedCriticalBatch() {
  const body = src.slice(src.indexOf('async initializeStore('), src.indexOf('async resetUserScopedData('));
  const start = body.indexOf('await Promise.allSettled([');
  expect(start, 'the awaited critical batch is missing').toBeGreaterThan(-1);
  const end = body.indexOf(']);', start);
  return { body, batch: body.slice(start, end) };
}

describe('the critical batch criticalDataReady waits for', () => {
  it('still loads the data the gated screens render', () => {
    const { batch } = awaitedCriticalBatch();
    for (const action of ['agents/fetchAgents', 'workflows/fetchWorkflows', 'contentOutputs/fetchOutputs', 'groups/fetchGroups']) {
      expect(batch, `${action} left the critical batch`).toContain(`'${action}'`);
    }
  });

  it.each(['userStats/fetchStats', 'appAuth/fetchConnectedApps'])('does not wait on %s', (action) => {
    const { batch } = awaitedCriticalBatch();
    expect(batch).not.toContain(`'${action}'`);
  });

  it.each(['userStats/fetchStats', 'appAuth/fetchConnectedApps'])('still loads %s during startup', (action) => {
    const { body } = awaitedCriticalBatch();
    expect(body).toContain(`dispatch('${action}')`);
  });
});
