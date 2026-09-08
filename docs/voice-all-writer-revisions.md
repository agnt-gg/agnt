# Voice persistence/reconnect repair — batch 16 (partial)

The completion mirror is no longer the only protected writer. `content_outputs.server_revision` is a server-owned column (no client-seal backfill). Ordinary saves strip `serverCompletion`; the atomic UPSERT refuses changes to a completed prefix and refuses removal/change of later user rows. Legitimate later turns can append and retain the seal. Rejected HTTP saves return 409 instead of reporting success. Canonical content and metadata lookups prioritize server revision over payload length. Existing duplicates/history are retained, never deleted.

Completion CAS still compares the exact prior payload. A later completed turn must preserve the earlier completed prefix. Arbitrary same-turn supersession is deliberately unsupported and fails closed. No client-provided revision authorizes replacement.

Authenticated orchestrator GET can return UI-shaped saved completion with revision only when the server-owned row seal/digest matches its last assistant, the provider log has the same final identity/text and user sequence, and no run is active. Otherwise its completion status is unknown. Main reconnect and unified hydration use completion/revision and user-turn correlation rather than length to accept shorter corrections. A revisionless legacy completed response requires final-message identity correlation; production GET emits revisions.

Terminal `transcriptPersisted` remains conversation-log durability. New `savedRowPersisted` and `savedRowReason` describe the mirror. Settlement has a two-second bound; timeout means `mirror_timeout_unknown`, NOT cancellation. A late DB write may still finish. Frozen completion receipts are copied, not mutated.

## Evidence and limits

See mission `receipts/batch-16.json` for exact commands and red/green logs. Tests use real isolated SQLite and production stores with mocked transport; these are not authenticated HTTP end-to-end or rendered-provider dogfood. No live history, microphone/speaker, GPU or provider use this batch. No publication.

Remaining: independently challenge all-writer races through authenticated HTTP; qualify persisted current-run identity across restart and explicit legitimate supersession. General legacy unsealed paths still use conservative size guards. Fully completed projection requires a preexisting saved row. Data-only migration has no backfill from historic JSON seals. End-to-end routing/account policy, release UI/build, downstream PCM/ASR, local streaming integration, Qwen/Pocket qualification and selected-model rendered dogfood remain mission blockers. Human acoustic acceptance is PENDING_USER.
