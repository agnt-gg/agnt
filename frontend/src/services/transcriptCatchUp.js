/**
 * Bring a chat this client holds up to date with the copy the server saved,
 * after the client was away (screen off, tab frozen, socket dropped).
 *
 * The server writes turns no client watched: a sub-chat reporting back into
 * the Main chat, a texted turn. It saves them by re-projecting the whole
 * conversation from its provider log, with fresh message ids, so the two
 * copies cannot be merged by id. They are compared by TURNS instead:
 *
 *   - adopt the server copy when it holds a report turn, or more of the
 *     user's own turns, that this client lacks;
 *   - keep the turns this client holds that the server copy does not: from
 *     the first user turn after the last one both share, to the end (a
 *     message typed here, or a whole turn sent before catching up);
 *   - otherwise leave this client's copy alone, so an up-to-date chat is not
 *     re-rendered from a projection on every wake.
 *
 * The report-turn rule is the server's own (backend utils/reportTurns.js), so
 * this client and the save guard agree on what a report is.
 */
import { reportTurnKey } from '../../../backend/src/utils/reportTurns.js';
import { WIRE_PREAMBLE } from '../../../backend/src/utils/compactedTranscript.js';
import { stripServerUserPrefixes } from './chatStreamReducer.js';

// OrchestratorService puts uploaded files' paths and text IN FRONT of the
// user's message; what the user sent is the end of the stored text.
const ATTACHED_FILES = '[ATTACHED FILES]';

const normalize = (text) => (typeof text === 'string' ? stripServerUserPrefixes(text) : '').replace(/\s+/g, ' ').trim();

/** A user turn's identity: a report key, the user's normalized words, or null (server-internal). */
function turnKey(message) {
  if (message?.role !== 'user') return null;
  const report = reportTurnKey(message.content);
  if (report) return { report: true, text: report };
  const text = normalize(message.content);
  if (!text || text.startsWith('[System: ') || text.startsWith(WIRE_PREAMBLE)) return null;
  return { report: false, text };
}

/** Is the stored turn `theirs` the same turn as this client's `mine`? */
function sameTurn(theirs, mine) {
  if (theirs.report !== mine.report) return false;
  if (theirs.text === mine.text) return true;
  return !theirs.report && theirs.text.startsWith(ATTACHED_FILES) && theirs.text.endsWith(` ${mine.text}`);
}

const turnsOf = (messages) => messages.map(turnKey).filter(Boolean);
const covers = (turns, key) => turns.some((other) => sameTurn(other, key));
const coveredBy = (turns, key) => turns.some((other) => sameTurn(key, other));

/** Where the turns the server copy does not hold begin in `local`, or local.length. */
function firstUncoveredTurn(local, storedTurns) {
  const keys = local.map(turnKey);
  let lastCovered = -1;
  keys.forEach((key, i) => { if (key && covers(storedTurns, key)) lastCovered = i; });
  for (let i = lastCovered + 1; i < local.length; i += 1) {
    if (keys[i] && !covers(storedTurns, keys[i])) return i;
  }
  return local.length;
}

/**
 * The transcript to show after catching up, or null to keep `local` as it is.
 *
 * @param {Array} local   what this client holds
 * @param {Array} stored  the server's saved copy
 */
export function catchUpTranscript(local, stored) {
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const mine = Array.isArray(local) ? local : [];
  const storedTurns = turnsOf(stored);
  const start = firstUncoveredTurn(mine, storedTurns);
  const pending = mine.slice(start);
  const syncedTurns = turnsOf(mine.slice(0, start));

  const missedReport = storedTurns.some((key) => key.report && !coveredBy(syncedTurns, key));
  const storedOwn = storedTurns.filter((key) => !key.report);
  const syncedOwn = syncedTurns.filter((key) => !key.report);
  const missedTurn = storedOwn.length > syncedOwn.length && storedOwn.some((key) => !coveredBy(syncedOwn, key));

  if (!missedReport && !missedTurn) return null;
  return [...stored, ...pending];
}

export default catchUpTranscript;
