# Candidate local ASR HTTP input boundary

Batch 21 adds `POST /api/speech/transcribe-local` behind the existing real Bearer auth guard. The default handler returns 503 until server-side owner integration supplies a verified `resolveBinding(userId)` with `{ id: 'local-asr-candidate', sampleRate: 16000, openSocket }`. This is **not runtime registration or owner qualification**. No browser endpoint, admission claim, credential override, text model or payer selection is accepted.

Input is raw `audio/pcm`, 16kHz mono signed 16-bit little endian, with `X-ASR-Utterance-Id` (1–80 alphanumeric/underscore/hyphen). Maximum 1,920,000 bytes / 60 seconds. HTTP chunks are streamed with awaited socket sends; odd transport boundaries are reassembled, odd total input rejected. No upload file is created. One active request per handler; duplicates are rejected in a bounded ten-minute 2,048-attempt window. This is transport retry protection, **not durable execution deduplication**.

Success returns only a correlated `local-asr-hard-final` transcript with exact audio byte count. Soft finals and partials cannot commit. Timeout, aborted upload and browser disconnect close the owned socket. Closing transport is not proof of immediate GPU compute cancellation. Responses are `Cache-Control: no-store`; provider details and endpoint configuration are not echoed.

`createLocalAsrClient` accepts already-permissioned or synthetic PCM; it never opens a microphone. It posts once with the existing caller-provided auth accessor, bounds response bytes and wall time, validates final kind/utterance/byte count, and returns a turn compatible with the existing native submit path. It does not call that submit path itself. `stopListening()` aborts input only, cannot stop an accepted Annie task, and rejects stale output. No fallback, retry or model selection.

Tests use isolated loopback HTTP/WebSocket servers with a clearly mocked identity seam and synthetic transcript fixtures. The production SpeechRoutes mount is tested for guard ordering and unavailable default. These tests do **not** prove real-account authentication, real ASR accuracy, rendered UI capture, selected-model Annie completion or post-gate playback fidelity.

Remaining: verified owner binding and route startup registration, user-facing candidate selection/capture lifecycle, real selected-model production UI dogfood with tagged/isolated persistence and independent post-gate ASR. Canonical voice paths remain unchanged. Human acoustic acceptance: PENDING_USER.
