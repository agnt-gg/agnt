# Lifecycle persistence fencing — #131 repair

2026-09-10. Fixes six deterministic races reproduced three times on53f9e686. Original tests preserved on c1a7fb1a; old red receipts unchanged. This change contains production code, not expected-failure tests.

## Guarantees implemented

- Main-process additive migration creates goal_lifecycle_versions and six triggers. Every goal/task insert/update/delete increments a monotonic revision, with task changes also invalidating the parent goal. Reparenting invalidates both parents. Tombstones survive ID reuse. Legacy SQL writers are observed; timestamp equality and A->B->A values cannot bypass the fence. No existing task/evaluation rows are rewritten. Existing rows start at revision0 until mutated.
- Evaluator captures a goal revision before loading task evidence. A dedicated short SQLite connection/BEGIN IMMEDIATE transaction checks owner, nondeleted/unpaused status and exact revision, inserts parent and task evaluations, then commits final goal status atomically. No network/model call inside the lock. Failure before commit rolls back all evaluation/status writes; unknown COMMIT acknowledgment is non-retryable uncertainty.
- Non-autonomous completion uses a revision-guarded initial needs_review write and an internal runtime-entry predicate. Late grading cannot override pause/replacement, delete a replacement entry, or start success side effects. Notifications are best-effort and cannot downgrade committed validation. Chat delivery is invoked before normal cleanup.
- Autonomous grading passes the same runtime predicate into evaluator persistence. Cancelled/stale grading does not replan; stale/unknown commit stops without overwriting persistent state. Duplicate unconditional validated write removed from the loop.
- updateTaskRecord passes the task snapshot revision, owner and goal to the actual UPDATE. A concurrent writer causes zero changed rows, TASK_NOT_UPDATED/not_applied/retryablefalse. Progress-only changes no longer restore stale completed status: conflict instead. Sequential intentional updates still pass. Other legacy TaskModel writers retain their API, but all writes advance revisions.

## Transaction and runtime boundaries

SQLite COMMIT submission is the linearization boundary. A pause committed before evaluation is checked or a current-entry cancellation observed before commit submission rejects it. A pause queued behind an already-submitted transaction wins afterward as a newer state; the transaction cannot retroactively be uncommitted. Run-entry fencing is local-process identity combined with persistent goal revision; it is not a new distributed scheduler lease. Raw replacement runs must write persistent state, as existing start/resume does, for cross-process fencing.

Conservative invalidation: any goal/task row update (including progress, bookkeeping, or claims) can require regrading. This trades some extra review work for rejecting stale evidence. Tombstone table grows with historical IDs; retention policy is not introduced in this patch. Migration must run under the existing main-process schema owner before upgraded workers start. It does not authorize a live DB upgrade by merely reviewing this PR.

Notifications are not a durable exactly-once outbox. A process crash can still lose a post-commit notification; storage remains the authority. Full autonomous execution/replanning phases outside grading, distributed claim replacement and remote side-effect deduplication are not certified by this repair. Mixed trace recovery remains evaluator-dependent as previously disclosed.

## Verification

14 controlled real-SQLite cases pass: original L01-L08, plus ABA evidence change L09, partial evaluation rollback L10, notification/chat-delivery failure L11, initial completion-write pause L12, autonomous late grading L13 and autonomous replacement L14. Original six failing safety assertions were not weakened. Model adapter and unrelated ancillary effects mocked; real evaluator, status handlers, update service and SQL run. Two handles plus promise barriers establish causal ordering; no sleeps.

Migration regression covers old rows, repeated initialization, raw writers, reparenting and tombstone reuse. Existing evaluator unit tests now mock the new atomic commit seam rather than removed individual model calls; actual storage behavior is exercised in controlled tests.

Final local backend5967passed1platformskip, frontend4446passed,25Playwright@cipassed,buildpassed. No added exclusions. Previous new-head CI53f9e686 had Chromium handshake/backfill-order failures; current local run includes both tests and passes, but does not prove those intermittent causes fixed. Await actual new-head CI.

Fresh native persisted canary /home/tryinget/agnt/projects/goal-fenced-dogfood-20260910-jCJY7c/receipt.json: successful real Codex worker read/write/readback and grading -> validated, exact24bytes; missing-input -> failed task/needs_review. Ancillary insight mining disabled to avoid unrelated work. No HTTP/UI live workflow or image-mission replay claim. Independent three-file review found no supported remaining blocker within its inspected boundaries.

No running backend changes, live goal mutations, upstream merge, API image requests or original incident replay in this repair. Test-owned orphan processes stopped; historical outputs preserved.
