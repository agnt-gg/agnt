/**
 * Web search: on this computer first, search.agnt.gg when it cannot.
 *
 * Every web search (the `web_search` chat tool and the Web Search workflow node) goes through
 * `searchWeb`. It answers from, in order:
 *
 *   cache  — the same query in the last few hours, whichever engine answered it;
 *   local  — Google in an invisible Chrome on this computer (localSearch.js), when this is a
 *            desktop with Chrome, the connection has budget left (searchBudget.js) and Google
 *            has not refused it recently;
 *   cloud  — search.agnt.gg, exactly as before, metered against the plan's allowance.
 *
 * A local search that fails for any reason falls through to the cloud, so the caller sees a
 * result or the cloud's own error, never a local failure. A refusal from Google additionally
 * pauses local search and wipes the search profile. The plan gate applies to every engine:
 * local search does not make web search free for an account that does not include it.
 *
 * The response is the hosted service's, plus `engine`: which of the three answered.
 *
 * AGNT_LOCAL_SEARCH=0 turns local search off (cloud only).
 */
import PathManager from '../../utils/PathManager.js';
import { getBestChromePath } from '../../utils/chrome-detector.js';
import { isContainerRuntime } from '../browserRuntime.js';
import { callService, serviceAllowed, proRequired, hostedInstanceSlug } from '../agntServices.js';
import { createSearchBudget, cacheKey } from './searchBudget.js';

export const MAX_RESULTS = 10;

// The Chrome lookup walks the disk and logs every call; once found, it stays found.
let chromeFound = false;
const hasChrome = () => (chromeFound ||= Boolean(getBestChromePath()));

/** Why this process never searches locally, or null if it may. */
export function localSearchUnavailableReason() {
  if (process.env.AGNT_LOCAL_SEARCH === '0') return 'disabled';
  // A hosted instance or a container is a shared server address, not someone's home connection.
  if (hostedInstanceSlug()) return 'hosted_instance';
  if (isContainerRuntime()) return 'container';
  if (!hasChrome()) return 'no_chrome';
  return null;
}

function defaultEngines() {
  return {
    async local(input) {
      const { searchLocally } = await import('./localSearch.js');
      return searchLocally(input);
    },
    async resetLocal() {
      const { resetSearchProfile } = await import('./localSearch.js');
      return resetSearchProfile();
    },
    // search.agnt.gg reads the count from `num` (alias `numResults`) and ignores unknown fields,
    // so any other name silently falls back to its default of 5.
    cloud: ({ query, count }) => callService('search', '/search', { method: 'POST', idempotent: true, body: { query, num: count } }),
    allowed: () => serviceAllowed('search'),
    unavailableReason: localSearchUnavailableReason,
  };
}

let defaultBudget = null;
const budgetFor = () => (defaultBudget ??= createSearchBudget({ statePath: PathManager.getDataPath('search-state.json') }));

/**
 * @param {{ query: string, count?: number }} input
 * @param {{ engines?: object, budget?: object }} [deps]  for tests
 * @returns {Promise<{ success: true, query: string, results: Array<{title,link,snippet,source}>, resultsCount: number, engine: 'cache'|'local'|'cloud', usage?: object }>}
 * @throws ServiceError from the cloud engine or the plan gate; callers turn it into serviceFailure()
 */
export async function searchWeb({ query, count = 5 }, { engines = defaultEngines(), budget = budgetFor() } = {}) {
  const text = String(query ?? '').trim();
  if (!text) throw new Error('Search query is required.');
  const wanted = Math.max(1, Math.min(MAX_RESULTS, Number.parseInt(count, 10) || 5));
  if (!(await engines.allowed())) throw proRequired('search');

  const answer = (results, engine, usage) => ({
    success: true, query: text, results, resultsCount: results.length, engine, ...(usage ? { usage } : {}),
  });

  const key = cacheKey(text, wanted);
  const cached = budget.cached(key);
  if (cached) return answer(cached, 'cache');

  const unavailable = engines.unavailableReason();
  if (!unavailable) {
    const reservation = budget.take();
    if (reservation.ok) {
      const local = await engines.local({ query: text, count: wanted }).catch((error) => ({ status: 'error', error: error.message }));
      if (local.status === 'ok') {
        budget.remember(key, local.results);
        return answer(local.results, 'local');
      }
      if (local.status === 'blocked') {
        const until = budget.recordBlock();
        console.warn(`[search] Google refused a local search; local search paused until ${new Date(until).toISOString()}, using search.agnt.gg`);
        await engines.resetLocal().catch(() => {});
      } else {
        console.warn(`[search] local search failed (${local.error || local.status}); using search.agnt.gg`);
      }
    }
  }

  const data = await engines.cloud({ query: text, count: wanted });
  const results = data.results || [];
  if (results.length) budget.remember(key, results);
  return answer(results, 'cloud', data.usage);
}
