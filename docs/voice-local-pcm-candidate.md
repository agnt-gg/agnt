# Local PCM candidate — not promoted

The `local-stream` speechOut engine is explicit opt-in. Existing browser/provider defaults are unchanged. No automatic fallback changes the selected audio destination. The authenticated `/api/speech/synthesize-stream` route is fail-closed until a server-owned adapter is supplied; no browser URL or endpoint is accepted. No new auth storage is introduced.

## Wire v1

Content-Type `application/x-ndjson`, UTF-8, newline-terminated records:

- `start`: version 1, requestId, format `s16le`, mono channels=1, sampleRate.
- `audio`: same requestId, contiguous zero-based sequence, base64 little-endian signed PCM16; at most one second per record.
- `done`: same requestId, exact positive chunks and samples counts.
- `error`: same requestId, bounded static code. Never followed by done.

EOF without done, extra records after done, malformed encoding, unsupported format, identity/sequence mismatch or zero audio is failure. Already-played audio cannot be recalled; failure stops remaining media and does not assert that the utterance was fully spoken. The producer is trusted for semantic PCM content; sequence checks cannot prove speech fidelity.

The browser parses incrementally with bounded records and awaits every sink write. The initial sink permits one active AudioBufferSource and no pending audio source; this conservative policy can introduce inter-chunk gaps and is not latency-qualified. It checks generation before and after context resume. Cancellation stops/disconnects synchronously and closes the context; provider compute cancellation is a separate fact. `scheduled-post-gate` capture is a diagnostics seam for samples submitted after permission, NOT captured hardware output. Required dogfood must capture downstream rendered PCM and independently transcribe it.

The server permits one active generation per handler and rejects concurrent requests with 429 (zero pending slots is stricter than one pending). Abort/timeout ends transport promptly but holds the busy latch until generator `next()`/`return()` settles. A stuck generator remains unavailable rather than permitting unsafe overlapping compute. Adapters MUST serialize underlying native/thread compute beyond coroutine cancellation and report actual owner admission externally; adapter registration alone is not attestation.

## Qualification status

No faster-Qwen model invocation, performance claim, native adapter registration or promotion is included. Pinned candidate source: e2a215f61984c0e72a242f8dd72333338e7672f4. Owner snapshot attempt on 2026-09-08 returned `runtime_ownership_unavailable` / invalid allocation identity or declared budget and performed no mutation. This is an admission block, not model quality failure. Canonical TTS/ASR and active workloads remain untouched. Matched Torch/Torchaudio installation, owner-qualified CustomVoice generator, production UI selection, independent post-playback ASR and human audition remain open.
