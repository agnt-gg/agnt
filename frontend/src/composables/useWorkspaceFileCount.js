import { ref } from 'vue';
import { getTree } from '@/services/fileSystemService.js';

/**
 * How many entries the Files list shows at the top of your workspace, for the
 * counts beside "My files" and the Library's Files tab. One listing, shared:
 * a call within a minute of the last reuses it, concurrent calls share one
 * request, and the Files pages report the count whenever they list the top
 * folder, so an upload or delete shows at once. Null until known.
 */
const FRESH_MS = 60_000;
const count = ref(null);
let loadedAt = 0;
let inflight = null;

/** The Files pages call this after listing the top folder. */
export function reportWorkspaceRootCount(entries) {
  if (!Array.isArray(entries)) return;
  count.value = entries.length;
  loadedAt = Date.now();
}

async function load({ force = false } = {}) {
  if (!force && count.value !== null && Date.now() - loadedAt < FRESH_MS) return count.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const body = await getTree('');
      reportWorkspaceRootCount(body?.items || []);
    } catch (error) {
      console.warn('[files] could not count the workspace:', error?.message || error);
    } finally {
      inflight = null;
    }
    return count.value;
  })();
  return inflight;
}

export function useWorkspaceFileCount() {
  return { count, load };
}

/** Test seam: forget the shared count. */
export function _resetWorkspaceFileCount() {
  count.value = null;
  loadedAt = 0;
  inflight = null;
}
