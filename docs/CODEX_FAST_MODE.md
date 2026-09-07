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
chat propagation and streaming/non-streaming adapter requests. No live authenticated
request or service-tier acceptance/performance test was performed.
