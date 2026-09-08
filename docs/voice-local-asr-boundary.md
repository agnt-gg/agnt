# Local ASR hard-final boundary — candidate, not registered

`backend/src/services/voice/localAsrSession.js` implements the Nemotron speech-stream reset boundary without importing a model runtime, microphone, credentials, or task executor. A server-owned `openSocket` must supply the owner-discovered endpoint and a WebSocket configured with a bounded `maxPayload`. It is not exposed as a browser-controlled URL or installed as the default ASR engine.

Protocol reference inspected 2026-09-08: workstation-owned `runtime/m1-nemotron-asr-en/src/nemotron-january-2026/src/nemotron_speech/server.py`, ready/audio/reset dispatch and `_reset_session`; the reference source returns cumulative partials and explicitly distinguishes soft `finalize:false` from hard `finalize:true`. No upstream code was copied. Socket factory uses the Node `ws` interface (`message(Buffer, isBinary)`, send callback, terminate).

## Contract

- One socket and one message reader per utterance. No socket reuse: this wire protocol carries no utterance correlation ID. Late and duplicate finals cannot affect a fresh session.
- Fixed input PCM16 little-endian, mono, 16kHz. Each send is positive even bytes, at most one second; total at most 60 seconds. One active send and zero queued sends; overlap returns busy. Caller owns retry/backpressure, never silent drop.
- The hard reset is sent after an in-flight audio send completes. New audio is rejected once finalization begins. Partials arriving during that drain are not an error and cannot commit.
- `is_final:true` alone is insufficient. Only explicit `finalize:true` in response to the hard reset can return commit-ready evidence. Soft/missing-finalize records never substitute for a hard final; empty final, timeout, malformed wire data, transport loss and unsolicited hard final fail closed.
- Connection/final wait bounded to 1–60000ms; listening session capped at 60 seconds. Session transport is terminated and its message reader removed before the result resolves. This closes local transport, not a claim that GPU compute has synchronously cancelled.
- Return kind `local-asr-hard-final` survives backend normalization, JSON serialization and frontend normalization. It identifies the ASR protocol source; it is not a verbatim-accuracy guarantee or an authorization receipt.
- No commit callback or task authority in this module. Integration must pass a successful result through the existing selected-model submit/receipt path; stopping ASR must not cancel an accepted Annie task.

## Batch 20 evidence and remaining integration

Tests cover deterministic ordering and failure injection plus an actual loopback WebSocket server with synthetic protocol records and zero model inference. This is transport qualification, NOT real ASR quality, selected-model UI dogfood, or human acoustic acceptance. Production route registration, UI input/VAD integration, owner health/admission checks and downstream speech capture/retranscription remain open.

Owner scheduler snapshot on this batch returned `runtime_ownership_unavailable` (invalid allocation identity or declared budget, `runtime_mutation_performed:false`). No faster-Qwen inference, installation, default change, promotion or GPU mutation was performed. Do not interpret admission failure as Qwen quality failure.
