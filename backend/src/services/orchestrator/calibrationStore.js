import db from '../../models/database/index.js';

/**
 * Remembers, per provider+model, how much larger a real request is than our
 * estimate of it.
 *
 * WHY THIS EXISTS
 * ---------------
 * manageContext already learns a correction ratio from provider-reported usage
 * (updateEstimateCalibration), but it lived only on the in-memory conversation
 * context. Every new conversation therefore started at 1.0 and had to
 * rediscover the same number from scratch, so the first turns of every chat
 * under-reported their true size.
 *
 * That relearning was pure waste, because the number is a property of the
 * PROVIDER, not of the conversation. Measured over 400 single-request
 * executions from the live database (2026-07-28):
 *
 *   provider/model                fixed overhead   spread(p10..p90)
 *   openai/gpt-4o                        57,455              1%
 *   groq/llama-3.3-70b-versatile         69,248              1%
 *   openai/gpt-4.1-mini                  28,146              2%
 *   Claude-Code/claude-opus-5           253,909            121%
 *   Kimi-Code/k3                        385,102            134%
 *
 * Metered API providers land within 1-2% of AGNT's own system+tools surface,
 * which means the estimator itself is accurate. The CLI/OAuth-backed providers
 * (Claude Code, Codex, Kimi, Antigravity) carry 2-6x that, because those
 * backends inject their own preamble and built-in tool definitions into every
 * request. AGNT never receives those bytes, so NO chars-per-token constant can
 * ever account for them — the only way to know is to measure the response and
 * remember it.
 *
 * Hence: learn it once, reuse it everywhere, keep refining it. Nothing is
 * hardcoded, so the day a provider changes its preamble the number follows on
 * its own.
 */

// A ratio is only meaningful once a few rounds agree; below this the panel
// keeps showing raw estimates rather than trusting one noisy sample.
const MIN_SAMPLES_TO_TRUST = 3;

// Same clamp updateEstimateCalibration uses, applied again at the persistence
// boundary so a corrupt row can never widen the budget or collapse it.
const MIN_RATIO = 0.5;
const MAX_RATIO = 3;

// Write-behind: rounds fire several times a turn and this is presentation-grade
// data, never worth blocking a response on.
const FLUSH_INTERVAL_MS = 30_000;

/** provider|model -> { ratio, samples, dirty } */
const cache = new Map();
let loaded = false;
let flushTimer = null;

const key = (provider, model) => `${String(provider || '').toLowerCase()}|${String(model || '').toLowerCase()}`;

/**
 * Load the whole table once. It is tiny (one row per provider+model the user
 * has actually used) and every lookup afterwards is synchronous, which matters
 * because it sits on the request path.
 */
export function loadCalibrations() {
  if (loaded) return Promise.resolve();
  loaded = true;
  return new Promise((resolve) => {
    db.all('SELECT provider, model, ratio, samples FROM estimate_calibration', [], (err, rows) => {
      if (err) {
        // Never let a calibration problem break chat: an unseeded ratio is the
        // old behaviour, which is merely less accurate.
        console.warn('[Calibration] load failed, continuing uncalibrated:', err.message);
        return resolve();
      }
      for (const r of rows || []) {
        const ratio = Number(r.ratio);
        if (!Number.isFinite(ratio)) continue;
        cache.set(key(r.provider, r.model), {
          ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)),
          samples: Number(r.samples) || 0,
          dirty: false,
        });
      }
      resolve();
    });
  });
}

/**
 * The learned starting ratio for a provider+model.
 * @returns {number|null} null when nothing trustworthy has been learned yet —
 *          deliberately not 1, so callers can tell "no data" from "no drift".
 */
export function getCalibration(provider, model) {
  const hit = cache.get(key(provider, model));
  if (!hit || hit.samples < MIN_SAMPLES_TO_TRUST) return null;
  return hit.ratio;
}

/** Everything learned so far, for diagnostics and the settings surface. */
export function listCalibrations() {
  return [...cache.entries()].map(([k, v]) => {
    const [provider, model] = k.split('|');
    return { provider, model, ratio: v.ratio, samples: v.samples };
  });
}

/**
 * Fold one observed ratio into the stored value.
 *
 * The observation is always real/RAW-estimate — the raw estimate never has the
 * calibration applied to it — so seeding a conversation from this store cannot
 * feed back into the number it learns. That independence is what makes the
 * whole scheme stable rather than self-amplifying.
 *
 * Weight decays as samples accumulate (1/n, floored at 0.1) so the value
 * settles instead of chasing the most recent turn, but never freezes: a
 * genuine provider change still moves it.
 */
export function recordCalibration(provider, model, ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return;
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
  const k = key(provider, model);
  const prev = cache.get(k);

  if (!prev) {
    cache.set(k, { ratio: clamped, samples: 1, dirty: true });
  } else {
    const w = Math.max(0.1, 1 / (prev.samples + 1));
    cache.set(k, {
      ratio: prev.ratio * (1 - w) + clamped * w,
      samples: prev.samples + 1,
      dirty: true,
    });
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCalibrations();
  }, FLUSH_INTERVAL_MS);
  // Never hold the process open for a statistics write.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/** Persist dirty rows. Safe to call at any time; a failure is logged, not thrown. */
export function flushCalibrations() {
  const dirty = [...cache.entries()].filter(([, v]) => v.dirty);
  if (!dirty.length) return Promise.resolve(0);

  return new Promise((resolve) => {
    const stmt = db.prepare(
      `INSERT INTO estimate_calibration (provider, model, ratio, samples, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(provider, model) DO UPDATE SET
         ratio = excluded.ratio,
         samples = excluded.samples,
         updated_at = CURRENT_TIMESTAMP`
    );
    let pending = dirty.length;
    for (const [k, v] of dirty) {
      const [provider, model] = k.split('|');
      stmt.run([provider, model, v.ratio, v.samples], (err) => {
        if (err) console.warn('[Calibration] persist failed:', err.message);
        else v.dirty = false;
        if (--pending === 0) stmt.finalize(() => resolve(dirty.length));
      });
    }
  });
}

/** Test seam. */
export function __resetCalibrationCache() {
  cache.clear();
  loaded = false;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
