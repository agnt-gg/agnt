# Native voice request origin binding

Batch 15 binds each native submit at the existing transport, before fetch. Only the existing verified AGNT session user is used; no token decoding or alternate account lookup occurs. A fresh crypto UUID in `X-AGNT-Voice-Request-Id` correlates the POST to server lifecycle receipts. This nonce is NOT authentication: the shared server handler continues to obtain userId from normal authentication and merely echoes a bounded nonce.

The native adapter rejects missing/late/repeated binding. Expected identity is copied before events; received receipt fields cannot establish the expected user or model. Known conversation IDs are required to match; new temporary IDs are omitted until the authenticated request establishes the server conversation. Text model/provider comes from the host's actual resolved selection, never the audio model. Voice transports pin that selected pair for the turn; typed routing remains unchanged. Unified panels use the same strict adapter as main/agent/mobile. Mobile transmits normalized current-turn metadata rather than only displaying it locally.

## Boundaries still open

- Provider-account attestation remains `unattested`; this is an AGNT user/request binding, not proof of the provider payer account.
- Server fallback policy is not disabled here. A differing actual terminal provider/model refuses narration, but that is not a pre-execution destination guarantee.
- Main/agent/unified require a selected pair; missing routing information fails before fetch rather than guessing. Agent default-mode selection needs full UI qualification.
- These tests use real production imports and synthetic SSE/server receipt construction, not live provider or post-gate PCM evidence.
- Durable autosave/duplicate arbitration, reconnect reconciliation, faster-Qwen owner admission, and selected-model live rendered-UI dogfood remain separate milestones.
