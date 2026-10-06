// learningFormat — the words and numbers the Learning board and its right
// panel both print. One definition, so the list card and its receipt can
// never describe the same trial differently.

export const title = (capability, kind) => `${capability || 'Operation'} · ${String(kind || 'outcome').replaceAll('_', ' ')}`;

export const date = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

export const percent = (value) => (value == null ? 'Unknown' : Math.round(value * 100) + '%');

export const daysLeft = (value) => Math.max(0, Math.ceil((value - Date.now()) / 86400000)) + ' days to review';

export const trialProgress = (trial) =>
  Math.max(0, Math.min(100, (100 * (Date.now() - trial.started_at)) / (trial.review_due_at - trial.started_at)));

export const verdictLabel = (value) =>
  ({ supported: 'Improvement observed', regressed: 'Regression observed', inconclusive: 'Not enough evidence', no_clear_benefit: 'No clear benefit' })[value] ||
  'Review pending';
