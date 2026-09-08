# Exact PR-branch verification — 2026-09-08

Base: upstream `3090bf66e69f8e1c7ac538beb0493aeb8bca45a5`.
Voice commits: `df1ba524`, `50dad6c5` (rebased by cherry-pick from the isolated development branch). The unrelated circuit-breaker commit is excluded.

Reran on this exact upstream-based tree:
- Backend 93 tests / 5 files pass.
- Frontend 689 tests / 33 files pass with documented process-only Node26/jsdom preload.
- Vite production build passes (14.63 s, large-chunk warnings).
- Real Codex voice + existing Annie backend + production shared composable/store/transport smoke test passes its response-transfer conditions: one accepted request; durable execution ID; fresh received audio with phrase supplied only to Annie; answer save/reload; input tracks stopped.

Important qualification: in this final smoke test the input ASR transcribed 'verification' as 'vacation'. The response-transfer test supplies a synthetic answer context to Annie, so successful output does NOT establish accurate understanding of that word. This ASR error is retained as failed speech-fidelity evidence, not hidden by the overall transport pass.

The native interruption scenario previously measured ~1.7 s from injected speech to native turn detection. That fails the intended responsiveness target. The stale-response gate was subsequently covered by regression tests and a successful real deferred-narration run; no broad guarantee of verbatim or acoustic performance.

No full application button-click/human microphone/device matrix, full host parity, full CI/fresh install, or release qualification claim. This PR must remain DRAFT. #108 remains open.
