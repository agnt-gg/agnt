/**
 * Tolerant parsing for ```chartjs config blocks.
 *
 * WHY THIS EXISTS
 * ---------------
 * Chart configs are authored by an LLM, one token at a time. Across a large
 * corpus a small fraction will carry a mechanical defect — a dropped closing
 * brace, one brace too many, a trailing comma, a typographic minus sign. That
 * rate is a property of generation, not a bug we can remove upstream.
 *
 * Measured on this install's history: 1240 unique chart blocks, 10 invalid
 * (0.8%). Every one of the 10 fell into a class that is *mechanically
 * unambiguous* to repair:
 *
 *   5  missing exactly one closing '}'      {"a":{"b":1}
 *   3  one trailing '}' too many            {"a":1}}
 *   1  trailing comma                       [18,1,13,]
 *   1  U+2212 MINUS SIGN used as '-'        [85,−45,31]
 *
 * Before this module a bare JSON.parse turned any of those into a red error
 * box, destroying a chart whose data was fully intact and readable. Repairing
 * them is not leniency for its own sake — it is refusing to discard data over
 * a defect with exactly one possible reading.
 *
 * THE SAFETY CONTRACT
 * -------------------
 * 1. Valid JSON is never touched. parseChartConfig tries a plain JSON.parse
 *    first and only reaches the repair path once that has already failed, so
 *    a well-formed config cannot change meaning.
 * 2. String literals are never modified. Every repair is driven by a single
 *    scanner that knows whether it is inside a string, so a label of
 *    "Q1, 2025" / "a } b" / "http://x" / "NaN" / "−45" survives byte-identical.
 *    This is the property that makes repair safe, and it is the one the tests
 *    press hardest.
 * 3. A repair is only adopted if the repaired text actually parses AND yields
 *    an object. Otherwise the ORIGINAL parse error is thrown, so a failure
 *    reports the real defect rather than a confusing artifact of repair.
 */

import { vizErrorHtml } from './vizError';

const ZERO_WIDTH = new Set(['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);
const SMART_QUOTES = new Set(['\u201C', '\u201D']);
// Characters that only ever mean "minus" when they appear outside a string:
// U+2212 MINUS SIGN, U+2013 EN DASH, U+2014 EM DASH.
const DASHES = new Set(['\u2212', '\u2013', '\u2014']);
const CLOSER_FOR = { '{': '}', '[': ']' };

const isWordChar = (ch) => !!ch && /[A-Za-z0-9_$]/.test(ch);

/**
 * Repair the mechanical defects an LLM introduces into otherwise-JSON text.
 *
 * Single left-to-right pass. Anything inside a string literal is copied
 * verbatim; every rewrite below is reachable only from outside a string.
 *
 * @param {string} src
 * @returns {{ text: string, repairs: string[] }}
 */
export function repairJsonish(src) {
  const out = [];
  const stack = []; // expected closers, innermost last
  const repairs = [];
  const note = (msg) => { if (!repairs.includes(msg)) repairs.push(msg); };

  // Drop whitespace and a trailing comma already written to `out`, so that a
  // closer can be emitted without leaving `[1,2,]` behind.
  const dropTrailingComma = () => {
    let i = out.length - 1;
    while (i >= 0 && /^\s*$/.test(out[i])) i--;
    if (i >= 0 && out[i] === ',') {
      out.splice(i, 1);
      note('removed trailing comma');
    }
  };

  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // ---- string literal: copy verbatim, honouring escapes ----
    if (ch === '"' || SMART_QUOTES.has(ch)) {
      const smartOpen = ch !== '"';
      if (smartOpen) note('normalised smart quotes');
      out.push('"');
      i++;
      while (i < n) {
        const c = src[i];
        if (c === '\\') {
          // Escape sequence — copy both characters untouched.
          out.push(c);
          if (i + 1 < n) out.push(src[i + 1]);
          i += 2;
          continue;
        }
        const closesSmart = smartOpen && SMART_QUOTES.has(c);
        if (c === '"' || closesSmart) {
          out.push('"');
          i++;
          break;
        }
        out.push(c);
        i++;
      }
      continue;
    }

    // ---- comments ----
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      note('removed comment');
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      note('removed comment');
      continue;
    }

    // ---- invisible characters ----
    if (ZERO_WIDTH.has(ch)) {
      i++;
      note('removed zero-width character');
      continue;
    }

    // ---- typographic dash used as a minus sign ----
    if (DASHES.has(ch)) {
      // -Infinity must be rewritten as a unit, never as '-' + 'null'.
      if (/^Infinity/.test(src.slice(i + 1)) && !isWordChar(src[i + 9])) {
        out.push('null');
        i += 9;
        note('replaced Infinity with null');
        continue;
      }
      out.push('-');
      i++;
      note('replaced typographic dash with "-"');
      continue;
    }

    // ---- non-finite / undefined literals ----
    if (ch === '-' && /^Infinity/.test(src.slice(i + 1)) && !isWordChar(src[i + 9])) {
      out.push('null');
      i += 9;
      note('replaced Infinity with null');
      continue;
    }
    if (!isWordChar(out[out.length - 1])) {
      const rest = src.slice(i);
      const word = /^(NaN|Infinity|undefined)/.exec(rest);
      if (word && !isWordChar(src[i + word[1].length])) {
        out.push('null');
        i += word[1].length;
        note(`replaced ${word[1]} with null`);
        continue;
      }
    }

    // ---- structural delimiters ----
    if (ch === '{' || ch === '[') {
      stack.push(CLOSER_FOR[ch]);
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      dropTrailingComma();

      // Close any inner containers the author forgot to close, e.g. {"a":[1}
      while (stack.length && stack[stack.length - 1] !== ch) {
        out.push(stack.pop());
        note('closed unterminated container');
      }

      if (!stack.length) {
        // The root value already closed; this closer is surplus.
        i++;
        note('removed extra closing bracket');
        continue;
      }

      stack.pop();
      out.push(ch);
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  // ---- unterminated containers at EOF ----
  if (stack.length) {
    dropTrailingComma();
    while (stack.length) out.push(stack.pop());
    note('added missing closing bracket');
  }

  return { text: out.join(''), repairs };
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse a ```chartjs block into a Chart.js config, repairing mechanical
 * defects when — and only when — the repair is unambiguous.
 *
 * @param {string} raw
 * @returns {{ config: object, repairs: string[] }}
 * @throws {SyntaxError} when the config cannot be recovered.
 */
export function parseChartConfig(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new SyntaxError('Chart config is empty');

  let originalErr;
  try {
    const config = JSON.parse(text);
    if (isPlainObject(config)) return { config, repairs: [] };
    throw new SyntaxError('Chart config must be a JSON object');
  } catch (err) {
    originalErr = err;
  }

  let repaired;
  try {
    repaired = repairJsonish(text);
  } catch {
    throw originalErr;
  }
  if (!repaired.repairs.length || repaired.text === text) throw originalErr;

  let config;
  try {
    config = JSON.parse(repaired.text);
  } catch {
    throw originalErr;
  }
  if (!isPlainObject(config)) throw originalErr;

  return { config, repairs: repaired.repairs };
}

/**
 * Failure markup for a config that could not be recovered. The source is shown
 * alongside the error so the data is never lost to a rendering failure.
 */
export function chartErrorHtml(message, source) {
  return vizErrorHtml('Chart Render Failed', message, source);
}
