/**
 * runResume.js — reattach to turns that were still generating when this tab
 * last went away.
 *
 * One call site, every chat surface. The marker written by inflightRuns.js
 * records which store owns each run (a `channelKey` means a sidebar channel in
 * `chatUnified`; its absence means the main orchestrator chat), so a new chat
 * surface gets resume for free as long as it writes a marker.
 *
 * This deliberately does NOT block app startup: each reattach holds an SSE
 * connection open until its run finishes, which can be minutes.
 */

import { listInflightRuns } from './inflightRuns.js';

/**
 * Kick off a reattach for every run left in flight.
 *
 * @param {import('vuex').Store} store
 * @returns {Promise<{attempted: number, resumed: number}>} Settles when every
 *          reattached run has FINISHED, so tests can await it. Callers in app
 *          code should not.
 */
export async function resumeInflightRuns(store) {
  if (!store) return { attempted: 0, resumed: 0 };

  // No credentials means every reattach would 401 and clear markers that a
  // logged-in session could still have used.
  let token = null;
  try {
    token = localStorage.getItem('token');
  } catch {
    /* storage unavailable */
  }
  if (!token) return { attempted: 0, resumed: 0 };

  const runs = listInflightRuns();
  if (runs.length === 0) return { attempted: 0, resumed: 0 };

  console.log(`[runResume] ${runs.length} run(s) were in flight — attempting reattach`);

  const results = await Promise.allSettled(
    runs.map((run) => {
      if (run.channelKey) {
        return store.dispatch('chatUnified/reattachChannel', {
          channelKey: run.channelKey,
          conversationId: run.conversationId,
        });
      }
      return store.dispatch('chat/reattachConversation', run.conversationId);
    }),
  );

  const resumed = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  console.log(`[runResume] Reattached ${resumed}/${runs.length} run(s)`);
  return { attempted: runs.length, resumed };
}

export default resumeInflightRuns;
