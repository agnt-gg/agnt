/**
 * wakePhrase — "hey annie", stop phrases, and agent routing.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * This is the TEXT layer of wake detection: given a transcript, does it contain
 * a wake phrase, and which target does it address? It is not an acoustic
 * keyword spotter. That distinction matters because it makes the routing logic
 * testable and engine-independent — a future on-device KWS model can replace
 * the acoustic front end without touching a line of this.
 *
 * ROUTING, WHICH IS THE PART THAT BEATS THE OBVIOUS DESIGN
 * --------------------------------------------------------
 * The naive build hardcodes one phrase. Hermes does better with configurable
 * "profiles" — but each is a config entry a human has to write.
 *
 * AGNT already has a library of named agents. So the wake phrase is
 * `hey <name>`, and <name> is matched against that library at match time:
 *
 *     "hey annie"            → the orchestrator
 *     "hey researcher"       → opens a session with the Researcher agent
 *
 * Every agent the user creates becomes wakeable the moment it is created, with
 * zero configuration and zero training. That is a property of the data model,
 * not a feature anyone has to maintain.
 *
 * FUZZY MATCHING, AND WHY IT IS BOUNDED
 * -------------------------------------
 * ASR mishears short names constantly — "annie" comes back as "any", "annie's",
 * "ani", "hey and he". Exact matching makes the wake word feel broken. So we
 * allow edit distance 1 for names of 4+ characters, and exact-only below that
 * (at three characters, distance 1 matches most of the dictionary).
 *
 * STOP PHRASES
 * ------------
 * "stop" must end the session. "stop the docker container" must not. The rule —
 * borrowed from Hermes because it is exactly right — is WHOLE-UTTERANCE match:
 * the stop phrase counts only when it is the entire thing said, modulo filler
 * and politeness. Anything more is a real instruction.
 */

/** Prefixes that can introduce a wake phrase. */
const WAKE_PREFIXES = ['hey', 'hi', 'ok', 'okay', 'yo', 'hello'];

/** Whole-utterance phrases that end a hands-free session. */
export const STOP_PHRASES = Object.freeze([
  'stop', 'stop it', 'never mind', 'nevermind', 'goodbye', 'good bye', 'bye',
  'cancel', "that's all", 'thats all', 'that is all', 'exit', 'quit',
  'shut up', 'be quiet', 'end session', 'stop listening', 'go to sleep',
  'thanks that\'s all', 'we\'re done', 'were done', 'done for now',
]);

/** Politeness/filler tokens ignored when testing for a whole-utterance stop. */
const IGNORABLE = new Set(['please', 'ok', 'okay', 'um', 'uh', 'er', 'hey', 'annie', 'now', 'just', 'yeah', 'well', 'so']);

export const DEFAULT_WAKE_CONFIG = Object.freeze({
  /** The primary assistant name. */
  name: 'annie',
  /** Require a prefix ("hey annie") vs. bare name ("annie"). Bare names fire on
   *  ordinary conversation about the assistant, so this defaults on. */
  requirePrefix: true,
  /** Max Levenshtein distance tolerated for the name token. */
  maxDistance: 1,
  /** Names shorter than this must match exactly. */
  fuzzyMinLength: 4,
  /** Keep this much text after the wake phrase as the first command. Hermes
   *  discards it and re-listens; carrying it means "hey annie, what time is it"
   *  works in one breath. */
  carryCommand: true,
});

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance, early-exit above `max`. */
export function editDistance(a, b, max = Infinity) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** Does `token` name `target`, allowing bounded ASR error? */
export function tokenMatchesName(token, target, config = {}) {
  const cfg = { ...DEFAULT_WAKE_CONFIG, ...config };
  const t = String(token || '').toLowerCase().replace(/'s$/, '');
  const n = String(target || '').toLowerCase();
  if (!t || !n) return false;
  if (t === n) return true;
  if (n.length < cfg.fuzzyMinLength) return false;
  return editDistance(t, n, cfg.maxDistance) <= cfg.maxDistance;
}

/**
 * Look for a wake phrase.
 *
 * @param {string} transcript
 * @param {{ name?:string, agents?:Array<{id:string,name:string}> }} [options]
 * @param {Partial<typeof DEFAULT_WAKE_CONFIG>} [config]
 * @returns {null | { target:'orchestrator'|'agent', agentId?:string, agentName?:string,
 *                    matchedName:string, command:string, index:number }}
 */
export function detectWake(transcript, options = {}, config = {}) {
  const cfg = { ...DEFAULT_WAKE_CONFIG, ...config };
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return null;

  const agents = Array.isArray(options.agents) ? options.agents : [];
  const primary = String(options.name || cfg.name).toLowerCase();

  // Multi-word agent names ("code reviewer") need a window; take the longest
  // match so "hey code reviewer" prefers the agent over a stray "code".
  const candidates = [
    { words: primary.split(/\s+/), target: 'orchestrator', name: primary },
    ...agents
      .filter((a) => a && typeof a.name === 'string' && a.name.trim())
      .map((a) => ({ words: a.name.toLowerCase().trim().split(/\s+/), target: 'agent', id: a.id, name: a.name })),
  ].sort((x, y) => y.words.length - x.words.length);

  for (let i = 0; i < tokens.length; i++) {
    const hasPrefix = WAKE_PREFIXES.includes(tokens[i]);
    const start = hasPrefix ? i + 1 : i;
    if (cfg.requirePrefix && !hasPrefix) continue;
    if (start >= tokens.length) continue;

    for (const cand of candidates) {
      const slice = tokens.slice(start, start + cand.words.length);
      if (slice.length !== cand.words.length) continue;
      const all = slice.every((tok, k) => tokenMatchesName(tok, cand.words[k], cfg));
      if (!all) continue;

      const after = tokens.slice(start + cand.words.length);
      return {
        target: cand.target,
        agentId: cand.id,
        agentName: cand.target === 'agent' ? cand.name : undefined,
        matchedName: cand.name,
        command: cfg.carryCommand ? after.join(' ') : '',
        index: i,
      };
    }
  }

  return null;
}

/**
 * Whole-utterance stop detection.
 *
 * Returns true only when the transcript IS a stop phrase (ignoring politeness),
 * never when it merely contains one. "stop" ends the session; "stop the docker
 * container" is a request and must reach the agent.
 */
export function isStopPhrase(transcript) {
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return false;

  const core = tokens.filter((t) => !IGNORABLE.has(t));
  const joinedCore = core.join(' ');
  const joinedAll = tokens.join(' ');

  for (const phrase of STOP_PHRASES) {
    const p = tokenize(phrase).join(' ');
    if (!p) continue;
    if (joinedAll === p || joinedCore === p) return true;
  }
  return false;
}

/**
 * Remove the wake phrase from a transcript so the command reaches the model
 * clean ("hey annie open the repo" → "open the repo").
 */
export function stripWakePhrase(transcript, match) {
  if (!match) return String(transcript || '').trim();
  if (match.command) return match.command;
  const tokens = tokenize(transcript);
  const nameLen = match.matchedName.split(/\s+/).length;
  return tokens.slice(match.index + 1 + nameLen).join(' ').trim();
}

export default { detectWake, isStopPhrase, stripWakePhrase, tokenMatchesName, editDistance, STOP_PHRASES, DEFAULT_WAKE_CONFIG };
