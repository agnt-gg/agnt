# Goal execution truth repair (#130)

Scope: virtual task executor must receive its internal tool configuration through the existing runtime builder; saved-agent restrictions unchanged. Explicit blocked/error worker outcomes cannot become completed. Negative/missing/failed evaluation cannot be promoted by task counters. Terminal goal cards must prefer current server counters over stale live events. Preserve original incident and repair only its status/progress without replaying work.

Acceptance: Given virtual executor and no saved row, when building runtime, filesystem/shell tools are actually callable; restricted saved agents stay restricted. Given explicit blocked response, persist failure/output then stop dependent execution. Given completed rows and score44.9 or evaluator error, never validated; evaluator uncertainty needs review, no automatic retry of side effects. Given terminal server counters and stale live zero snapshot, card uses authoritative counters. Real small native read/write dogfood required, not a six-hour resubmission before preflight.

Non-goals: completing the image feature via this code repair, arbitrary privilege expansion, a perfect natural-language completion classifier, treating prose as independent artifact verification, changing authentication or upstream merge. Structured failures and narrow explicit-status compatibility detection are conservative negative evidence, never positive proof. Image mission remains incomplete until separately executed and dogfooded.

## Verification and boundaries

Four runtime/task behavioral failures and two UI stale-event regressions reproduced red then green. Actual TaskOrchestrator.executeTaskViaAgentChat with Codex, no saved agent row, read_file/write_file completed a byte-exact canary in isolated DB. This proves tool execution, not completion of the image mission. Final backend5956passed1platformskip; frontend4446assertionspassed but two existing PopupTutorial teardown errors exit1; focusedcard2pass;buildpass. Evaluator direct/high-score failure cases and actual loop44.9/error/positive cases covered. Runtime guard also refuses missing declared virtual tools before LLM spend. Saved-agent ceilings unchanged.

Incident goal3e5d2246-b3ba-4862-9520-b5024a09d9c9 corrected separately: paused,loopstopped,6failedtasks,0progress. Exact scoped transaction compares originaloutputs and priorstatus, preserves outputs/evaluation/history. update_task_status had a simulator returning success without writing; now uses owner/goal-scoped checks, actual TaskModel update and readback. Historical records remain evidence, not erased.

Completion detection is not a universal proof engine. Structured errors and explicit opening blocked statuses are negative evidence; ordinary prose can still be wrong and requires task-specific evaluation/dogfood. No auto-replay of the old overnight image mission. Scope excludes image PR completion and local GPU lane changes.
