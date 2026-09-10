# Controlled goal lifecycle regressions

Baseline: #131 at `53f9e686f3cddf7b7e8a426ac241144cba9d7a77`.
Status: executable tests implemented; production races NOT repaired here.

## Test entry

`backend/src/services/goal/controlledLifecycle.bdd.test.js`

Run from this checkout with the standard isolated backend Vitest runner:

    ./node_modules/.bin/vitest run backend/src/services/goal/controlledLifecycle.bdd.test.js

Expected on the baseline: exit 1, six failing safety assertions and two passing positive controls. These are normal tests, not test.fails/test.skip or characterization assertions that accept unsafe behavior. Keep on the dedicated test branch until the matching production fixes make them pass. The suite is in the normal backend discovery path; no CI exclusion was introduced.

Optional: set AGNT_LIFECYCLE_TEST_REPORT_DIR to a NEW directory beneath /home/tryinget/agnt/projects/ to capture per-scenario JSON. Receipt files use exclusive creation, so use a fresh directory for every run. They contain observed state, not a claimed test verdict; consult the separate Vitest results. No personal workspace path is needed for ordinary execution without receipt export.

## Boundaries exercised

Actual modules: GoalEvaluator.evaluateGoal (including task grading, aggregate decision and evaluation/status persistence), TaskOrchestrator.completeGoal/pauseGoal, updateTaskRecord, GoalModel, TaskModel, GoalEvaluationModel and TaskEvaluationModel. Uses the standard full disposable DB initialization and a second real SQLite connection to the SAME temporary database. Isolation is checked before AGNT imports and against PRAGMA database_list afterward. The secondary connection uses read-write-only mode and is explicitly closed.

Only the provider adapter response and unrelated services (worker execution, prompt assembly, insights, notifications, unfirehose) are replaced. No model calls, image generation, external effect, live goal modification, original incident replay, or runtime restart. API client constructor/adapter is mocked; the evaluator and persistence implementations are NOT mocked. No whole completion handler mock.

Two mechanisms control ordering:
- Grade barrier: hold the first adapter response; commit a pause/replacement/task correction, then release.
- Write barrier: spy delegates to the real TaskModel.updateStatus only after its caller has completed the stale read. Commit a competing update on the second SQLite handle, or release a competing writer and wait through its actual readback, before releasing the first writer.

No sleeps or probabilistic scheduling establish a race. Promise barriers settle in teardown even after assertion failure, operations are awaited before restoring spies, and the running-map test entries are removed. The runner owns the primary database connection. Timeout remains a harness safety bound, not the expected failure oracle.

## Results (three independent process runs)

| ID | Required contract | Observed on baseline | Result each run |
|---|---|---|---|
| L01 | Unchanged evidence can validate after grading | needs_review before release; validated afterward, one insight, run removed | PASS |
| L02 | Late passing grade cannot override pause | paused became validated; passed evaluation persisted; validated event and insight emitted | FAIL |
| L03 | Run A cannot overwrite/delete replacement B | B's executing status became validated and B's tracking entry was removed | FAIL |
| L04 | Committed correction invalidates old grading snapshot | task remains failed at v2, but goal/evaluation accept stale v1 | FAIL |
| L05 | Late grading error cannot override pause | paused became needs_review | FAIL |
| L06 | Progress-only write cannot restore stale status | failed task became completed, retained winner error; stale success event emitted | FAIL |
| L07 | Overlapping explicit writes need conflict detection | both reported verified success; stale A overwrote B's failed status and correction output | FAIL |
| L08 | Sequential intentional updates remain usable | failed status preserved while progress advances; verified writes | PASS |

L03 installs replacement B at the actual runningGoals/model boundary after the actual pause; it does not claim to exercise public HTTP resume or start a second worker. testGeneration is fixture-only identity, NOT a shipped run-generation fence. L07 specifies desired optimistic concurrency semantics for operations overlapping from one snapshot; the existing public update contract lacks a revision parameter. Production remediation must define that contract deliberately; a last-write-wins implementation cannot satisfy this safety expectation by readback alone.

L04 invokes the evaluator directly so its own stale persistent write cannot be hidden by caller-side rejection. L02/L03/L05 exercise actual non-autonomous completeGoal handling. The autonomous loop's cancellation/replan/recovery paths, process crashes, partial evaluation persistence and real UI event replay are NOT covered by these eight tests.

## Evidence

Three runs saved under `/home/tryinget/agnt/projects/goal-lifecycle-race-evidence-20260910/run-{1,2,3}/`:
- `vitest.json`: assertion results, including separate soft-assertion failures.
- `L01.json` through `L08.json`: barrier sequence, final goal/tasks/evaluations, runtime identity, emitted events/insights and operation outcomes.
- `runner.log`: runner output.

Three repeats establish reproducibility for these controlled schedules, not statistical concurrency coverage. The two positive controls prevent an always-reject implementation from qualifying as safe.

## Next repair targets (not implemented)

1. Fence evaluator persistence and completion side effects against pause/replacement and evidence changes, not just the waiting caller's promise.
2. Ensure cleanup of run A cannot remove run B.
3. Apply task updates atomically to the intended current goal/task revision; avoid rewriting status on progress-only patches.
4. Add regression coverage at any new persistence fence and run the unchanged positive controls plus existing lifecycle suites.

No production modifications or edits to #131's published branch accompany these tests. Do not mark the races fixed or merge-ready from this test-only implementation.
