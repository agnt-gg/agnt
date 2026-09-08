# Voice engineering: verified unattended slices, release still partial

2026-09-08. Relates to #108, #109, draft PR #114. This is the CURRENT evidence summary; earlier prototype/preview documents are historical. No production deployment or merge.

## Decisions and implementation now present
- Existing Codex provider family retained; no separate provider/account identity. Native Codex media is **always muted** because it cannot be bound safely to exact accepted output text. Codex handles input/protocol; a separately selected final-text narrator handles output. This is a deliberate functional change from the original generative-speech preview, not a claim the old narration defects disappeared.
- Native user finals/delegations correlate by native turn identity. Complete delegation interpretation is retained with provenance, never replaced by a truncated observed partial. Busy/stale input is isolated by turn; conflicting later final raises uncertainty without replaying work.
- Submitted, accepted, completed, failed and unknown are separate states. Authenticated request identity and actual execution/model/provider evidence bind the final receipt. Draft EOF cannot become success. Authoritative final corrections replace streamed drafts and sealed final text is used for speech.
- Shared chat persistence and hydration preserve bounded voice metadata and final authority, with revision/identity-aware writes rather than simply preferring longer text. Changes include the backend mirror/record lifecycle and need careful upstream review.
- All shared chat surfaces have explicit listening/playback controls and native/local submission adapters. Main/agent/mobile wiring is fixture-tested; real button dogfood below is the rendered unified chat, not every physical device.
- Local ASR uses an administrator-selected owner contract and single-reader reset/final protocol. Explicit **Send voice utterance** is the commit boundary: silence does not cause partial commands. Native input that never finalizes fails visibly with a bounded watchdog, without auto-submitting or switching provider.
- Legacy WAV decoding outputs raw PCM through bounded execFile, does not overwrite/delete uploaded input, and handles RIFF ancillary chunks/resampling. Typed synthesis errors reach the frontend; unavailable/quota paths avoid repeated doomed requests.
- Explicit PCM streaming output, bounded parser/queues, post-permission/gain playback sink, independently observable rendered stream, and cancellation/owned resource cleanup.
- Optional **Pocket TTS CPU** adapter registered only with server configuration and allowed user IDs. Persistent one-request CPU worker, no overlapping inference, generation/request IDs, bounded pipe/parser, explicit terminal, 120s request deadline, 120s idle shutdown, exact owned-child cancellation/exit receipt. No model installation at app startup, no GPU usage, no implicit fallback.

## Original audit gate
Frozen five-counterexample audit passed **5/5**, originally 0/5, with source mutation challenges and subsequent reviewer probes. Fixes cover truncated instruction, busy-turn contamination, false EOF completion, omitted authoritative correction, and ignored assistant creation. Native muting is the final safety policy; passing the gate does NOT prove native generative audio safe or audible.

## Real dogfooding (not merely mocks)
### Codex input → selected Annie → Pocket output
Actual rendered UnifiedChatContainer Talk button, useVoiceEngines/useCodexVoice, production WebRTC controller and native submit/store, isolated production OrchestratorRoutes/OrchestratorService/SQLite persistence, then production Pocket stream and post-gain playback.
- User-selected OpenAI-Codex / gpt-6-astra preserved. No hidden expected answer in model context; tools unused.
- Synthetic continuous microphone stream asks about three apples plus two. Exactly one durable accepted/completed execution; answer **You have five apples.**
- Output is captured after the actual gain/permission path and independently transcribed by existing local Nemotron ASR as the same sentence.
- Saved and reloaded answer/provenance match. Actual Pause/Resume/End controls exercised; tracks and output contexts close.
- Native media stays muted, never counted as played audio. No room microphone or physical-speaker acceptance.

### Local ASR explicit Send → selected Annie → Pocket output
Actual Talk and Send buttons with synthetic WAV containing **I do not buy two more**. Production local PCM capture/ASR hard-final, submit/store/selected model, isolated completed receipt, Pocket output and post-gain capture.
- Exactly one durable completed execution; answer **You still have three apples.**
- Independently transcribed post-gain audio matches exactly. Restored metadata matches. Tracks/contexts closed.
- This is a tested local alternative, never a silent native→local fallback.

### Isolation and history
The final tests use an empty seeded candidate database and normal issuer verification/provisioning, not copied auth or user DB. Anonymous requests rejected401; authenticated requests accepted. Live server used read-only auth/settings; no final-test chat/save writes to live history. Earlier UI setup attempts before isolation did create explicitly TEST/private history; preserved, not deleted. Earlier session's mixed real/test conversation also preserved. Test UI allowlist blocked an unrelated model-schema GET403; it is reported but not a speech failure.

## Pocket measurements, actual CPU runtime
Pinned Pocket source063171d12c6b25d734e7fa019eb76a7954a77233, package3.1.0, Torch2.8.0+cpu, two CPU threads, built-in Alba; English and German models. Source/model caches live in isolated workspace, not bundled in PR.
- Six short English/German samples: first generated chunks approximately66–100ms, generation RTF0.26–0.29. Generator output arrives before waveform completes. Peak process RSS approximately1.1GiB.
- English samples including negation/backup condition independently transcribed correctly. German one initial `Verschiebe` prefix was lost and one number split in ASR; German acoustic fidelity is not fully qualified.
- First naive one-process-per-request adapter: 2.5–2.8s to playback. Repaired persistent worker preserves warm performance.
- Actual authenticated HTTP→production player n20 warm trials: first nonzero **rendered post-gain** audio p95 **99.3ms** (fresh repeated set101.3ms). Cold process/model startup approximately2.7s. Callback/scheduled metrics are logged separately.
- Actual abort after a stalled read: owned child exits in58ms, another worker survives, fresh restart tested, no orphan. Actual120s idle expiration verified.
- Actual production local input monitor + PCM sink,20 synthetic interruption trials: post-gain silence p95 **149.1ms**, narrowly under150ms. This is browser-graph timing, not physical microphone/speaker/AEC timing and not native provider endpoint latency.

## Faster-Qwen status
Still the preferred GPU candidate. Source and isolated empty environment/dry-run prepared, but owner admission denied (`runtime_ownership_unavailable`, allocation identity/budget/profile unavailable). No new GPU model, benchmark, eviction, canonical replacement or promotion performed. **Not a Qwen quality failure.** Pocket was explicitly evaluated as the authorized CPU availability fallback. Matching Torch/Torchaudio/CUDA pinning and owner qualification remain #109 work.

## Test/build state
- Original audit5/5 and independent reviewer counterexamples pass.
- Final focused backend selection **1,743 tests/130 files passed** using explicit FFMPEG_PATH=/usr/bin/ffmpeg. Initial four decoder failures used a non-executable shared ffmpeg-static; shared dependencies were not chmod-ed. Real input-preservation/resampling checks pass with configured executable.
- Full frontend run:4,736 passed plus one QR timeout, before final watchdog tests. QR timeout reproduces on unchanged baseline under same Vitest4 runner; the older Vitest2 frontend runner passes it.
- Follow-up frontend with QR file explicitly excluded:4,740 assertions passed, but two tutorial-teardown unhandled rejections made process nonzero. These remain disclosed, not counted as green CI. Isolated unchanged tutorial baseline passes; concurrency/teardown cause not fully resolved.
- Production Vite build passes; large bundle warnings retained. No package/lockfile changes. Clean dependency install/full CI remains an open gate.
- Native and local runtime tests are opt-in; ordinary tests do not open the room mic or spend voice quota.

## Confirmed remaining limitations
1. Native negation trial produced complete words but no final/delegation for150s, hence no submission. Failure preserved. Watchdog now reports unconfirmed input after bounded wait and releases session; automated tests pass, native stranded-case retest pending.
2. Codex is not serving its generative output voice in the safe mode; exact-final TTS is the explicit output contract. Do not describe this as full ChatGPT-style native voice parity.
3. Account2 live binding/entitlement not tested; no account or metered-provider fallback.
4. Human mic/speaker/headphone/mobile/AEC and subjective EN/DE quality remain PENDING_USER. Background-tab timing may differ.
5. Local explicit Send is not identical to entirely hands-free turn ending. Native reliable endpointing, full mid-run steering, restart/reconnect matrix and exact played-word history remain qualification work.
6. Broad test-run teardown/QR environment issues, clean install/CI and upstream policy/large diff review remain. No release/merge claim.
7. Code scope expanded to shared terminal/persistence fixes; review/split by concern is advisable. All work is isolated; do not overwrite concurrent dirty production tree.

## Reproduction / opt-in setup
Use installed CPU-only Pocket environment with pinned source/model revisions. Set **server-side** AGNT_POCKET_PYTHON to its absolute interpreter, AGNT_POCKET_CACHE to predownloaded cache, AGNT_POCKET_USERS to explicit allowed authenticated IDs, optional AGNT_POCKET_LANGUAGE=english|german. Configure local ASR via owner-published AGNT_LOCAL_ASR_CONTRACT and AGNT_LOCAL_ASR_USERS. Select the named Pocket CPU output explicitly in Voice settings; defaults do not change.

Worker network downloads are disabled at runtime; install/cache provisioning is an explicit preparatory operation. Model/voice license and source notices must be retained by distributor. No credentials go into the worker environment.

Human return test, after deliberately launching the candidate: select local input/Pocket output, Talk, read `I have three apples. I do not buy two more. How many apples do I have? Answer in one short sentence.`, click Send, verify it says three; then test Pause/Resume/Stop. Do not present this as completed while user absent.
