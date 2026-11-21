/**
 * "Annie can use Gmail, Slack, Calendar and 6 more": the apps line on the
 * chat's start screen. Pure: names in, one sentence fragment out.
 */
export function appsSentence(names = [], shown = 3) {
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!list.length) return '';
  if (list.length <= shown + 1) {
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  }
  return `${list.slice(0, shown).join(', ')} and ${list.length - shown} more`;
}
