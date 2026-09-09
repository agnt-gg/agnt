# Codex image experimental selection — 2026-09-09

## First principles and changed acceptance boundary

The user authorized empirical evaluation after rejecting the blanket unknown-engine block. Separate: (1) AGNT sends distinct requested selectors; (2) users observe a useful quality/time trade-off; (3) the provider identifies an internal engine. (1) is now proved at native action/SDK request boundaries. (2) is explored below. (3) remains unknown and is not a precondition for an explicitly experimental user-requested run.

## Implemented

`latest` requests `gpt-image-2.5-sunburst`; `latest-fast` requests `gpt-image-2.5-flare`. Binding copies the user's policy and account through the native chat wrapper to the workflow action and adapter. No silent alternate model/provider/account is used. The existing subscription opt-in still applies. Off/mismatched selections fail before dispatch. Explicit `provider-default` remains a legacy programmatic choice only when no bound preference contradicts it; it is not a hidden fallback.

Mapping is centralized in `codexImageCandidates.js`, profile `2026-09-09-api-release-experiment`. This is NOT fresh subscription discovery: names come from the current API release, and this route has no established latest-alias contract. Compatible auto-discovery remains future work; do not claim permanent zero-maintenance latest selection. No new credential acquisition/storage code.

Receipts separate requested policy, resolved request ID, nullable returned model, provider-reported size/quality/usage. `modelSelectionVerified`, `modelIdentityVerified`, and `latestVerified` remain false. UI explains experimental requests and unverified advantage. Missing identity no longer prevents the experiment. Provider-side ignored selectors/fallback remain possible and are disclosed; no local fallback is implemented. Missing cost remains null, not free.

## TDD and review

- New native generation/editing tests: 10 actual failures / 4 preexisting substitution passes before change -> 14 passing after implementation. Capture SDK-bound request fields for both policies; test rejected APIs/accounts, errors, concurrent async initialization.
- Existing rejection tests changed only where user-approved semantics changed; off/account/provider/policy mismatch tests remain.
- Review found non-OK response cleanup defect: 1 red -> green; abort failed request and cancel unread body without awaiting forever.
- Real built-app Playwright clicks both policy controls then dispatches the actual chat store action to a mocked SSE boundary. Outgoing JSON has each selected policy. It is not a live LLM run nor a Send-button click. Composed with native tests and live native pilot, it covers the wiring in separate layers.
- A first browser fixture used fragile Vue internal lookup and failed before controls; replaced with actual provider-button click. Historical failed output retained.

## Predeclared six-image pilot

Primary Codex account; sequential calls F,Q / Q,F / F,Q. Two generation briefs (desktop dashboard and text-sensitive mobile ticket) then one edit brief. Each pair uses identical prompt/auto rendering settings. Both edits use the SAME first dashboard image, chosen before seeing outputs. No retries; exactly six image POSTs, each checked before egress for expected Codex path/account/requested model. Isolated empty runtime DB, real native generate_image -> action -> adapter -> client; only client-construction seam wrapped for safe egress audit. This is native function-level live evidence, not a single full rendered-chat/provider run. The live main backend still needs reload to import changed modules.

| Pair | Sunburst requested | Flare requested | Notes |
|---|---:|---:|---|
| Dashboard generate | 46.66 s | 49.62 s | Both 1536x1024 |
| Mobile generate | 37.51 s | 41.09 s | Q 887x1774; F 1024x1536; auto-size confound |
| Same-source edit | 50.00 s | 55.84 s | Both 1536x1024; same reference SHA |

All six succeeded, returned medium quality, and omitted model identity. Geometric F/Q elapsed ratio 1.0917: F was descriptively 9.17% slower here. Three heterogeneous pairs are too few to infer a stable advantage; two pairs F-first and one Q-first is not perfectly balanced. Local regression suites and vision assessments ran during parts of the pilot; elapsed times include client/host work and server variability. No statistical-significance or reliability claim. Earlier fixed-order two-batch results were not pooled into a confirmatory estimate.

Provider total tokens across six image calls: 11,510, not a dollar/credit charge. All observed image egress was the Codex subscription endpoint, exactly one per call, redirects rejected. This does not independently audit the provider ledger or prohibit every other general-purpose tool in AGNT.

## Input-masked quality review

One vision-model assessment per output, using neutral filenames and no selector/time/usage labels. Not a double-blind human study; AI scores are subjective and have ceiling effects. Four common axes: instruction adherence, hierarchy, text accuracy/legibility, polish. Edit preservation scored separately.

| Pair | Q common-axis mean /5 | F common-axis mean /5 | Concrete observations |
|---|---:|---:|---|
| Dashboard | 4.75 | 5.00 | Q decorative copy incomplete, some low contrast; F met listed brief |
| Mobile | 4.625 | 4.75 | Q large illustration/repetition; F less intuitive navigation icons; both exact requested strings |
| Edit | 4.75 | 4.50 | F recoloured Monstera/Pothos thumbnails; Q preserved them. Both recoloured a non-green gold water badge; both preserved layout/text |

Overall common-axis Q=4.7083, F=4.75: effectively tied in this small subjective pilot. Edit-preservation score4/5 both, though specific errors differ. These outputs do not establish engine identity, nor do similar scores prove the same engine.

**Decision:** enable trial of actual distinct requests, do not promise a speed/quality advantage. User may judge the displayed outputs and iterate. No additional automatic benchmark quota consumption. Broader recovery/deduplication, full image-ledger and provider honoring contract remain independent open work.

Evidence: `/home/tryinget/agnt/projects/codex-empirical-20260909-3iezsR/` includes immutable protocol, per-call dispatch/receipts/output hashes, input-masked score transcription, analysis JSON, red/green/full-suite logs. Exact vision assessment text is in the originating conversation. No secrets in published source/evidence.

## Gates

`node scripts/check-codex-image-release.mjs --experimental` checks distinct request wiring and returns0 when available. Without `--experimental` it retains exit2 because complete verified release is not certified. Neither command calls a provider; live pilot evidence is separate. A label marked unverified is a disclosure, not an automatic refusal to generate.
