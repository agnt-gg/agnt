# Completion persistence boundary — batch 14

The server mirror now rejects a completed receipt unless the terminal provider row has the exact assistant ID and SHA-256 final-text digest observed by the receipt. Duplicate IDs, nonterminal finals, wrong text and missing IDs are rejected. A strict projection retains tool cards but replaces merged draft prose with the final, including an empty final.

The production handler binds only a matching string final row to its actual server-emitted assistant ID. Other provider shapes fail closed for authoritative mirroring; block-array provider finals and sanitizer behavior still need full handler qualification. Ledger IDs are stripped at the provider request boundary.

Saved rows written by this path contain a serverCompletion seal with execution/request/message identities, final digest, user-turn fingerprint and incrementing mirror revision. Same-turn writes after a seal are refused, even if longer. A later user turn may advance the revision. This is conservative immutable-turn arbitration, not a complete run-supersession design.

All mirror writes use one SQLite UPDATE comparing the exact old content, authenticated user, conversation and row ID. A changed row yields concurrent_write without retry. Unrelated columns and existing titles are not overwritten. An absent title may be derived. This also protects mirror-versus-autosave races where autosave lands BEFORE the mirror UPDATE.

## Explicit remaining limits

- The ordinary HTTP autosave upsert can still overwrite a seal AFTER a mirror write. Its contract must join durable server-owned arbitration before claiming cross-writer safety.
- Duplicate saved rows still use the legacy longest-row selector; no global conversation revision is implemented.
- Seals inside JSON are not authentication attestations for HTTP clients. A separate durable server-owned revision/GET contract is still required; do not trust client-submitted serverCompletion fields.
- Reconnect still reconciles by substance and can retain a longer stale draft.
- Same-turn legitimate supersession is deliberately rejected pending explicit revision authorization. Mirror revisions are not distributed run ordering.
- done.transcriptPersisted still describes conversation-log durability, not fire-and-forget mirror completion.
- These are offline production-import and real isolated SQLite checks, not selected-model rendered playback dogfood or human audio acceptance.

Frozen reviewer probes remain unchanged. Batch evidence retains red and green trials.
