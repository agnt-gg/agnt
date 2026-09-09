# Image model selection

OpenAI image requests without a model use the AGNT policy **`latest`**, not a hard-coded model version. `latest-fast` selects the speed tier. These policy names are resolved once inside the native image action using its already-authenticated OpenAI SDK client; neither name is sent to OpenAI. Chat and workflow execution use the same action.

A fresh `models.list` is read on every automatic request, with a 10-second deadline and zero discovery retries. There is no cross-account cache, static fallback, or extra image-generation probe. Empty, failed, malformed, incomplete, ambiguous or incompatible catalogs fail clearly. A catalog entry is discoverability, not proof of account entitlement or endpoint compatibility; the provider may still reject generation.

## Ranking and limits

The resolver recognizes stable numeric `gpt-image-*` releases and known sibling names in one module, `imageModelSelection.js`. It compares version components numerically (2.10 is newer than 2.9). Quality prefers Sunburst or unsuffixed full models; speed prefers Flare/mini or unsuffixed models. Version is ranked before sibling preference. Automatic mode excludes dated snapshots, previews, unknown sibling names, and entries marked deprecated. Missing provider deprecation metadata cannot establish that a model is current. New numeric releases within the known contract do not require a new default literal; new variant names or incompatible endpoint/parameter contracts still require review.

Explicit IDs, including dated snapshots, remain pins and are sent unchanged without catalog discovery. The endpoint validates availability. Unsupported Edit/Variation choices are rejected rather than silently replacing the pin with another model. Existing saved workflows are not rewritten. A workflow designer that has already saved an explicit ID remains pinned; choose/enter `latest` explicitly where the UI permits it. This change does not redesign the model dropdown or change the text-mode schema default.

Rendering size/count/quality are independent of model selection. This patch preserves existing rendering controls; it does not automatically raise quality to max or claim all future parameter sets are supported. Other image providers retain their current defaults.

## Receipts

`imageMetadata` records `requestedModel`, `selectionMode`, `resolvedModel`, `returnedModel`, `catalogSource` and `catalogFetchedAt`. Requested and resolved models are request provenance; only a provider-returned model is engine identity. Missing returned identity stays null. The model used for the workflow usage record is the resolved request model, not the policy label. This is not an image accounting overhaul: existing generic usage handling remains, and zero text tokens must not be interpreted as free image generation.

## Codex is separate

This PR changes the OpenAI API-key image path, not subscription image transport. A 2026-09-09 direct Codex probe returned images for 2.5 names **and an intentionally nonexistent model ID**, with no engine identity. Therefore HTTP 200 proves image transport, not honored 2.5 selection or reliable pins. Native Codex transport is a separate PR and must preserve this limitation. See issue #105.

## Verification

Deterministic tests cover numeric ranking, policy/pin separation, unknown variants, deprecation flags, empty/error/timeout catalogs, concurrent account isolation, future compatible releases, and native chat/workflow forwarding. Live OpenAI API-key dogfooding remains unavailable when no key is configured; do not substitute the Codex route or claim mocked tests establish it.
