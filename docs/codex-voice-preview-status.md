# Historical Codex voice #108 checkpoint, 2026-09-08

**Superseded for current status by [codex-voice-live-evidence.md](codex-voice-live-evidence.md).** The text below records the earlier pre-dogfood checkpoint, not the current implementation.

This is an unfinished opt-in integration, NOT live-qualified or release-ready.

## Directly implemented
- Existing openai-codex provider declares realtimeVoice capability, no new provider identity.
- Native setup/catalog router mounted under SpeechRoutes /codex; exact registered account APIs consumed without auth-file changes, one fixed endpoint, no retries/fallback, request/response bounds and cancellation.
- Browser-native Codex protocol/controller, settings, shared voice-engine selection, and panel/workspace chat request-scoped speech observer. Legacy default unchanged.
- Delegation ID dedupe and bounded protocol frames; transcript interpretation provenance attached to local user-message metadata.
- Sidebar/panel existing chat stream supplies server conversation/message identity; not global-last-answer observation.

## Verified
- 92 backend tests across new service/router and existing realtime regressions (fixture auth/upstream; real loopback HTTP for routes).
- 566 frontend tests across 23 focused voice files, including 12 new controller/protocol/request-bridge tests and existing ownership/parity tests. Initial 50-test subset is included, not additional coverage.
- Vite production build passes, 14.61 seconds. Existing chunk-size warnings.
- Syntax and git diff whitespace checks pass.
- Separate Pipecat source investigation: 60 upstream tests passed. Not AGNT or audio-model tests.
- Environment reuses existing installed node_modules via new symlinks; no package manifests/lockfiles/auth files modified. Fresh-install reproducibility remains a gate.

## Remaining before usable/PR claim
- Real selected-account native handshake, media/data channel, synthetic-audio actual Annie roundtrip, acoustic output inspection.
- Browser UI dogfood and cross-surface coverage. Initial submitVoiceTurn implementation exists only for UnifiedChatContainer panel/workspace path; main/agent/mobile Codex path explicitly unsupported. Legacy still works.
- Speech interruption currently observes transcript events and relies on native media interruption; actual start-of-speech cancellation, pre-roll/late finals and out-of-order transcript/delegation pairing require live protocol traces and tests. A late same-utterance transcript can incorrectly suppress narration. Do not call interruption complete.
- Overlapping voice requests are rejected, not integrated steering. Correct run/steer acknowledgments, transcript finality and reconnect uncertainty need completion.
- Server conversation/message IDs are observed per request; durable execution/run receipts are not implemented. Local voiceProvenance metadata has not been proven to survive every persistence/export path. Nondelegated speech persistence is incomplete.
- Unknown provider events currently ignored; readiness/error policy needs recorded native event qualification. No session auto-reconnect or initial context seeding yet.
- Security/privacy review: settings per-user isolation, content-free telemetry, strict metadata limits in store, policy/account shape tests across actual registries, bounded pending work; route tests use fixture auth, not full auth integration.
- No live service restart/deployment; no public PR because required gates are not complete.

## Autonomous execution caveat
Two attempted goals were paused. Their workers reported missing callable tool schemas while the scheduler marked blocked task responses completed. All code/testing above was performed directly after independently inspecting the unchanged checkout. Goal percentages are not evidence. No faster-Qwen benchmark or installation resulted from those jobs.

## Next concrete step
Complete production request-bridge tests and obtain bounded native event/media evidence through the normal server provider path in an isolated test instance. Repair observed ordering/interruption gaps, then expand hosts. Keep local TTS qualification separate from Codex media implementation. Upstream review policy is a merge risk, not a reason to halt local development.
