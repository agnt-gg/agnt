# Chat continuity acceptance checklist

Base: Teams MVP 870bc381. Branch: fix/chat-continuity.

## MVP status (supersedes earlier integration notes below)

Personal main-chat admission and startup scheduling are now wired by default in backend/server.js, after journal recovery. AGNT_CHAT_CONTINUITY=0 disables admission on restart for rollback. No user-facing mode is required.

Completion is explicitly semantic judgment for this MVP, NOT deterministic proof of arbitrary task success. A separate reviewer evaluates the immutable original request, and the scheduler enforces continuation. Unknown/running operation receipts block completion. Team-scoped execution remains on its existing authorized path rather than receiving personal credentials; team continuation is not delivered by this MVP.

Verified: boot/admit/two-segment/single-close integration test passed using a scripted engine and reviewer. Orchestrator/storage regression: 139 files, 1623 tests passed. Startup syntax check passed. The app has NOT been restarted into this worktree; live-provider/cache and overnight verification are NOT complete. Existing full-suite evidence below predates this wiring.


Unchecked means not delivered, regardless of component-test results.

- [ ] Extract and connect the existing chat execution loop.
  - [x] Transport-independent execution entry preserving existing provider path.
  - [ ] Supervisor owns subsequent segments; no recursive HTTP/fake user requests.
  - [ ] Initial text-only and post-tool response boundaries both evaluated.
- [ ] Preserve provider payloads and cache identity across segments.
  - [x] Existing conversation prefix state retained through allow-listed checkpoint serialization.
  - [ ] Exact request-prefix and tool-order regression tests.
  - [ ] Live provider cache-read verification.
- [ ] Integrate requirement creation and trusted validators.
  - [ ] Original request coverage, revision tracking, evidence receipts.
  - [ ] Subjective judgments distinguished from deterministic checks.
  - [ ] Teams premature-completion end-to-end regression.
- [ ] Wire durable tool outcomes, team authorization, and credential recovery.
  - [ ] Operation intent/result persistence and ambiguous outcome reconciliation.
  - [ ] Async completion resumes same supervisor rather than competing generation.
  - [ ] Scope restoration, grant revalidation, credential refresh/revocation.
- [ ] Connect startup recovery, streaming status, steering, and Stop.
  - [ ] Durable startup scheduling after transcript recovery.
  - [ ] Main chat automatic behavior; no user mode/toggle required.
  - [ ] Durable Stop wins retry/restart/late-result races.
  - [ ] Steering and group handoff serialized.
- [ ] Run end-to-end, full-suite, build, and unattended verification.
  - [ ] Real restart and two-worker tests, not merely reconstructed instances.
  - [ ] Actual tool-dispatch soak, not an incremented counter.
  - [x] Full backend and frontend suites run serially (later changes separately tested; rerun required before release).
  - [x] Frontend production build.
  - [ ] Running-app verification.
  - [ ] Unattended run and rollback drill.

## Execution evidence and current integration state

- HTTP-independent `executeChatSegment` now backs the existing HTTP handler through `chatTransport`. It exposes cancellation, pre-dispatch ownership, receipt dispatch, prepared history, and a typed result.
- 30 extraction/cache-history/abort lifecycle tests passed after the extraction.
- 11 operation-receipt and validator tests passed.
- Disk reopen recovery and a 2000-persisted-operation/100-checkpoint storage fixture passed. Neither is an actual process-kill or provider soak.
- 14 sender-identity, authority-adapter, history, and segment-adapter tests passed.
- Latest full frontend run: 330 files / 4950 tests passed; production build passed in 27.42s.
- First full backend run: 454 files passed, 4 files failed; 6442 tests passed, 5 failed, 2 skipped. Source assertions and recovery timeout fixed; targeted reruns passed. Earlier full backend run passed: 467 files, 6467 tests passed, 2 skipped. Latest full run: 479 files passed, one image-backfill concurrency test failed (6490 passed, 1 failed, 2 skipped). The failed file and subsequent integration checks passed targeted reruns; this is not a clean latest full-suite pass.

Additional implemented seams: shared frontend reducer, backend mirror, and main-chat store consume ordered work-state events and suppress duplicate frontend continuation; Stop/status routes consult the runtime registry; SQLite triggers atomically publish status events and acknowledge steering with checkpoints; verified-session subscriber wakes only auth-waiting work; repeated unchanged evidence backs off; composed five-requirement test exercises scheduler, database, encrypted snapshots, dispatcher and validator registry without further user messages.

Latest implementation: main-chat entry calls admission when the runtime is installed; admission persists input before scheduling and serializes follow-up messages. The composed application connects that admission to the existing segment engine, encrypted persisted credentials with per-segment revalidation, snapshot history, and durable dispatch. A stream hub keeps the original HTTP stream open across segments. Managed async callbacks retain the lease until settlement and persist results without spawning another model turn. Recovery blocks ambiguous interrupted effects rather than replaying them.

Still not release-complete: production task-specific contract generation/validation, server startup installation, concrete team renewable binding, disconnected-client status reattachment, live steering delivery within a segment, snapshot retention, external async reconciliation, full live provider/cache and overnight verification. Boot composition refuses scheduling without a production verification policy; semantic review is a veto/judgment only, never deterministic completion evidence. No placeholders are enabled.

Existing isolated foundation: 25 tests passed in previous turn. The original 2000-operation fixture only increments a counter and is not a tool-execution soak. A separate-process lease takeover test and real HTTP disconnect test now pass, but no live provider/cache, overnight, complete application-process recovery, or rollback acceptance claim is justified yet.
