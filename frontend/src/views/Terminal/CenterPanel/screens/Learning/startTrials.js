/**
 * Start one trial per finding, one at a time, so each gets its own trial and undo. A refusal for
 * one tool (not enough baseline, a trial already running) never stops the others; an abort does.
 */
export async function startTrials(findings, start, reasonFor = (error) => error?.message || 'It was refused.') {
  const refused = [];
  let started = 0;
  for (const finding of findings) {
    try {
      await start(finding);
      started++;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      refused.push({ capability: finding.capability, reason: reasonFor(error) });
    }
  }
  return { started, refused };
}

/** What to tell the person when some trials did not start; '' when every one did. */
export function refusedSentence({ started, refused }) {
  if (!refused.length) return '';
  const lead = started ? `${started} of ${started + refused.length} trials started.` : 'No trial started.';
  return [lead, ...refused.map((r) => `${r.capability}: ${r.reason}`)].join(' ');
}
