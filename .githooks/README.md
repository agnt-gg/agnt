# .githooks

Tracked git hooks. Install once per clone:

```sh
npm run hooks:install     # or: git config core.hooksPath .githooks
```

`postinstall` runs this too, so a normal `npm install` is enough.

## commit-msg

Two scripts run in order:

| Script | Role |
| --- | --- |
| `commit-msg-reflow.mjs` | Pre-pass. Rewraps an over-long body in place. Never fails a commit. |
| `commit-msg-lint.mjs` | Decides. Rejects a message that would still read as truncated. |

The rules the linter enforces:

| Rule | Why |
| --- | --- |
| Subject ≤ 72 chars | GitHub's commit list truncates past 72 and appends an ellipsis. The tail is not shown anywhere you browse history. |
| Line 2 blank | Without it git treats the whole message as one subject. |
| Body lines ≤ 72 chars | `git log` indents the body by 4 and never re-wraps. 72 + 4 = 76, inside an 80-column terminal. |

Exempt, because wrapping them is impossible or destructive: lines indented two
or more spaces (pasted code, logs, diffs), `Trailer-Name:` lines, and a line
that is one unbreakable token such as a URL. `Merge`, `Revert`, `fixup!`,
`squash!` and `amend!` subjects are skipped entirely.

### Over-long bodies are reflowed, not rejected

The pre-pass rewraps the body at 72 columns and lets the commit through, so a
paragraph that arrives as one enormous line is repaired rather than bounced
back at you:

```
commit-msg: reflowed the body to 72 columns (1 line(s) in, 3 out, longest was 166).
```

It edits only the message region. The `# Please enter the commit message`
block, the `# ------------------------ >8 ------------------------` scissors
line and the `--verbose` diff below it, trailers, preformatted blocks and CRLF
line endings all survive byte-for-byte. Running it twice changes nothing the
second time.

It declines to touch the file at all — leaving the linter to report the
problem — in every shape where reflowing could lose information:

| Shape | Why it is left alone |
| --- | --- |
| A body line starting with `#` | git stores it (see below), so dropping it would delete something you wrote. |
| Line 2 is not blank | The body is read as `lines.slice(2)`, so line 2 would be silently discarded. |
| A comment interleaved with body text | Not a shape it understands. Guessing is worse than declining. |
| `Merge`, `Revert`, `fixup!`, `squash!`, `amend!` | Exempt from the rules entirely. |
| The reflow would not fix the body, or introduces a new problem | Being unable to help is fine; making it worse is not. |

The pre-pass never exits non-zero. If it throws it prints `commit-msg: reflow
skipped (...)` and the linter runs anyway, so it can never be the reason a
commit fails.

### When it still rejects you

An over-long **subject** is never rewritten automatically — that is a decision
about what the commit says, not about formatting. A subject states one thing:
move the qualifying clause, the part after the comma or the dash, into the
body.

For a shape the pre-pass declined, edit the file the linter names and commit
it as-is:

```sh
git commit -F .git/COMMIT_EDITMSG
```

### Why the hook does not call `commit-msg-lint.mjs --fix`

`--fix` is safe on a scratch file you wrote yourself, and destructive on a real
`.git/COMMIT_EDITMSG`. It writes back `reflowBody(parseMessage(raw))`, and
`parseMessage` deliberately reduces the file to *the message git will actually
store* — `.split(SCISSORS)[0]` and `.filter(l => !l.startsWith('#'))`. That is
correct for linting and wrong for rewriting. Measured against a realistic
commit-msg file, `--fix`:

- deletes the `# Please enter the commit message...` block
- deletes the `# ---- >8 ----` scissors line and the `--verbose` diff
- deletes line 2 entirely when line 2 is not blank, because the body is
  taken as `lines.slice(2)`
- deletes any body line beginning with `#`

The last two are silent data loss rather than cosmetics. The `#` case is not
hypothetical: git's default cleanup is `strip` only when the message is
*edited*, and `whitespace` otherwise, so with `-F` or `-m` a body line such as
`#123 is the upstream issue` is stored verbatim in the commit today.

`commit-msg-reflow.mjs` exists to get the same repair without those four
losses. Its behaviour — including every refusal above — is covered by
`scripts/commitMsgReflow.test.js`.

### Write bodies with `-F`, not `-m`

`git commit -m "<paragraph>"` cannot contain a newline on Windows, so every
`-m` body arrives as one enormous line. In this repo's history that is exactly
what happened: every message authored with `-F` measures 72-80 columns, every
one authored with `-m` measures 190-660.

The pre-pass now repairs that automatically, so `-m` no longer blocks a
commit. `-F` is still the better habit: you choose where the paragraph breaks
fall, and anything structured — several paragraphs, a bullet list, a trailer
block — survives exactly as you wrote it instead of being rewrapped.

Bypass in an emergency with `git commit --no-verify`.
