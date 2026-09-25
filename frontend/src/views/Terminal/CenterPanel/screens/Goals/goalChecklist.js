/**
 * The checklist a reviewer signs off against: the evaluator's checked items
 * when the goal has been evaluated, otherwise the plan's items, unchecked.
 * The server owns normalisation (backend services/goal/goalChecklist.js); this
 * only reads what it stored, falling back the same way for older goals.
 */
export function reviewChecklist(goal) {
  const evaluation = goal?.evaluation;
  const data = evaluation?.evaluation_data || evaluation?.evaluationData || null;
  const checked = Array.isArray(data?.checklist) ? data.checklist.filter((item) => item && item.text) : [];
  if (checked.length) {
    return {
      evaluated: true,
      met: checked.filter((item) => item.met === true).length,
      items: checked.map((item, index) => ({ id: item.id || `c${index + 1}`, text: item.text, met: item.met ?? null, evidence: item.evidence || '' })),
    };
  }
  const criteria = goal?.success_criteria && typeof goal.success_criteria === 'object' ? goal.success_criteria : {};
  const planned = Array.isArray(criteria.checklist) && criteria.checklist.length
    ? criteria.checklist
    : [...(criteria.deliverables || []), ...(criteria.qualityChecks || [])];
  const seen = new Set();
  const items = [];
  for (const entry of planned) {
    const text = String(typeof entry === 'object' && entry ? entry.text : entry ?? '').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    items.push({ id: `c${items.length + 1}`, text, met: null, evidence: '' });
  }
  return { evaluated: false, met: 0, items: items.slice(0, 10) };
}
