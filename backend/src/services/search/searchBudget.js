/**
 * How much local searching this computer's connection can take, and what it already knows.
 *
 * Local search spends the USER's IP address. Google rations each address; when it decides an
 * address is a bot, every search from it, the user's own browsing included, gets a captcha.
 * Measured: ~55 searches in ~30 minutes from one home address tripped it. So local search runs
 * well under that and backs off hard on the first refusal, and anything over budget goes to the
 * cloud service instead of waiting.
 *
 *  - rate: a bucket of BURST searches, refilled one per REFILL_MS (20 per 10 minutes);
 *  - day: at most DAILY_CAP local searches per calendar day;
 *  - breaker: a refusal pauses local search for 1 h, the next 6 h, then 24 h each time, until
 *    a full day passes after a pause ends with no refusal, which starts it over at 1 h;
 *  - cache: a repeated query within CACHE_TTL_MS is answered from memory, from any engine.
 *
 * The breaker and the day count survive a restart (a restart must not reset a cooldown). They
 * are stored without any query text; the cache lives in memory only.
 */
import fs from 'fs';
import path from 'path';

export const BUDGET = Object.freeze({
  BURST: 5,
  REFILL_MS: 30_000,
  DAILY_CAP: 300,
  COOLDOWNS_MS: [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000],
  STRIKE_WINDOW_MS: 24 * 60 * 60_000,
  CACHE_TTL_MS: 6 * 60 * 60_000,
  CACHE_MAX: 500,
});

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function cacheKey(query, count) {
  return `${String(query).trim().replace(/\s+/g, ' ').toLowerCase()}\u0000${count}`;
}

/**
 * @param {{ statePath?: string|null, now?: () => number }} options  statePath null keeps state in memory
 */
export function createSearchBudget({ statePath = null, now = Date.now } = {}) {
  let state = { blockedUntil: 0, strikes: 0, day: dayOf(now()), dayCount: 0 };
  if (statePath) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      for (const key of Object.keys(state)) if (typeof saved[key] === typeof state[key]) state[key] = saved[key];
    } catch { /* first run, or unreadable: start fresh */ }
  }
  let tokens = BUDGET.BURST;
  let refilledAt = now();
  const cache = new Map();

  function save() {
    if (!statePath) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state));
    } catch (error) {
      console.warn('[search] could not save local search state:', error.message);
    }
  }

  function refill() {
    const at = now();
    const earned = Math.floor((at - refilledAt) / BUDGET.REFILL_MS);
    if (earned > 0) {
      tokens = Math.min(BUDGET.BURST, tokens + earned);
      refilledAt = tokens === BUDGET.BURST ? at : refilledAt + earned * BUDGET.REFILL_MS;
    }
    const today = dayOf(at);
    if (state.day !== today) {
      state.day = today;
      state.dayCount = 0;
    }
  }

  return {
    /**
     * Reserves one local search if the connection can take it.
     * @returns {{ ok: true } | { ok: false, reason: 'cooling_down'|'rate_limited'|'daily_cap', retryAt?: number }}
     */
    take() {
      refill();
      if (now() < state.blockedUntil) return { ok: false, reason: 'cooling_down', retryAt: state.blockedUntil };
      if (state.dayCount >= BUDGET.DAILY_CAP) return { ok: false, reason: 'daily_cap' };
      if (tokens < 1) return { ok: false, reason: 'rate_limited', retryAt: refilledAt + BUDGET.REFILL_MS };
      tokens -= 1;
      state.dayCount += 1;
      save();
      return { ok: true };
    },

    /**
     * Google refused a search: pause local search. The window is counted from the END of the
     * previous pause: a refusal straight after a 24 h pause means the address is still flagged,
     * so it must not drop back to 1 h.
     */
    recordBlock() {
      const at = now();
      state.strikes = state.strikes > 0 && at - state.blockedUntil < BUDGET.STRIKE_WINDOW_MS ? state.strikes + 1 : 1;
      const cooldown = BUDGET.COOLDOWNS_MS[Math.min(state.strikes, BUDGET.COOLDOWNS_MS.length) - 1];
      state.blockedUntil = at + cooldown;
      save();
      return state.blockedUntil;
    },

    cached(key) {
      const entry = cache.get(key);
      if (!entry) return null;
      if (now() - entry.at > BUDGET.CACHE_TTL_MS) {
        cache.delete(key);
        return null;
      }
      return entry.value;
    },

    remember(key, value) {
      cache.delete(key);
      cache.set(key, { at: now(), value });
      if (cache.size > BUDGET.CACHE_MAX) cache.delete(cache.keys().next().value);
    },

    /** For tests and diagnostics. */
    snapshot: () => ({ ...state, tokens, cached: cache.size }),
  };
}
