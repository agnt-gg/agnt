# .githooks

Tracked git hooks. Install once per clone:

```sh
npm run hooks:install     # or: git config core.hooksPath .githooks
```

`postinstall` runs this too, so a normal `npm install` is enough.

## commit-msg

Refuses a commit message that would read as truncated:

| Rule | Why |
| --- | --- |
| Subject ≤ 72 chars | GitHub's commit list truncates past 72 and appends an ellipsis. The tail is not shown anywhere you browse history. |
| Line 2 blank | Without it git treats the whole message as one subject. |
| Body lines ≤ 72 chars | `git log` indents the body by 4 and never re-wraps. 72 + 4 = 76, inside an 80-column terminal. |

Exempt, because wrapping them is impossible or destructive: lines indented two
or more spaces (pasted code, logs, diffs), `Trailer-Name:` lines, and a line
that is one unbreakable token such as a URL. `Merge`, `Revert`, `fixup!`,
`squash!` and `amend!` subjects are skipped entirely.

### When it rejects you

```sh
node .githooks/commit-msg-lint.mjs --fix .git/COMMIT_EDITMSG   # rewrap body at 72
git commit -F .git/COMMIT_EDITMSG
```

The subject is never rewritten automatically — that is a decision about what
the commit says, not about formatting.

### Write bodies with `-F`, not `-m`

`git commit -m "<paragraph>"` cannot contain a newline on Windows, so every
`-m` body arrives as one enormous line. In this repo's history that is exactly
what happened: every message authored with `-F` measures 72-80 columns, every
one authored with `-m` measures 190-660.

Bypass in an emergency with `git commit --no-verify`.
