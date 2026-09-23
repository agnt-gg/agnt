# Independent image settings — implementation checkpoint

2026-09-09. **Draft foundation only; not a working Settings > General > Images feature yet.** This is PR2 of the three-part image split, based on #116 ebcfb1ca. No #103 or #117 ancestry required. Production migration/HTTP routes and dispatch integration are not mounted by this checkpoint.

## Fresh-eyes corrections

- Image defaults must be resolved by authenticated server code, not inferred from the text provider or raw browser enabled fields.
- Settings writes need atomic compare-and-swap revisions, not theme preferences' last-write-wins timestamp.
- Freeze ordinary options for in-flight work, but immediately before dispatch recheck current consent revision and account binding. Revocation/regrant must not resurrect old queued work.
- Persisted explicit workflows use their own connection/model, not an indiscriminately attached disabled global default. Subscription consent remains mandatory.
- A provider slot string is not a stable account identity. Production descriptor integration must supply owner, binding identifier, capabilities and consent requirement, and establish that the client created asynchronously matches that binding. Token refresh is not account replacement. Missing reliable metadata must be surfaced, not invented.

## Implemented modules

`backend/src/services/images/imageSettingsContract.js` defines an internal pure contract for versioned settings, options, grants and issued request snapshots. It accepts dependency-injected server connection descriptors, not credentials. Plain-record/accessor validation, model/schema checks and revision limits are enforced. WeakSet-issued snapshots cannot be forged by passing deserialized request objects directly to pre-dispatch validation; workflow processes must rebind at their trusted entry point.

`imageSettingsStore.js` uses an injected existing SQLite connection, not a second database. Schema initialization is explicit and currently only exercised by tests. The proposed dedicated image_settings table provides independent revision semantics so old text/theme writers cannot overwrite consent. First insert and subsequent updates are single-statement CAS. Missing record means unconfigured. Reads validate schema and DB/document revision agreement. No import-time DB writes.

The existing reference picker and all six associated source/test files were preserved from #11774e16320. Host wiring was transplanted from eb01dc3a, not copied from a dirty live checkout. The browser fixture now imports the identical synthetic PNG fixture from tests/fixtures/imagePng.js, removing a Codex-specific dependency. No new image store, unbounded thumbnail requests, automatic Send or filesystem URL selector. Main/unified keyed conversation scope, pending cancellation and removal of already-attached picked references on scope change are retained.

## Validation in this checkpoint

- Initial contract/storage red runs were missing-module failures, not behavioral proof.
- Independent contract review produced8 behavioral red regressions (inherited/accessor fields, invalid state/model) then fixed to green.
- Store review produced2 behavioral red regressions (non-OpenAI default roundtrip, mutable save receipt) then fixed to green.
- 30 contract tests plus7 store tests pass. Store tests use actual SQLite, including two independent connections racing revision0; one wins and one conflicts. Also tests revision1 stale update, user separation, persisted defaults and receipt snapshot.
- Preserved picker/host/loader33 tests pass on this dependency-independent branch; production frontend build passes.
- Exact full-suite/browser results belong in PR receipt after execution; do not reuse #117's old qualification for this branch.

## Required next implementation

1. Qualified server connection resolver using existing nonsecret connection metadata. Do not add credential readers or modify auth storage. Explicitly establish disconnect/rebind and client-affinity behavior; restricted-area changes require owner involvement.
2. Main-process schema migration registration and authenticated settings GET/PUT using existing middleware. CAS conflict ->409, reject malformed writes, perform owner-aware account resolution; no arbitrary client-supplied binding/grant fields. User-selected consent comes from the authenticated settings action, never LLM arguments.
3. One shared settings/store/UI authority and composer shortcut. Conditional OpenAI Quality/Fast/pin options; supported Gemini/Grok options; no separate image controls in text-speed component. No automatic paid default.
4. Safe legacy migration: keep local codexImages data for reconciliation; never promote enabled=true into new consent; don't silently relabel old experimental policies. Existing explicit API workflows unchanged.
5. Production request construction/revalidation after async client initialization, no-replay semantics, actual native HTTP/workflow and user-journey tests. Recheck revocation and binding without interpreting missing identity as permission.
6. Generic upload reference/PNG handling and supported OpenAI Edit action; Codex-specific transport is separate PR3. Keep all picker behavior.
7. Bounded approved live generation/edit pilot only after production integration and release review. No provider calls, restart or activation in this checkpoint.

## Non-goals

No Codex engine selection, no text speed changes, no provider authentication changes, no new image services, no universal video/audio framework, no new approval system, no global sandbox for arbitrary shell/HTTP tools, no silent provider/account/model fallback, no claim of exactly-once remote execution or independently verified provider billing.

Historical experimental implementation and evidence remain intact on #117. This branch does not delete or rewrite them. Existing live checkout and its settings remain unchanged.
