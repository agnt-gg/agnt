# PR-aware worktree lifecycle planning

Tracking/design: [issue #123](https://github.com/agnt-gg/agnt/issues/123).

## Design: plan first, never guess that a checkout is disposable

Keep one canonical worktree per active PR. Start independent changes from fresh
upstream main, reuse that worktree for revisions, and keep durable evidence
outside it. Keep local main free of feature work. Updating main does not mean
rebasing every open PR: update a PR base when conflicts, dependencies or CI
require it. After a merge, inspect and retire the finished work instead of
rebasing it.

GitHub deleting a remote branch, `fetch.prune`, and `git worktree prune` do not
remove local branches and existing worktree directories. A clean worktree can
still contain ignored evidence, serve a live process, or supply dependencies to
another worktree. A squash/rebase merge may not preserve local ancestry.

This phase adds **read-only planning** to the existing `npm run wt` entry point.
It does not implement a scheduler, cleanup hook, deletion executor, automatic
rebase, main update, process killer or permission escalation. No plan is a
capability token. `authorized: false` means the planner grants no authorization;
it does not revoke a human's separately recorded approval.

## Commands

Requirements: Node 20+, Git supporting `worktree list --porcelain -z`, and the
GitHub CLI (`gh`) configured through its normal authentication. No credentials
are discovered, printed, minted, stored or passed by this helper.

```sh
npm run wt -- doctor --github agnt-gg/agnt --author YOUR_GITHUB_LOGIN
npm run wt -- sync --dry-run --github agnt-gg/agnt --author YOUR_GITHUB_LOGIN
npm run wt -- retire --dry-run --pr 123 --worktree /absolute/worktree/path --github agnt-gg/agnt --author YOUR_GITHUB_LOGIN
```

Use `--repo /path/to/checkout` to inspect another local checkout in the same
invocation. The default is the current directory; registered worktrees from
its Git common directory are inventoried, including paths outside `.worktrees/`.
`doctor --help`, `sync --help` and `retire --help` work offline outside Git.
`npm --silent run wt -- ...` suppresses npm's banner for machine-readable JSON.

Explicit repository and author flags prevent accidentally selecting another
contributor's PR. The upstream must be GitHub.com `origin`, with local
`origin/main` and base `main`; HTTPS and standard Git SSH origins are accepted.
Other remote layouts, GitHub Enterprise and base names are not yet supported.
A GitHub/base failure is unknown, not an empty successful inventory. Fetch
upstream separately when authorized if local origin/main is stale; the planner
never fetches, including lazy fetching of missing objects.

| Command | Result |
| --- | --- |
| `doctor` | Worktrees, current exact-head PRs, local state, link and process observations |
| `sync --dry-run` | Full main/upstream SHAs, ahead/behind, and proposed fast-forward strategy; divergence stops the plan |
| `retire --dry-run` | Exact worktree/branch/HEAD, selected merged PR, patch-equivalence signal and blockers |

All results have `readOnly: true`, `canExecute: false`. Exit 0 means the report
or plan was produced without blockers; exit 1 means invalid arguments or a
collection failure; exit 2 means blockers, including incomplete process
visibility in an otherwise successful doctor report. Retire always requires
external owner/consumer review, so even an otherwise clear retirement plan
exits 2. Read the JSON rather than interpreting any exit as permission to delete.

## Retirement evidence

The planner refuses to clear primary, dirty, untracked, ignored, locked,
in-progress, active-process or dependency-provider worktrees. All ignored paths
need explicit disposition: it does not assume every `node_modules` path is a
safe symlink or every test result is disposable. The named branch must match
the selected PR; detached copies require an exact PR-head match. Local branches
renamed for publication require manual reconciliation rather than guesswork.

The selected PR must be merged into main. `git cherry` provides a conservative
ordinary-commit patch-equivalence signal against origin/main, not final proof
of semantic integration. Local merge commits absent upstream are blockers
because cherry omits merge-resolution changes. Squashed multi-commit branches,
rewritten PRs and subsequent upstream changes may require manual blob/diff
review. Do not replace this review with `git branch -D`.

Before any later user-approved retirement: refresh exact identities, verify
recoverability of commits/local evidence, resolve all blockers and owner leases,
review external consumers, then remove only the approved directory/local ref.
Never delete a shared parent evidence directory or follow a dependency symlink.
Unknown or stale evidence requires another observation, not a force flag.

## Observation limits

- Git queries disable optional index locks and fsmonitor. They do not write
  refs/index, prune registrations or refresh upstream. Beginning/end worktree,
  main and upstream ref checks detect ref drift but do not create an atomic
  filesystem snapshot. Files and processes can change during or after inspection.
- Subprocesses have a 15-second timeout and 12 MiB output cap. Collection checks
  a 90-second budget before subprocesses; filesystem scans have 20-second
  traversal budgets and caps. These bound traversal/admission, not cancellation
  of an individual hung filesystem operation. Do not treat them as a real-time
  OS-level deadline guarantee.
- PR enumeration is capped at 1000; reaching the cap is incomplete. GitHub and
  Git errors never echo raw stderr or response bodies.
- Dependency scanning never recursively follows symlinks. It records lexical
  and resolved targets to detect chains between registered worktrees, including
  dependency package entries. It skips package internals and generated output
  recursion. It does not find every external symlink, hardlink, scheduler or
  active-agent lease. A missing registered-consumer edge is not global proof.
- Process inspection supports Linux `/proc`, same UID only, at one point in
  time. It checks cwd/executable/file descriptors and argv path references,
  plus process start identity. Raw argv and unrelated fd paths are discarded.
  The planner's own argv is excluded, but its cwd/fds are not. Stable permission
  denial blocks; unsupported platforms return unknown. Already-loaded code,
  other users, memory mappings and future launches require external review.
- `doctor` is observational: it does not issue service-health requests or
  identify an app as safe to restart. Do not switch files beneath a running app.

## Existing command compatibility

`create`, `remove`, `list`, and non-dry `sweep` retain their existing semantics.
They are **not retrofitted with these PR/process gates**, so a blocked plan is
not permission to fall back to legacy forced removal. Legacy `findOrphans`
still prunes by default; `sweep --dry` now explicitly disables that prune so
its metadata stays untouched. Dry mode is a preview of current registrations,
not a simulated prune.

## Verification contract

Blocking root Vitest tests cover strict NUL parsing, arguments, PR/ref targeting,
permission and cap failures, dependency chains, PID/ref races, merged-patch
limits, JSON exit semantics and real disposable Git repositories. A regression
must demonstrate expired registration metadata disappearing before the dry-mode
fix and surviving afterward, with index/refs unchanged. Default non-dry sweep
must still prune. Test output and local dogfood belong in the PR description;
this document does not claim a particular run passed.
