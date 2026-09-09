---
summary: "Codex priority speed control: scope, persistence, wire behavior, and limits."
read_when:
  - "Using or changing the Codex speed control."
type: "reference"
---

# Codex fast mode

The AI Provider panel and Settings → AI Model expose two Codex speed choices:

- **🐢 Standard** (default): omit `service_tier`, preserving the previous request.
- **🐇 Fast**: request `service_tier: "priority"` from the Codex Responses endpoint.

This follows `pi-better-openai`'s fast-mode payload injection, not a faster model
or reduced reasoning effort. The selected model and reasoning effort stay unchanged.
Priority availability, latency and quota/cost depend on the upstream service;
“Priority requested” is not confirmation of the tier actually served.

The preference is stored in this browser's localStorage under `codexPriority`.
It applies to Codex calls initiated through the main chat and unified chat panels,
including requests routed or failed over to Codex. It does not configure background
jobs, other browsers, other providers, authentication, or Pi's own settings.
The control remains accessible in Default/Dynamic routing modes.

**Cost limitation:** AGNT's current token cost estimates do not include the priority
surcharge. Use the provider's usage/billing surface for actual consumption.

## Reasoning is separate

Commit `20898acb` (2026-09-04) added GPT-6 Astra support and the real `max`
reasoning value above `xhigh`. Older GPT-5 UI controls label `xhigh` as “Max”.
Neither effort value enables priority scheduling. A fast answer at high/max effort
alone does not establish which service tier was used.

## Implementation and verification

- `frontend/src/components/common/CodexSpeedControl.vue`: shared accessible controls.
- `frontend/src/store/app/aiProvider.js`: independent, off-by-default preference.
- Main/unified chat stores and `chatService.js`: JSON/multipart propagation.
- `OrchestratorService.js`: strict true/`'true'` normalization and primary/fallback options.
- `orchestrator/transports/openaiResponses.js`: Codex-only priority injection.

Synthetic tests cover component state, persistence, request serialization, routed
chat propagation and streaming/non-streaming adapter requests.

### Readiness qualification — 2026-09-09

The original feature commit is `c6025bb9`. A separate candidate combined it with
upstream `5ede8e72` and the tutorial test-fixture cleanup; no image feature was
included. Qualification used Node 26, installed dependencies matching the unchanged
lockfiles, a sanitized environment, sandbox HOME, and a short non-hidden TMPDIR.

- Full backend: **375 files, 5,938 passed, 1 existing platform-specific skip**.
- Full frontend at default concurrency: **264 files, 4,462 passed, exit 0**.
- Production frontend build: **passed**, with existing chunk-size warnings.
- Playwright `--grep @ci --workers=2`: **25 passed**, Chromium 145.0.7632.6
  (Playwright headless-shell revision 1208), isolated data and mocked external APIs.
- Whitespace and line-ending checks: **passed**.

The original `c6025bb9` base plus cleanup also passed all **4,438 frontend tests**
at default concurrency twice. The unmodified base had passed all 5,865 backend
tests with zero skips after correcting the temporary-directory environment.
These are local qualification results, not GitHub CI or deployment evidence.

The two initial backend failures were environmental: hidden TMPDIR ancestors
triggered portable-bundle exclusions, while a long TMPDIR exceeded Chromium's
Unix-socket path limit. Use a **short, non-hidden** temporary path. On Node 26,
`NODE_OPTIONS=--no-experimental-webstorage` avoids the host's experimental
localStorage conflicting with jsdom. Keep credentials out of regression runs:

```sh
# Set these to dedicated test directories; keep TEST_TMP short and non-hidden.
env -i PATH="$PATH" HOME="$TEST_HOME" TMPDIR="$TEST_TMP" \
  NODE_OPTIONS=--no-experimental-webstorage CI=1 npm test
env -i PATH="$PATH" HOME="$TEST_HOME" TMPDIR="$TEST_TMP" \
  NODE_OPTIONS=--no-experimental-webstorage CI=1 npm --prefix frontend test
# Build before the browser gate; provision the matching Playwright browser.
```

`PopupTutorial.spec.js` now owns per-scenario unmount, DOM restoration and controlled
timer progression. Its Gherkin-style regression was observed RED (7 failing
scenarios) before cleanup and GREEN afterward. The acceptance description is
`tests/acceptance/popup-tutorial-teardown.feature`; executable steps are the Vitest
Given/When/Then scenarios, not a separate Cucumber runner. Assertions verify no
mounted component, pending timer or DOM fixture remains **before** safety cleanup.
No production lifecycle code, test exclusion or error filter was changed.

### Live evidence and limits

Two tiny authenticated native chat smoke probes, one Standard and one Fast,
returned the expected text with `gpt-6-astra` and `max` reasoning. They used the
running local app, **not an isolated deployment of this exact candidate**.
The returned data did not expose the provider-served tier or billing. They do
not establish priority acceptance, latency improvement, reliability or surcharge.
The wording remains **Priority requested**; actual usage belongs to the provider.

### Dependency boundary

PR #103 owns text Standard/Fast. PR #117 owns subscription image controls and
already incorporates the exact original #103 commit via dependency merge
`95144040`; image commit `400a6119` builds on that shared component. Update #103
once, then bring its resulting commit into the image branch. Do not create a
second copy of the text implementation, reverse-merge image work into #103, or
interpret these green text/test gates as satisfying #117's image selection gate.
