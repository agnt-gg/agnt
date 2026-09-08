# Codex voice: historical live trials are NOT playback qualification

> **Correction (batch 19, 2026-09-08):** The historical harness below is quarantined with an unconditional startup failure. It injected the expected answer into Annie context, pinned `gpt-5.4-mini`, proxied saves to live history, mounted a null-rendering host and recorded received audio before permission. Its old success condition did not establish restored answer/provenance equality or downstream fidelity. Do not use those trials as selected-model, rendered UI, playback or full-session qualification. Historical observations below remain for audit only; they do not describe current verified behavior.
>
> Current unattended acceptance is **PARTIAL**. Original audit repairs have offline evidence, but actual downstream post-gain audio/ASR, repeated <=150 ms interruption, authenticated selected-account/model integration, real rendered dogfood and owner-admitted faster-Qwen streaming remain unqualified. The active controller uses separate exact-final TTS; optional generative native playback is now fail-closed. Human microphone/speaker acceptance is **PENDING_USER**. Keep PR114 draft.

2026-09-08 · Relates to agnt-gg/agnt#108. This supersedes the older preview-status and prototype-only claims. Issue #108 stays open.

## Historical trials — invalid as current acceptance evidence
The existing Codex provider, production voice setup router, browser WebRTC controller, shared useVoiceEngines composable, actual chatUnified Vuex store, production streamChat transport, and a real Annie backend participated in live synthetic-audio tests. The candidate voice route was served on an ephemeral loopback listener with a separate data directory. The running AGNT backend handled explicitly bounded, tools-disabled synthetic chat requests. No room microphone, production restart, provider-token exposure, or canonical TTS replacement.

A synthetic question asks for a verification phrase. The phrase is supplied only to Annie's request, not to the voice session. Pass requires one accepted request with a server execution ID, the phrase in returned voice transcript after Annie's result, fresh received audio, saved/reloaded answer, and closed input tracks. It is stronger than a successful SDP or nonzero audio check, but still does not prove all speech faithful on arbitrary inputs.

Representative latest successful run:
- connection ready approximately 0.9 s after test start;
- native utterance dispatch approximately 5.8 s;
- authoritative Annie speech text approximately 7.8 s;
- previously started filler kept muted; fresh result context sent approximately 9.8 s;
- final returned phrase approximately 15.0 s;
- exactly one chat request and durable execution receipt;
- transcript save/load succeeded; input tracks ended on cleanup;
- actual store has one user message, assistant answer, and bounded voice provenance metadata;
- raw server saved transcript preserves metadata, but existing UI hydration drops it on reload (open follow-up).

Local evidence directories and private account/run identifiers are intentionally not committed. Opt-in probe scripts reproduce the flow and write artifacts locally. Raw received audio includes provider-generated material that may have been muted for playback; it is NOT a recording of exactly what a user would hear.

## Findings that changed implementation
1. The model sometimes answers simple questions without delegation despite instructions. A model's decision to delegate cannot be the sole action trigger.
2. When it does delegate, it may withhold turn.done waiting for the client. Waiting only for turn.done deadlocks.
3. delegation.created carries user_bidi_turn_id. Both correlated delegation and final transcript are deduplicated by native user turn ID; two delegation IDs plus a late final are one accepted request.
4. Native turn.created, not every transcript delta/final, invalidates prior speech. A late final for the same turn must not mute the answer.
5. A synthetic microphone must continuously send silence between utterances. An ended AudioBufferSource without a continuous track stopped the audio clock, producing context acknowledgments but no speech. Earlier stalled tests are harness failures, not provider quality evidence.
6. A real interruption run generated the wrong phrase 'Cobalt Lantern' before Annie's authoritative phrase. Playback had initially been unmuted when Annie finished, potentially exposing the tail of that old response. The new narration gate holds already-running unsolicited responses muted, then starts a fresh context for the real result; regression tests and a real post-fix run cover this case.
7. Codex still adds filler/paraphrases despite instructions. No deterministic verbatim guarantee is claimed.

## Tests
- Backend: 93 passed across five files (new service/router/deadline and legacy realtime regressions).
- Frontend: 689 passed across 33 voice/store/UI files. Includes new native event, late-final, duplicated delegation, receipt, final-only response, narration-gate and metadata-serializer tests.
- Frontend production build passes (large-chunk warnings remain).
- Node26/jsdom tests need a process-only storage preload documented in codex-voice-test-environment-note.md. No assertion or production storage changes for this workaround.
- Existing dependencies reused via symlinks; clean-install/CI matrix still required.
- Real synthetic interruption: playback muted and tracks closed; approximately 1695 ms from injected speech to native detection. This FAILS the aspirational 150 ms responsiveness target. It is not a low-latency claim.

## Preview scope / not done
- Opt-in panel/workspace path only; main chat, agent tab, mobile native parity pending. Legacy default unchanged.
- Account 2 works only when the target build actually registers its account manager; not added here and not live-tested in upstream-single-account checkout.
- Overlapping commands rejected with visible error; full mid-run steering/reconnect reconciliation pending.
- No wake word, hotword, cross-tab ownership, microphone first-word/pre-roll guarantee, device switch qualification or human acoustic quality certification.
- No exact word/audio alignment or faithful-narration proof. Existing voice response can add or substitute words; reject use as a guaranteed verbatim reader.
- Metadata saved on server but hydration follow-up needed; complete generated-vs-played transcript accounting pending.
- Local faster-Qwen/Pocket work remains separate #109; no GPU benchmark or promotion claimed.

## Reproduction status
Run normal isolated unit/route tests without live flags. `scripts/codex-voice-roundtrip.mjs` is intentionally disabled, including when `AGNT_LIVE_VOICE_TEST=1`; there is no bypass. A replacement must render production chat, retain the user's selected model/account, use transparent randomized prompts without injected answers, isolate authenticated history, prove exactly one durable completion and restored equality, capture downstream audio and independently transcribe it, and verify lifecycle cleanup. No validated live reproduction command is available yet. Never use room audio for unattended tests.

PR must remain draft until the missing release gates are resolved. Keep #108 open; no merge, deployment or completion claim implied.
