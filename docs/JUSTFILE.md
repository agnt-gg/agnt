# AGNT's Justfile interface

Tracking: [issue #126](https://github.com/agnt-gg/agnt/issues/126).

`just` provides the standard outer command names; the existing npm scripts
remain the implementation. This is a local adaptation of engineering-core's
standardized Justfile and validation guidance, not a package-manager migration
or a claim that AGNT has adopted a new language lane.

## Everyday commands

From this checkout or any of its subdirectories:

```sh
just                              # list recipes; does not start anything
just doctor                       # tool versions, not app health
just status                       # read backend health and ownership
just status --json                # machine-readable backend status
just restart-backend              # authenticated, supervised backend restart
just dev                          # foreground Vite frontend; Ctrl+C stops it
just dev --host 127.0.0.1 --port 5173
just build                        # build frontend assets; not Electron packaging
just start                        # launch Electron + backend; only when not running
```

Do not run `just start` or `just dev-backend` while another instance owns port
3333. `dev-backend` is a standalone start, not a supervised restart. `dev` means
Vite only, unlike root `npm run dev`, which starts a backend.

There is deliberately no `restart-both`. Frontend build, Vite lifecycle,
renderer reload, backend restart and whole-app restart are separate operations.
After `just build`, reload the app window if you want to load the new frontend.
`just dev` does not automatically redirect Electron to the Vite origin.

`restart-backend` uses the existing `npm run restart:backend` contract: an
already supplied `AGNT_AUTH_TOKEN`, IPv4 loopback, verified Linux source-checkout
Electron ownership, one POST with no automatic retry, and changed-PID/health
verification under the same supervisor. Use your existing secure environment
injection; do not paste a token into shell history or chat. A 202 is not recovery.
See [NPM_APP_LIFECYCLE.md](NPM_APP_LIFECYCLE.md) for limits and error handling.

The Justfile itself never loads a `.env` file or acquires credentials. Delegated
applications retain their own existing configuration behavior. Positional
arguments are passed using quoted `"$@"`, not inserted into shell source. This
file uses POSIX `sh`; it is verified on Linux. Windows needs a suitable POSIX
shell and has not been validated here. Install `just` separately; no package
installation occurs from `help` or `doctor`. Tested with Just 1.58.0; older
versions are not claimed supported. Recipes run at the Justfile's directory.

## Validation and packaging

| Recipe | Actual work |
| --- | --- |
| `just check` | Existing tracked-file EOL check, working diff whitespace and staged diff whitespace |
| `just test` | Backend Vitest, then frontend Vitest, once each |
| `just test-backend [args...]` | `npm test -- ...` |
| `just test-frontend [args...]` | `npm --prefix frontend test -- ...` |
| `just test-browser [args...]` | One frontend build, then existing Playwright script with `--grep @ci` |
| `just test-recipes` | Exact routing suite with recording stubs, no services or builds |
| `just ci` | Check, both default suites, recipe routing, one frontend build and tagged browser suite, fail-fast |
| `just package [args...]` | One frontend build, then root `npm run build -- ...` (Electron packaging, including its existing prebuild) |

`dev` aliases `dev-frontend`; `build` aliases `build-frontend`.

Use targeted testing for local work, for example:

```sh
just test-backend scripts/app-lifecycle.test.js
just test-frontend src/path/to/component.spec.js
just --dry-run ci                  # inspect commands without executing them
just wt list                      # existing worktree inventory
```

The frontend recipe intentionally delegates to the frontend package directly:
root `test:frontend` is a nested npm invocation that can consume flags instead
of forwarding them. No package scripts need to change.

### Aggregate proof ownership

The default CI dependency graph is:

```text
ci
  check: EOL + working whitespace + staged whitespace
  test
    test-backend
    test-frontend
  test-recipes: dedicated routing suite
  test-browser
    build-frontend
    Playwright @ci
```

Frontend build is reached only through `test-browser`, not also as a separate
`ci` dependency. The worktree has one build for this gate; backend tests,
frontend tests and browser tests remain distinct proof dimensions. `package`
is a separate output-producing release operation, not another CI dependency.

This is a local orchestration of the blocking CI dimensions, not a replacement
for CI's fresh dependency install, browser install, OS/runtime environment and
other hosted checks. Prerequisites must already be present. Build/test commands
can write normal generated outputs and caches. Run expensive jobs through your
workstation's applicable admission/serialization wrapper; `just` is not an
admission guard and does not authorize bypassing one.

`check` is **not** lint, type checking or a complete clean-tree check. Its Git
checks do not cover untracked source files, and EOL checks cover attributed
tracked paths. Stage intended new files only under your normal approval workflow
before relying on that gate. Passing `doctor` or `check` says nothing about all
optional services or runtime features.

## Intentionally unavailable

- No `lint`, `fmt` or TypeScript `check` implementation is fabricated: this
  checkout has no canonical npm scripts for those dimensions. No formatter or
  typechecker is installed as a side effect. Reconcile these names only when
  a real repository-owned contract exists.
- No optional `loop-*` recipes are claimed: the repository has not selected a
  complete `repo-loop-validation-v1` mapping.
- The report-only `test:node` job is not promoted into a blocking gate. Its
  quoted-glob issue remains a separate existing problem.
- No Docker control, credential acquisition, force-kill, automatic sync/cleanup,
  restart-all, install, or publish shortcut is introduced.

`wt` is a transparent npm wrapper, **not a read-only safeguard**: explicit
legacy `remove`, `create`, or non-dry `sweep` subcommands retain their behavior.
PR [#124](https://github.com/agnt-gg/agnt/pull/124) separately adds read-only
`doctor`, `sync --dry-run` and `retire --dry-run` modes. Use those when installed
and follow their accompanying guide; this Justfile does not require that PR.
Do not interpret a recipe or planner output as deletion permission.

## Source guidance and scope

Design provenance: engineering-core guidance at commit
`9225dd66a83b5a9c23e14d2f834dbabdd2ce71d8` in the contributor workspace
(`~/ai-society/core/engineering-core`). These are source references only; neither
that checkout nor those policy files are needed to use AGNT:

- `src/engineering_core/lanes/engineering-ts.justfile.md` — standard outer
  vocabulary, existing package scripts, minimal churn and truthful omissions.
- `src/engineering_core/lanes/engineering-pi-ts.justfile.md` — supporting npm
  delegation example, not an assertion that AGNT is a Pi extension.
- `src/engineering_core/disciplines/validation.md` — validation dimensions,
  evidence boundaries and no duplicated expensive proof in aggregates.

Repo-specific choices here retain npm/Node/Vue/Vite rather than adopting Bun;
`build` means frontend artifacts while `package` explicitly means desktop
packaging. No engineering-core adoption metadata or policy files were changed.

The npm lifecycle scripts from PR [#122](https://github.com/agnt-gg/agnt/pull/122)
are required. This change is stacked on its published commit and must land after
it; no lifecycle logic is duplicated. The base `wt` npm script already exists
upstream; #124 adds optional subcommands rather than a prerequisite.

The dedicated `Justfile routing (no skips)` CI job installs Just 1.58.0 from its
checksum-verified Linux release, checks formatting, and runs the exact test file:

```sh
just test-recipes
# Equivalent: node --test tests/unit/justfile.test.js
```

The suite needs only Node and Just, not npm dependencies. Missing Just fails; no
platform/tool fallback silently skips it. CI requires all mandatory tests and
zero failures/cancellations/skips/todos. Ordinary Vitest users do not need Just;
the separate job does not rely on the existing report-only node:test glob.
Recipe tests use disposable recording executables, so `restart-backend`,
`package`, or `ci` routing tests do not execute those operations. Actual runtime
and full-suite evidence must be reported separately.
