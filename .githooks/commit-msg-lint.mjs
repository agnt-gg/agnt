#!/usr/bin/env node
/**
 * Reject commit messages that will READ as truncated.
 *
 * Nothing here is about storage. Git stores every byte of a message faithfully;
 * these messages get cut off on the way OUT, two separate ways:
 *
 *   1. SUBJECT OVER 72 CHARS. GitHub's commit LIST view hard-truncates the
 *      subject at 72 and appends an ellipsis, so the tail is not shown anywhere
 *      you browse history. Measured on this repo, 2026-08-23: four of the last
 *      ten subjects were 73/75/78/81 chars, and the invisible tails were
 *      "g", "ter", "d name" and " one file".
 *
 *   2. BODY LINES OVER 72 CHARS. `git log` indents the body by four spaces and
 *      never re-wraps it, so a paragraph authored as one long line runs off the
 *      right edge of every terminal. Same sample: body lines of 660, 581, 507
 *      and 498 characters.
 *
 * Defect 2 has a mechanical cause worth naming, because knowing it makes the
 * fix obvious. `git commit -m "<paragraph>"` on Windows cannot contain a
 * literal newline — cmd.exe has no way to put one in an argument — so each -m
 * becomes exactly one enormous line. The signature is perfectly bimodal in the
 * history: every message authored with `-F` measures 72-80 columns, every one
 * authored with `-m` measures 190-660. Author bodies with `-F <file>`.
 *
 * Hand-wrapping is not sufficient either. Wrapping at 76-77 looks fine in an
 * editor and still overflows, because `git log`'s four-space indent puts it at
 * 80-81 columns and an 80-column terminal folds the tail into one-word orphans.
 * Hence 72, which is the width the convention picked for exactly this reason.
 *
 * Usage:
 *   node .githooks/commit-msg-lint.mjs <msgfile>          lint; exit 1 on failure
 *   node .githooks/commit-msg-lint.mjs --fix <msgfile>    reflow body to 72 in place
 *
 * Installed as the `commit-msg` hook by `node .githooks/install.mjs`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** GitHub truncates the subject past this. Hard failure. */
export const SUBJECT_MAX = 72;
/** git's own convention. Advisory note only — plenty of good subjects run over. */
export const SUBJECT_IDEAL = 50;
/** `git log` indents by 4; 72 + 4 = 76, comfortably inside an 80-col terminal. */
export const BODY_MAX = 72;

/** `git commit --verbose` appends a diff below this marker. Not part of the message. */
const SCISSORS = /^# -+ >8 -+$/m;

/**
 * Subjects git generates or that carry a required exact form. Rewriting them
 * loses information a tool depends on (`Merge branch 'x'`, `fixup! <subject>`),
 * so they are exempt rather than merely tolerated.
 */
const GENERATED_SUBJECT = /^(?:Merge\b|Revert "|fixup!|squash!|amend!)/;

/** `Co-authored-by: ...`, `Signed-off-by: ...`, `Fixes: ...` — one per line, never wrapped. */
const TRAILER = /^[A-Za-z][A-Za-z-]*: \S/;

/** A list item, so its continuation lines can be given a hanging indent. */
const BULLET = /^(\s*(?:[-*\u2022]|\d+[.)])\s+)/;

/** Two or more leading spaces: pasted code, log output, a diff. Verbatim by intent. */
const PREFORMATTED = /^\s{2,}\S/;

/**
 * Strip comments and the verbose diff, and trim trailing blank lines — i.e.
 * reduce the raw file to the message git will actually store.
 */
export function parseMessage(raw) {
  const lines = raw
    .split(SCISSORS)[0]
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/**
 * True when wrapping this line at BODY_MAX is impossible or would destroy
 * meaning. Being wrong in the permissive direction costs a long line; being
 * wrong in the strict direction blocks a legitimate commit, so the three cases
 * here are deliberately narrow.
 */
export function isExempt(line) {
  if (PREFORMATTED.test(line)) return true;
  if (TRAILER.test(line)) return true;
  // A single unbreakable token — a URL, a path, a hash. No wrap point exists.
  const head = line.slice(0, BODY_MAX + 1).trim();
  if (head && !/\s/.test(head)) return true;
  return false;
}

/**
 * @returns {{problems: string[], notes: string[], skipped: boolean}}
 *   `problems` block the commit, `notes` are printed and ignored.
 */
export function lintCommitMessage(lines) {
  const problems = [];
  const notes = [];
  const subject = lines[0] ?? '';

  if (!subject.trim()) {
    return { problems: ['Empty subject line.'], notes, skipped: false };
  }
  if (GENERATED_SUBJECT.test(subject)) {
    return { problems, notes, skipped: true };
  }

  if (subject.length > SUBJECT_MAX) {
    problems.push(
      `Subject is ${subject.length} chars (max ${SUBJECT_MAX}).\n`
      + `    GitHub's commit list will show:\n`
      + `      "${subject.slice(0, SUBJECT_MAX)}\u2026"\n`
      + `    and silently drop:\n`
      + `      "${subject.slice(SUBJECT_MAX)}"\n`
      + `    A subject states one thing. Move the qualifying clause - the part\n`
      + `    after the comma or the dash - into the body.`,
    );
  } else if (subject.length > SUBJECT_IDEAL) {
    notes.push(`Subject is ${subject.length} chars; ${SUBJECT_IDEAL} is the convention.`);
  }

  if (subject.endsWith('.')) {
    notes.push('Subject ends with a period.');
  }

  if (lines.length > 1 && lines[1].trim() !== '') {
    problems.push(
      'Line 2 must be blank. Without it git treats the whole message as one\n'
      + '    subject, and every reader shows the body text inline.',
    );
  }

  const long = [];
  for (let i = 2; i < lines.length; i += 1) {
    if (lines[i].length > BODY_MAX && !isExempt(lines[i])) {
      long.push({ number: i + 1, length: lines[i].length });
    }
  }
  if (long.length) {
    const worst = long.reduce((a, b) => (b.length > a.length ? b : a));
    problems.push(
      `${long.length} body line(s) exceed ${BODY_MAX} chars (worst: line `
      + `${worst.number}, ${worst.length} chars).\n`
      + `    \`git log\` indents the body by 4 and never re-wraps, so these run\n`
      + `    off the terminal and read as cut off. A ${worst.length}-char line is the\n`
      + `    signature of \`git commit -m\` from cmd.exe, which cannot embed a\n`
      + `    newline in an argument.`,
    );
  }

  return { problems, notes, skipped: false };
}

/**
 * Reflow one paragraph to `width`, giving list items a hanging indent so the
 * continuation lines sit under the text rather than under the bullet.
 */
export function wrapParagraph(text, width = BODY_MAX) {
  const marker = (text.match(BULLET) ?? text.match(/^\s*/))[0];
  const hang = ' '.repeat(marker.length);
  const words = text.slice(marker.length).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [text.trimEnd()];

  const out = [];
  let line = marker + words[0];
  for (let i = 1; i < words.length; i += 1) {
    // An over-long first word has no wrap point; emit it and carry on.
    if (line.length + 1 + words[i].length > width) {
      out.push(line);
      line = hang + words[i];
    } else {
      line += ` ${words[i]}`;
    }
  }
  out.push(line);
  return out;
}

/**
 * Rewrap the body at BODY_MAX. The subject is never touched — it cannot be
 * reflowed, only rewritten, and that is a judgement about what the commit says.
 */
export function reflowBody(lines) {
  const subject = lines[0];
  const body = lines.slice(2);
  if (!body.length) return [subject];

  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(...wrapParagraph(paragraph.join(' ')));
    paragraph = [];
  };

  for (const line of body) {
    if (!line.trim()) { flush(); out.push(''); continue; }
    // Preformatted blocks and trailers survive byte-for-byte.
    if (PREFORMATTED.test(line) || TRAILER.test(line)) { flush(); out.push(line); continue; }
    if (BULLET.test(line)) { flush(); paragraph = [line]; continue; }
    paragraph.push(line);
  }
  flush();

  while (out.length && !out[out.length - 1].trim()) out.pop();
  return [subject, '', ...out];
}

export function formatReport({ problems, notes }, file) {
  const lines = [];
  for (const note of notes) lines.push(`commit-msg: note: ${note}`);
  if (!problems.length) return lines.join('\n');

  lines.push('');
  lines.push('commit-msg: REJECTED - this message would read as truncated.');
  lines.push('');
  for (const problem of problems) lines.push(`  - ${problem}`);
  lines.push('');
  lines.push(`  Your message is still at: ${file}`);
  lines.push('  Reflow the body:          node .githooks/commit-msg-lint.mjs --fix '
    + `"${file}"`);
  lines.push(`  Then commit it:           git commit -F "${file}"`);
  lines.push('');
  return lines.join('\n');
}

/* c8 ignore start — CLI wiring, exercised by the hook itself and by the live tests. */
// pathToFileURL, not string surgery: it is the only thing that agrees with
// import.meta.url on a Windows drive-letter path.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const fix = process.argv[2] === '--fix';
  const file = fix ? process.argv[3] : process.argv[2];

  if (!file) {
    console.error('usage: commit-msg-lint.mjs [--fix] <msgfile>');
    process.exit(2);
  }

  const parsed = parseMessage(readFileSync(file, 'utf8'));

  if (fix) {
    const reflowed = `${reflowBody(parsed).join('\n')}\n`;
    writeFileSync(file, reflowed, 'utf8');
    console.log(`Reflowed ${file} to ${BODY_MAX} columns.`);
    const after = lintCommitMessage(parseMessage(reflowed));
    if (after.problems.length) {
      console.error(formatReport(after, file));
      process.exit(1);
    }
    process.exit(0);
  }

  const result = lintCommitMessage(parsed);
  if (result.skipped) process.exit(0);
  const report = formatReport(result, file);
  if (report) console.error(report);
  process.exit(result.problems.length ? 1 : 0);
}
/* c8 ignore stop */
