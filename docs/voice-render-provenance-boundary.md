# Completed render/provenance boundaries — batch 19

Status: PARTIAL mission, offline persistence repair verified; no release qualification.

## Writes
`sealedTranscriptProjection.js` restores the prior completed prefix's contentParts, toolCalls/tool_calls, reasoning and terminal render fields without flattening legitimate interleave order. It restores accepted voice-input entries, strips conflicting incoming voice claims, and retains unrelated metadata and later turns. Ordinary ContentOutputModel saves bind the normalized payload to the exact sealed snapshot in the SQL UPSERT. If completion wins the race, the stale save returns changes:0; there is no blind retry. The internal completion CAS uses the same projection restoration against its existing expectedContent.

Role, ID and content conflicts remain rejected by existing writer checks. This protects already server-completed prefixes, not a new authenticated utterance/execution ledger. Pre-completion provenance and same-turn supersession still need the broader identity contract. The first completion's provider projection remains responsible for initial correctness. It is not legitimate to call these SQLite tests authenticated HTTP or account/payer qualification.

Unchanged review18 SQLite/hydrator probes: red 5 pass/2 fail, green 7/7. Added exact tool order, extra voice claims, later-turn completion, simultaneous relabel attempts and controlled stale-save/completion races. Historical reviewer probes and frozen audit remain unchanged.

## Native output and PCM evidence
Optional generative native bridge output never grants playback permission. The controller already explicitly uses separate exact-final TTS. Native assistant lifecycle parsing is still required and tested; after disabling native output, the frozen audio-race assertion alone no longer detects an ignored-created parser mutant. A direct protocol-identity assertion detects that mutant, with a passing current-source control. Do not report five frozen-gate mutant detections.

The PCM sink's optional onRenderedStream exposes a MediaStreamAudioDestination connected after the actual gain node. It is distinct from onPostGatePcm, which still explicitly reports scheduled-post-gate source samples. Tracks are stopped on stop/drain. Chromium synthetic tone capture verifies gain-zero renders zero, half gain renders peak0.25 and full gain peak0.5 for source peak0.5. This is digital graph evidence, not speaker playback, model speech fidelity, ASR, VAD, or interruption acceptance. No local streaming adapter is registered by this change.

## Harness and release
Historical codex-voice-roundtrip.mjs is unconditionally quarantined, with no environment bypass. Original source is retained after the startup guard for audit. It cannot inject expected answers, access credentials or save live test history because it exits first. Replacement rendered selected-model dogfood remains required. Browser startup was verified against the built app's unauthenticated sign-in screen with network/API requests blocked, not a signed-in chat.

Eight voice native title tooltips were changed to existing v-tooltip. Full frontend now has one QR timeout and two PopupTutorial teardown errors; these source/test files are unchanged from HEAD and QR reproduces isolated. No assertions/timeouts were weakened to hide them. Keep PR114 draft; no publication or merge in this batch.
