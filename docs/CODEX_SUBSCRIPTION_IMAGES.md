# Codex subscription images through independent settings

## Behavior

Choose Codex subscription under Settings > General > Images, explicitly allow allowance use, and Save. Image settings do not follow text provider/model. Production uses only provider-default and sends no named model field; the provider chooses its engine. No claim of verified latest, Sunburst/Flare, free usage or exact engine identity.

The existing Codex auth manager supplies its nonsecret account ID. Consent stores a hashed account binding; the created SDK client's account header must match before any POST. Current connection and stored consent revision are then revalidated. Missing consent is enforced for interactive tools and explicit workflow/native action calls. Revocation during asynchronous initialization is covered. Auth/credential files and login handling are unchanged.

This first clean upstream adapter advertises the primary Codex connection only. Account2 host support is separate work, not silently copied from the dirty workstation. Existing API workflows retain their explicit settings; global image defaults apply to interactive chat. Consent is never migrated from the old browser-only experimental toggle.

## Real local smoke

On 2026-09-09, the native tool on this candidate used persisted settings and consent in a disposable database, with Gemini as text-provider context:
- Generate: success,1536x1024,40.796s, request0e4f80c0-6ea4-45d7-bce4-3cafa05fd276.
- Edit the exact generated PNG, Canopy -> Grove: success,1536x1024,55.331s, request39fd9ecc-fbaa-4180-9cc7-241becc1dcf0.
- Both persisted through ImageStorage; requestedModel provider-default, returnedModel null. Reported usage647 and2952total tokens; price unknown.
- Evidence /home/tryinget/agnt/projects/usable-image-smoke-OSLeTD/receipt.json. This is real native provider traffic, not a full rendered Send-to-provider roundtrip. Existing browser tests separately cover settings save/composer and explicit reference selection/no-send.
- Two planned image calls, no automatic retry. No live app settings, schema or backend process was changed.

## Qualification

Six native integration tests pass: independent text/image choice; editing reference; absent consent across direct/workflow entry; revocation during factory initialization; account rebind; mismatched client affinity.34transport tests include mandatory beforeDispatch hook;86contract/storage/service/transport/integration tests pass together. Missing-hook regression observed red then green. Final build and two composed real-browser tests pass (settings HTTP mocked, media fixture mocked).

Full composed backend run is NOT green: plugin tests cannot resolve Node builtins stream/stream/promises under this worktree's installed Vitest environment; route inventory checks consequently cannot import those routes. Do not claim these are fixed by focused tests. Full settings-only branch6012passed1platformskip. Frontend4475passed before final portable-abort delta; final focused39passed and composed build/browser2passed after that delta. Earlier browser/tab and PopupTutorial teardown failures retained in logs.

## Remaining boundaries

- No distributed exactly-once guarantee, authoritative image price ledger or global prevention of unrelated HTTP/shell tools.
- Provider runtime/flag does not itself grant consent.
- API-slot binding does not prove a particular API billing account identity.
- Return failures without automatic regeneration; interrupted dispatched requests may consume allowance.
- Before deploying, explicitly select this clean composed branch or reconcile the dirty live checkout with backups. A restart of the old checkout alone does not install these changes.
- Existing #117 remains preserved for comparison until replacement/history disposition is authorized; this clean branch is not yet approved for merge.
