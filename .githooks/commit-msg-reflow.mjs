#!/usr/bin/env node
/**
 * Reflow an over-long commit BODY in place, so the hook fixes what it can
 * mechanically fix instead of rejecting the commit and making a human do it.
 *
 * This runs BEFORE commit-msg-lint.mjs and never decides anything. It exits 0
 * unconditionally; the linter remains the sole authority on whether a commit
 * is allowed. If this script cannot help, it changes nothing and the linter
 * prints its usual diagnostic.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST CALL `commit-msg-lint.mjs --fix`
 * ---------------------------------------------------------------------------
 * Because `--fix` writes back `reflowBody(parseMessage(raw))`, and
 * `parseMessage` deliberately reduces the file to "the message git will
 * actually store" — it drops every `#` line and everything past the scissors.
 * That is correct for LINTING and destructive for REWRITING. Measured against
 * the real implementation on 2026-08-24, `--fix` on a commit-msg file:
 *
 *   - deletes the `# Please enter the commit message...` block
 *   - deletes the `# ---- >8 ----` scissors line and the --verbose diff
 *   - deletes line 2 entirely when line 2 is not blank, because reflowBody
 *     takes the body as `lines.slice(2)`
 *   - deletes any body line beginning with `#`
 *
 * The last two are silent data loss rather than cosmetics. The `#` case is not
 * theoretical: git's default cleanup is `strip` only when the message is
 * edited, and `whitespace` otherwise, so with `-F`/`-m` a body line starting
 * with `#` is stored verbatim in the commit today. Verified 2026-08-24 on git
 * 2.55.0 — a `#123 is the upstream issue` line survives into `git log`.
 *
 * So this script reflows the message region ONLY, preserves the comment block,
 * the scissors and the diff byte-for-byte, and refuses to act at all in the
 * shapes where reflowing would lose information.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 * The subject is never rewritten. An over-long subject is a statement that
 * says two things, and choosing which one to keep is editorial. The linter
 * still rejects it, with the diagnostic that shows exactly which tail GitHub
 * would hide.
 *
 * Usage:  node .githooks/commit-msg-reflow.mjs <msgfile>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { reflowBody, lintCommitMessage } from './commit-msg-lint.mjs';

const SCISSORS_LINE = /^# -+ >8 -+$/;
const BODY_PROBLEM = /body line\(s\) exceed/;
const BLOCKING_SHAPE = /^(Line 2 must be blank|Empty subject line)/;

/** Index of the trailing run of `#` lines, or -1. Only a run that reaches the
 *  end of the region counts: an interleaved comment is not a trailing block. */
function trailingCommentStart(lines) {
  let i = lines.length;
  while (i > 0) {
    const line = lines[i - 1];
    if (line.startsWith('#') || !line.trim()) i -= 1;
    else break;
  }
  while (i < lines.length && !lines[i].startsWith('#')) i += 1;
  return i < lines.length ? i : -1;
}

function main() {
  const file = process.argv[2];
  if (!file) return;

  const raw = readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const all = raw.split(/\r?\n/);

  // Everything from the scissors line on is preserved untouched.
  const cut = all.findIndex((l) => SCISSORS_LINE.test(l));
  const head = cut === -1 ? all : all.slice(0, cut);
  const tail = cut === -1 ? [] : all.slice(cut);

  // The trailing `# Please enter...` block is preserved untouched too.
  const commentAt = trailingCommentStart(head);
  const content = commentAt === -1 ? head.slice() : head.slice(0, commentAt);
  const comments = commentAt === -1 ? [] : head.slice(commentAt);

  // Preserve the exact blank-line separator that was already there.
  let blanks = 0;
  while (content.length && !content[content.length - 1].trim()) {
    content.pop();
    blanks += 1;
  }

  // A comment among the real content means the shape is not one this script
  // understands. Leave it alone rather than guess.
  if (content.some((l) => l.startsWith('#'))) return;
  // Subject only, or subject + blank: nothing to reflow.
  if (content.length < 3) return;
  // Body would be read as `slice(2)`, so a non-blank line 2 would be dropped.
  if (content[1].trim() !== '') return;

  const before = lintCommitMessage(content);
  if (before.skipped) return;
  if (before.problems.some((p) => BLOCKING_SHAPE.test(p))) return;
  if (!before.problems.some((p) => BODY_PROBLEM.test(p))) return;

  const reflowed = reflowBody(content);

  // Only rewrite if this actually resolved the body problem and introduced
  // nothing new. Being unable to help is fine; making it worse is not.
  const after = lintCommitMessage(reflowed);
  if (after.problems.some((p) => BODY_PROBLEM.test(p))) return;
  if (after.problems.length > before.problems.length) return;

  const out = [...reflowed, ...Array(blanks).fill(''), ...comments, ...tail];
  writeFileSync(file, out.join(eol) + (raw.endsWith('\n') ? eol : ''), 'utf8');

  const worst = content.reduce((n, l) => Math.max(n, l.length), 0);
  console.error(
    `commit-msg: reflowed the body to 72 columns `
    + `(${content.length - 2} line(s) in, ${reflowed.length - 2} out, `
    + `longest was ${worst}).`,
  );
}

try {
  main();
} catch (error) {
  // A pre-pass must never be the reason a commit fails. The linter runs next
  // and will report anything genuinely wrong with the message.
  console.error(`commit-msg: reflow skipped (${error.message}).`);
}
