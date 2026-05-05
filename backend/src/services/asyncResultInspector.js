/**
 * Async Result Inspector
 *
 * Inspects an async tool result (single or periodic) and reports whether the
 * inner business-logic operation actually succeeded.
 *
 * The async system has two layers of status:
 *   - Outer: did the worker run to completion (status: completed/failed)?
 *   - Inner: did the operation itself succeed (result.success === true)?
 *
 * Outer = "completed" can wrap an inner failure (ENOENT, EPERM, validation
 * error, API error). Without inspecting the inner layer, downstream consumers
 * (counters, autonomous-message banners) wrongly treat completed-with-error
 * as success.
 *
 * Used by:
 *   - AsyncToolQueue.getStats() — businessFailed counter
 *   - AutonomousMessageService.triggerToolCompletion() — banner + directive
 */

function safeParseJson(s) {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Inspect an async tool result.
 *
 * @param {*} result - whatever the tool / queue produced. May be a JSON string,
 *   a plain object, a periodic result wrapper, or null/undefined.
 * @returns {{ ok: boolean, errorSummary: string|null, unknown: boolean }}
 *   - ok=true: no detectable inner failure
 *   - ok=false: the operation reported failure; errorSummary describes it
 *   - unknown=true: we couldn't determine a verdict (null / undefined /
 *     unparseable string / non-object). ok defaults to true in this case so
 *     existing callers reading only `.ok` keep their current behavior;
 *     callers that want a neutral state (e.g. a third banner type) can
 *     branch on `.unknown`.
 *
 * Defaulting unknown to ok=true is a deliberate choice: most tools return
 * well-formed JSON and the few that return unusual shapes are typically
 * successful — flipping the default would degrade those to a warning banner.
 */
export function inspectAsyncResult(result) {
  if (result === null || result === undefined) {
    return { ok: true, errorSummary: null, unknown: true };
  }

  let inner = result;
  if (typeof result === 'string') {
    inner = safeParseJson(result);
    if (inner === null) return { ok: true, errorSummary: null, unknown: true };
  }
  if (typeof inner !== 'object') {
    return { ok: true, errorSummary: null, unknown: true };
  }

  // Periodic execution wrapper: inspect every iteration.
  if (inner.periodicExecution && Array.isArray(inner.results)) {
    const failedIterations = [];
    for (const it of inner.results) {
      if (it && it.error) {
        failedIterations.push(it.iteration);
        continue;
      }
      let itInner = it && it.result;
      if (typeof itInner === 'string') itInner = safeParseJson(itInner);
      if (itInner && typeof itInner === 'object' && itInner.success === false) {
        failedIterations.push(it.iteration);
      }
    }
    if (failedIterations.length === 0) {
      return { ok: true, errorSummary: null, unknown: false };
    }
    return {
      ok: false,
      errorSummary: `${failedIterations.length} of ${inner.results.length} iteration(s) failed (iterations: ${failedIterations.join(', ')})`,
      unknown: false,
    };
  }

  // Single execution.
  if (inner.success === false) {
    return { ok: false, errorSummary: inner.error || 'Operation failed', unknown: false };
  }

  return { ok: true, errorSummary: null, unknown: false };
}

export default inspectAsyncResult;
