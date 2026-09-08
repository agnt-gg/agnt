# Final narration and independent controls (candidate)

The Codex controller now uses final-text browser TTS, not native generative playback. The native WebRTC audio element stays muted for every response. Its data channel still receives final speakable context to resolve native delegation protocol causality. Only the production request bridge's final opening paragraph is eligible for narration, after its returned receipt has `accepted: true`, `completed: true` and matching conversation/message/execution IDs. Missing/contradictory completion or speech callbacks fail closed. This trades latency for correction safety. It does not prove acoustic fidelity, browser voice availability, pronunciation, or the OS speech service's data handling.

Existing legacy voice selection is unchanged. Selecting Codex explicitly selects browser final narration as disclosed in settings, not a fallback to another metered account. Local TTS streaming remains an unfinished candidate seam (`createNarrator`); no faster-Qwen qualification or promotion is claimed here.

All four chat surfaces expose the Codex session controls:
- **Stop playback** cancels current speech and invalidates in-flight narration, without stopping the mic or cancelling accepted work.
- **Pause mic / Resume mic** disables/enables existing media tracks and suppresses incoming user-turn dispatch while paused. Already accepted work can finish and narrate.
- **End voice** tears down native media and the local monitor, not the accepted task. Use the existing chat task-stop action to cancel work.

Local VAD observes the already-permitted stream with an analyser, never opens an additional mic, never connects mic audio to the speaker destination, and owns a cancellable 20 ms sampling timer. Warmup is 300 ms and the nominal onset threshold is three frames. Synthetic timing results are not a real-device p95 claim. Monitor availability, background-tab timer throttling and echo cancellation require live qualification. Pausing resets calibration.

Tests include the real request bridge feeding the production controller, final negation replacing opposite draft, unsolicited native audio kept muted, contradictory receipts, stale callbacks across stop/start, playback cancellation while work remains pending, pause/resume and cleanup. The frozen original five-defect gate must remain unchanged. No human acoustic acceptance or full production UI/service dogfood is implied by these tests.
