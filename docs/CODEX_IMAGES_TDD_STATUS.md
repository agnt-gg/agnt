# Codex two-choice delivery status — 2026-09-09

**Partial implementation, not a restart-ready two-choice image release.** Do not equate passing safety tests with supported upstream image selection. See `scripts/check-codex-image-release.mjs`: currently exits 2 with both policies BLOCKED.

## Delivered source

- Compact text-generation row plus independent subscription image switch and Latest Quality / Latest Fast preference buttons, layered on PR #103's existing turtle/rabbit component. Text multiplier follows the component's explicit model; no image multiplier inferred. Unknown model hides the multiplier. App tooltip, not native title.
- Per-account browser-local image preferences with strict boolean consent. Both main and unified chat forward a dedicated `codexImages` object through JSON/multipart. Main chat uses its effective conversation account.
- Backend binds a frozen intent before dynamic text routing; bound image requests cannot select a different provider/account/policy. Invalid preference gets HTTP400. Native generate_image and image workflow action check bound intent before dispatch/auth lookup.
- Current upstream selector is **unverified**; bound attempts fail with an explicit nonretryable error before any generation. No mapping to a guessed model or to provider-default.
- Explicit `upload:N` handles for current-turn PNGs. Backend owns the bytes and scope. Canonical base64/PNG integrity checks reuse the adapter validator; arbitrary paths/URLs, duplicate/wrong-turn/invalid inputs rejected. No automatic recent screenshot selection.
- `.feature` scenarios plus executable Given/When/Then Vitest tests (no Cucumber dependency/runner). Release gate is a separate command, not hidden skipped success tests.

## TDD record

Observed red before implementation: frontend 5 scenarios; serializer4; native dispatch9; account-routing2; review regressions account mismatch1 and UI2; reference validation3; workflow3 (including gate validation order). Backend module first red was a missing-module collection failure, not behavioral proof. Tests then went green after actual implementation. Independent reviewer findings fixed, not waived.

Evidence directory outside repo: `/home/tryinget/agnt/projects/codex-images-tdd-20260909-LBX2cf` contains pre-edit snapshots, scoped patch, red/green logs and release-gate result. Snapshot packaging excludes unrelated local auth/account changes.

## Boundaries and unresolved acceptance

1. **Provider gate unresolved:** Codex has not established distinct supported quality/fast selectors. Prior invalid-model generation means two successful images do not prove selection. No new quota-consuming requests were made this continuation.
2. **Not full no-bypass enforcement:** the existing no-intent programmatic provider-default path is retained. Bound chat/action guards are tested, but unrestricted generic HTTP/shell tools, independently dispatched agents, full workflow recovery and global egress enforcement are not covered. Do not claim production-wide API billing exclusion from these tests.
3. **UI preference scope is browser/account, not synchronized user settings.** Controls change future-turn preferences. Switching off does not cancel an already-dispatched request.
4. **Reference completion missing:** prior-generated-image selection and durable cross-turn handles, host-controlled per-image selection UX, and rendered generate/edit pilot remain incomplete. Upload index is based on image upload order, not arbitrary file order. Two fixture images prove resolver scope, not end-user selection approval.
5. **Usage ledger and deduplication incomplete:** no full image billing-ledger integration, provider billing audit, crash-safe idempotency, or workflow recovery replay guarantee delivered.
6. **Text fast provenance:** #103 requests priority; no new live proof of effective tier, speed or provider charge. Published multipliers are explanatory and not observed billing evidence.
7. **Tests/build versus deployment:** no backend restart or opt-in activation, no upstream merge. Tests use disposable data; live checkout retains unrelated work. Full frontend teardown/browser environment limitations must be reported separately.

## Test commands

- Focused backend: `vitest run backend/src/services/ai/codexImageIntent.test.js backend/src/services/ai/codexImageReferences.bdd.test.js backend/src/services/orchestrator/tools.codexImages.bdd.test.js backend/src/tools/library/actions/generate-with-ai-llm.codexIntent.bdd.test.js` plus existing adapter/native/image-selection suites.
- Focused frontend: `NODE_OPTIONS=--no-experimental-webstorage vitest run src/components/common/CodexGeneration.bdd.spec.js src/services/chatService.codexImages.bdd.spec.js src/store/features/chat.codexImages.bdd.spec.js` plus existing Codex speed suites.
- Necessary release gate: `node scripts/check-codex-image-release.mjs` (currently BLOCKED, exit2). It does not call providers or prove live acceptance.

PR #117 depends on #116 (image defaults) and #103 (text speed UI). Dependency merge preserves #103's exact parent commit; it is not an upstream merge or change to #103's draft state.
