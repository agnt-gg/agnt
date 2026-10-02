/**
 * Browser-storage entries that hold ONE account's conversation content.
 *
 * localStorage belongs to the browser profile, not to whoever is signed in, so
 * anything a chat surface caches there is handed to the next account unless it
 * is removed when the session ends. These are the entries whose contents are
 * that account's own words or runs:
 *
 *   chat drafts        unsent composer text, keyed by conversation
 *   in-flight runs     turns to reattach to on the next load
 *   context status     the last token/context meter per conversation
 *
 * The chat transcript cache itself is owned and cleared by chatUnified's
 * RESET_FOR_SESSION_END, next to the code that writes it.
 *
 * Device preferences (theme, panel widths, provider choice, tutorial flags)
 * are deliberately NOT here: they describe this machine, not an account, and
 * are synced per user by userPreferences where that matters.
 */
import { STORAGE_KEY as CHAT_DRAFTS_KEY } from '@/services/chatDrafts.js';
import { STORAGE_KEY as CONTEXT_STATUS_KEY } from '@/services/contextStatusCache.js';
import { _STORAGE_KEY as INFLIGHT_RUNS_KEY } from '@/services/inflightRuns.js';

export const ACCOUNT_SCOPED_STORAGE_KEYS = Object.freeze([CHAT_DRAFTS_KEY, INFLIGHT_RUNS_KEY, CONTEXT_STATUS_KEY]);

/** Remove every account-scoped entry. Never throws: storage may be unavailable. */
export function clearAccountScopedStorage(storage = globalThis.localStorage) {
  if (!storage) return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn(`[session] could not clear ${key}:`, error?.message || error);
    }
  }
}
