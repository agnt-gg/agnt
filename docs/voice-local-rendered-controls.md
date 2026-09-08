# Local explicit-send voice preview

The shared `useVoiceEngines` adapter now exposes Local ASR selection on main,
agent, unified and mobile chat. It reuses each surface's existing `submitVoiceTurn`
callback: no model override, second orchestrator, task cancellation or fallback.
Local ASR access still requires the administrator/user contract documented in
`voice-owner-asr-binding.md`; this change does not enable the live service.

Choose Local ASR in Voice backend. Choose browser final-text output or explicitly
choose the **unqualified** local PCM candidate. Start Voice, record the whole
instruction, then Send voice utterance. No silence endpoint commits an instruction.
Capture stops on Send; Resume mic begins a fresh utterance. Pause discards unsent
capture/ASR, Stop playback invalidates narration only, End voice tears down input.
Accepted tasks require the ordinary task-stop control to cancel.

Capture demands actual 16kHz mono from AudioContext, writes little-endian PCM,
retains at most 60 seconds and rejects overflow wholesale. Unsupported devices
fail closed. ScriptProcessor (1024 samples, about 64ms) is a compatibility path,
not an AudioWorklet latency guarantee. Local energy onset mutes without remote
VAD. This is not proof of p95 interruption timing or real acoustic echo safety.
Narration accepts only the final speech callback plus matching accepted/completed
execution/conversation/assistant IDs from the native submit adapter. There is no
pre-completion or generative audio path here.

Tests use synthetic capture and receipt fixtures. Rendered settings and shared
composable controls are exercised, but these are NOT authenticated real-provider
UI dogfood or speech fidelity qualification. No room microphone or OS playback
was used. Browser speech may be an OS network service; local-stream has no fallback.
Faster-Qwen/Pocket qualification and human audition remain outstanding.
