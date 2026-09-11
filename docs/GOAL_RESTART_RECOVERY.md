# Durable goal restart recovery

2026-09-11. Isolated follow-up based on published #131 at 84d5f643. Not deployed or merged. This document supersedes the earlier WIP snapshot; that file remains historical evidence.

## Supported contract
The persisted goal label is not proof that a process is alive. Each admitted goal run owns a random run ID, process boot ID, increasing generation, and 30-second lease. The owning process renews every five seconds. Main-process startup and periodic reconciliation classify expired/ownerless executions as needs_review / interrupted while preserving task evidence.

Automatic continuation is intentionally bounded:
- A recorded start authorization identifies mode, provider/model, conversation and iteration budget, plus a hash of goal/task scope.
- Only `tasks` and `evaluate` checkpoints are eligible. Resume stays on the recorded iteration, not lastIteration+1. Completed outputs are retained. An evaluate checkpoint requires every task completed.
- No admitted unresolved attempt, running/assigned task, changed scope, deleted/paused/stopped goal, unsupported checkpoint, or exhausted recovery budget is admitted.
- At most three automatic recoveries per authorization chain. The coordinator scans bounded pages and dispatches one recovery at a time. Task-wave spend admission remains in effect.
- Recovery uses the matching normal or autonomous executor. It does not convert normal runs to an autonomous replanning loop.
- This is recovery of safe durable boundaries, not arbitrary mid-action replay. An action may have succeeded before a crash; that case requires evidence.

## Ownership and persistence boundaries
- All operations on the private ownership SQLite handle are serialized, including renewal/release/read/checkpoint. Transaction-local calls are reentrant through scoped async context; outside operations cannot accidentally join a transaction or its rollback.
- Failed COMMIT acknowledgment is an explicit non-retryable RECOVERY_COMMIT_UNKNOWN outcome.
- A task admission has a separate attempt UUID and task revision. Attempt history is appended by SQLite triggers; a later attempt cannot erase the earlier one. Claim-heartbeat fields do not invalidate evidence, while status/output/description/tools/dependency changes do.
- Task-result writes check user, goal, run generation, lease, current attempt, task revision and pause/deletion in a short transaction. Result and attempt disposition commit together. A failed response remains failed and retains an uncertain-effect barrier; it is not proof that its actions did not execute.
- Async run context fences the model status/phase/world-state, task creation/assignment/restoration, direct replanning update and goal-deletion paths modified here. Late cancellation does not reset an admitted task to pending. Evaluator context cannot borrow a replacement run's owner.
- Successful evaluation and durable owner release commit in #131's same evaluation transaction. A crash immediately after validation cannot turn that committed success back into an abandoned run.
- The fresh goal_iterations schema now includes the legacy-required `state` column used by GoalIterationModel.create; a regression checks journal creation/readback.

## Operator recovery surface
No token lookup or credential export. The CLI requires the operator's supplied AGNT_AUTH_TOKEN:

    node scripts/goal-recovery.mjs inspect GOAL_ID
    node scripts/goal-recovery.mjs resolve GOAL_ID evidence.json

Inspect reports reason, checkpoint, run generation, uncertain task IDs/attempt IDs and next action. The authenticated GET route is `/api/goals/:id/recovery`; POST resolution is `/api/goals/:id/recovery/resolve`.

Resolution body:

    {
      "runId": "the interrupted run ID returned by inspect",
      "evidence": "how external state was verified",
      "decisions": [
        {"taskId":"task-id","outcome":"not_executed","evidence":"operation query confirmed no action"}
      ]
    }

Alternatively a decision can use `outcome: completed` with a verified `output` object. Every uncertain task must be covered exactly once. Missing/moved task, wrong user/run, malformed evidence or partial coverage refuses/rolls back the decision. Resolution does not start execution or override Pause. It records the operator's evidence assertion, not independent verification by AGNT. Never write a not_executed decision merely to make Resume work.

The command/API is the operator interface in this change; no graphical resolution wizard was implemented. Current goal cards receive persisted corrected status through existing reads. A dedicated realtime recovery notification is not wired; clients relying only on cached socket state may need refresh/poll.

## Tests and evidence
Fresh final full backend suite: **6033 passed, 1 skipped across 387 files**, exit 0 (`goal-restart-recovery-evidence/final-verified.log`). Normal test isolation and explicit non-hidden TMPDIR; no live DB imports or provider calls. Syntax and diff whitespace checks pass.

This revision recorded RED–GREEN cycles for:
- transaction/renewal interleaving, lost attempt history, missing unknown reason and description-change fencing;
- safe-recovery API contracts (initially missing-method failures, not preexisting behavioral defects);
- evaluation success/release crash window;
- malformed recovery route input;
- failed task-result status and stale assignment;
- paused explicit Resume;
- fresh iteration journal schema;
- old evaluator context borrowing a new owner;
- cross-process pause/renewal and coordinator stop handle;
- resolution of deleted tasks and unsafe replay after failed external output.

Process test R5: a real child saves owner/authorization/checkpoint then is killed with SIGKILL; a replacement recovers the persisted checkpoint and enters the actual autonomous evaluator without replaying completed tasks. Lease times in that crash test are injected; model responses are controlled. This is not a whole live AGNT server stop/start with production credentials. R9 separately executes the real coordinator dispatch into the runner. Existing child-process interruption test also remains.

Some tests were added as verification after implementation rather than RED-first (scope hash change, recovery cap, initial loop continuation); do not retrofit RED claims. Earlier failed runs are retained. One full run failed to launch Brave within 30s; the unchanged nine-test live browser suite passed alone. Another full run exposed fixture-goal interference in R9; the scenario now isolates its eligible authorization records. Final full run is green. No test skips added to hide those failures.

## Gap disposition and remaining boundaries
1. **Safe automatic continuation:** implemented for the specified safe phases. Bootstrap/replanning or unknown side-effect stages intentionally stop for review rather than replay.
2. **Iteration continuation:** recorded phase and iteration used, no crash-only increment. Best-score snapshot restoration still uses existing loop records; no proof of exactly-once accounting of model cost or iteration notifications.
3. **Operator flow:** authenticated API + CLI supplied; graphical UI/realtime recovery event remain optional follow-ups, not silently claimed implemented.
4. **Cluster compatibility:** owned goals are excluded from cluster pull until remote workers carry equivalent run/attempt context. This changes throughput and is an explicit local-executor-only release constraint. Healthy current-version remote leases are not taken over; mixed old/new workers must not share an active DB during rollout.
5. **External effects:** no exactly-once guarantee. Generic shell/third-party tools and other processes writing SQL do not acquire fences simply because this code exists. Supported application model paths have fencing; out-of-band DB writes are outside the contract.
6. **Schema/rollout:** additive tables/triggers and one legacy column. Main-process migration must finish before workers; do not roll back to old executors against active recovery records. Earlier prototype schema was never deployed; no automatic upgrade path from an unversioned prototype database is promised.
7. **Budgets/history:** append-only attempts/resolutions and task-revision tombstones grow. No retention deletion is introduced. Recovery capped at three; blocked goals require evidence or revised explicit authorization, not endless retry.
8. **PR2/PR3:** these goals were not reset/resumed or evaluated here. Goal completion is not baseline validity and cannot bypass PR3's separate evidence gate.
9. **Production verification:** not deployed. No running app restart, live migration, account operation or external PR creation/merge occurred. Source is an isolated #131-based candidate; fresh rebase/overlap and maintainer review are still required before release.

## Before deployment
Review the supported-path boundaries, validate additive migration on a disposable copy, drain all old goal executors, deploy main and workers together, then exercise whole-server restart with a harmless goal and inspect recovery reason/attempt receipts. Do not restart active real work merely to test recovery. Verify source hashes and preserve unrelated dirty work.
