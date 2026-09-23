# Independent image workflow — implemented 2026-09-09

## User workflow

Settings > General navigation group > Images selects the image service independently of text. The existing internal `general` section is Logout, so Images has its own section under the General caption. The same component appears in main/unified composers. OpenAI API offers latest quality, latest fast and exact pin; API billing is explicit. Gemini/Grok retain advertised models. Missing configuration produces a setup error rather than choosing a paid image provider from the text model.

User settings are persisted in the existing SQLite database's versioned image_settings table, initialized by the main schema path; workers do not create schema. Authenticated /api/users/image-settings GET/PUT uses the existing middleware plus an explicit isAuthenticated check. Writes use CAS; conflicts require reload. Unknown client binding/grant fields are rejected by the contract. No credential-storage changes.

Interactive native generate_image resolves settings server-side and rejects model/provider overrides inconsistent with the saved configuration. Explicit API workflows retain their existing parameters. A prepared request freezes options and rechecks availability and consent immediately before the supported provider dispatch, with an invocation-local duplicate guard. This does NOT provide crash-safe exactly-once or constrain general-purpose HTTP/shell tools.

Previous-result picker remains intact: select persisted output, attach a visible copy, describe edit and Send. Current-turn PNG upload handles now work for the OpenAI edit path; providers without edit support reject it. No automatic image send, arbitrary paths or external URLs. Actual model/provider image validation remains authoritative.

## Consent extension

Codex is supplied by the separate subscription adapter branch. The UI offers explicit allowance consent and a separate Revoke action that works while disconnected; changing text models has no effect. Revocation-only writes do not require successful provider discovery. A fresh connection descriptor and persisted consent are re-read before dispatch. Existing experimental browser preferences are not migrated or promoted to consent; new settings begin unconfigured.

API-key services expose existing per-user credential slots, NOT verified billing-account identities. Account-specific Codex binding is handled separately. Connection descriptors in responses are allowlisted and stored authorization bindings are removed from public projection. Settings authorization tokens are not stored by this feature.

## Verification and limitations

- Contract/store/service/native settings tests exercise actual SQLite and native request binding with provider SDK boundaries mocked. Full settings-branch backend:6012passed,1platformskip; no explicit exclusion. An earlier run had a browser tab fixture failure; retained log.
- Full frontend4475passed on the pre-final lifecycle delta. Final focused UI/picker39passed; portable cancellation correction is covered. Earlier jsdom AbortSignal.any and offline revoke/stale draft errors were reproduced and fixed; no assertion weakened.
- Real built-app settings scenario selects API Fast and saves it, then observes the configured composer. Its settings response is mocked; native persistence/service tests cover that other boundary. Prior picker browser scenario preserved. No API-key image generation was purchased for this work.
- General image model and connection settings are implemented; advanced rendering settings, conversation overrides and a distributed write/revocation lock are not introduced. Same-tab components refresh on saved events; other clients detect conflicts/reload rather than real-time push synchronization.
- Bound-request controls cover native image action paths; no claim that arbitrary tools cannot spend provider credits. Post-dispatch uncertainty is not proof of no usage/refund. No automatic provider fallback.

## Runtime status

This implementation is in isolated PR worktrees. The live checkout still contains the earlier experimental text-coupled image settings. Do not simply merge the dirty checkout wholesale or assume a restart loads these new branches. Integrate the selected reviewed commits or run the clean composed candidate explicitly. No live settings migration, restart or merge was performed this continuation.
