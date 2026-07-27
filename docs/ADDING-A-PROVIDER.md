# Adding a Provider — Integration Checklist

Every surface a provider must be wired through, in dependency order. Derived
from the PR #50 (grok-build / cursor-cli) integration audit on 2026-07-27,
where each unchecked box below was a real, live-reproduced failure.

## 0. Transport triage — DO THIS FIRST

"CLI provider" is not one archetype, it is three, and picking the wrong one
costs you the entire tool surface. Decide by measurement, not by the vendor's
marketing:

| Transport | Examples | Tools? | How AGNT talks to it |
|---|---|---|---|
| `http-direct` | openai, anthropic, groq | yes | API key, normal SDK |
| `http-borrowed-oauth` | openai-codex, claude-code, **grok-build** | **yes** | CLI owns the credential, AGNT builds the request |
| `cli-subprocess` | cursor-cli | no | spawn, pipe text in, parse text out |

**A subprocess transport can never call AGNT tools.** It flattens the whole
conversation into one text prompt; there is no function-calling channel, so
every schema is dropped and the model narrates calls it cannot make. Only
choose it when you have proven no borrowable endpoint exists.

### The 15-minute probe that decides it

Before writing a single line of connector code, check whether the CLI is a
thin client over a real API you can reuse:

1. **Find the credential.** `~/.<cli>/auth.json` or similar. A `key` /
   `access_token` field plus `refresh_token` and `expires_at` means the CLI
   holds a normal OAuth token.
2. **Find the endpoint.** The provider config, the CLI's `--help`, or
   `strings` on the binary. (grok-build's was sitting in `baseURL`, labelled
   "not used for HTTP".)
3. **Probe it.** `GET /v1/models` with `Authorization: Bearer <token>`.
   A 200 with a model list means the API is real and your token works.
4. **Read the rejection.** A 4xx is often a *missing header*, not a wall.
   grok replied `426 Upgrade Required: "Your Grok CLI version (none) is
   outdated"` — a version gate, satisfied by one header.
5. **Recover the headers from the binary.** Grep for `x-<vendor>-client`,
   `x-<vendor>-version`, `client-version`. grok.exe yielded
   `x-grok-client-version` / `-identifier` / `-surface`.
6. **Prove tools.** POST `/chat/completions` with a `tools` array and assert
   `finish_reason: "tool_calls"` comes back. This is the whole question.

MEASURED 2026-07-27: grok-build shipped in PR #50 as `cli-subprocess` and was
therefore tool-blind. The probe above found a fully OpenAI-compatible endpoint
that accepts tools, streams deltas AND reasoning, and reports
`prompt_tokens_details.cached_tokens`. It is now `http-borrowed-oauth` with
the complete AGNT registry. The same probe on cursor-cli found no readable
token (`apiStatus: 401`), so it legitimately stays a subprocess.

If the transport is `http-borrowed-oauth`, sections 4 (CLI process rules) and
most of the streaming caveats simply do not apply — you are writing a normal
HTTP provider that happens to read its token from disk.

---

## 1. Core registration — `backend/src/services/ai/providerConfigs.js`

- [ ] Provider entry: `key`, `name`, `authScheme`, `capabilities`.
- [ ] `modelMetadata` for **every model in `fallbackModels` — especially the
      default model**. A missing entry silently falls back to the generic 128k
      context window and halves the tool/context budget.
      *(Failure seen live: `cursor-grok-4.5-high` had no entry → 128k instead of 256k.)*
- [ ] `capabilities.text.supportsTools` must be HONEST. The orchestrator reads
      it via `providerSupportsTools()` and sends **zero** tool schemas when
      false. A CLI that cannot receive function schemas but claims `true`
      makes the model narrate tool calls that never execute.
- [ ] Seat-based billing? Add to `SUBSCRIPTION_PROVIDERS` so the cost panel
      labels usage *notional*, not billed. Price the models at 0 (or real
      metered prices if a metered API twin exists — see claude-code).
- [ ] `getContextBudget(model, provider)` returns the right window for every
      listed model (this is derived from metadata; just verify).

## 2. Auth — `backend/src/services/auth/`

- [ ] Auth manager with `checkApiUsable({ forceRefresh })` returning
      `{ available, apiUsable, error, ... }` — the error string must contain
      the exact fix command (e.g. "Run: grok login --oauth").
- [ ] `AuthDispatcher.js` scheme entry. `AuthManager.getValidAccessToken(userId,
      provider)` must resolve (a real token or a placeholder string) — the
      ToolForge stream (`AiService`), the workflow LLM node, and model refresh
      all gate on it before any client is built.
- [ ] `envKeyMap.js`: CLI providers are documented as omitted; keep the list
      current.
- [ ] One auth probe implementation. Routes use public methods
      (`listModels()`, `checkApiUsable()`) — never reach into `_private`
      spawn helpers.

## 3. Chat client — `backend/src/services/ai/`

- [ ] `LlmService.js` routing branch → returns the client.
- [ ] `llmAdapters.js` case → almost always the OpenAI-like adapter group for
      CLI providers.
- [ ] **Usage contract**: the client must return OpenAI snake_case usage
      (`prompt_tokens` / `completion_tokens`, cached subset under
      `prompt_tokens_details.cached_tokens`) or Anthropic snake_case
      (`input_tokens` + `cache_read_input_tokens`, where input is the
      *uncached* portion). The orchestrator accumulator reads only those two
      shapes. Normalize at the client boundary.
      *(Failure seen live: cursor CLI reports camelCase `inputTokens` → 0
      tokens recorded everywhere.)*
- [ ] **Error surfacing**: if the underlying service resolves
      `{ success: false, error }` instead of rejecting, the client must throw.
      Reading `.text` off a failure shape renders a silent empty assistant
      message. *(Failure seen live: cursor usage-limit → blank reply.)*
- [ ] **Streaming**: check the CLI's own flags before concluding it cannot
      stream. `cursor-agent` hides real token deltas behind
      `--output-format stream-json --stream-partial-output`; the connector
      shipped with non-streaming `json` and emitted one blob. When parsing
      NDJSON deltas, find the discriminator between incremental and final
      messages — cursor emits BOTH, and the final one lacks `timestamp_ms`,
      so summing everything doubles the reply.
- [ ] Session resume: persist via `CodexThreadModel` with the provider tag.
      Any row filter must mirror `normalizeProvider` exactly — untagged legacy
      rows mean `openai-codex`, never your provider. In-memory session maps
      must be bounded (LRU).

## 4. CLI process rules (CLI providers only)

- [ ] **Windows spawn**: Node cannot spawn `.cmd`/`.bat`/`.ps1` shims
      (EINVAL, CVE-2024-27980), and `shell: true` pushes prompt text through
      cmd.exe quoting. Resolve what the shim actually runs and spawn that
      directly — see `backend/src/utils/cliInvocation.js`.
- [ ] **Platform-aware bin candidates**: Windows installers ship `.exe`;
      extensionless POSIX candidate lists never match them.
- [ ] **argv limits**: Windows caps the entire command line at 32,767 UTF-16
      chars (`spawn ENAMETOOLONG`); POSIX has ARG_MAX. A full-size
      orchestrator system prompt (~40KB) exceeds the Windows cap. Large
      prompts must go via `--prompt-file` (grok) or stdin (cursor), with a
      threshold *below* the platform limit (28KB on win32).
      *(Failure seen live: 80KB threshold on a 32KB cap → every real chat died.)*
- [ ] **No import-time side effects**: no mkdir/network/spawn at module scope.
      `tools.js` imports provider services unconditionally on every boot and
      in every test run. Verify with a child-process import probe.
- [ ] Never prepend `.` or user-writable dirs to PATH.

## 5. Model listing — `backend/src/routes/ModelRoutes.js`

- [ ] Explicit branch in `GET /:provider/models` (CLI listing or static
      fallback; gate on `apiUsable` and surface `status.error`).
- [ ] Explicit branch in `POST /:provider/models/refresh` — otherwise the
      route falls through to `GenericProviderService`, which does **real
      HTTP against the decorative baseURL with the user's bearer token**.
- [ ] CLI listing goes through a public `listModels()` on the auth manager.

## 6. Orchestrator surfaces (mostly automatic — verify, don't wire)

- [ ] Tool budget: `[ToolBudget]` log shows the expected tool count
      (0 for tool-blind transports).
- [ ] Context: no history destruction / system-prompt truncation at the
      model's real window (run a long conversation).
- [ ] Cost: `getModelCost` + `computeCacheSavings` + notional labeling flow
      into `agent_executions` and the Context Monitor.
- [ ] Prompt caching: tools array byte-stable across turns (automatic when
      the provider surface is stable; trivially true for empty surfaces).

## 7. Workflow & tool surfaces

- [ ] `backend/src/tools/library/actions/generate-with-ai-llm.js`:
      - `PROVIDER_CONFIG` entry (honest `supportsVision` / image flags).
      - Text-generation switch case. CLI providers route through
        `generateWithManagedOpenAiLike` (client MUST come from
        `createLlmClient`; a raw SDK client targets api.openai.com).
      - Vision switch case ONLY if the transport accepts images.
- [ ] `backend/src/stream/StreamEngine.js` (ToolForge + document chat):
      - Main switch: pick the group by API shape — `startCodexResponsesStream`
        requires `client.responses`; clients that only implement
        `chat.completions` join the `startOpenAiLikeStream` group.
      - All **four** toolforge generation switches AND all **four**
        `defaultModel` maps (they are near-duplicates; missing a map entry
        means `model: undefined`).
- [ ] `agnt-agent` node and orchestrator agent chat: automatic via
      `createLlmClient`/`createLlmAdapter` — verify, no wiring.
- [ ] `*_exec` orchestrator tool (optional, CLI providers): schema defaults in
      `tools.js` must match the code's actual defaults; add to a
      `toolSelector.js` group.

## 8. Frontend

- [ ] `store/auth/appAuth.js` + `store/app/aiProvider.js` provider entries + icon.
- [ ] `IntegrationHealth.vue` (LeftPanel ChatPanel) entry with connect
      instructions. (RightPanel copy exists too — check which is live.)
- [ ] Settings → model selector shows the provider; models populate.
- [ ] Optional deeper integration: `Connectors.vue` / `ProviderSetup.vue`
      device-login flows (codex/claude-code have these; kimi-code does not —
      minimal footprint is the accepted pattern for CLI providers).

## 9. Verification gauntlet (all of these ran live for PR #50)

```text
1.  Unit: provider suites + full backend gate == recorded baseline.
2.  GET  /api/models/<provider>/models        -> 200 + real model list.
3.  POST /api/models/<provider>/models/refresh -> 200, no HTTP to fake baseURL.
4.  Client round-trip, short prompt            -> exact echo code returned.
5.  Client round-trip, 40KB system prompt      -> no ENAMETOOLONG / ARG_MAX.
6.  Live orchestrator chat (the UI path), tool-temptation prompt:
      - response arrives, honest "no tools" if tool-blind,
      - [ToolBudget] line correct, zero hallucinated tool calls,
      - DB row: correct provider/model, non-zero tokens, cost as designed.
7.  Unauthenticated: clean actionable error, not ENOENT/hang/blank.
8.  Provider-specific failure (usage cap, expired session) -> readable error.
9.  Workflow node: generate_with_ai_llm executes with the provider,
      returns text + non-zero token counts.
10. StreamEngine: startOpenAiLikeStream (or the right group) streams the echo.
11. Session resume: second turn reuses the session (resume flag / thread row).
12. Import purity: child-process import of the service touches no filesystem.
```

## 10. Known warts to not copy

- `kimi-code` is in the StreamEngine switches but missing from its
  `defaultModel` maps (→ `model: undefined` when unset).
- The four StreamEngine toolforge methods are near-duplicates; edits must hit
  all four. Prefer line-targeted scripts over string-replace (a replaced
  group remains a prefix-match for the next replace and edits stack).
- `AiService.localAuthProviders` is only `local` + `openai-codex`; other CLI
  providers pass through `getValidAccessToken`, which their dispatcher scheme
  must therefore support.
