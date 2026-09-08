# Authoritative final persistence

The saved transcript mirror now receives the server-created terminal receipt after execution and conversation-log writes settle. A completed, identified receipt can replace a longer streamed draft with a shorter (including empty) final. The user-turn sequence must remain a prefix of the incoming conversation; a completed old run cannot erase a newer user turn merely by being longer.

This exception is internal to `persistTurnTranscript` / `writeTranscript`. It is not an HTTP request field, voice provenance metadata, provider-account attestation, or a new authentication mechanism. It requires receipt version, binding, request/execution/assistant identity, user/conversation equality, accepted/success/completed flags, and both durable-write flags. Missing or contradictory fields retain the old substance guard. Journal `appendTurn` retains conservative merging regardless of receipt.

## Verification

`voicePersistenceRoundtrip.test.js` uses isolated actual SQLite models and the actual frontend hydrator. It covers shorter negation and empty finals, preservation of voice metadata/title/private visibility, invalid receipt fields, journal mode, and refusal to drop a newer user turn. Orchestrator wiring is source-tested separately; this is not live-provider or rendered playback proof.

## Still unfinished

- GET conversation-log reconnect reconciliation still lacks a durable current-run receipt; its length/substance heuristic has NOT been weakened here.
- Concurrent writers are not serialized by this change. Atomic compare-and-swap / persistent run revision is needed for full same-turn stale-write protection.
- Existing duplicate-row selection and HTTP autosave arbitration remain separate concerns.
- Selected-model post-gate playback dogfood and human acoustic acceptance remain pending.
