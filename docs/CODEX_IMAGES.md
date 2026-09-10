> **2026-09-09 empirical-mode update:** the earlier blanket-block descriptions below are historical. User-authorized experimental `latest` / `latest-fast` now send distinct Sunburst/Flare candidate requests through native Codex generation/editing; unknown engine identity is disclosed, not blocked. See [current implementation, six-call pilot, and limits](CODEX_IMAGE_EMPIRICAL_PILOT.md). No proven speed/quality advantage or automatic subscription catalog discovery is claimed.

# Native Codex images (opt-in draft)

This transport is separate from the OpenAI API-key `latest` resolver. Enable explicitly with `AGNT_CODEX_IMAGE_ENABLED=true` when starting an AGNT test/runtime. It is **off by default**. Do not restart a running server without operator authorization.

## Model truth

A 2026-09-09 direct Codex negative control returned an image for an intentionally nonexistent model ID. The same endpoint also worked with no `model` field. Accordingly this adapter sends **no model ID** and exposes only `provider-default`. It rejects `latest`, `latest-fast` and explicit model pins rather than pretending to honor them. There is no hard-coded image version to update, but no guarantee the backend chooses the newest engine either. GPT Image 2.5 engine identity is **unverified**.

Metadata distinguishes `requestedModel: provider-default`, `selectionMode: provider-selected`, `resolvedModel: null`, and nullable `returnedModel`. Even a returned label is not independent engine verification; `modelIdentityVerified`, `modelSelectionVerified` and `latestVerified` remain false.

## Native paths

- Chat: `generate_image` with an explicitly selected existing Codex connection; omit model. Generation persists through existing ImageStorage.
- Workflow action: Image Generation / Generate or Edit, selected existing Codex provider, model `provider-default` (or no model).
- Chat Edit accepts an explicit `referenceImages` array of PNG data URIs. Workflow Edit also accepts its existing `referenceImage` data URI field. Never select both.
- Client comes from existing `createLlmClient(provider, userId)`. No new login, credential store, provider key, account switch, API-key fallback, Pi dependency or hosted text-model intermediary.
- Only already-configured Codex accounts receive the opt-in capability. Upstream currently has the primary provider; a local checkout with an existing Account 2 uses that existing client mapping. This PR does **not** add Account 2 authentication upstream.

## Deliberately narrow contract

One output, auto size/quality, no style/aspect-ratio/variation/mask. Up to three explicit noninterlaced 8-bit grayscale/RGB/RGBA PNG references, 8 MiB each and 16 MiB total encoded references. Palette/interlaced/16-bit PNG, JPEG/GIF/WebP references, paths, remote URLs, implicit recent-image selection and screenshot capture are not supported by this first adapter. Unsupported inputs fail rather than being silently dropped.

Output response accumulation is capped at 16 MiB; decoded PNG at 8 MiB/16 megapixels. Signature, chunk bounds/CRC, header encoding, terminal chunk, decompression size and scanline filters are validated without loading a native image library. This is a limited PNG profile, not a full general-purpose decoder.

Only the fixed Codex destination is used. Redirects are rejected and SDK retries disabled. Local waiting is bounded, including asynchronous client initialization and stalled response streams. The existing client factory itself is not cancellable: the adapter stops waiting and will not dispatch after cancellation, but cannot stop internal authentication refresh already underway. Synchronous bounded PNG validation is not preemptible; an elapsed deadline is checked before success.

Error receipts distinguish auth rejection, entitlement rejection, rate limit and uncertain outcomes. Errors do not echo raw SDK bodies, credentials or private prompts. No automatic re-generation after uncertain dispatch or storage failure.

## Usage and delivery limits

Provider usage is kept as returned in `imageMetadata.usage`; absent usage and cost stay null. The adapter does not invent a zero-token priced LLM ledger row. Integrating image usage into the authoritative ledger without an established engine/rate is a **remaining review item**, not a claim that usage is free or fully accounted for.

The ordinary workflow action returns image data/metadata; durable workflow artifact lifecycle beyond existing behavior is not added here. Chat uses existing ImageStorage and reports persistence failure rather than success. Data-URI reference inputs are a narrow programmatic interface; privacy-preserving host-owned upload/artifact handles and UI selectors remain required before broad release. Do not paste private base64 into model-visible prompts.

## Evidence

2026-09-09 clean PR candidate, isolated data directories, existing primary Codex account:
- Real native `generate_image` -> direct endpoint -> ImageStorage PNG: succeeded, 1254×1254, request `fec353c1-01c4-4294-b486-db80ea54ce86`, provider usage present, engine unknown.
- Real native workflow action Edit of a synthetic PNG: succeeded, 1254×1254, request `d097c8ca-dbf4-410e-bc86-621d978bfbb5`, returned PNG saved by test harness, provider usage present, engine unknown.
- These were function-level native dogfood runs, not a UI click, scheduled workflow execution or live-server deployment.
- Earlier direct-only Account 2 generation worked, but Account 2 native integration is deterministic-fixture coverage, not clean upstream live verification.
- Initial direct Sunburst probe crashed before a receipt; remote outcome unknown, not retried. Other raw positive controls cannot establish model identity because the invalid-model control also generated.

Keep this PR draft until maintainers review the backend-specific contract, provenance, usage-ledger handling, reference UX/privacy and desired release scope. See #105 and separate latest-resolver PR #116.
