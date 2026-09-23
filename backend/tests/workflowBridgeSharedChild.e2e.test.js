/**
 * PR145 approval B item 32 — AR-1 repair validation: the REAL bridge fork path
 * in test mode. No child_process mocking here.
 *
 * What this proves (and the broken staged bytes could not):
 *   1. PARSE — importing the bridge executes its module body (the staged file
 *      died at collection with a duplicate-binding SyntaxError).
 *   2. FORK — test-mode spawn() hands the child the shared-store descriptor
 *      (validated bookkeeping + ppid lease) and a `--import` preload instead
 *      of ambient env authority (F7-A).
 *   3. ADOPTION + SHARING — the real WorkflowProcess.js child boots with the
 *      PARENT-INITIALIZED schema: READY arrives only after the child's
 *      dbReady settles, and FETCH_WORKFLOW_STATE answers successfully on a
 *      workflow that does not exist. ProcessManager reads the `workflows`
 *      table for that — a table that exists ONLY because THIS process created
 *      it in the shared root. A child on any other root answers sqlite's
 *      "no such table" as a rejected reply; a child with no adopted context
 *      fails its database import entirely and never sends READY.
 *   4. LIFECYCLE — shutdown() exits the child cleanly (lease released).
 *
 * Production-mode compatibility of the unchanged production branch is covered
 * by the existing mocked suites WorkflowProcessBridge.{lifecycle,startStop,
 * unavailable}.test.js (verify-only, must stay green).
 */
import { describe, expect, it } from 'vitest';
import bridge from '../src/workflow/WorkflowProcessBridge.js';
import { getStorageContext } from '../src/utils/testStorageContext.js';

describe('WorkflowProcessBridge — real shared synthetic child (F7-A, AR-1 repair)', () => {
  it(
    'test-mode spawn() boots the real WorkflowProcess child on the parent-shared synthetic store',
    async () => {
      // The parent's admitted context is the shared store the descriptor will
      // name. Importing the database module here ensures the schema exists in
      // THAT root before the child is forked (the child runs with
      // AGNT_SKIP_DB_INIT=1 and trusts this process to own schema init).
      getStorageContext(); // validate the parent admission that names the shared store
      const dbMod = await import('../src/models/database/index.js');
      await dbMod.dbReady;
      const db = dbMod.default;
      const tables = await new Promise((resolve, reject) =>
        db.all(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'",
          (err, rows) => (err ? reject(err) : resolve(rows))
        )
      );
      expect(tables).toHaveLength(1); // parent-initialized schema in the shared root

      // Real fork. Resolves only on the child's READY (its dbReady settled on
      // the adopted shared store) — rejects after 30s otherwise.
      await bridge.spawn();

      // Sharing proof: successful reply to a DB-backed query for a workflow
      // that does not exist. Resolution itself is the proof — a child on a
      // different root rejects with the sqlite error instead.
      const state = await bridge.sendMessage(
        'FETCH_WORKFLOW_STATE',
        { workflowId: 'wf-pr145-bridge-proof', userId: 'user-pr145-bridge-proof' },
        60000
      );
      expect(state).toBeTruthy();
      expect(typeof state).toBe('object');
      expect(state.status).toBe('Not Found'); // missing workflow, PRESENT table (sharing proof)

      // The child is alive and connected until shutdown, then exits.
      const child = bridge.workflowProcess;
      expect(child).toBeTruthy();
      expect(child.connected).toBe(true);
      await bridge.shutdown();
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const t = setTimeout(resolve, 15000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
      expect(child.exitCode).toBe(0); // graceful SHUTDOWN round-trip
    },
    180_000
  );
});
