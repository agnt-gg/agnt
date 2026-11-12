// learningFormat — the words and numbers the Learning board and its right
// panel both print. One definition, so the list card and its receipt can
// never describe the same trial differently.

export const title = (capability, kind) => `${capability || 'Operation'} · ${String(kind || 'outcome').replaceAll('_', ' ')}`;

export const date = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

export const percent = (value) => (value == null ? 'Unknown' : Math.round(value * 100) + '%');

export const daysLeft = (value) => Math.max(0, Math.ceil((value - Date.now()) / 86400000)) + ' days to review';

export const trialProgress = (trial) =>
  Math.max(0, Math.min(100, (100 * (Date.now() - trial.started_at)) / (trial.review_due_at - trial.started_at)));

// What each error kind (learningContract.errorKind) usually means, and why it repeats.
const WHY = Object.freeze({
  timeout: 'The calls waited too long for an answer. Timeouts like this are usually passing trouble, so one more try often succeeds.',
  unavailable: 'The service was briefly unreachable: a dropped connection or a 5xx answer. That is usually passing trouble, so one more try often succeeds.',
  rate_limit: 'The service said too many requests. Trying again at once makes it worse; it needs slower calls or a higher limit.',
  authentication: 'The sign-in was rejected. Trying again cannot fix that; the connection needs signing in again.',
  permission: 'The call was not allowed. Trying again cannot fix that; it needs a permission change.',
  missing_resource: 'What the call asked for was not there: a file, page or record. Trying again finds the same nothing.',
  invalid_input: 'The tool rejected the input it was called with. The fix is in how it is called, not in trying again.',
  other: 'These failures do not match a known pattern yet.',
});
const KIND_WORD = Object.freeze({ timeout: 'timed out', unavailable: 'could not reach its service', rate_limit: 'hit a rate limit', authentication: 'had its sign-in rejected', permission: 'was not allowed', missing_resource: 'did not find what it asked for', invalid_input: 'rejected its input', other: 'failed' });
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * A recurring problem on one page: what happened, why it keeps happening, what would be tried,
 * and how a trial decides whether it worked. The trial terms are the coordinator's own
 * (7 days, 20 known calls, a fall of at least 10 points with clearly separate ranges).
 */
export function onePage(finding = {}) {
  const kind = finding.error_kind || 'other';
  const happened = `${finding.capability || 'A tool'} ${KIND_WORD[kind] || 'failed'} ${plural(finding.occurrences || 0, 'time')} across ${plural(finding.independent_runs || 0, 'separate run')}.`;
  const tryText = finding.candidate
    ? `Try ${finding.capability} once more after ${kind === 'timeout' ? 'a timeout' : 'it cannot reach its service'}. It only reads, so a second try cannot change anything.`
    : 'Nothing yet. The only change that can be tried on its own is one more try of a read-only tool after passing trouble (a timeout or an unreachable service).';
  const know = finding.candidate
    ? 'A 7-day trial compares the failure rate on these calls before and after. It counts as working only if failures fall by at least 10 points and the ranges clearly separate, with at least 20 known calls on each side. Undo any time.'
    : 'There is no trial to run until a supported change exists.';
  return { happened, why: WHY[kind] || WHY.other, tryText, know };
}

/**
 * Other tools with the problem an active policy solved: the same error kind, a supported change,
 * and nothing already being tested. Each would get its own trial and undo.
 */
export function sameProblemElsewhere(policy, findings = []) {
  if (!policy) return [];
  return findings
    .filter((f) => f.state === 'detected' && f.candidate && f.candidate_hash && f.error_kind === policy.error_kind && f.capability !== policy.capability)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0));
}

export const verdictLabel = (value) =>
  ({ supported: 'Improvement observed', regressed: 'Regression observed', inconclusive: 'Not enough evidence', no_clear_benefit: 'No clear benefit' })[value] ||
  'Review pending';
