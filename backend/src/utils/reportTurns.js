/**
 * Sub-chat report turns: the user-role messages the server writes into a
 * parent chat when a sub-chat hands its work back (subChatReports.js).
 *
 * They are the turns a client can miss: the server runs them with no client
 * attached, so a browser that was asleep holds a transcript without them. The
 * save path uses this to refuse a write that would erase them.
 */
const REPORT_HEAD = /^\[System: (?:Sub-chat (?:finished|needs your input)|\d+ sub-chats finished)/;
const LEADING_TURN_MARKER = /^\[(?:TEXT MESSAGE|VOICE) TURN\]\s*/;
const KEY_CHARS = 300;

/** A comparable key for a report turn, or null when `content` is not one. */
export function reportTurnKey(content) {
  if (typeof content !== 'string') return null;
  const body = content.trimStart().replace(LEADING_TURN_MARKER, '');
  if (!REPORT_HEAD.test(body)) return null;
  return body.replace(/\s+/g, ' ').trim().slice(0, KEY_CHARS);
}

/**
 * Report turns present in `storedReports` but absent from the `incoming`
 * transcript payload. Returns [] when the payload cannot be read: an unreadable
 * payload is not judged as missing anything.
 */
export function missingReportTurns(incomingContent, storedReports) {
  const wanted = (storedReports || []).map(reportTurnKey).filter(Boolean);
  if (!wanted.length) return [];
  let messages;
  try {
    const parsed = JSON.parse(incomingContent);
    messages = Array.isArray(parsed) ? parsed : parsed?.messages;
  } catch {
    return [];
  }
  if (!Array.isArray(messages)) return [];
  const present = new Set(messages.filter((m) => m?.role === 'user').map((m) => reportTurnKey(m.content)).filter(Boolean));
  return wanted.filter((key) => !present.has(key));
}
