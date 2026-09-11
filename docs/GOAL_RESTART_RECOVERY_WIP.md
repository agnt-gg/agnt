# Goal restart recovery — isolated implementation checkpoint (2026-09-11)

## State: WORK IN PROGRESS, NOT DEPLOYABLE
Parent is published PR #131 commit 84d5f64366f805fcfa0129435600cee55e114eb4, not the dirty live checkout. No production DB change, restart, goal reset, or provider task execution. This is not a complete implementation of automatic crash recovery and is not submitted as merge-ready.

## Implemented candidate
- Durable goal owner record: random run ID and process boot ID, generation, 30-second lease, checkpoint, explicit interruption reason.
- Main-process schema initialization and five-second periodic reconciliation. Expired/ownerless executing runs become needs_review with loop_status interrupted; tasks/results/iteration are retained. Live remote owner leases are not taken over. Pause/stop remains intact.
- Ownership admission before normal/autonomous/resume mutations. Unknown/outstanding external attempts block generic Resume rather than being replayed.
- Five-second renew loop tied to in-memory runtime identity. Ownership loss requests cancellation.
- Per-task admission ID and task revision guard, preserving tombstones through delete/recreate. Status/output/parent changes invalidate stale work; task claim heartbeat alone does not.
- Atomic result + attempt commit on a dedicated SQLite connection. Expired/changed owner, changed task, duplicate/old attempt and paused goal are rejected.
- #131 atomic evaluation transaction additionally checks durable run ID/generation/state/expiry captured before grading.
- Authenticated recovery GET and explicit evidence-backed POST resolve. Each uncertain task needs a decision: known not executed, or verified completed output. Decisions are durably recorded; resolution does not start a goal or override pause.
- Cluster pull excluded for newly owned goals until remote executors support the same attempt contract. Local claims/reaper exclude admitted unknown attempts.

## Evidence
All evidence under /home/tryinget/agnt/projects/goal-restart-recovery-evidence.
- runner-red.log: 3 behavioral failures (normal start/autonomous start/resume ignoring ownership refusal), then green.
- second-order-red.log: 2 behavioral failures (expired terminal writes, checkpointed external work released without unknown barrier), then green.
- attempt-red.log: 4 missing-API contract failures, not reproduced implementation defects; corresponding contracts green after implementation.
- resolution-red.log: 4 missing-API contract failures; corresponding contracts green afterward.
- admission-red.log: 3 failures for pause-before-admission, delete/recreate, and distinct second attempt; green afterward.
- evaluation-red.log: one actual late-evaluation expiry failure plus two old unit fixture assumptions about ownerless executing goals. Fixed transaction guard and corrected fixtures without removing the lifecycle assertions.
- First 10 ownership tests were written before store implementation but executed only afterward: verification, NOT claimed RED–GREEN.
- Real child-process SIGKILL test commits ownership then kills worker; parent reopens persisted state and reconciles. Simulated lease time advancement is used; this is not a production backend restart or full end-to-end autonomous loop test.
- Final full #131-based backend suite: 6,006 passed, 1 skipped in 386 files (full-on131-verified.log).
- Tests use isolated DB setup and explicit non-hidden TMPDIR. Dependencies reused from installed checkout. Production DB untouched.

## Unfinished work / known landmines
1. Automatic continuation is NOT implemented. Current policy safely stops interrupted work for evidence resolution. Do not claim the user's unattended PR2 will resume after restart with this checkpoint.
2. Requested-state/authorization envelope and exact phase continuation policy still need durable admission contracts. Iteration-only resume logic is retained, not certified correct for crash continuation.
3. Recovery UI/actionable status integration and route-level authentication/malformed-body/ownership tests are not yet complete. Current changes update saved goal state periodically; no realtime recovery broadcast wired.
4. Rollout cannot mix old goal runners and new reconciliation: legacy ownerless executions may belong to another healthy old process. Drain/coordinate upgrades; no broad live boot sweep authorized.
5. Local-only fallback for newly owned goals reduces cluster throughput. Needs explicit contract/feature policy and remote attempt fencing before fleet support.
6. Dedicated ownership handle serializes transactions, but renew/release/checkpoint currently share it without serialized operations. Review potential interleaving before approval.
7. Start failure before watch installation leaves lease until expiry. Terminal release depends on next renewal tick; parent-state and release must become atomic to avoid false interruption during crashes after successful completion.
8. A task can invoke platform tools that update its own DB row. Its revision then changes and final result is conservatively rejected. Reconcile helper/direct tool writers with attempt context; no blanket bypass.
9. Task-failure/cancellation writes, goal phase updates, manual evaluation/review, and external side effects need complete run-context auditing. Atomic result/evaluation guards are not universal generation fencing.
10. Task-attempt row currently keeps latest attempt per run/task; durable history for superseded attempts needs audit before production use. Resolution accepts operator evidence assertions; it does not independently prove external outcomes.
11. Never automatically replay actions whose effects cannot be determined. No exactly-once claim for arbitrary APIs. Completed goal status does not validate PR2 artifacts or authorize PR3.
12. Final integration/rebase with moving #131 and other goal work is pending. Do not replace live files from either isolated prototype.

## Next implementation boundary
Keep working on the #131-based branch. Resolve the above runtime/transaction/context gaps with RED–GREEN tests; add exact safe-continuation and an explicit resolution operator surface. Reproduce a whole-loop crash/restart using disposable data and harmless side effects, and check PR2->PR3 evidence gating remains independent. Only then submit a scoped follow-up draft PR and propose deployment; no user action is needed to continue isolated development.
