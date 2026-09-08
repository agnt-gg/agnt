# Native voice submit adapters — batch 6

Main Chat, dedicated Agent Chat, and Mobile Lite now adapt their existing send paths with request-local SSE receipts. No audio-provider model is sent as the text model. Agent routing/identity is captured before the UI nextTick. Main Chat uses a Promise-returning BaseScreen prop; Vue emits cannot return async handler settlement. Other BaseScreen hosts without this prop remain explicitly unsupported for native submission.

Native turns preserve unsent keyboard drafts and carry bounded provenance. Spoken clear/slash/goal strings do not execute local composer shortcuts; they go to the normal chat backend as text. Busy native turns fail closed rather than entering the steer path, whose terminal identity contract is not yet sufficient. Legacy voice steering remains unchanged. Accepted tasks are not cancelled by this adapter when audio/listening ends.

Both existing custom store readers now have a request-local observer (not the global callback registry), notify malformed/transport errors, and the agent action awaits reader settlement. Draft deltas cannot authorize narration. A done followed by read failure retains historical acceptance but refuses completed speech.

## Verified scope
Production store actions driven with bounded synthetic SSE reader fixtures; mounted production MobileChat with synthetic service; broad frontend regression/build and original independent gates. These are not provider sessions, an authenticated server roundtrip, or post-gate PCM dogfood.

## Still required
Server-attested request/account identity and server-side metadata persistence; rendered main/agent host integration tests; user-selected-model live dogfood; owner-admitted faster-Qwen qualification; human acoustic acceptance. Original gate remains frozen. No publication claim.
