> **2026-09-09 empirical-mode update:** the earlier blanket-block descriptions below are historical. User-authorized experimental `latest` / `latest-fast` now send distinct Sunburst/Flare candidate requests through native Codex generation/editing; unknown engine identity is disclosed, not blocked. See [current implementation, six-call pilot, and limits](CODEX_IMAGE_EMPIRICAL_PILOT.md). No proven speed/quality advantage or automatic subscription catalog discovery is claimed.

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
4. **Previous-result attachment delivered; provider edit pilot blocked:** the composer now lists persisted native generate_image receipts from its keyed conversation slot. Explicit selection downloads one PNG through the configured AGNT media route (8 MiB/deadline/redirect bounds), emits a scoped File into the existing attachment flow, and never sends automatically. Pending and already-attached picked references are discarded on conversation switch; ordinary files remain unchanged. No new durable cross-turn server handles: the selected image is re-uploaded as an explicit current-turn attachment. The actual two-policy edit request and result still need provider acceptance. Media loading uses the existing authenticated media endpoint; this is not a new ownership/auth layer. Lists omit prose links, failed receipts and outputs without retained savedImageIds; previews are labels/IDs, not unbounded thumbnail downloads.
5. **Usage ledger and deduplication incomplete:** no full image billing-ledger integration, provider billing audit, crash-safe idempotency, or workflow recovery replay guarantee delivered.
6. **Text fast provenance:** #103 requests priority; no new live proof of effective tier, speed or provider charge. Published multipliers are explanatory and not observed billing evidence.
7. **Tests/build versus deployment:** no backend restart or opt-in activation, no upstream merge. Tests use disposable data; live checkout retains unrelated work. Full frontend teardown/browser environment limitations must be reported separately.

## Test commands

- Focused backend: `vitest run backend/src/services/ai/codexImageIntent.test.js backend/src/services/ai/codexImageReferences.bdd.test.js backend/src/services/orchestrator/tools.codexImages.bdd.test.js backend/src/tools/library/actions/generate-with-ai-llm.codexIntent.bdd.test.js` plus existing adapter/native/image-selection suites.
- Focused frontend: `NODE_OPTIONS=--no-experimental-webstorage vitest run src/components/common/CodexGeneration.bdd.spec.js src/services/chatService.codexImages.bdd.spec.js src/store/features/chat.codexImages.bdd.spec.js` plus existing Codex speed suites.
- Necessary release gate: `node scripts/check-codex-image-release.mjs` (currently BLOCKED, exit2). It does not call providers or prove live acceptance.

PR #117 depends on #116 (image defaults) and #103 (text speed UI). Dependency merge preserves #103's exact parent commit; it is not an upstream merge or change to #103's draft state.

## Follow-through review (2026-09-09)

#103 is now ready for review at 21208828; its blocking GitHub checks are green. #117 inherited it at 332fb40f; the shared change since 400a6119 is test-fixture cleanup/documentation, not new image-selection support. This continuation adds the previous-result picker and its tests. No server restart, activation, provider generation or API-key billing request occurred.

New local qualification: 6060 backend tests passed with one existing platform skip (browser suite included); 4508 frontend tests passed; build passed; 26 Playwright @ci tests passed. The new browser test mounts the real built app, seeds a synthetic conversation receipt, mocks its PNG media response, clicks the picker and checks the visible attachment/no-send/scope cleanup. It is not a live provider or media-auth test. Original missing-module/syntax/path fixture failures were retained; three review regressions (unbounded thumbnail, mismatched scope, missing emitted scope) were observed red then green, plus wrong-conversation attached-reference cleanup.

Read-only upstream check at openai/codex 129fd216 still exposes no quality/fast image-model selector in the built-in tool. Images 2.5 rollout announcement is not proof of selectable Sunburst/Flare subscription routing. The release gate still exits 2 for both policies. Remaining global no-bypass, image-ledger, deduplication and actual two-choice generation/editing acceptance are not waived.
