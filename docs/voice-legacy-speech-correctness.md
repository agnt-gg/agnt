# Legacy speech correctness — batch 2 (2026-09-08)

This is an offline/loopback correctness checkpoint, not a deployment or voice-quality claim. The native Codex five-defect frozen audit still passes 5/5; native generative narration fidelity remains unqualified.

## Decoder contract

`WhisperService.decodeAudio` uses `execFile` (no shell) with a fixed argument vector and an absolute input path. ffmpeg parses the container and emits explicit mono 16 kHz signed little-endian PCM through stdout. There is no sibling output file, no guessed 44-byte WAV header, and no decoder cleanup that can unlink the caller's input. The upload route still owns its own temporary-upload lifecycle.

Bounds: 30-second subprocess deadline, 16 MiB stdout/stderr maxBuffer, one decode/encode thread, file/pipe protocol allowlist, no stdin. Overflow/timeout/error rejects the decode rather than accepting a partial waveform. Empty or odd-length PCM is rejected. Sample normalization is signed-int16 / 32768.

Five real ffmpeg fixture tests cover same-extension WAV, odd ancillary RIFF chunks, filenames with shell punctuation, preservation of a pre-existing sibling WAV, malformed input preservation, and stereo 48 kHz resampling. Separate mocked subprocess tests verify the exact arguments and limits. No ASR model, microphone, or GPU participates.

Environment caveat: the mission's inherited FFMPEG_PATH points to a non-executable bundled binary. That failed trial is retained. Real decoder verification uses the installed `/usr/bin/ffmpeg` explicitly; neither the bundled binary nor live configuration was modified. Packaged ffmpeg/clean-install qualification remains outstanding.

## Synthesis failure contract

`TtsError` distinguishes provider rejection, network/timeout, and zero-audio failures. Upstream diagnostics are not echoed to clients or logs. Provider 401/403/429 survives the route as that HTTP status with a typed `tts-provider-rejected` body, `providerStatus`, and `demote: true`; other failures remain 502 with `demote: false`. Existing service consumers retain the status property. Fetch has a 30-second timeout. This remains the legacy complete-audio path, not a streaming TTS implementation.

The browser output module demotes an explicit `available:false` response once, just as it already does for 401/403/429. Queued chunks and turn resets do not reattempt the unavailable provider; explicit provider reconfiguration can retry. A delayed response from a cancelled generation cannot demote the current generation or trigger fallback speech. No alternative paid provider is selected.

Tests drive the actual production browser speech module through a real ephemeral loopback HTTP router and the real synthesis service. Identity, upstream fetch and browser synthesis are mocked. These tests do not prove connected-provider auth, audio quality, actual browser playback, or human audition.

## Verification

- Focused backend: 157 tests passed across ten files.
- Frontend voice/store/composable regressions: 710 tests passed across 36 files.
- Production frontend build and git diff whitespace check passed (existing chunk warnings).
- Isolated corrected challenge control passed; restoring original decoder/route/service/demotion modules caused 5/9/9/2 failing assertions respectively.
- First challenge attempt lacked resolver-only mocked dependency paths; retained as invalid infrastructure evidence, not counted as a successful mutation challenge.

The machine-local mission receipt contains exact commands, exits, source hashes and log paths. Dependencies are reused, not clean-installed. No production restart, live voice session, history cleanup, GPU admission, publication, or room/OS-speaker audio occurred. Human acoustic acceptance is PENDING_USER.

## Remaining release gates

Safe authoritative-final text-to-TTS output mode or proven native response identity; selected-user/account controls and local interruption; production server metadata roundtrip; owner-admitted faster-Qwen streaming qualification; repaired no-answer-injection full UI dogfood recording post-gate audio; independent review and reviewed PR update. None are replaced by this checkpoint.
