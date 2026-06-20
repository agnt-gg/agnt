# AGNT API Documentation

This document provides comprehensive documentation for all API endpoints in the AGNT backend system.

## Local API (http://localhost:3333/api/)

## Table of Contents (Local)

- [Authentication](#authentication)
- [Closed Loop System (PRD-091)](#closed-loop-system-prd-091)
- [Agent Routes](#agent-routes)
- [Async Tool Routes](#async-tool-routes)
- [Provider Auth Routes](#provider-auth-routes)
- [Contract Routes](#contract-routes)
- [Content Output Routes](#content-output-routes)
- [Custom Provider Routes](#custom-provider-routes)
- [Custom Tool Routes](#custom-tool-routes)
- [Email Listener Routes](#email-listener-routes)
- [Execution Routes](#execution-routes)
- [Evolution / Insight Routes](#evolution--insight-routes)
- [Experiment Routes](#experiment-routes)
- [FileSystem Routes](#filesystem-routes)
- [Goal Routes](#goal-routes)
- [Group Routes](#group-routes)
- [Layout Routes](#layout-routes)
- [MCP Routes](#mcp-routes)
- [Memory Routes](#memory-routes)
- [Model Routes](#model-routes)
- [Mutation History Routes](#mutation-history-routes)
- [NPM Routes](#npm-routes)
- [Orchestrator Routes](#orchestrator-routes)
- [Plugin Routes](#plugin-routes)
- [Schedule Routes](#schedule-routes)
- [Skill Routes](#skill-routes)
- [Skill Discovery Routes](#skill-discovery-routes)
- [SkillForge Routes](#skillforge-routes)
- [Speech Routes](#speech-routes)
- [Stream Routes](#stream-routes)
- [Tool Schema Routes](#tool-schema-routes)
- [Tools Routes](#tools-routes)
- [User Routes](#user-routes)
- [Wallet Routes](#wallet-routes)
- [Webhook Routes](#webhook-routes)
- [Widget Definition Routes](#widget-definition-routes)
- [Workflow Routes](#workflow-routes)
- [Artifacts](#artifacts)

---

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

The authentication middleware (`authenticateToken`) will:

- Extract user information from the JWT token
- Set `req.user` with user data including `id`, `email`, and `auth_type`
- Store token and user data in session for backend operations
- Continue as unauthenticated if no valid token is provided

### Token Storage & Access

The JWT token is **not stored in the database**. It lives in three places depending on context:

| Context                              | Where the token lives                                  | How to access it                                 |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Widgets (iframe)                     | Never enters the iframe                                | Use the global `agnt` SDK (auth is proxied)      |
| Frontend (Vue app, browser)          | `localStorage`                                         | `localStorage.getItem('token')` (legacy callsites) |
| Backend services (Express)           | `req.headers.authorization` or `req.session.userToken` | Passed as `authToken` parameter between services |
| Orchestrator tools (spawned Node.js) | `process.env.AGNT_AUTH_TOKEN`                          | Automatically injected by the orchestrator       |

### Widgets (browser iframe — use the agnt SDK)

The widget runtime injects a global `agnt` object into every widget iframe at mount time. **The token never enters the iframe** — every call is proxied through the parent via `postMessage` and executed by the parent's authenticated axios instance. Widget code should NOT read `localStorage`, NOT set `Authorization` headers, NOT write a `getToken()` helper. Bypassing the SDK will 401.

```js
// Plugin / native / registry tool execution (most common widget use case)
const joke = await agnt.tool('chucknorris-get-joke', { category: 'dev' });

// Any /api/* endpoint
const agents = await agnt.fetch('/api/agents');
const created = await agnt.fetch('/api/agents', {
  method: 'POST',
  body: { name: 'My Agent' },   // object or JSON.stringify(...) both work
});

// User context, available synchronously
console.log(agnt.user);   // { id, email, name } | null
```

`agnt.tool` returns the tool's `result` directly (not the `{ success, result }` envelope) and throws on tool failure. `agnt.fetch` returns the parsed response body and throws on non-2xx. `agnt.fetch` is allowlisted to `/api/*` paths and to standard HTTP methods (GET/POST/PUT/PATCH/DELETE).

### Frontend Vue app (browser, non-widget context)

The Vue app stores the JWT in `localStorage` under the key `token` and a global axios interceptor in `frontend/src/main.js` attaches `Authorization: Bearer ...` to every outbound request automatically. New code should use the existing axios setup; reach for `localStorage.getItem('token')` only when bypassing axios.

```js
// Most code — interceptor handles auth automatically
import axios from 'axios';
const { data } = await axios.get('/api/agents');

// Bypass case (raw fetch outside axios):
const token = localStorage.getItem('token');
const res = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
```

### Backend Services (Express context)

Inside Express route handlers and services, the token arrives via the request header and is cached in the session by the `authenticateToken` middleware:

```js
// In a route handler — token from the request
const authToken = req.headers.authorization; // "Bearer <token>"

// Or from session (set automatically by middleware after first auth)
const sessionData = getUserTokenFromSession(req);
// sessionData = { token: "<jwt>", user: { id, email, auth_type } }

// Services receive it as a parameter — just pass it along
const result = await someService.doWork(args, authToken);
```

### Orchestrator Tools (spawned Node.js context)

When the orchestrator's `execute_javascript_code` tool runs code, it spawns an isolated Node.js process. There is no `req`, no session, and no `localStorage`. The orchestrator automatically injects the user's token as an environment variable:

```js
const API = 'http://localhost:3333/api';
const TOKEN = process.env.AGNT_AUTH_TOKEN; // automatically provided

const res = await fetch(API + '/agents/', {
  headers: {
    Authorization: 'Bearer ' + TOKEN,
    'Content-Type': 'application/json',
  },
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
```

> **Important:** Each context has its own way to get the token — don't mix them. `localStorage` only exists in the browser. `req.session` only exists in Express handlers. `process.env.AGNT_AUTH_TOKEN` only exists in orchestrator-spawned processes.

---

## Closed Loop System (PRD-091)

AGNT runs a self-improvement loop across four primitives that together let goals fire on a cadence, mutations prove themselves before promoting, safe insights auto-apply, contracts enforce runtime invariants, and regressions auto-revert. **This section is required reading for any agent that touches scheduling, auto-apply, budgets, or revert.**

### The four primitives

| Primitive | Base path | What it stores | Layer |
|---|---|---|---|
| **Schedules** | `/api/schedules` | Durable cron entries (target + cron + next_run). Survives backend restart. | 1 (Clock) |
| **Wallets** | `/api/wallets` | Linear capability budgets (root + sub-wallets). Sub-wallets can never exceed parent balance. | 3 (Budgets) |
| **Contracts** | `/api/contracts` | Runtime invariants mined from successful executions ("output must be JSON", "step count ≤ 5"). | 5 (Invariants) |
| **Mutation History** | `/api/mutations` | Every router-applied change, with before-snapshot + fitness baseline. | 7 (Provenance) |

Plus the **Autonomy Router** at `POST /api/insights/route` which decides per pending insight whether to **direct-apply**, **gate via sandbox**, **escalate to the user**, or **skip**. Driven by `EvolutionSettingsModel.autonomy` (off by default).

### When to use which endpoint (intent → call)

| User says... | Call |
|---|---|
| "Run this goal every morning at 9 ET" | `POST /api/schedules` with `targetType:'goal'`, `cron:'0 9 * * *'`, `timezone:'America/New_York'` |
| "When will my schedule fire next?" | `POST /api/schedules/preview` (no persist) — or `GET /api/schedules/:id` and read `next_run` |
| "Show me what AGNT auto-changed lately" | `GET /api/mutations` |
| "Did that auto-change regress quality?" | `POST /api/mutations/:id/canary-check` |
| "Undo that auto-applied change" | `POST /api/mutations/:id/revert` |
| "Turn on autonomy" | `POST /api/insights/settings` with `{ autonomy: { enabled: true } }` |
| "Apply all my safe pending insights" | `POST /api/insights/route` (sweeps every pending insight through the router) |
| "Route just this one insight" | `POST /api/insights/:id/route` |
| "What's my budget?" | `GET /api/wallets/root` |
| "Add credit to my budget" | `POST /api/wallets/root/topup` |
| "Spin up a sub-budget for this agent" | (server-side) `WalletService.allocate(...)` — no public route yet |
| "Show this agent's spend ledger" | `GET /api/wallets/:id/ledger` |
| "Does this output satisfy our quality contracts?" | `POST /api/contracts/check` |
| "Show me what rules have been mined" | `GET /api/contracts` |

### Safety contract (the agent MUST respect this)

1. **Never** flip `autonomy.enabled` on the user's behalf without explicit, in-conversation confirmation. It is off by default for a reason.
2. **Never** call `POST /api/insights/:id/apply` on insights with `priority: 'critical'` or `category: 'parameter_tune' | 'bottleneck'` without explicit confirmation.
3. **Always** call `POST /api/mutations/:id/canary-check` before suggesting `revert`. Show the user the verdict (`regression: true|false`, `delta`, `fitnessAfter`).
4. **Always** call `GET /api/wallets/root` before scheduling a recurring goal that will incur LLM cost — confirm there is budget.
5. **Default to escalation, not direct-apply.** When in doubt, use `POST /api/insights/route` (which respects the router) rather than `POST /api/insights/:id/apply` (which bypasses it).

### Layered guarantees the safety contract relies on

- The router itself returns `{ decision: 'escalate', reason: 'autonomy_disabled' }` for every insight when `autonomy.enabled === false`. Flipping `enabled` is the *only* way auto-apply turns on.
- Every router-applied mutation captures `fitness_before` at apply time. Revert is non-lossy because the before-snapshot lives in `mutation_history`.
- `VerifierGate` enforces `delta > MIN_DELTA (0.05)` AND structural-constraint gates before promote. A regression cannot pass the gate.
- Wallets cap blast radius — even if autonomy is on AND all gates pass, a tool with a depleted wallet cannot keep spending.

### Default policy values (live in `AutonomyPolicy.DEFAULTS`)

```json
{
  "enabled": false,
  "minConfidence": 0.7,
  "minDelta": 0.05,
  "maxBlastRadius": 0.5,
  "dailyBudget": 20,
  "allowedCategories": [
    "memory", "prompt_refinement", "tool_preference",
    "contract_proposal", "skill_recommendation", "pattern", "antipattern"
  ],
  "requireGateAbove": 0.45
}
```

Insight with `blast_radius >= requireGateAbove` is routed `gated` (sandbox-tested) instead of `direct`. Insight with `blast_radius > maxBlastRadius` is `escalate`d (human required).

### Realtime events the frontend listens for

| Event | When it fires |
|---|---|
| `autonomy.router.decision` | Router emits a decision per insight |
| `autonomy.mutation.applied` | A mutation lands in `mutation_history` |
| `autonomy.canary.regression` | Periodic canary sweep detects a regression |
| `scheduler.tick` | Scheduler tick fires a schedule |
| `scheduler.run.complete` | A scheduled run finishes |

(Implemented in `frontend/src/composables/useRealtimeSync.js`.)

---

## Agent Routes

Base path: `/api/agents`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the agent service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Agents

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all agents for the authenticated user
- **Note**: Include trailing slash (`/api/agents/`) for best compatibility
- **Response**:

```json
{
  "agents": [
    {
      "id": "67b9bf15-a5c7-4153-936b-5959dc83b03c",
      "name": "Content Manager",
      "description": "Main content manager",
      "status": "active",
      "icon": "agent",
      "class": "worker",
      "category": "Content & Media",
      "assignedTools": [],
      "capabilities": [],
      "tasksCompleted": 0,
      "uptime": 0,
      "creditLimit": 0,
      "creditsUsed": 0,
      "workflows": 0,
      "lastActive": null,
      "successRate": null,
      "provider": "openai",
      "model": "gpt-4"
    }
  ]
}
```

**Important**: The response wraps agents in an `agents` array property, not a direct array.

### Save/Update Agent

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new agent or update an existing one
- **Body**:

```json
{
  "id": "optional-agent-id",
  "name": "Agent Name",
  "description": "Agent description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "id": "agent-id",
    "name": "Agent Name",
    "description": "Agent description",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Agent by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Description**: Retrieve a specific agent by ID
- **Response**:

```json
{
  "id": "agent-id",
  "name": "Agent Name",
  "description": "Agent description",
  "config": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Agent

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "name": "Updated Agent Name",
  "description": "Updated description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "id": "agent-id",
    "name": "Updated Agent Name",
    "description": "Updated description",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Agent

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Description**: Delete an agent by ID
- **Response**:

```json
{
  "success": true,
  "message": "Agent deleted successfully"
}
```

### Chat with Agent

**POST** `/:id/chat`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "message": "Your message here",
  "context": {}
}
```

- **Response**:

```json
{
  "response": "Agent response",
  "metadata": {}
}
```

### Stream Chat with Agent

**POST** `/:id/chat-stream`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "message": "Your message here",
  "context": {}
}
```

- **Response**: Server-sent events stream

### Get Agent Suggestions

**POST** `/:id/suggestions`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "context": "Current context or partial message"
}
```

- **Response**:

```json
{
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}
```

---

## Async Tool Routes

Base path: `/api/async-tools`



> ## \u26A0\uFE0F Critical Behaviour Notes (read before integrating)
>
> These behaviours were discovered during empirical stress-testing on 2026-05-04. Most of the silent-degradation cases were fixed in the same dated commit \u2014 see [`ASYNC-TOOLS-REFERENCE.md` \u00A7 Recent Fixes](./ASYNC-TOOLS-REFERENCE.md#recent-fixes-2026-05-04) for the fix table.
>
> **\ud83d\udd34 In-batch ordering is NOT guaranteed.** When multiple async tool calls are submitted in the same function-calls block, the orchestrator fires them all in the **same millisecond** with no ordering. Submitting a `write` followed by a `read` of the same path can produce a read failure (`ENOENT`) 2+ seconds *before* the write completes. This is by design \u2014 async tools are independent and unordered. **Use synchronous calls for any read-after-write or dependent operation.** Non-LLM integrators (workflow nodes, webhook handlers, third-party callers) must enforce ordering themselves: await the queued result before issuing the next dependent call.
>
> **\u2705 Silent-degradation parameter patterns FIXED (2026-05-04).** The four shapes below used to silently fall back to a one-shot. They now return a structured validation error at queue time so callers can self-correct:
> 1. `_interval: 0` (or negative / non-numeric) \u2014 rejected.
> 2. `_stopAfter: N` without `_interval` \u2014 rejected.
> 3. `_duration: N` without `_interval` \u2014 rejected.
> 4. `_delayFirst: true` without `_interval` \u2014 rejected.
>
> **\u2705 Failure observability FIXED (2026-05-04).** The `GET /api/async-tools/status` endpoint now reports three failure-related counters:
> - `failed` \u2014 system-level failures only (worker crashed/aborted). Same semantics as before.
> - `businessFailed` \u2014 completed executions whose inner `result.success === false` (ENOENT, EPERM, per-iteration errors in periodic runs).
> - `totalFailed` \u2014 `failed + businessFailed`, exact (the source sets are disjoint).
>
> **\u2705 Autonomous-message banner FIXED (2026-05-04).** The wrapper that delivers async results into the conversation now inspects the inner result and emits `\u26A0\uFE0F ASYNC TOOL FINISHED WITH ERROR` with an honesty directive when the operation reported failure, instead of always claiming success.
>
> **\u2705 Sub-second intervals work** (validated down to `_interval: 0.1`), but at intervals shorter than the tool\u2019s own execution time the actual gap is dominated by tool throughput, not the timer. Note: `_interval: 0` is no longer accepted (see fix above).
>
> **\u2705 True OS-level concurrency is real** \u2014 five parallel `ping` shells took 5.2 s total instead of 21 s.
>
> **\u26a0\ufe0f Whole feature is experimental and OFF by default (2026-05-04).** A per-user setting (`asyncToolsEnabled` on `PUT /api/users/settings`) gates whether the LLM can use async tools at all. With it OFF (default), the universal async control params drop off every tool schema AND the async-guidance prompt section is omitted, so the LLM has no way to know async exists. In-flight tasks that started before the toggle flipped run to completion. New users see the chat behave like a conventional sync-only assistant until they explicitly enable the feature in Settings. See [`ASYNC-TOOLS-REFERENCE.md` \u00a7 Async tools toggle](./ASYNC-TOOLS-REFERENCE.md#async-tools-toggle-per-user-setting-2026-05-04) for the full contract.

### Tool-Call Async Parameters (How to Use Async)

Every tool in the AGNT registry — native, plugin, registry, MCP — supports background and recurring execution via a set of universal **underscore-prefixed parameters**. These are **not** part of the tool's own schema; they are intercepted by the orchestrator before the tool runs.

> 📘 **For the comprehensive guide with worked examples, error handling patterns, edge cases, and empirically-validated test results, see [`ASYNC-TOOLS-REFERENCE.md`](./ASYNC-TOOLS-REFERENCE.md).**

#### Universal Async Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `_executeAsync` | boolean | `false` | Run the tool in the background. Returns an `executionId` immediately; results arrive later via autonomous message. |
| `_interval` | integer (seconds) | — | Re-run the tool every N seconds. Requires `_executeAsync`. |
| `_stopAfter` | integer | — | Stop after N iterations. Requires `_interval`. |
| `_duration` | number (minutes) | — | Stop after N minutes total. Decimals allowed (e.g. `0.1` = 6 seconds). Requires `_interval`. |
| `_delayFirst` | boolean | `false` | Skip the immediate first run — wait one full `_interval` before the first execution. Requires `_interval`. |
| `_estimatedMinutes` | number | — | UI hint for expected duration. **No functional impact** on scheduling — purely cosmetic. |

#### Common Patterns

**Run once in the background:**

```json
{ "query": "latest AI news", "_executeAsync": true }
```

**Run a real tool once after a delay (e.g. send a reminder email in 1 hour):**

```json
{
  "to": "user@example.com",
  "subject": "Reminder",
  "body": "Don't forget!",
  "_executeAsync": true,
  "_interval": 3600,
  "_stopAfter": 1,
  "_delayFirst": true
}
```

**Run every 60 seconds, exactly 5 times:**

```json
{ "...": "...", "_executeAsync": true, "_interval": 60, "_stopAfter": 5 }
```

**Scrape a site every 5 minutes for 1 hour:**

```json
{ "url": "https://example.com", "_executeAsync": true, "_interval": 300, "_duration": 60 }
```

**Safety-belt pattern (stop at whichever limit hits first):**

```json
{ "...": "...", "_executeAsync": true, "_interval": 60, "_stopAfter": 100, "_duration": 60 }
```

#### Response Shapes

**Sync (no async params)** — returns the tool's native payload directly:

```json
{ "success": true, "total": 20, "individualRolls": [20], "error": null }
```

**Async, queued** — returned immediately when `_executeAsync: true`:

```json
{
  "success": true,
  "status": "queued",
  "executionId": "8604c5b0-8515-4cb1-8894-918acb31ac25",
  "message": "<toolName> started in the background. You'll receive updates as it progresses.",
  "estimatedDuration": null
}
```

**Async, completed (one-shot)** — arrives via autonomous message:

```json
{
  "success": true,
  "status": "completed",
  "executionId": "8604c5b0-8515-4cb1-8894-918acb31ac25",
  "result": "{\"success\":true,\"total\":20,...}",
  "duration": 480
}
```

> The `result` field is often a **JSON-stringified payload**. Clients must `JSON.parse()` it before consuming.

**Periodic execution completed** — a single combined payload after the full schedule finishes:

```json
{
  "success": true,
  "status": "completed",
  "executionId": "af4cd05e-0c19-4e3b-96fb-fc38c57d81bc",
  "result": {
    "periodicExecution": true,
    "totalIterations": 3,
    "results": [
      { "iteration": 1, "result": "{...}", "timestamp": 1777909033895 },
      { "iteration": 2, "result": "{...}", "timestamp": 1777909043897 },
      { "iteration": 3, "result": "{...}", "timestamp": 1777909053906 }
    ],
    "totalDuration": 20011
  },
  "duration": 20011
}
```

#### Two-Layer Status Model (Critical)

Async responses have **two independent layers** that must both be checked:

1. **System layer** — the outer envelope (`success`, `status`). Tells you whether the orchestrator queued/ran the task.
2. **Business-logic layer** — `result.success` or the parsed payload. Tells you whether the tool's operation actually succeeded.

A task can be `status: "completed"` at the system level while `result.success: false` at the business layer (e.g. file not found, invalid parameter, API error).

```javascript
if (response.status === "completed") {
  const inner = typeof response.result === "string"
    ? JSON.parse(response.result)
    : response.result;
  if (inner.success) {
    // use inner data
  } else {
    // handle inner.error (e.g. ENOENT, EPERM, validation message)
  }
}
```

#### Empirically-Verified Behaviors

These behaviors were validated via live tool calls (see `ASYNC-TOOLS-REFERENCE.md` for the full test log):

- **Validation runs at execution time, not queue time.** Invalid parameters are queued successfully and only fail when the task actually runs.
- **Conflicting stop conditions:** when both `_stopAfter` and `_duration` are set, **whichever limit triggers first wins**. Tested with `_stopAfter: 100` + `_duration: 0.1` (6 s) — task stopped at 3 iterations.
- **Parallel concurrency:** 19+ simultaneous async calls in a single function-calls block all queue and execute cleanly. No rate limit observed.
- **Mixed sync + async** in the same function-calls block works — sync results return inline, async return execution IDs.
- **Periodic results are batched.** A periodic task delivers **no output** until the full schedule completes. Use separate async calls (one per assistant message) if streaming is required.
- **`_estimatedMinutes` is purely cosmetic.** Tasks run as fast as they can regardless of the estimate.
- **Minimum interval** tested: 1 second (with ~10–20 ms drift per iteration). Sub-second intervals untested.
- **Decimal `_duration`** values work (e.g. `0.1` = 6 seconds).
- **Error envelope:** business-logic failures (`ENOENT`, `EPERM`, validation errors) surface inside `result.error` while the outer `status` remains `"completed"`. The system never crashes or hangs on bad input.

#### Anti-Patterns

❌ **Do not** use async for dependent tasks. If Task B references Task A's output, Task A must be sync.

❌ **Do not** build a fake `sleep` / `echo` / `timer` tool to schedule something later. Attach `_executeAsync`, `_interval`, `_stopAfter: 1`, `_delayFirst: true` directly to the **real tool you want to run**.

❌ **Do not** start a periodic task without `_stopAfter` or `_duration`. It will run until cancelled via `POST /cancel/:executionId`.

---

### Get Queue Status

**GET** `/status`

- **Authentication**: Required
- **Description**: Get async tool queue statistics
- **Response**:

```json
{
  "success": true,
  "stats": {
    "pending": 0,
    "running": 2,
    "completed": 15,
    "failed": 1
  }
}
```

### Get Executions by Conversation

**GET** `/executions/:conversationId`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Get all async tool executions for a conversation
- **Response**:

```json
{
  "success": true,
  "executions": [
    {
      "executionId": "exec-id",
      "toolName": "tool-name",
      "status": "running|completed|failed|cancelled",
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": null
    }
  ]
}
```

### Get Running Executions

**GET** `/executions/:conversationId/running`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Get only running async tool executions for a conversation
- **Response**:

```json
{
  "success": true,
  "executions": []
}
```

### Get Execution Details

**GET** `/execution/:executionId`

- **Authentication**: Required
- **Parameters**:
  - `executionId` (path): Execution ID
- **Description**: Get details of a specific async tool execution
- **Response**:

```json
{
  "success": true,
  "execution": {
    "executionId": "exec-id",
    "toolName": "tool-name",
    "status": "completed",
    "result": {}
  }
}
```

- **Error** (404): Execution not found

### Cancel Execution

**POST** `/cancel/:executionId`

- **Authentication**: Required
- **Parameters**:
  - `executionId` (path): Execution ID
- **Description**: Cancel a running async tool execution
- **Response**:

```json
{
  "success": true,
  "message": "Async tool execution cancelled successfully"
}
```

### Cancel All Executions for Conversation

**POST** `/cancel-all/:conversationId`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Cancel all running async tools for a conversation (global stop)
- **Response**:

```json
{
  "success": true,
  "cancelled": 3
}
```

---

## Provider Auth Routes

Base path: `/api/providers`

All provider authentication is handled through a single unified router. The `:providerId` parameter identifies the provider (e.g., `claude-code`, `openai-codex`, `gemini-cli`, `openai`, `anthropic`, etc.). Local CLI providers use filesystem-backed credentials; remote providers proxy to agnt.gg.

**Note:** An unknown `:providerId` returns 404: `{ "success": false, "error": "Unknown provider: <id>" }`.

**Auth Dispatcher** (`AuthDispatcher.js`) maps each provider's `authScheme` to an auth manager and a set of capabilities:

| Auth Scheme   | Local | Capabilities                                                                              |
| ------------- | ----- | ----------------------------------------------------------------------------------------- |
| `claude-code` | Yes   | status, connect-token, disconnect, refresh, oauth-pkce                                    |
| `codex`       | Yes   | status, disconnect, device-auth                                                           |
| `gemini-cli`  | Yes   | status, connect-apikey, disconnect, refresh, oauth-loopback, set-auth-method, gcp-project |
| `bearer`      | No    | status, connect-apikey, disconnect                                                        |
| `api-key`     | No    | status, connect-apikey, disconnect                                                        |
| `query-param` | No    | status, connect-apikey, disconnect                                                        |

### Get Provider Auth Status

**GET** `/:providerId/auth/status`

- **Authentication**: None
- **Description**: Check whether credentials exist for this provider and whether its API is usable. For local CLI providers, checks filesystem credentials. For remote providers, returns basic info (use the connection health endpoint for remote status).
- **Response** (local provider):

```json
{
  "success": true,
  "available": true,
  "apiUsable": true,
  "hint": "Claude Code is connected and the Anthropic API is usable."
}
```

For `openai-codex`, also includes `codexWorkdir` and `toolRunner` fields.

- **Response** (remote provider):

```json
{
  "success": true,
  "available": false,
  "providerId": "openai",
  "local": false,
  "hint": "Use connection health endpoint for remote provider status."
}
```

### Get Provider Capabilities

**GET** `/:providerId/auth/capabilities`

- **Authentication**: None
- **Description**: Return the capabilities and metadata for a provider's auth scheme
- **Response**:

```json
{
  "success": true,
  "providerId": "claude-code",
  "providerName": "Claude Code",
  "local": true,
  "remote": false,
  "capabilities": ["status", "connect-token", "disconnect", "refresh", "oauth-pkce"]
}
```

### Connect Provider

**POST** `/:providerId/auth/connect`

- **Authentication**: None (local), Required (remote — proxied to agnt.gg)
- **Description**: Save credentials for a provider. Body and response vary by auth scheme.
- **Body** (claude-code — token):

```json
{
  "token": "sk-ant-..."
}
```

- **Body** (gemini-cli — API key):

```json
{
  "apiKey": "AIza..."
}
```

- **Body** (remote providers — proxied to agnt.gg):

```json
{
  "apiKey": "sk-..."
}
```

- **Response** (claude-code):

```json
{
  "success": true,
  "message": "Token saved successfully",
  "apiUsable": true
}
```

- **Response** (gemini-cli):

```json
{
  "success": true,
  "message": "Gemini CLI connected successfully",
  "apiUsable": true
}
```

- **Response** (remote providers): Proxied from agnt.gg
- **Error** (400): Missing or invalid credentials for the auth scheme
- **Error** (400): `{ "error": "Connect not supported for <providerId>" }` if local provider has no connect handler

### Disconnect Provider

**POST** `/:providerId/auth/disconnect`

- **Authentication**: None (local), Required (remote)
- **Description**: Remove credentials for a provider. Local providers delete filesystem credentials; remote providers proxy to agnt.gg.
- **Response**:

```json
{
  "success": true
}
```

### Refresh Token

**POST** `/:providerId/auth/refresh`

- **Authentication**: None
- **Description**: Refresh the access token using the stored refresh token. Only supported for local providers with the `refresh` capability (claude-code, gemini-cli).
- **Response** (success):

```json
{
  "success": true,
  "refreshed": true,
  "available": true,
  "apiUsable": true
}
```

- **Error** (400): `{ "error": "Refresh not supported for this provider" }` if provider lacks `refresh` capability
- **Error** (401 — claude-code specific): `{ "code": "REAUTH_REQUIRED", "error": "..." }` if refresh token is revoked
- **Error** (502): `{ "code": "REFRESH_FAILED", "error": "..." }` if token refresh fails upstream

### Start OAuth Flow

**GET** `/:providerId/auth/oauth/start`

- **Authentication**: None
- **Description**: Initiate an OAuth flow. For `claude-code`, starts Anthropic PKCE OAuth. For `gemini-cli`, starts Google loopback OAuth. Only supported for local providers.
- **Error** (400): `{ "error": "OAuth start not supported for remote providers" }` if provider is not local
- **Response**:

```json
{
  "success": true,
  "authUrl": "https://console.anthropic.com/oauth/authorize?...",
  "sessionId": "session-uuid"
}
```

### Exchange OAuth Code (claude-code PKCE)

**POST** `/:providerId/auth/oauth/exchange`

- **Authentication**: None
- **Description**: Submit the code#state string copied from Anthropic's callback page. Only supported for providers with `oauth-pkce` capability.
- **Body**:

```json
{
  "sessionId": "session-uuid",
  "codeState": "auth-code#state-value"
}
```

- **Response**:

```json
{
  "success": true
}
```

- **Error** (400): `{ "error": "OAuth exchange not supported for this provider" }` if provider lacks `oauth-pkce` capability
- **Error** (400): `{ "error": "sessionId and codeState are required" }` if body is incomplete
- **Error** (400): `{ "error": "Could not parse the authorization code. Please copy the full code from the Anthropic page and try again." }` if code/state parsing fails

### Poll OAuth Status (gemini-cli loopback)

**GET** `/:providerId/auth/oauth/status?sessionId=...`

- **Authentication**: None
- **Parameters**:
  - `sessionId` (query, required): The session ID from the OAuth start endpoint
- **Description**: Poll the loopback OAuth session state. Only supported for providers with `oauth-loopback` capability.
- **Response**:

```json
{
  "success": true,
  "state": "pending|completed|expired|error"
}
```

- **Error** (400): `{ "error": "Missing sessionId" }` if query param missing
- **Error** (400): `{ "error": "OAuth status polling not supported for this provider" }` if provider lacks `oauth-loopback` capability

### Start Device Auth (openai-codex)

**POST** `/:providerId/auth/device/start`

- **Authentication**: None
- **Description**: Start device login flow. Returns a URL and code the user enters in a browser. Only supported for providers with `device-auth` capability.
- **Response**:

```json
{
  "success": true,
  "sessionId": "session-uuid",
  "deviceUrl": "https://auth.openai.com/device",
  "deviceCode": "ABCD-1234",
  "state": "pending",
  "message": null,
  "startedAt": "2024-01-01T00:00:00Z",
  "expiresAt": "2024-01-01T00:15:00Z",
  "hint": "Open the URL, enter the code, then return here. We will poll for completion."
}
```

- **Error** (400): `{ "error": "Device auth not supported for this provider" }` if provider lacks `device-auth` capability

### Poll Device Auth Status (openai-codex)

**GET** `/:providerId/auth/device/status?sessionId=...`

- **Authentication**: None
- **Parameters**:
  - `sessionId` (query, required): The session ID from the device start endpoint
- **Description**: Poll the device login session state. Only supported for providers with `device-auth` capability.
- **Response**:

```json
{
  "success": true,
  "state": "pending|completed|expired|error"
}
```

- **Error** (400): `{ "error": "sessionId is required" }` if query param missing or not a string
- **Error** (400): `{ "error": "Device auth not supported for this provider" }` if provider lacks `device-auth` capability

### Set Auth Method (gemini-cli)

**POST** `/:providerId/auth/set-auth-method`

- **Authentication**: None
- **Description**: Switch between API key and OAuth authentication methods. When switching to `api-key`, removes OAuth credentials from `~/.gemini/oauth_creds.json`. When switching to `oauth`, removes API key from `~/.gemini/.env`. Only supported for providers with `set-auth-method` capability.
- **Body**:

```json
{
  "method": "api-key|oauth"
}
```

- **Response**:

```json
{
  "success": true,
  "available": true,
  "apiUsable": true
}
```

- **Error** (400): `{ "error": "method must be \"api-key\" or \"oauth\"" }` if method is invalid
- **Error** (400): `{ "error": "set-auth-method not supported for this provider" }` if provider lacks capability

### Set GCP Project (gemini-cli)

**POST** `/:providerId/auth/gcp-project`

- **Authentication**: None
- **Description**: Set the Google Cloud Project ID (required for workspace/organization accounts). Only supported for providers with `gcp-project` capability.
- **Body**:

```json
{
  "projectId": "my-gcp-project"
}
```

- **Response**:

```json
{
  "success": true,
  "projectId": "my-gcp-project"
}
```

- **Error** (400): `{ "error": "Missing projectId" }` if body is incomplete
- **Error** (400): `{ "error": "GCP project not supported for this provider" }` if provider lacks capability

---

## Contract Routes

Base path: `/api/contracts`

Contracts are refinement-type runtime invariants (PRD-091 Layer 5). They are either **authored** by the user/agent or **mined** by `InsightEngine` from successful executions ("output must be JSON", "step count ≤ 5", "response includes citation block"). At runtime, `ContractsService.check` evaluates whether evidence satisfies the contract; violations are counted on the contract row and feed into `FitnessScoreService` (contract cleanliness component).

### Contract shape

```json
{
  "id": "uuid",
  "user_id": "user-uuid",
  "target_type": "tool|workflow|skill|agent",
  "target_id": "target-uuid",
  "name": "Output must be valid JSON",
  "predicate": { "type": "json_valid", "field": "output" },
  "source": "authored|mined",
  "status": "active|disabled|deprecated",
  "confidence": 0.92,
  "evidence_count": 47,
  "violation_count": 2,
  "created_at": "...",
  "updated_at": "..."
}
```

### List Contracts

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `status` (query, optional): `active`, `disabled`, `deprecated`
  - `targetType` (query, optional): `tool`, `workflow`, `skill`, `agent`
- **Response**:

```json
{ "success": true, "contracts": [ { ... } ] }
```

### Create Contract

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "targetType": "tool",
  "targetId": "web-search",
  "name": "Output must include source URLs",
  "predicate": { "type": "regex", "field": "output", "pattern": "https?://" },
  "confidence": 0.9
}
```

- **Description**: Authors a new contract. `targetType` and `targetId` scope the contract to a specific asset; `predicate` is a JSON shape interpreted by `ContractsService.check`. Errors return `400` if required fields are missing.
- **Response** (`201`):

```json
{ "success": true, "contract": { ... } }
```

### Get Single Contract

**GET** `/:id`

- **Authentication**: Required
- **Response**:

```json
{ "success": true, "contract": { ... } }
```

- **Errors**: `404` not found, `403` forbidden

### Get Contract Violations

**GET** `/:id/violations`

- **Authentication**: Required
- **Description**: Returns the violation history for a contract — useful when surfacing why a `canary-check` flagged regression.
- **Response**:

```json
{
  "success": true,
  "violations": [
    {
      "id": "v-uuid",
      "contract_id": "c-uuid",
      "source_execution_id": "exec-uuid",
      "details": { "expected": "...", "actual": "..." },
      "created_at": "..."
    }
  ]
}
```

### Update Contract Status

**PATCH** `/:id`

- **Authentication**: Required
- **Body**:

```json
{ "status": "disabled" }
```

- **Description**: Currently only `status` is mutable. Use this to disable a noisy contract without deleting it.
- **Response**:

```json
{ "success": true, "contract": { ... } }
```

### Check Evidence Against Active Contracts

**POST** `/check`

- **Authentication**: Required
- **Body**:

```json
{
  "targetType": "tool",
  "targetId": "web-search",
  "runtimeState": { "output": "..." },
  "sourceExecutionId": "exec-uuid"
}
```

- **Description**: Evaluates `runtimeState` against every active contract for `(targetType, targetId)`. Records evidence on each contract; persists a violation row if a predicate fails. Returns per-contract verdicts.
- **Response**:

```json
{
  "success": true,
  "checked": 3,
  "passed": 2,
  "failed": 1,
  "verdicts": [
    { "contractId": "...", "name": "...", "passed": true },
    { "contractId": "...", "name": "...", "passed": false, "violationId": "..." }
  ]
}
```

### Delete Contract

**DELETE** `/:id`

- **Authentication**: Required
- **Response**:

```json
{ "success": true, "deleted": true }
```

---

## Content Output Routes

Base path: `/api/content-outputs`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the content output service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Content Outputs

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all content outputs for the authenticated user
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Save/Update Content Output

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new content output or update an existing one
- **Body**:

```json
{
  "id": "optional-output-id",
  "title": "Output Title",
  "content": "Content data",
  "workflowId": "workflow-id",
  "toolId": "tool-id"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Content Output by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Description**: Retrieve a specific content output by ID
- **Response**:

```json
{
  "id": "output-id",
  "title": "Output Title",
  "content": "Content data",
  "workflowId": "workflow-id",
  "toolId": "tool-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Content Output

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Body**:

```json
{
  "title": "Updated Title",
  "content": "Updated content data"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "Updated Title",
    "content": "Updated content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Rename Content Output

**PATCH** `/:id/rename`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Body**:

```json
{
  "title": "New Title"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "New Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Content Output

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Description**: Delete a content output by ID
- **Response**:

```json
{
  "success": true,
  "message": "Content output deleted successfully"
}
```

### Get Content Outputs by Workflow

**GET** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Retrieve all content outputs for a specific workflow
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Get Content Outputs by Tool

**GET** `/tool/:toolId`

- **Authentication**: Required
- **Parameters**:
  - `toolId` (path): Tool ID
- **Description**: Retrieve all content outputs for a specific tool
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

---

## Custom Provider Routes

Base path: `/api/custom-providers`

Manage user-created custom OpenAI-compatible providers (e.g., local Ollama, LM Studio, or any OpenAI-compatible API endpoint).

### Get All Custom Providers

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all custom providers for the authenticated user
- **Response**:

```json
{
  "success": true,
  "providers": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "provider_name": "Local LM Studio",
      "base_url": "http://localhost:1234",
      "is_active": 1,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### Create Custom Provider

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "provider_name": "Custom Provider",
  "base_url": "https://api.example.com",
  "api_key": "your-api-key"
}
```

- `provider_name` (required): Display name
- `base_url` (required): API base URL
- `api_key` (optional): API key for authentication

- **Response** (201 Created):

```json
{
  "success": true,
  "provider": {
    "id": "uuid",
    "user_id": "user-uuid",
    "provider_name": "Custom Provider",
    "base_url": "https://api.example.com",
    "is_active": 1,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "message": "Custom provider created successfully"
}
```

- **Error** (400): `{ "error": "Missing required fields: provider_name, base_url" }`

### Get Custom Provider by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider UUID
- **Description**: Retrieve a specific custom provider by ID
- **Response**:

```json
{
  "success": true,
  "provider": {
    "id": "uuid",
    "user_id": "user-uuid",
    "provider_name": "Custom Provider",
    "base_url": "https://api.example.com",
    "is_active": 1,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

- **Error** (404): `{ "error": "Provider not found" }`

### Update Custom Provider

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider UUID
- **Body** (all fields optional):

```json
{
  "provider_name": "Updated Provider Name",
  "base_url": "https://api.updated.com",
  "api_key": "new-api-key",
  "is_active": 1
}
```

- **Response**:

```json
{
  "success": true,
  "provider": {
    "id": "uuid",
    "user_id": "user-uuid",
    "provider_name": "Updated Provider Name",
    "base_url": "https://api.updated.com",
    "is_active": 1,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "message": "Custom provider updated successfully"
}
```

- **Error** (404): Provider not found

### Delete Custom Provider

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider UUID
- **Description**: Delete a custom provider by ID
- **Response**:

```json
{
  "success": true,
  "message": "Custom provider deleted successfully"
}
```

- **Error** (404): Provider not found

### Get Provider Templates

**GET** `/templates`

- **Authentication**: None
- **Description**: Get all pre-configured provider templates for creating custom providers. Includes cloud APIs (Mistral, Fireworks, Perplexity, etc.) and local inference servers (Ollama, LM Studio).
- **Response**:

```json
{
  "success": true,
  "templates": [
    {
      "key": "ollama",
      "name": "Ollama (Local)",
      "baseURL": "http://localhost:11434/v1",
      "defaultModel": "llama3.2",
      "supportsTools": true,
      "supportsStreaming": true,
      "requiresApiKey": false,
      "description": "Ollama — Run open-source LLMs locally"
    },
    {
      "key": "mistral",
      "name": "Mistral AI",
      "baseURL": "https://api.mistral.ai/v1",
      "defaultModel": "mistral-large-latest",
      "supportsTools": true,
      "supportsVision": true,
      "supportsStreaming": true,
      "description": "Mistral AI — European AI lab with efficient, high-quality models"
    }
  ],
  "count": 10
}
```

### Test Custom Provider Connection

**POST** `/test`

- **Authentication**: Required
- **Description**: Test connection to a custom provider without saving it. Normalizes the URL (adds `/v1` if needed) and calls the `/models` endpoint.
- **Body**:

```json
{
  "base_url": "https://api.example.com",
  "api_key": "your-api-key"
}
```

- `base_url` (required): API base URL to test
- `api_key` (optional): API key for authentication

- **Response** (success):

```json
{
  "success": true,
  "modelsCount": 15,
  "models": ["model-1", "model-2", "model-3", "model-4", "model-5"]
}
```

**Note:** Returns at most 5 model IDs as a preview.

- **Response** (connection failure):

```json
{
  "success": false,
  "error": "HTTP 401: Unauthorized"
}
```

- **Error** (400): `{ "error": "Missing required fields: base_url" }`

### Get Custom Provider Models

**GET** `/:id/models`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider UUID
- **Description**: Fetch all available models from a custom provider
- **Response**:

```json
{
  "success": true,
  "models": ["model-1", "model-2", "model-3"],
  "count": 3
}
```

---

## Custom Tool Routes

Base path: `/api/custom-tools`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the custom tool service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Custom Tools

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all custom tools for the authenticated user
- **Response**:

```json
[
  {
    "id": "tool-id",
    "name": "Custom Tool",
    "description": "Tool description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Save/Update Custom Tool

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new custom tool or update an existing one
- **Body**:

```json
{
  "id": "optional-tool-id",
  "name": "Custom Tool",
  "description": "Tool description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "id": "tool-id",
    "name": "Custom Tool",
    "description": "Tool description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Custom Tool by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Description**: Retrieve a specific custom tool by ID
- **Response**:

```json
{
  "id": "tool-id",
  "name": "Custom Tool",
  "description": "Tool description",
  "config": {},
  "userId": "user-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Custom Tool

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Body**:

```json
{
  "name": "Updated Tool Name",
  "description": "Updated description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "id": "tool-id",
    "name": "Updated Tool Name",
    "description": "Updated description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Custom Tool

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Description**: Delete a custom tool by ID
- **Response**:

```json
{
  "success": true,
  "message": "Custom tool deleted successfully"
}
```

---

## Email Listener Routes

Base path: `/api/email-listeners`

### Get Email Listeners

**GET** `/`

- **Authentication**: Required
- **Description**: Get all workflows with `receive-email` trigger nodes for the authenticated user
- **Response**:

```json
{
  "success": true,
  "listeners": [
    {
      "id": "workflow-id",
      "workflow_id": "workflow-id",
      "workflow_name": "Email Handler Workflow",
      "workflow_status": "active",
      "email_address": "workflow-123@agnt.gg",
      "email_config": "Built-in Email",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Execution Routes

Base path: `/api/executions`

### Get All Executions

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all executions for the authenticated user
- **Response**:

```json
[
  {
    "id": "execution-id",
    "type": "agent|workflow|tool",
    "status": "running|completed|failed",
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:05:00Z",
    "metadata": {}
  }
]
```

### Get Agent Activity Data

**POST** `/activity`

- **Authentication**: Required
- **Body**:

```json
{
  "agentId": "agent-id",
  "timeRange": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-02T00:00:00Z"
  }
}
```

- **Response**:

```json
{
  "activities": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "type": "chat|execution",
      "details": {}
    }
  ],
  "summary": {
    "totalChats": 10,
    "totalExecutions": 5
  }
}
```

### Get Execution Details

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution ID
- **Description**: Retrieve detailed information about a specific execution
- **Response**:

```json
{
  "id": "execution-id",
  "type": "agent|workflow|tool",
  "status": "running|completed|failed",
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-01T00:05:00Z",
  "input": {},
  "output": {},
  "logs": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "level": "info|error|debug",
      "message": "Log message"
    }
  ],
  "metadata": {}
}
```

### Get Agent Executions

**GET** `/agents/list`

- **Authentication**: Required
- **Description**: Get all agent/orchestrator execution traces
- **Response**:

```json
{
  "success": true,
  "runs": [
    {
      "id": "run-id",
      "agentId": "agent-id",
      "agentName": "Agent Name",
      "status": "completed|running|failed",
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z",
      "tokensUsed": 1500,
      "cost": 0.003
    }
  ]
}
```

### Get Agent Execution Details

**GET** `/agents/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution/run ID
- **Description**: Get detailed agent execution trace including messages and tool calls
- **Response**:

```json
{
  "success": true,
  "run": {
    "id": "run-id",
    "agentId": "agent-id",
    "status": "completed",
    "messages": [],
    "toolCalls": [],
    "tokensUsed": 1500,
    "cost": 0.003,
    "startedAt": "2024-01-01T00:00:00Z",
    "completedAt": "2024-01-01T00:05:00Z"
  }
}
```

### Delete Agent Execution

**DELETE** `/agents/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution/run ID
- **Description**: Delete a specific agent execution trace
- **Response**:

```json
{
  "success": true,
  "message": "Agent execution deleted"
}
```

### Clear Completed Agent Executions

**POST** `/agents/clear-completed`

- **Authentication**: Required
- **Description**: Clear all completed agent execution traces for the authenticated user
- **Response**:

```json
{
  "success": true,
  "cleared": 15
}
```

---

## Evolution / Insight Routes

Base path: `/api/insights`

The unified evolution system extracts actionable insights from agent chats, goal executions, and workflow runs. Insights can target agents, skills, workflows, or tools and are automatically generated when executions complete. The system also manages per-agent memory (facts, preferences, corrections learned from conversations).

### List Insights

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `targetType` (query, optional): Filter by target type (`agent`, `skill`, `workflow`, `tool`)
  - `targetId` (query, optional): Filter by target ID
  - `status` (query, optional): Filter by status (`pending`, `applied`, `rejected`)
  - `category` (query, optional): Filter by category (`memory`, `prompt_refinement`, `skill_recommendation`, `tool_preference`, `bottleneck`, `optimization`, `error_pattern`, `skill_candidate`)
  - `limit` (query, optional): Max results (default: 100)
- **Response**:

```json
{
  "success": true,
  "insights": [
    {
      "id": "insight-uuid",
      "user_id": "user-id",
      "source_type": "agent_chat|goal|workflow",
      "source_id": "execution-id",
      "target_type": "agent|skill|workflow|tool",
      "target_id": "agent-id",
      "category": "prompt_refinement",
      "title": "Insight title",
      "description": "Detailed description",
      "confidence": 0.85,
      "priority": "medium",
      "status": "pending",
      "source_context": {},
      "evidence": {},
      "applied_result": null,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Insight Stats

**GET** `/stats`

- **Authentication**: Required
- **Description**: Get aggregated insight counts grouped by status and target type
- **Response**:

```json
{
  "success": true,
  "statusCounts": { "pending": 12, "applied": 8, "rejected": 2 },
  "targetCounts": { "agent": 10, "skill": 5, "workflow": 7 }
}
```

### Get Insights by Target

**GET** `/target/:targetType/:targetId`

- **Authentication**: Required
- **Parameters**:
  - `targetType` (path): `agent`, `skill`, `workflow`, or `tool`
  - `targetId` (path): Target entity ID
  - `status` (query, optional): Filter by status
- **Description**: Get all insights targeting a specific entity (e.g., all insights for a particular agent)
- **Response**:

```json
{
  "success": true,
  "insights": [ ... ]
}
```

### Get Insights by Source

**GET** `/source/:sourceType/:sourceId`

- **Authentication**: Required
- **Parameters**:
  - `sourceType` (path): `agent_chat`, `goal`, or `workflow`
  - `sourceId` (path): Source execution ID
- **Description**: Get all insights generated from a specific execution (e.g., all insights extracted from a particular goal run)
- **Response**:

```json
{
  "success": true,
  "insights": [ ... ]
}
```

### Get Single Insight

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Response**:

```json
{
  "success": true,
  "insight": { ... }
}
```

- **Error** (404): Insight not found

### Autonomy Router — Route Pending Insights (PRD-091 Layer 4)

**POST** `/route`

- **Authentication**: Required
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Sweeps every pending insight for the user through the `InsightAutonomyRouter`. Each insight is evaluated by `AutonomyPolicy.evaluate(insight, settings, ctx)` against `EvolutionSettingsModel.autonomy`. Per-insight verdicts:
  - **`direct`** — apply now (memory, low blast radius, high confidence)
  - **`gated`** — sandbox-test before applying (blast radius ≥ `requireGateAbove`)
  - **`escalate`** — surface to the user as `pending` with `autonomy_decision: 'escalate'` (high blast OR low confidence OR over budget)
  - **`skip`** — autonomy disabled (the default state)

  Every applied insight gets a row in `mutation_history` with `fitness_before` captured for canary detection. **Prefer this over `/:id/apply` for unattended flows.**

- **Response**:

```json
{
  "success": true,
  "summary": {
    "evaluated": 12,
    "direct": 4,
    "gated": 2,
    "escalated": 5,
    "skipped": 1,
    "mutationIds": ["m-uuid", "m-uuid", "..."]
  }
}
```

### Autonomy Router — Route One Insight

**POST** `/:id/route`

- **Authentication**: Required
- **Body** (optional): same `{ provider, model }` override as above
- **Description**: Same logic as `POST /route` but applied to a single insight by id. Useful when surfacing "auto-handle this?" affordance per row.
- **Response**:

```json
{
  "success": true,
  "result": {
    "decision": "direct|gated|escalate|skip",
    "reason": "low_blast_high_confidence",
    "blastRadius": 0.1,
    "mutationId": "m-uuid|null"
  }
}
```

### Evolution Settings — Get

**GET** `/settings`

- **Authentication**: Required
- **Description**: Returns the user's evolution settings, including the autonomy policy block. Defaults live in `AutonomyPolicy.DEFAULTS` (see Closed Loop System section above) — only user overrides are persisted.
- **Response**:

```json
{
  "success": true,
  "settings": {
    "autonomy": {
      "enabled": false,
      "minConfidence": 0.7,
      "maxBlastRadius": 0.5,
      "dailyBudget": 20,
      "allowedCategories": ["memory", "prompt_refinement", "..."],
      "requireGateAbove": 0.45
    }
  }
}
```

### Evolution Settings — Update (Opt-In Switch)

**POST** `/settings`

- **Authentication**: Required
- **Body**:

```json
{
  "autonomy": { "enabled": true, "minConfidence": 0.8 }
}
```

- **Description**: **This is the user opt-in switch.** Flipping `autonomy.enabled` to `true` is what permits the router to direct-apply insights. The agent must **never** flip this without explicit, in-conversation confirmation from the user.
- **Response**:

```json
{ "success": true, "settings": { ... } }
```

### Apply Insight (Direct, Bypasses Router)

**POST** `/:id/apply`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Apply an insight to its target entity. For agent prompt refinements, uses LLM to merge the improvement into the agent's system prompt. Provider/model override the user's defaults for the LLM call. The insight status is updated to `applied`.

> **Note vs. router endpoints above:** `/:id/apply` is the human-confirmed path — bypasses `AutonomyPolicy` entirely and just runs the applicator. Use this when the user clicks an "Apply" button. Use `POST /route` or `POST /:id/route` for unattended / batched application that respects the user's policy. **Do not call `/apply` on critical-priority insights without explicit confirmation.**
- **Response**:

```json
{
  "success": true,
  "result": {
    "applied": true,
    "changes": { ... }
  }
}
```

### Reject Insight

**POST** `/:id/reject`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Description**: Mark an insight as rejected
- **Response**:

```json
{
  "success": true,
  "message": "Insight rejected"
}
```

### Delete Insight

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Response**:

```json
{
  "success": true,
  "deleted": true
}
```

### Trigger Periodic Rollup

**POST** `/rollup`

- **Authentication**: Required
- **Description**: Manually trigger tool usage rollup analysis. Extracts tool preference insights from recent execution history.
- **Response**:

```json
{
  "success": true,
  "count": 3,
  "insightIds": ["id-1", "id-2", "id-3"]
}
```

### Get Agent Memories

**GET** `/memory/:agentId`

- **Authentication**: Required
- **Parameters**:
  - `agentId` (path): Agent ID
  - `memoryType` (query, optional): Filter by type (`fact`, `preference`, `correction`)
- **Description**: Get all memories for an agent. Memories are facts, preferences, and corrections learned from conversations.
- **Response**:

```json
{
  "success": true,
  "memories": [
    {
      "id": "memory-uuid",
      "agent_id": "agent-id",
      "user_id": "user-id",
      "memory_type": "fact",
      "content": "User prefers TypeScript over JavaScript",
      "relevance_score": 0.9,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Add Agent Memory

**POST** `/memory/:agentId`

- **Authentication**: Required
- **Parameters**:
  - `agentId` (path): Agent ID
- **Body**:

```json
{
  "memoryType": "fact|preference|correction",
  "content": "User prefers concise answers"
}
```

- **Response**:

```json
{
  "success": true,
  "id": "memory-uuid"
}
```

### Update Agent Memory

**PUT** `/memory/entry/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Memory entry ID
- **Body**:

```json
{
  "content": "Updated memory content",
  "relevanceScore": 0.95,
  "memoryType": "preference"
}
```

- **Response**:

```json
{
  "success": true,
  "updated": true
}
```

### Delete Agent Memory

**DELETE** `/memory/entry/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Memory entry ID
- **Response**:

```json
{
  "success": true,
  "deleted": true
}
```

---

## Memory Routes

Base path: `/api/memory`

Hybrid full-text search across the user's persistent history — the "remember anything" layer. Backed by SQLite FTS5 virtual tables that shadow `conversation_logs`, `agent_executions`, `content_outputs`, `insights`, `agent_memory`, and `workflow_versions`. Triggers keep the indexes in sync; the source tables remain the system of record.

The same surface is also exposed to the chat orchestrator as the `recall`, `list_recent`, and `get_trace` tools.

### Search

**GET** `/search`

- **Authentication**: Required
- **Description**: Hybrid keyword + date-range search across all (or a subset of) memory sources. When `q` is provided, results are ranked by BM25 relevance; when omitted, the endpoint falls back to time-ordered recent rows (same shape as `/recent`).
- **Query Parameters**:
  - `q` (string, optional): Keyword(s). Tokens are sanitized (alphanumeric + `-_` only), prefix-matched, and AND-ed. e.g. `q=pokemon mew` matches both terms with prefix expansion.
    - **Alias**: `query` is accepted as a synonym for `q`. If both are sent, `q` wins.
  - `since` (ISO-8601, optional): Lower bound on the source's timestamp column (e.g. `2026-05-19T00:00:00Z`).
  - `until` (ISO-8601, optional): Upper bound.
  - `sources` (CSV, optional): Subset of `conversations,executions,outputs,insights,memory,versions`. Omit to search all.
  - `limit` (integer, optional): Max results to return. Default 50, cap 200.
- **Example**: `GET /api/memory/search?q=pokemon&since=2026-05-19T00:00:00Z&sources=conversations,outputs&limit=20`
- **Response**:

```json
{
  "success": true,
  "count": 12,
  "results": [
    {
      "kind": "conversation",
      "id": "conversation-uuid",
      "timestamp": "2026-05-24T19:23:00Z",
      "title": "make a pokemon red mew starter save",
      "snippet": "...generated «pokemon» starter screenshots...",
      "score": -7.42,
      "meta": { "conversation_id": "conversation-uuid", "row_id": 4221 }
    },
    {
      "kind": "execution",
      "id": "execution-uuid",
      "timestamp": "2026-05-24T19:24:11Z",
      "title": "Orchestrator run · completed",
      "snippet": "...wrote ascii_screen.py for «pokemon»...",
      "score": -6.91,
      "meta": {
        "execution_id": "execution-uuid",
        "conversation_id": "conversation-uuid",
        "agent_id": null,
        "agent_name": "Orchestrator",
        "status": "completed",
        "provider": "OpenAI-Codex",
        "model": "gpt-5.5",
        "end_time": "2026-05-24T19:25:03Z"
      }
    }
  ]
}
```

Each result row is normalized to `{ kind, id, timestamp, title, snippet, score?, meta }`. `kind` is one of `conversation | execution | output | insight | memory | version`. `score` is BM25 (lower = more relevant) and is only present when `q` was provided. `meta` carries kind-specific identifiers — most importantly `meta.execution_id`, which you can pass to `/trace/:id` for the full trace.

### Recent

**GET** `/recent`

- **Authentication**: Required
- **Description**: Time-bounded "what happened recently?" lookup without a keyword. Useful for "what did you do last week" style questions where the user wants a chronological summary, not a search.
- **Query Parameters**:
  - `days` (integer, optional): Days back from now. Default 7. Minimum 1.
  - `kind` (string, optional): Restrict to a single source: `conversations | executions | outputs | insights | memory | versions`. Omit to include all.
  - `limit` (integer, optional): Max results to return. Default 100, cap 500.
- **Example**: `GET /api/memory/recent?days=7&kind=executions&limit=50`
- **Response**: Same shape as `/search`, but rows are sorted by `timestamp DESC` and have no `score` field.

### Get Trace Detail

**GET** `/trace/:executionId`

- **Authentication**: Required
- **Description**: Full detail for a single `agent_executions` row plus its `agent_tool_executions` children. Convenience wrapper around `GET /api/executions/agents/:id` that additionally parses each tool call's `input` / `output` JSON.
- **Parameters**:
  - `executionId` (path): The `agent_executions.id` UUID. Most easily obtained from `result.meta.execution_id` on a `/search` or `/recent` result.
- **Response**:

```json
{
  "success": true,
  "trace": {
    "id": "execution-uuid",
    "agentId": null,
    "agentName": "Orchestrator",
    "conversationId": "conversation-uuid",
    "userId": "user-uuid",
    "status": "completed",
    "startTime": "2026-05-24T19:24:11Z",
    "endTime": "2026-05-24T19:25:03Z",
    "initialPrompt": "make a pokemon red mew starter save",
    "finalResponse": "Created the starter save and saved screenshots to ...",
    "provider": "OpenAI-Codex",
    "model": "gpt-5.5",
    "totalTokens": 66319,
    "estimatedCost": 0.0906,
    "toolExecutions": [
      {
        "id": "tool-exec-uuid",
        "tool_name": "execute_shell_command",
        "start_time": "2026-05-24T19:24:14Z",
        "end_time": "2026-05-24T19:24:15Z",
        "status": "completed",
        "input": { "command": "node inspect_save.py", "cwd": "." },
        "output": { "success": true, "stdout": "..." },
        "error": null,
        "credits_used": 0.12
      }
    ]
  }
}
```

If the trace doesn't exist (or belongs to a different user), responds `404 { success: false, error: "Trace not found" }`.

### Implementation Notes

- FTS5 indexes are created on first boot via `setupFullTextSearch()` in `backend/src/models/database/fts.js`. Existing rows are backfilled once; thereafter `AFTER INSERT / UPDATE / DELETE` triggers keep the FTS tables in sync with their source.
- Keyword sanitization strips everything but `[a-zA-Z0-9_-]`, then appends `*` to each surviving token for prefix expansion. This is both safe (no FTS5 syntax injection) and forgiving (`pokemon` matches `pokemons`, `pokemon-red`).
- All queries are scoped to `req.user.userId` — there is no cross-user visibility. `workflow_versions` doesn't store `user_id` directly, so the versions source joins through `workflows.user_id` for scoping.
- Wrong-method requests (e.g. `POST /api/memory/search`) respond `405` with `{ success: false, error: "Method POST not allowed. Use GET ..." }` and an `Allow: GET` header — never an HTML error page.

---

## Experiment Routes

Base path: `/api/experiments`

Manages A/B testing experiments, evaluation datasets, and benchmarks for the evolution system.

### Create Eval Dataset

**POST** `/datasets`

- **Authentication**: Required
- **Description**: Create an evaluation dataset (manual or synthetic)
- **Body**:

```json
{
  "name": "Dataset Name",
  "skillId": "skill-id",
  "category": "general",
  "source": "manual|synthetic|history|golden",
  "items": [
    {
      "input": "Test input",
      "expectedOutput": "Expected output",
      "metadata": {}
    }
  ],
  "splitConfig": {
    "train": 0.7,
    "test": 0.2,
    "validation": 0.1
  }
}
```

- **Response**:

```json
{
  "success": true,
  "datasetId": "dataset-uuid"
}
```

### List Datasets

**GET** `/datasets`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (query, optional): Filter by skill
  - `category` (query, optional): Filter by category
- **Response**:

```json
{
  "success": true,
  "datasets": [
    {
      "id": "dataset-id",
      "name": "Dataset Name",
      "skillId": "skill-id",
      "category": "general",
      "source": "manual",
      "itemCount": 100,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Generate Dataset

**POST** `/datasets/generate`

- **Authentication**: Required
- **Description**: Auto-generate a dataset from goal history, golden standards, or synthetically
- **Body**:

```json
{
  "skillId": "skill-id",
  "source": "history|golden|synthetic",
  "category": "general",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "datasetId": "dataset-uuid"
}
```

### Get Dataset with Splits

**GET** `/datasets/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Dataset ID
- **Response**:

```json
{
  "success": true,
  "dataset": {
    "id": "dataset-id",
    "name": "Dataset Name",
    "items": []
  },
  "splits": {
    "train": [],
    "test": [],
    "validation": []
  }
}
```

### Delete Dataset

**DELETE** `/datasets/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Dataset ID
- **Response**:

```json
{
  "success": true
}
```

### Get Benchmarks

**GET** `/benchmarks`

- **Authentication**: Required
- **Description**: List golden standard benchmarks available for experiments
- **Response**:

```json
{
  "success": true,
  "benchmarks": [
    {
      "id": "benchmark-id",
      "name": "Benchmark Name",
      "sourceGoalId": "goal-id",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Experiment

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "Experiment Name",
  "hypothesis": "Skill v2 will outperform v1 on accuracy",
  "type": "ab_test|benchmark|regression",
  "sourceGoalId": "goal-id",
  "benchmarkId": "benchmark-id",
  "skillId": "skill-id",
  "evalDatasetId": "dataset-id",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "experiment": {
    "id": "experiment-id",
    "name": "Experiment Name",
    "status": "created",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### List Experiments

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `status` (query, optional): Filter by status
  - `limit` (query, optional): Max results (default: 50)
- **Response**:

```json
{
  "success": true,
  "experiments": [
    {
      "id": "experiment-id",
      "name": "Experiment Name",
      "status": "created|running|completed|failed",
      "type": "ab_test",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Experiment with Results

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Response**:

```json
{
  "success": true,
  "experiment": {
    "id": "experiment-id",
    "name": "Experiment Name",
    "status": "completed",
    "results": {},
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Run Experiment

**POST** `/:id/run`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Body** (optional):

```json
{
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Description**: Fire-and-forget experiment execution. Returns immediately while the experiment runs in the background.
- **Response**:

```json
{
  "success": true,
  "message": "Experiment run started"
}
```

### Delete Experiment

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Response**:

```json
{
  "success": true
}
```

### Get Experiment Runs

**GET** `/:id/runs`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Description**: Get all run results for an experiment
- **Response**:

```json
{
  "success": true,
  "runs": [
    {
      "id": "run-id",
      "experimentId": "experiment-id",
      "status": "completed",
      "results": {},
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z"
    }
  ]
}
```

---

## FileSystem Routes

Base path: `/api/filesystem`

Provides a sandboxed file system for the built-in code editor. All file paths are relative to the configured workspace root. Path traversal outside the workspace is blocked (403).

### Get Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Returns the current workspace root directory and default root
- **Response**:

```json
{
  "workspaceRoot": "/home/user/.agnt/data/projects",
  "defaultRoot": "/home/user/.agnt/data/projects"
}
```

### Update Settings

**PUT** `/settings`

- **Authentication**: Required
- **Description**: Update the workspace root directory
- **Body**:

```json
{
  "workspaceRoot": "/path/to/new/workspace"
}
```

- **Response**:

```json
{
  "success": true,
  "workspaceRoot": "/path/to/new/workspace"
}
```

### Get Directory Tree

**GET** `/tree?dir=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `dir` (query, optional): Relative path within workspace (default: root)
- **Description**: Returns directory listing for the given relative path. Hidden files (dot-prefixed) are excluded. Directories are listed first.
- **Response**:

```json
{
  "items": [
    { "name": "src", "type": "directory", "path": "src" },
    { "name": "index.js", "type": "file", "path": "index.js" }
  ],
  "root": "/"
}
```

### Read File

**GET** `/file?path=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `path` (query, required): Relative file path within workspace
- **Description**: Returns the content of a file as UTF-8 text
- **Response**:

```json
{
  "content": "file contents here...",
  "path": "src/index.js"
}
```

- **Error** (404): File not found

### Write File

**POST** `/file`

- **Authentication**: Required
- **Description**: Create or overwrite a file. Parent directories are created automatically.
- **Body**:

```json
{
  "path": "src/index.js",
  "content": "console.log('hello');"
}
```

- **Response**:

```json
{
  "success": true,
  "path": "src/index.js"
}
```

### Create Directory

**POST** `/mkdir`

- **Authentication**: Required
- **Description**: Create a directory (recursive)
- **Body**:

```json
{
  "path": "src/components"
}
```

- **Response**:

```json
{
  "success": true,
  "path": "src/components"
}
```

### Rename / Move

**POST** `/rename`

- **Authentication**: Required
- **Description**: Rename or move a file or directory
- **Body**:

```json
{
  "oldPath": "src/old-name.js",
  "newPath": "src/new-name.js"
}
```

- **Response**:

```json
{
  "success": true,
  "oldPath": "src/old-name.js",
  "newPath": "src/new-name.js"
}
```

### Delete File or Directory

**DELETE** `/file?path=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `path` (query, required): Relative path within workspace
- **Description**: Delete a file or directory (recursive for directories)
- **Response**:

```json
{
  "success": true,
  "path": "src/old-file.js"
}
```

- **Error** (404): File not found

---

## Goal Routes

Base path: `/api/goals`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the goal service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Goals

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all goals for the authenticated user. Includes aggregated token usage from goal evaluations.
- **Response**:

```json
[
  {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active|paused|completed|validated|needs_review|failed",
    "priority": "low|medium|high",
    "task_count": 5,
    "completed_tasks": 3,
    "input_tokens": 15000,
    "output_tokens": 3200,
    "total_tokens": 18200,
    "estimated_cost": 0.045,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Create Goal

**POST** `/create`

- **Authentication**: Required
- **Body**:

```json
{
  "title": "Goal Title",
  "description": "Goal description",
  "priority": "low|medium|high",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "goal": {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active",
    "priority": "medium",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Execute Goal

**POST** `/:goalId/execute`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Start goal execution. Any failed or stuck tasks are reset to pending. The provider/model override the user's default settings for this execution and all downstream operations (task execution, evaluation, insight extraction, skill evolution).
- **Response**:

```json
{
  "message": "Goal execution started",
  "goalId": "goal-id",
  "status": "executing"
}
```

### Get Goal by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Retrieve a specific goal with tasks and aggregated token usage from evaluations and task executions
- **Response**:

```json
{
  "goal": {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active|paused|completed|validated|needs_review|failed",
    "priority": "low|medium|high",
    "config": {},
    "tasks": [],
    "total_duration": 120,
    "credits_used": 120,
    "input_tokens": 15000,
    "output_tokens": 3200,
    "total_tokens": 18200,
    "estimated_cost": 0.045,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Goal Status

**GET** `/:id/status`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Get the current status of a goal
- **Response**:

```json
{
  "goalId": "goal-id",
  "status": "active|paused|completed|failed",
  "progress": 75,
  "lastExecution": "2024-01-01T00:00:00Z",
  "nextExecution": "2024-01-01T01:00:00Z"
}
```

### Pause Goal

**POST** `/:id/pause`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Pause an active goal
- **Response**:

```json
{
  "success": true,
  "message": "Goal paused successfully"
}
```

### Resume Goal

**POST** `/:id/resume`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Resume a paused or failed goal. Failed/stuck tasks are reset to pending. Provider/model are forwarded to all downstream operations.
- **Response**:

```json
{
  "message": "Goal resumed"
}
```

### Delete Goal

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Delete a goal by ID
- **Response**:

```json
{
  "success": true,
  "message": "Goal deleted successfully"
}
```

### Execute Goal Autonomously (AGI Loop)

**POST** `/:goalId/execute-autonomous`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "maxIterations": 50,
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Trigger autonomous goal execution. The system iterates through execute → evaluate → re-plan cycles until the goal passes evaluation or reaches `maxIterations`. Provider/model are forwarded to task execution, evaluation, re-planning, insight extraction, and skill evolution. Broadcasts real-time `goal:iteration_*` events via WebSocket.
- **Response**:

```json
{
  "message": "Autonomous goal execution started",
  "goalId": "goal-id",
  "maxIterations": 50
}
```

### Get Iteration History

**GET** `/:goalId/iterations`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Description**: Get the full iteration history for an autonomous goal execution. Each iteration includes evaluation scores and re-planned task data.
- **Response**:

```json
{
  "success": true,
  "iterations": [
    {
      "iteration": 1,
      "action": "Description of action taken",
      "result": {},
      "evaluation": {},
      "evaluation_score": 65.5,
      "evaluation_passed": 0,
      "world_state_snapshot": {},
      "replanned_tasks": [],
      "duration_ms": 45000,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get World State

**GET** `/:goalId/world-state`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Description**: Get the current world state snapshot for a goal's autonomous execution
- **Response**:

```json
{
  "success": true,
  "worldState": {
    "goalId": "goal-id",
    "currentIteration": 5,
    "state": {},
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Revert to Iteration

**POST** `/:goalId/revert/:iteration`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
  - `iteration` (path): Iteration number to revert to
- **Description**: Revert the goal's execution state to a specific iteration
- **Response**:

```json
{
  "success": true,
  "revertedToIteration": 3,
  "worldState": {}
}
```

### Review Goal

**POST** `/:id/review`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Approve or reject a goal that is in `needs_review` status
- **Body**:

```json
{
  "status": "approved|rejected",
  "feedback": "Optional feedback message"
}
```

- **Response**:

```json
{
  "success": true,
  "goal": {
    "id": "goal-id",
    "status": "approved",
    "reviewedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Evaluate Goal

**POST** `/:id/evaluate`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body**:

```json
{
  "evaluation_type": "automatic",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Evaluate a completed goal using LLM-as-judge. Each task output is scored against its success criteria, then an overall evaluation is produced. Token usage is tracked and stored per evaluation. The goal status is set to `validated` (score ≥ 70%) or `needs_review`.
- **Response**:

```json
{
  "passed": true,
  "status": "validated",
  "scores": {
    "overall": 85,
    "taskScores": {}
  },
  "feedback": "Detailed evaluation feedback...",
  "input_tokens": 8000,
  "output_tokens": 1500,
  "total_tokens": 9500,
  "estimated_cost": 0.025
}
```

### Get Evaluation Report

**GET** `/:id/evaluation`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Get evaluation report for a goal
- **Response**:

```json
{
  "goalId": "goal-id",
  "evaluations": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "score": 85,
      "metrics": {},
      "recommendations": []
    }
  ]
}
```

### Save as Golden Standard

**POST** `/:id/golden-standard`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body**:

```json
{
  "name": "Golden Standard Name",
  "description": "Description of the golden standard"
}
```

- **Response**:

```json
{
  "success": true,
  "goldenStandard": {
    "id": "golden-standard-id",
    "name": "Golden Standard Name",
    "description": "Description",
    "sourceGoalId": "goal-id",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Golden Standards

**GET** `/golden-standards/list`

- **Authentication**: Required
- **Description**: Retrieve all golden standards
- **Response**:

```json
{
  "goldenStandards": [
    {
      "id": "golden-standard-id",
      "name": "Golden Standard Name",
      "description": "Description",
      "sourceGoalId": "goal-id",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Layout Routes

Base path: `/api/layouts`

Manages per-user widget layout pages for the dashboard. Each page stores a grid layout of widgets.

### Get All Layouts

**GET** `/`

- **Authentication**: Required
- **Description**: Get all layout pages for the authenticated user
- **Response**:

```json
{
  "pages": [
    {
      "id": "uuid",
      "user_id": "user-id",
      "page_id": "dashboard",
      "page_name": "Dashboard",
      "page_icon": "fas fa-th",
      "page_order": 0,
      "route": "/dashboard",
      "layout_data": "[...]",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Layout

**POST** `/`

- **Authentication**: Required
- **Description**: Create a new layout page
- **Body**:

```json
{
  "page_id": "my-page",
  "page_name": "My Page",
  "page_icon": "fas fa-th",
  "page_order": 1,
  "route": "/my-page",
  "layout_data": "[]"
}
```

- **Response** (201):

```json
{
  "message": "Layout created",
  "id": "uuid",
  "page_id": "my-page"
}
```

### Update Layout

**PUT** `/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Update a layout page (upserts if not found)
- **Body**:

```json
{
  "page_name": "Updated Name",
  "page_icon": "fas fa-chart-bar",
  "page_order": 2,
  "route": "/updated-page",
  "layout_data": "[...]"
}
```

- **Response**:

```json
{
  "message": "Layout updated",
  "page_id": "my-page"
}
```

### Delete Layout

**DELETE** `/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Delete a layout page
- **Response**:

```json
{
  "message": "Layout deleted",
  "page_id": "my-page"
}
```

### Reset Layout

**POST** `/reset/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Reset a page to default layout
- **Body**:

```json
{
  "layout_data": "[]"
}
```

- **Response**:

```json
{
  "message": "Layout reset",
  "page_id": "my-page"
}
```

---

## MCP Routes

Base path: `/api/mcp`

### Get All MCP Servers

**GET** `/servers`

- **Authentication**: Required
- **Description**: Retrieve all MCP servers for the authenticated user
- **Response**:

```json
{
  "success": true,
  "servers": [
    {
      "name": "server-name",
      "description": "Server description",
      "url": "https://server-url.com",
      "status": "active|inactive",
      "config": {}
    }
  ]
}
```

### Add MCP Server

**POST** `/servers`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "server-name",
  "description": "Server description",
  "url": "https://server-url.com",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "server": {
    "name": "server-name",
    "description": "Server description",
    "url": "https://server-url.com",
    "status": "active",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Update MCP Server

**PUT** `/servers/:name`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Body**:

```json
{
  "description": "Updated description",
  "url": "https://updated-url.com",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "server": {
    "name": "server-name",
    "description": "Updated description",
    "url": "https://updated-url.com",
    "status": "active",
    "config": {},
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete MCP Server

**DELETE** `/servers/:name`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Delete an MCP server by name
- **Response**:

```json
{
  "success": true,
  "message": "MCP server deleted successfully"
}
```

### Get Server Capabilities

**GET** `/servers/:name/capabilities`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Get capabilities of a specific MCP server
- **Response**:

```json
{
  "success": true,
  "capabilities": {
    "tools": ["tool1", "tool2"],
    "resources": ["resource1", "resource2"],
    "prompts": ["prompt1", "prompt2"]
  }
}
```

### Test MCP Server Connection

**POST** `/servers/:name/test`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Test connection to an MCP server
- **Response**:

```json
{
  "success": true,
  "message": "Connection successful",
  "latency": 150,
  "capabilities": {
    "tools": ["tool1", "tool2"],
    "resources": ["resource1", "resource2"]
  }
}
```

---

## Model Routes

Base path: `/api/models`

Also mounted at `/api/openrouter` for legacy backward compatibility (all routes below work at both base paths).

### List Available Providers

To discover all available built-in providers, request models for an unknown provider name. The error response includes the full list:

**GET** `/:provider/models` (with an invalid provider name)

```json
{
  "success": false,
  "error": "Unknown provider: invalid",
  "availableProviders": [
    "openai",
    "anthropic",
    "gemini",
    "grokai",
    "groq",
    "deepseek",
    "openrouter",
    "togetherai",
    "cerebras",
    "kimi",
    "minimax",
    "zai",
    "openai-codex",
    "claude-code",
    "gemini-cli"
  ]
}
```

Alternatively, the [Provider Health](#get-provider-health) endpoint returns status for all providers, and [Provider Templates](#get-provider-templates) lists additional custom-provider-ready templates.

### Get Models by Provider

**GET** `/:provider/models`

- **Authentication**: Required (except for static-model providers like `openai-codex` and CLI providers which use local auth)
- **Parameters**:
  - `provider` (path): Provider key or display name. Keys: `openai`, `anthropic`, `gemini`, `grokai` (alias: `grok`), `groq`, `deepseek`, `openrouter`, `togetherai`, `cerebras`, `kimi`, `minimax`, `zai`, `openai-codex`, `claude-code`, `gemini-cli`. Display names like `"Z-AI"` or `"Grok AI"` are also resolved.
  - `category` (query, optional): Filter by category — `all` (default), `programming`, `creative`, `reasoning`
  - `useCache` (query, optional): Use cached models — `true` (default) or `false`
  - `format` (query, optional): Response format — `names` (default, array of model ID strings) or `full` (array of model objects with metadata)
- **Description**: Fetch available models from a specific provider
- **Response** (`format=names`, default):

```json
{
  "success": true,
  "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  "cached": true,
  "count": 3
}
```

- **Response** (`format=full`):

```json
{
  "success": true,
  "models": [
    {
      "id": "gpt-4o",
      "name": "gpt-4o",
      "description": "",
      "createdAt": "2024-05-13T00:00:00Z",
      "ownedBy": "openai"
    }
  ],
  "cached": true,
  "count": 1
}
```

- **Error** (400): `{ "error": "Unknown provider: <name>", "availableProviders": [...] }` if provider not found
- **Error** (400): Provider-specific auth errors (e.g., CLI not connected, API key not found)
- **Error** (401): `{ "error": "Authentication required to fetch <provider> models" }` if JWT missing for standard providers

### Refresh Models Cache

**POST** `/:provider/models/refresh`

- **Authentication**: Required (same rules as GET)
- **Parameters**:
  - `provider` (path): Provider key or display name
- **Description**: Clear the models cache and fetch fresh models from the provider API
- **Response**:

```json
{
  "success": true,
  "models": ["gpt-4o", "gpt-4-turbo"],
  "count": 2,
  "message": "openai models cache refreshed successfully"
}
```

### Get OpenRouter Models (Legacy)

**GET** `/models`

- **Description**: Legacy endpoint — redirects internally to `/:provider/models` with `provider=openrouter`
- **Response**: Same as `GET /:provider/models` for openrouter

### Refresh OpenRouter Models (Legacy)

**POST** `/models/refresh`

- **Description**: Legacy endpoint — redirects internally to `/:provider/models/refresh` with `provider=openrouter`
- **Response**: Same as `POST /:provider/models/refresh` for openrouter

### Get Provider Metadata (All Models)

**GET** `/:provider/metadata`

- **Authentication**: None
- **Parameters**:
  - `provider` (path): Provider key
- **Description**: Get metadata (cost, context window, capabilities) for all models from a specific provider. Sourced from static configuration, not live API calls.
- **Response**:

```json
{
  "success": true,
  "provider": "openai",
  "metadata": {
    "gpt-4o": {
      "contextWindow": 128000,
      "maxOutputTokens": 16384,
      "inputCostPer1M": 2.5,
      "outputCostPer1M": 10.0,
      "supportsVision": true,
      "supportsTools": true,
      "reasoning": false
    }
  }
}
```

**Note:** Returns `null` metadata for providers without configured model metadata.

### Get Model Metadata (Single Model)

**GET** `/:provider/metadata/:modelId`

- **Authentication**: None
- **Parameters**:
  - `provider` (path): Provider key
  - `modelId` (path): Model ID
  - `inputTokens` (query, optional): Input token count for cost estimate
  - `outputTokens` (query, optional): Output token count for cost estimate
- **Description**: Get metadata for a specific model, optionally with cost estimate. The `cost` field is only included when both `inputTokens` and `outputTokens` are provided.
- **Response**:

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-4o",
  "metadata": {
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "inputCostPer1M": 2.5,
    "outputCostPer1M": 10.0,
    "supportsVision": true,
    "supportsTools": true
  },
  "reasoning": false,
  "cost": {
    "inputCost": 0.0025,
    "outputCost": 0.01,
    "totalCost": 0.0125
  }
}
```

- **Response** (model not found in metadata): `{ "success": true, "provider": "openai", "model": "unknown-model", "metadata": null }`

### Get Provider Health

**GET** `/provider-health`

- **Authentication**: None
- **Description**: Get cached provider health status for all configured providers. Returns the last-known status without making new API calls.
- **Response**:

```json
{
  "success": true,
  "overall": "degraded",
  "healthy": 8,
  "degraded": 0,
  "unhealthy": 1,
  "unknown": 0,
  "total": 9,
  "providers": {
    "openai": { "status": "healthy", "lastChecked": "2024-01-01T00:00:00Z" },
    "anthropic": { "status": "healthy", "lastChecked": "2024-01-01T00:00:00Z" },
    "gemini": { "status": "unhealthy", "error": "Invalid API key", "lastChecked": "2024-01-01T00:00:00Z" }
  }
}
```

The `overall` field is one of: `healthy`, `degraded` (some unhealthy/degraded), `critical` (all unhealthy), `unknown`.

### Check Provider Health (Live)

**POST** `/provider-health/check`

- **Authentication**: Optional (if `Authorization: Bearer <JWT>` is provided, the user's stored API keys are used for more accurate health checks)
- **Description**: Run fresh live health checks against all configured providers. More expensive than the cached GET endpoint — makes actual API calls.
- **Response**:

```json
{
  "success": true,
  "overall": "healthy",
  "healthy": 9,
  "degraded": 0,
  "unhealthy": 0,
  "unknown": 0,
  "total": 9,
  "providers": {
    "openai": { "status": "healthy", "lastChecked": "2024-01-01T00:00:00Z" },
    "anthropic": { "status": "healthy", "lastChecked": "2024-01-01T00:00:00Z" }
  }
}
```

### Get Model Categories

**GET** `/models/categories`

- **Authentication**: None
- **Description**: Get available model categories for filtering
- **Response**:

```json
{
  "success": true,
  "categories": [
    {
      "id": "all",
      "name": "All Models",
      "description": "All available models"
    },
    {
      "id": "programming",
      "name": "Programming",
      "description": "Models optimized for code generation and programming tasks"
    },
    {
      "id": "creative",
      "name": "Creative",
      "description": "Models optimized for creative writing and content generation"
    },
    {
      "id": "reasoning",
      "name": "Reasoning",
      "description": "Models optimized for logical reasoning and problem solving"
    }
  ]
}
```

---

## Mutation History Routes

Base path: `/api/mutations`

Every router-applied change is recorded here (PRD-091 Layer 7). Each row captures the *before-state snapshot* and the `fitness_before` baseline so a regression can trigger non-lossy revert. **This is the audit trail the agent should consult when the user asks "what did AGNT change?" or "undo that change."**

### Mutation shape

```json
{
  "id": "uuid",
  "user_id": "user-uuid",
  "insight_id": "insight-uuid|null",
  "target_type": "agent|skill|workflow|tool|memory",
  "target_id": "target-uuid",
  "operation": "apply|revert",
  "status": "applied|reverted|failed",
  "before_snapshot": { "...": "...": "the asset as it was before the change" },
  "after_snapshot": { "...": "...": "the asset as written" },
  "fitness_before": 0.82,
  "fitness_after": 0.78,
  "fitness_delta": -0.04,
  "reverted_reason": "manual|canary_regression|null",
  "created_at": "...",
  "reverted_at": "..."
}
```

### List Mutations

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `status` (query, optional): `applied`, `reverted`, `failed`
  - `targetType` (query, optional): `agent`, `skill`, `workflow`, `tool`, `memory`
  - `limit` (query, optional): default `200`
- **Description**: Returns the mutation history for the authenticated user, newest first.
- **Response**:

```json
{ "success": true, "history": [ { ... } ] }
```

### Get Single Mutation

**GET** `/:id`

- **Authentication**: Required
- **Description**: Full row including `before_snapshot` and `after_snapshot`. Use this to render a diff or to surface what changed.
- **Response**:

```json
{ "success": true, "mutation": { ... } }
```

- **Errors**: `404` not found, `403` forbidden

### Canary Check (Detect Regression)

**POST** `/:id/canary-check`

- **Authentication**: Required
- **Description**: Re-scores fitness for the mutated asset right now (using `FitnessScoreService.forTool` / `forWorkflow`) and compares against the stored `fitness_before` baseline. Persists `fitness_after` and `fitness_delta` on the row. **The agent should call this before suggesting revert.**
- **Response**:

```json
{
  "success": true,
  "verdict": {
    "regression": true,
    "delta": -0.12,
    "fitnessAfter": 0.70
  }
}
```

- **Verdict shape:**
  - `regression: true` when `delta < -0.05` (default `minDelta`)
  - `regression: false, reason: 'not_applicable'` when mutation isn't in `applied` status
  - `regression: false, reason: 'no_baseline'` when `fitness_before` was never captured
  - `regression: false, reason: 'no_after_score'` when there's no recent execution data to score against

### Revert Mutation

**POST** `/:id/revert`

- **Authentication**: Required
- **Body** (optional):

```json
{ "reason": "manual" }
```

- **Description**: Marks the mutation row as `reverted` with `reverted_reason`. The actual rollback uses the `before_snapshot` to restore the asset (handled by the model). Safe to call only when canary-check confirms regression OR the user explicitly requests it.
- **Response**:

```json
{ "success": true }
```

- **Default `reason`**: `"manual"` when the user triggers revert; the periodic canary sweep uses `"canary_regression"`.

---

## NPM Routes

Base path: `/api/npm`

### Search MCP Servers

**GET** `/search`

- **Authentication**: Required
- **Parameters**:
  - `q` (query): Search query
  - `limit` (query): Maximum results (optional)
- **Description**: Search for MCP servers on NPM
- **Response**:

```json
{
  "success": true,
  "packages": [
    {
      "name": "package-name",
      "version": "1.0.0",
      "description": "Package description",
      "author": "Author Name",
      "keywords": ["mcp", "server"],
      "downloads": 1000
    }
  ]
}
```

### Get Popular Servers

**GET** `/popular`

- **Authentication**: Required
- **Description**: Get popular MCP servers from NPM
- **Response**:

```json
{
  "success": true,
  "packages": [
    {
      "name": "popular-package",
      "version": "1.0.0",
      "description": "Popular package description",
      "downloads": 10000,
      "rating": 4.5
    }
  ]
}
```

### Get Package Details

**GET** `/package/:packageName`

- **Authentication**: Required
- **Parameters**:
  - `packageName` (path): NPM package name
- **Description**: Get detailed information about a specific NPM package
- **Response**:

```json
{
  "success": true,
  "package": {
    "name": "package-name",
    "version": "1.0.0",
    "description": "Package description",
    "author": "Author Name",
    "license": "MIT",
    "repository": "https://github.com/user/repo",
    "dependencies": {},
    "downloads": {
      "lastWeek": 1000,
      "lastMonth": 5000,
      "total": 50000
    },
    "readme": "README content"
  }
}
```

### Test Package

**POST** `/test`

- **Authentication**: Required
- **Body**:

```json
{
  "packageName": "package-name",
  "version": "1.0.0"
}
```

- **Response**:

```json
{
  "success": true,
  "testResults": {
    "compatible": true,
    "issues": [],
    "recommendations": []
  }
}
```

---

## Orchestrator Routes

Base path: `/api/orchestrator`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the orchestrator service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get Available Tools

**GET** `/tools`

- **Authentication**: Required
- **Description**: Get the list of tools available to the orchestrator (native tools, registry tools, and installed plugin tools). Used by the frontend tool selector to render available actions.
- **Response**:

```json
{
  "tools": [
    {
      "name": "tool_name",
      "description": "What the tool does",
      "parameters": { "type": "object", "properties": {} },
      "category": "native|plugin|registry"
    }
  ]
}
```

### Universal Chat

**POST** `/chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Universal chat endpoint that handles agent, workflow, tool, and goal interactions
- **Response**: Server-sent events stream

### Agent Chat

**POST** `/agent-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `agentId` (string): Agent ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific agent
- **Response**: Server-sent events stream

### Workflow Chat

**POST** `/workflow-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `workflowId` (string): Workflow ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific workflow
- **Response**: Server-sent events stream

### Tool Chat

**POST** `/tool-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `toolId` (string): Tool ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific tool
- **Response**: Server-sent events stream

### Goal Chat

**POST** `/goal-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `goalId` (string): Goal ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific goal
- **Response**: Server-sent events stream

### Artifact Chat

**POST** `/artifact-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `codeContext` (object, optional): Context from the artifacts workspace (active file, selection, open files)
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Chat handler for the Artifacts workspace ("Annie" assistant). Streams responses and calls the workspace file-operation tools (`read_file`, `write_file`, `edit_file`, `list_files`) against the user's workspace root. See the [Artifacts](#artifacts) section for full details on storage, tools, and events.
- **Response**: Server-sent events stream

### Widget Chat

**POST** `/widget-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Widget-specific chat with streaming. Used for creating and editing custom dashboard widgets.
- **Response**: Server-sent events stream

### Get Suggestions

**POST** `/suggestions`

- **Authentication**: Required
- **Body**:

```json
{
  "context": "Current context or partial message",
  "type": "agent|workflow|tool|goal"
}
```

- **Response**:

```json
{
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}
```

---

## Plugin Routes

Base path: `/api/plugins`

### Get Installed Plugins

**GET** `/installed`

- **Authentication**: None
- **Description**: Get list of installed plugins with their status
- **Response**:

```json
{
  "success": true,
  "plugins": [
    {
      "name": "plugin-name",
      "version": "1.0.0",
      "description": "Plugin description",
      "status": "active|inactive|error",
      "tools": ["tool1", "tool2"]
    }
  ],
  "stats": {
    "total": 5,
    "active": 3,
    "inactive": 2
  }
}
```

### Get Installed Plugin Details

**GET** `/installed/:name`

- **Authentication**: None
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get details of a specific installed plugin, including each tool's full input schema (use this to discover param types and allowed values without guessing).
- **Response**:

```json
{
  "success": true,
  "plugin": {
    "name": "chucknorris-joke-plugin",
    "displayName": "Chuck Norris Jokes",
    "version": "1.0.0",
    "description": "Fetch random Chuck Norris jokes from the public Chuck Norris API.",
    "author": "AGNT User",
    "isValid": true,
    "tools": [
      {
        "type": "chucknorris-get-joke",
        "title": "Get Random Chuck Norris Joke",
        "description": "Retrieves a random Chuck Norris joke, optionally filtered by category.",
        "category": "action",
        "schema": {
          "title": "Get Random Chuck Norris Joke",
          "description": "Retrieves a random Chuck Norris joke, optionally filtered by category.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "category": {
                "type": "string",
                "enum": ["animal", "career", "celebrity", "dev", "explicit", "fashion", "food", "history", "money", "movie", "music", "political", "religion", "science", "sport", "travel"]
              }
            }
          }
        }
      }
    ]
  }
}
```

- **Response (404)**: `{ "success": false, "error": "Plugin '<name>' not found" }`

### Get Plugin Source Code

**GET** `/installed/:name/source`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get source code of an installed plugin
- **Response**:

```json
{
  "success": true,
  "files": {
    "manifest.json": "{...}",
    "package.json": "{...}",
    "index.js": "console.log('hello');"
  }
}
```

### Get Plugin Package

**GET** `/installed/:name/package`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get the plugin as a packaged .agnt file (base64 encoded)
- **Response**:

```json
{
  "success": true,
  "data": "base64-encoded-package-data",
  "size": 1024000,
  "fileName": "plugin-name.agnt"
}
```

### Get Marketplace Plugins

**GET** `/marketplace`

- **Authentication**: None
- **Description**: Get list of available plugins from the marketplace
- **Response**:

```json
{
  "plugins": [
    {
      "name": "marketplace-plugin",
      "version": "1.0.0",
      "description": "Marketplace plugin description",
      "author": "Author Name",
      "downloads": 1000,
      "rating": 4.5
    }
  ]
}
```

### Install Plugin from Marketplace

**POST** `/install`

- **Authentication**: None
- **Body**:

```json
{
  "name": "plugin-name",
  "version": "latest"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Plugin installed successfully",
  "plugin": {
    "name": "plugin-name",
    "version": "1.0.0"
  }
}
```

### Install Plugin from File

**POST** `/install-file`

- **Authentication**: None
- **Body**:

```json
{
  "name": "plugin-name",
  "fileData": "base64-encoded-file-data",
  "fileName": "plugin.agnt"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Plugin installed successfully",
  "plugin": {
    "name": "plugin-name",
    "version": "1.0.0"
  }
}
```

### Uninstall Plugin

**DELETE** `/:name`

- **Authentication**: None
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Uninstall a plugin
- **Response**:

```json
{
  "success": true,
  "message": "Plugin uninstalled successfully"
}
```

### Get Plugin Tools

**GET** `/tools`

- **Authentication**: None
- **Description**: Get all tools provided by plugins
- **Response**:

```json
{
  "success": true,
  "tools": [
    {
      "type": "tool-type",
      "title": "Tool Title",
      "description": "Tool description",
      "category": "action",
      "icon": "tool-icon",
      "plugin": "plugin-name"
    }
  ],
  "count": 1
}
```

### Generate Plugin with AI

**POST** `/generate`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Natural language description of the plugin",
  "provider": "openai",
  "model": "gpt-4",
  "options": {}
}
```

- **Response**: Server-sent events stream with generation progress

### Regenerate Plugin File

**POST** `/regenerate-file`

- **Authentication**: Required
- **Body**:

```json
{
  "fileName": "index.js",
  "instructions": "Update the file to...",
  "currentManifest": {},
  "currentCode": {},
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "content": "Generated file content"
}
```

### Regenerate Entire Plugin

**POST** `/regenerate`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Updated plugin description",
  "currentManifest": {},
  "currentCode": {},
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**: Server-sent events stream with regeneration progress

### Build Generated Plugin

**POST** `/build-generated`

- **Authentication**: Required
- **Body**:

```json
{
  "manifest": {},
  "toolCode": {},
  "packageJson": {},
  "installAfterBuild": true
}
```

- **Response**:

```json
{
  "success": true,
  "pluginName": "generated-plugin",
  "outputFile": "/path/to/plugin.agnt",
  "installed": true,
  "installResult": {
    "success": true
  }
}
```

### Reload Plugins

**POST** `/reload`

- **Authentication**: None
- **Description**: Reload all plugins (useful after manual changes)
- **Response**:

```json
{
  "success": true,
  "message": "Plugins reloaded",
  "stats": {
    "total": 5,
    "active": 3
  },
  "orchestratorReload": {
    "success": true
  },
  "workflowProcessReload": {
    "success": true
  }
}
```

---

## Schedule Routes

Base path: `/api/schedules`

The durable cron scheduler (PRD-091 Layer 1). Use when the user wants recurring execution of a goal. Survives backend restart, uses in-zone DST-correct timing, idempotent on `last_run`. Hangs on `HeartbeatService` — no separate process.

### Schedule shape

```json
{
  "id": "uuid",
  "user_id": "user-uuid",
  "target_type": "goal",
  "target_id": "goal-uuid",
  "cron": "0 9 * * MON-FRI",
  "timezone": "America/New_York",
  "next_run": "2026-06-22T13:00:00.000Z",
  "last_run": "2026-06-19T13:00:00.000Z",
  "enabled": true,
  "on_missed": "fire_once",
  "created_at": "..."
}
```

### Supported cron syntax

5-field cron (`minute hour dom month dow`) plus macros:

- **Macros**: `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`, `@annually`
- **Fields**: `*`, `*/N`, `A-B`, `A,B,C`, day-of-week names (`MON`–`SUN`), `7` aliases to `0` (Sunday)
- **Dom/dow OR semantics**: when both restricted, the schedule fires when *either* matches (standard cron)
- **Timezone**: IANA name (e.g. `America/New_York`, `Europe/London`). Defaults to `UTC`.

### `on_missed` values

| Value | Behavior on backend restart |
|---|---|
| `fire_once` (default) | If next_run is in the past, fire once then resume |
| `fire_all` | Fire once for each missed slot (use sparingly — can cascade) |
| `skip` | Skip missed firings; only resume forward |

### List Schedules

**GET** `/`

- **Authentication**: Required
- **Response**:

```json
{ "success": true, "schedules": [ { ... } ] }
```

### Get Schedules by Target

**GET** `/target/:targetType/:targetId`

- **Authentication**: Required
- **Parameters**:
  - `targetType` (path): `goal` (MVP currently only supports goal)
  - `targetId` (path): the goal ID
- **Description**: Useful for the Goals UI to show "this goal is scheduled."
- **Response**:

```json
{ "success": true, "schedules": [ { ... } ] }
```

### Preview Cron Firings (No Persist)

**POST** `/preview`

- **Authentication**: Required
- **Body**:

```json
{
  "cron": "0 9 * * MON-FRI",
  "timezone": "America/New_York",
  "count": 5
}
```

- **Description**: Validates the cron expression and returns the next `count` firing times (max 25). **Persists nothing.** Use this when surfacing "this schedule will next fire on..." in the UI before the user clicks Create.
- **Response**:

```json
{
  "success": true,
  "previews": [
    "2026-06-22T13:00:00.000Z",
    "2026-06-23T13:00:00.000Z",
    "2026-06-24T13:00:00.000Z"
  ]
}
```

- **Errors**: `400` when `cron` is missing or invalid.

### Create Schedule

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "targetType": "goal",
  "targetId": "goal-uuid",
  "cron": "0 9 * * MON-FRI",
  "timezone": "America/New_York",
  "enabled": true,
  "onMissed": "fire_once"
}
```

- **Description**: Creates a schedule. `next_run` is computed from `cron` + `timezone`. `enabled` defaults to `true`. `onMissed` defaults to `fire_once`.
- **Response** (`201`):

```json
{ "success": true, "schedule": { ... } }
```

- **Errors**:
  - `400` when `targetType`, `targetId`, or `cron` is missing
  - `400` when `cron` is invalid (per `isValidCron`)

### Update Schedule

**PATCH** `/:id`

- **Authentication**: Required
- **Body** (any subset):

```json
{
  "cron": "0 10 * * MON-FRI",
  "timezone": "Europe/London",
  "enabled": false,
  "onMissed": "skip"
}
```

- **Description**: Updates schedule fields. When `cron`, `timezone`, or `onMissed` change, `next_run` is recomputed. Setting `enabled: false` pauses without deleting.
- **Response**:

```json
{ "success": true, "schedule": { ... } }
```

- **Errors**: `404` not found, `403` forbidden, `400` invalid cron

### Fire Schedule Now

**POST** `/:id/fire-now`

- **Authentication**: Required
- **Description**: Manually trigger the schedule's target (currently invokes `TaskOrchestrator.executeGoalAutonomous`). Does NOT update `next_run` — the regular cadence continues unaffected. Useful for "test run" or "I want it now."
- **Response**:

```json
{ "success": true, "result": { "executionId": "...", "status": "running" } }
```

### Get Run History

**GET** `/:id/runs`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): max `500`, default `50`
- **Response**:

```json
{
  "success": true,
  "runs": [
    {
      "id": "run-uuid",
      "schedule_id": "schedule-uuid",
      "fired_at": "2026-06-19T13:00:00.000Z",
      "execution_id": "exec-uuid",
      "status": "completed",
      "duration_ms": 4823
    }
  ]
}
```

### Delete Schedule

**DELETE** `/:id`

- **Authentication**: Required
- **Response**:

```json
{ "success": true, "deleted": true }
```

---

## Skill Routes

Base path: `/api/skills`

Manage reusable agent skills — named instruction sets that can be assigned to agents.

### Get All Skills

**GET** `/`

- **Authentication**: Required
- **Description**: Get all skills for the authenticated user
- **Response**:

```json
{
  "skills": [
    {
      "id": "skill-uuid",
      "name": "Code Reviewer",
      "description": "Reviews code for quality and security",
      "instructions": "When reviewing code...",
      "icon": "fas fa-code",
      "category": "development",
      "allowed_tools": "[\"code-search\",\"file-read\"]",
      "license": "",
      "compatibility": "",
      "metadata": "",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Skill by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Response**:

```json
{
  "skill": { ... }
}
```

- **Error** (404): Skill not found

### Create Skill

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "skill": {
    "name": "Code Reviewer",
    "description": "Reviews code for quality and security",
    "instructions": "When reviewing code, focus on...",
    "icon": "fas fa-code",
    "category": "development",
    "allowedTools": ["code-search", "file-read"]
  }
}
```

- **Response** (201):

```json
{
  "skill": { ... },
  "skillId": "skill-uuid"
}
```

### Update Skill

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Body**:

```json
{
  "skill": {
    "name": "Updated Name",
    "description": "Updated description",
    "instructions": "Updated instructions..."
  }
}
```

- **Response**:

```json
{
  "skill": { ... }
}
```

### Delete Skill

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Response**:

```json
{
  "message": "Skill deleted"
}
```

- **Error** (404): Skill not found

### Export Skill as Markdown

**GET** `/:id/export`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Description**: Export a skill as a `.SKILL.md` file with YAML frontmatter and markdown body
- **Response**: `text/markdown` file download

### Import Skill from Markdown

**POST** `/import`

- **Authentication**: Required
- **Content-Type**: `text/plain`
- **Description**: Import a skill from SKILL.md content (YAML frontmatter + markdown body)
- **Body**: Raw text content of a `.SKILL.md` file

```
---
name: "My Skill"
description: "Skill description"
category: "general"
icon: "fas fa-puzzle-piece"
allowed-tools:
  - code-search
  - file-read
---

Instructions for the skill go here...
```

- **Response** (201):

```json
{
  "skill": { ... },
  "skillId": "skill-uuid"
}
```

---

## SkillForge Routes

Base path: `/api/skillforge`

SkillForge is the skill evolution subsystem within the unified evolution engine. It analyzes goal execution traces via the TraceAnalyzer, extracts patterns and anti-patterns, evolves skills with improved instructions, and tracks performance over time using a Skill Evolution Score (SES). Runs automatically after goal completion when `autoAnalyze` is enabled, or can be triggered manually.

### Get Eligible Goals

**GET** `/eligible-goals`

- **Authentication**: Required
- **Description**: List completed goals that are available for skill forging/analysis
- **Response**:

```json
{
  "success": true,
  "goals": [
    {
      "id": "goal-id",
      "title": "Goal Title",
      "status": "completed",
      "completedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Analyze Goal Trace

**POST** `/analyze/:goalId`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Analyze a goal's execution trace using LLM-as-judge to extract patterns, anti-patterns, and a reusable skill candidate. Provider/model override the user's defaults for the LLM analysis call.
- **Response**:

```json
{
  "success": true,
  "analysis": {
    "patterns": [],
    "antipatterns": [],
    "insights": [],
    "skillCandidate": {}
  }
}
```

### Evolve Skill

**POST** `/evolve/:goalId`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Full analysis and skill evolution — analyzes the goal trace, creates or updates a skill with merged instructions, and records the evolution with SES tracking. Provider/model are forwarded to trace analysis and skill instruction merging.
- **Response**:

```json
{
  "success": true,
  "result": {
    "skillId": "skill-id",
    "previousVersion": 1,
    "newVersion": 2,
    "sesDelta": 0.15,
    "improvements": []
  }
}
```

### Get All Evaluations

**GET** `/evaluations`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): Max results (default: 50)
- **Description**: List all skill evaluations for the authenticated user
- **Response**:

```json
{
  "success": true,
  "evaluations": [
    {
      "id": "eval-id",
      "skillId": "skill-id",
      "score": 85,
      "sesDelta": 0.12,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Evaluations for Skill

**GET** `/evaluations/:skillId`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get all evaluations for a specific skill
- **Response**:

```json
{
  "success": true,
  "evaluations": [
    {
      "id": "eval-id",
      "skillId": "skill-id",
      "score": 85,
      "sesDelta": 0.12,
      "version": 2,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Leaderboard

**GET** `/leaderboard`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): Max results (default: 20)
- **Description**: Get top skills ranked by average SES delta
- **Response**:

```json
{
  "success": true,
  "leaderboard": [
    {
      "skillId": "skill-id",
      "skillName": "Code Reviewer",
      "avgSesDelta": 0.25,
      "totalEvolutions": 8,
      "currentVersion": 5
    }
  ]
}
```

### Get Skill Version History

**GET** `/skill/:skillId/versions`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get the version history for a skill's evolution
- **Response**:

```json
{
  "success": true,
  "versions": [
    {
      "version": 3,
      "sesDelta": 0.15,
      "changes": "Improved error handling patterns",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Skill Lineage

**GET** `/skill/:skillId/lineage`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get the full evolutionary lineage of a skill — every ancestor, mutation, and stats
- **Response**:

```json
{
  "success": true,
  "lineage": [
    {
      "version": 1,
      "parentGoalId": "goal-id",
      "sesDelta": 0.0,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "stats": {
    "totalEvolutions": 5,
    "avgSesDelta": 0.18,
    "bestVersion": 4
  }
}
```

### Get Aggregate Stats

**GET** `/stats`

- **Authentication**: Required
- **Description**: Get aggregate SkillForge statistics for the user
- **Response**:

```json
{
  "success": true,
  "stats": {
    "totalSkills": 12,
    "totalEvolutions": 45,
    "totalEvaluations": 120,
    "avgSesDelta": 0.15,
    "topSkill": "Code Reviewer"
  }
}
```

### Get SkillForge Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Get SkillForge configuration settings
- **Response**:

```json
{
  "success": true,
  "settings": {
    "autoAnalyze": false,
    "evaluationThreshold": 0.7,
    "maxVersions": 50
  }
}
```

### Update SkillForge Settings

**POST** `/settings`

- **Authentication**: Required
- **Body**:

```json
{
  "autoAnalyze": true,
  "evaluationThreshold": 0.8,
  "maxVersions": 100
}
```

- **Response**:

```json
{
  "success": true,
  "settings": {
    "autoAnalyze": true,
    "evaluationThreshold": 0.8,
    "maxVersions": 100
  }
}
```

---

## Speech Routes

Base path: `/api/speech`

### Transcribe Audio

**POST** `/transcribe`

- **Authentication**: None
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `audio` (file): Audio file to transcribe (max 10MB)
- **Description**: Transcribe audio file to text using Whisper
- **Response**:

```json
{
  "success": true,
  "transcript": "Transcribed text from audio"
}
```

### Get Speech Service Status

**GET** `/status`

- **Authentication**: None
- **Description**: Get Whisper service status
- **Response**:

```json
{
  "success": true,
  "status": "ready|loading|error",
  "model": "whisper-1",
  "initialized": true
}
```

### Initialize Speech Service

**POST** `/initialize`

- **Authentication**: None
- **Description**: Initialize Whisper service (download model if needed)
- **Response**:

```json
{
  "success": true,
  "message": "Whisper service initialized successfully"
}
```

---

## Stream Routes

Base path: `/api/streams`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the stream service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Start Tool Forge Stream

**POST** `/start-tool-forge-stream`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `prompt` (string): Tool generation prompt
  - `files` (file[]): Optional file attachments
- **Response**: Server-sent events stream

### Cancel Tool Forge Stream

**POST** `/cancel-tool-forge-stream`

- **Authentication**: Required
- **Body**:

```json
{
  "streamId": "stream-id"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Stream cancelled"
}
```

### Start Chat Stream

**POST** `/start-chat-stream`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Response**: Server-sent events stream

### Cancel Chat Stream

**POST** `/cancel-chat-stream`

- **Authentication**: Required
- **Body**:

```json
{
  "streamId": "stream-id"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Stream cancelled"
}
```

### Generate Tool

**POST** `/generate-tool`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Tool description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "name": "Generated Tool",
    "description": "Tool description",
    "config": {}
  }
}
```

### Generate Workflow

**POST** `/generate-workflow`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Workflow description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "name": "Generated Workflow",
    "description": "Workflow description",
    "nodes": [],
    "edges": []
  }
}
```

### Generate Agent

**POST** `/generate-agent`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Agent description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "name": "Generated Agent",
    "description": "Agent description",
    "config": {}
  }
}
```

---

## Tool Schema Routes

Base path: `/api/tool-schemas`

### Get All Tool Schemas

**GET** `/schemas`

- **Authentication**: None
- **Description**: Get all tool schemas organized by category
- **Response**:

```json
{
  "triggers": [
    {
      "type": "trigger-type",
      "title": "Trigger Title",
      "description": "Trigger description",
      "schema": {}
    }
  ],
  "actions": [
    {
      "type": "action-type",
      "title": "Action Title",
      "description": "Action description",
      "schema": {}
    }
  ],
  "utilities": [
    {
      "type": "utility-type",
      "title": "Utility Title",
      "description": "Utility description",
      "schema": {}
    }
  ]
}
```

### Get Tool Schema by Type

**GET** `/schemas/:toolType`

- **Authentication**: None
- **Parameters**:
  - `toolType` (path): Tool type
- **Description**: Get schema for a specific tool
- **Response**:

```json
{
  "type": "tool-type",
  "title": "Tool Title",
  "description": "Tool description",
  "schema": {
    "properties": {},
    "required": []
  }
}
```

### Get Schemas by Category

**GET** `/schemas/category/:category`

- **Authentication**: None
- **Parameters**:
  - `category` (path): Category name (triggers, actions, utilities, etc.)
- **Description**: Get schemas by category
- **Response**:

```json
[
  {
    "type": "tool-type",
    "title": "Tool Title",
    "description": "Tool description",
    "schema": {}
  }
]
```

### Get Registry Statistics

**GET** `/stats`

- **Authentication**: None
- **Description**: Get registry statistics
- **Response**:

```json
{
  "totalTools": 50,
  "categories": {
    "triggers": 10,
    "actions": 25,
    "utilities": 15
  },
  "lastUpdated": "2024-01-01T00:00:00Z"
}
```

### Get Tool Metadata

**GET** `/metadata/:toolType`

- **Authentication**: None
- **Parameters**:
  - `toolType` (path): Tool type
- **Description**: Get metadata for a specific tool (includes source info)
- **Response**:

```json
{
  "type": "tool-type",
  "source": "builtin|plugin|custom",
  "plugin": "plugin-name",
  "version": "1.0.0",
  "author": "Author Name",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Reload Registry

**POST** `/reload`

- **Authentication**: None
- **Description**: Reload the registry (useful for development)
- **Response**:

```json
{
  "success": true,
  "message": "Tool registry reloaded successfully",
  "stats": {
    "totalTools": 50,
    "categories": {
      "triggers": 10,
      "actions": 25,
      "utilities": 15
    }
  }
}
```

---

## Tools Routes

Base path: `/api/tools`

### Get Orchestrator Tools

**GET** `/orchestrator-tools`

- **Authentication**: None
- **Description**: Get all orchestrator tools (native, registry, and plugin tools)
- **Response**:

```json
{
  "tools": [
    {
      "id": "tool-name",
      "name": "Tool Name",
      "title": "Tool Title",
      "description": "Tool description",
      "category": "Data & Knowledge",
      "is_builtin": true,
      "is_plugin": false,
      "plugin_name": null
    }
  ]
}
```

### Get Workflow Tools

**GET** `/workflow-tools`

- **Authentication**: Required
- **Description**: Get all tools for the workflow designer including plugins and custom tools
- **Response**:

```json
{
  "triggers": [
    {
      "type": "trigger-type",
      "title": "Trigger Title",
      "description": "Trigger description",
      "icon": "trigger-icon",
      "isPlugin": false
    }
  ],
  "actions": [
    {
      "type": "action-type",
      "title": "Action Title",
      "description": "Action description",
      "icon": "action-icon",
      "isPlugin": false
    }
  ],
  "utilities": [
    {
      "type": "utility-type",
      "title": "Utility Title",
      "description": "Utility description",
      "icon": "utility-icon",
      "isPlugin": false
    }
  ],
  "widgets": [],
  "controls": [],
  "custom": [
    {
      "id": "custom-tool-id",
      "name": "Custom Tool",
      "description": "Custom tool description"
    }
  ]
}
```

### Get Plugin Tools Only

**GET** `/plugins-only`

- **Authentication**: None
- **Description**: Get only plugin tools (for real-time updates)
- **Response**:

```json
{
  "success": true,
  "plugins": {
    "triggers": [
      {
        "type": "plugin-trigger",
        "title": "Plugin Trigger",
        "description": "Description",
        "icon": "puzzle-piece",
        "isPlugin": true,
        "pluginName": "plugin-name"
      }
    ],
    "actions": [],
    "utilities": [],
    "widgets": [],
    "controls": [],
    "custom": []
  },
  "totalCount": 1
}
```

### Execute Tool

**POST** `/:toolName/execute`

- **Authentication**: Required
- **Parameters**:
  - `toolName` (path): Tool identifier — accepts kebab-case (`chucknorris-get-joke`) or snake_case (`chucknorris_get_joke`). Resolves across native orchestrator tools, agent/workflow/goal/code/widget/tool-forge tools, registry tools, and installed plugin tools.
- **Body**:

```json
{
  "args": { "category": "dev" }
}
```

- **Description**: Universal tool execution endpoint. Invokes any registered tool by name with the supplied arguments and returns the parsed result. Argument validation, OAuth resolution for tools that require it, and registry/plugin dispatch are all handled internally — this is the same pipeline the chat orchestrator uses to call tools.
- **Response (success)**:

```json
{
  "success": true,
  "tool": "chucknorris-get-joke",
  "result": {
    "joke": "Chuck Norris doesn't write code...",
    "id": "abc123",
    "categories": ["dev"],
    "url": "https://api.chucknorris.io/jokes/abc123"
  }
}
```

- **Response (tool reported failure)**:

```json
{
  "success": false,
  "tool": "chucknorris-get-joke",
  "error": "Validation failed: 'category' must be one of [...]",
  "details": { "...": "full payload returned by the tool" }
}
```

- **Response 401**: `{ "success": false, "error": "Authentication required" }`

---

## User Routes

Base path: `/api/users`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the user service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get User Stats

**GET** `/user-stats`

- **Authentication**: Required
- **Description**: Get user statistics
- **Response**:

```json
{
  "agents": 5,
  "workflows": 10,
  "tools": 3,
  "goals": 2,
  "executions": 100,
  "storageUsed": "1.2GB"
}
```

### Get User Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Get user settings
- **Response**:

```json
{
  "theme": "dark",
  "language": "en",
  "notifications": {
    "email": true,
    "push": false
  },
  "preferences": {}
}
```

### Update User Settings

**PUT** `/settings`

- **Authentication**: Required
- **Body**:

```json
{
  "theme": "light",
  "language": "es",
  "notifications": {
    "email": false,
    "push": true
  }
}
```

- **Response**:

```json
{
  "success": true,
  "settings": {
    "theme": "light",
    "language": "es",
    "notifications": {
      "email": false,
      "push": true
    }
  }
}
```

### Sync Token

**POST** `/sync-token`

- **Authentication**: Required
- **Description**: Sync user token across services
- **Response**:

```json
{
  "success": true,
  "message": "Token synced successfully"
}
```

### Get Token Status

**GET** `/token-status`

- **Authentication**: None
- **Description**: Get current token status
- **Response**:

```json
{
  "valid": true,
  "expiresIn": 3600,
  "refreshRequired": false
}
```

### Get Connection Health

**GET** `/connection-health`

- **Authentication**: Required
- **Description**: Get health status of all provider connections
- **Response**:

```json
{
  "success": true,
  "data": {
    "overall": "healthy|degraded",
    "healthyConnections": 51,
    "totalConnections": 52,
    "timestamp": "2026-01-01T15:42:40.838Z",
    "providers": [
      {
        "provider": "openai",
        "status": "healthy",
        "lastChecked": "2026-01-01T15:42:39.786Z",
        "details": {}
      },
      {
        "provider": "anthropic",
        "status": "healthy",
        "lastChecked": "2026-01-01T15:42:37.303Z",
        "details": {}
      },
      {
        "provider": "twitter",
        "status": "error",
        "lastChecked": "2026-01-01T15:42:40.643Z",
        "error": "Failed to retrieve access token from remote auth service."
      }
    ]
  }
}
```

**Important**:

- The response wraps data in a `data` object, not at the root level.
- Provider status values are `"healthy"` or `"error"` (not `"connected"`).
- Each provider object has a `provider` field (lowercase provider name), not `name` or `id`.
- Failed providers include an `error` field instead of `details`.

### Get Single Provider Health

**GET** `/connection-health/:providerId`

- **Authentication**: Required
- **Parameters**:
  - `providerId` (path): Provider ID
- **Description**: Get health status of a specific provider
- **Response**:

```json
{
  "id": "openai",
  "name": "OpenAI",
  "status": "connected",
  "lastCheck": "2024-01-01T00:00:00Z",
  "latency": 150,
  "details": {}
}
```

### Get Connection Health Stream

**GET** `/connection-health-stream`

- **Authentication**: Required (via token query parameter)
- **Parameters**:
  - `token` (query): JWT token
- **Description**: Get real-time connection health updates via SSE
- **Response**: Server-sent events stream

---

## Wallet Routes

Base path: `/api/wallets`

Linear-type capability budgets (PRD-091 Layer 3). Each user has a **root wallet**; sub-wallets are derived via `WalletService.allocate` and can never duplicate funds because every debit and transfer goes through an atomic guard with a `balance >= amount` check.

Conservation invariant: across allocate / consume / release cycles, the sum of all active balances is exactly `(root topup total) - (total consumed)`. The agent can rely on this — see `WalletService.spec.js` invariant tests.

### Wallet shape

```json
{
  "id": "uuid",
  "user_id": "user-uuid",
  "owner_type": "user|agent|workflow|tool|run",
  "owner_id": "owner-uuid",
  "parent_id": "uuid|null",
  "kind": "tokens",
  "balance": 850,
  "status": "active|closed",
  "created_at": "...",
  "updated_at": "..."
}
```

### List Wallets

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `ownerType` (query, optional): filter by owner type
  - `status` (query, optional): `active`, `closed`
- **Response**:

```json
{ "success": true, "wallets": [ { ... } ] }
```

### Get-or-Create Root Wallet

**GET** `/root`

- **Authentication**: Required
- **Description**: Returns the user's root wallet (`owner_type:'user'`, `parent_id:null`). Creates it on first call with `balance:0`.
- **Response**:

```json
{ "success": true, "wallet": { ... } }
```

### Top Up Root Wallet

**POST** `/root/topup`

- **Authentication**: Required
- **Body**:

```json
{ "amount": 1000, "note": "monthly_recharge" }
```

- **Description**: Adds `amount` to the user's root wallet balance and writes a `topup` ledger entry. Idempotent on the API surface — repeated calls add repeatedly, so the agent should confirm with the user before topping up.
- **Response**:

```json
{ "success": true, "wallet": { ... } }
```

- **Errors**: `400` on invalid amount.

### Get Single Wallet

**GET** `/:id`

- **Authentication**: Required
- **Response**:

```json
{ "success": true, "wallet": { ... } }
```

- **Errors**: `404` not found, `403` forbidden

### Get Wallet Ledger

**GET** `/:id/ledger`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): max `1000`, default `200`
- **Description**: Returns the transaction log for this wallet. Each entry has `amount` (negative for debit), `op` (`topup` / `consume` / `allocate_in` / `allocate_out` / `release_sweep` / `release_recv`), optional `source_kind` / `source_id` linking to the asset that spent (e.g. tool, agent run).
- **Response**:

```json
{
  "success": true,
  "ledger": [
    {
      "id": "led-uuid",
      "wallet_id": "wal-uuid",
      "amount": -30,
      "op": "consume",
      "source_kind": "tool",
      "source_id": "web-search",
      "note": null,
      "created_at": "..."
    }
  ]
}
```

### Release Wallet

**POST** `/:id/release`

- **Authentication**: Required
- **Description**: Sweeps the wallet's remaining balance back to its parent (if any), then marks the wallet `closed`. Safe to call multiple times — a second call on an already-closed wallet is a no-op.
- **Response**:

```json
{ "success": true, "wallet": { ... } }
```

- **Use case**: An agent run finishes; release its sub-wallet so the leftover budget flows back to root.

### Notes on consume / allocate

There is currently **no public HTTP endpoint** for `consume` or `allocate`. Those operations live on the server-side `WalletService` and are invoked by tool executors, the orchestrator, and the scheduler. The HTTP surface is intentionally limited to read + root-topup + release — i.e. the operations a UI or agent on behalf of a user needs. Agent code that needs to debit an arbitrary wallet should call `WalletService.consume(walletId, amount)` directly, not over HTTP.

---

## Webhook Routes

Base path: `/api/webhooks`

### Get All Webhooks

**GET** `/`

- **Authentication**: Required
- **Description**: Get all webhooks for the authenticated user
- **Response**:

```json
{
  "success": true,
  "webhooks": [
    {
      "id": "webhook-id",
      "workflowId": "workflow-id",
      "url": "https://example.com/webhook",
      "secret": "webhook-secret",
      "events": ["trigger"],
      "active": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Webhook by Workflow ID

**GET** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Get webhook associated with a specific workflow
- **Response**:

```json
{
  "success": true,
  "webhook": {
    "id": "webhook-id",
    "workflowId": "workflow-id",
    "url": "https://example.com/webhook",
    "secret": "webhook-secret",
    "events": ["trigger"],
    "active": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Webhook by Workflow ID

**DELETE** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Delete webhook associated with a specific workflow
- **Response**:

```json
{
  "success": true,
  "message": "Webhook deleted successfully"
}
```

---

## Widget Definition Routes

Base path: `/api/widget-definitions`

Manage custom widget definitions for the dashboard. Widgets are user-created HTML/JS components that can be placed on layout pages.

### Get All Widget Definitions

**GET** `/`

- **Authentication**: Required
- **Description**: Get all widget definitions for the user (including shared ones)
- **Response**:

```json
{
  "widgets": [
    {
      "id": "cw_abc123def456",
      "user_id": "user-id",
      "name": "System Monitor",
      "description": "Displays system metrics",
      "icon": "fas fa-chart-line",
      "category": "monitoring",
      "widget_type": "html",
      "source_code": "<div>...</div>",
      "config": {},
      "data_bindings": [],
      "default_size": { "cols": 4, "rows": 3 },
      "min_size": { "cols": 2, "rows": 2 },
      "useThemeStyles": true,
      "is_shared": 0,
      "is_published": 0,
      "version": "1.0.0",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Widget Definition by ID

**GET** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Response**:

```json
{
  "widget": { ... }
}
```

- **Error** (404): Widget definition not found

### Create Widget Definition

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "My Widget",
  "description": "A custom widget",
  "icon": "fas fa-puzzle-piece",
  "category": "custom",
  "widget_type": "html",
  "source_code": "<div>Hello World</div>",
  "config": {},
  "data_bindings": [],
  "default_size": { "cols": 4, "rows": 3 },
  "min_size": { "cols": 2, "rows": 2 },
  "useThemeStyles": true
}
```

- **Response** (201):

```json
{
  "message": "Widget definition created",
  "id": "cw_abc123def456",
  "widget": { ... }
}
```

### Update Widget Definition

**PUT** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Description**: Partial update — only provided fields are changed
- **Body**:

```json
{
  "name": "Updated Name",
  "source_code": "<div>Updated</div>",
  "is_shared": true,
  "useThemeStyles": false
}
```

- **Response**:

```json
{
  "message": "Widget definition updated",
  "id": "cw_abc123def456"
}
```

### Delete Widget Definition

**DELETE** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Response**:

```json
{
  "message": "Widget definition deleted",
  "id": "cw_abc123def456"
}
```

### Duplicate Widget Definition

**POST** `/:widgetId/duplicate`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID to duplicate
- **Description**: Create a copy of an existing widget definition with " (copy)" appended to the name
- **Response** (201):

```json
{
  "message": "Widget duplicated",
  "id": "cw_newid123456"
}
```

### Export Widget Definition

**GET** `/:widgetId/export`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Description**: Export a widget definition as a portable JSON object
- **Response**:

```json
{
  "export": {
    "_format": "agnt-widget",
    "_version": "1.0.0",
    "name": "My Widget",
    "description": "A custom widget",
    "icon": "fas fa-puzzle-piece",
    "category": "custom",
    "widget_type": "html",
    "source_code": "<div>Hello World</div>",
    "config": {},
    "data_bindings": [],
    "default_size": { "cols": 4, "rows": 3 },
    "min_size": { "cols": 2, "rows": 2 },
    "exported_at": "2024-01-01T00:00:00Z"
  }
}
```

### Import Widget Definition

**POST** `/import`

- **Authentication**: Required
- **Description**: Import a widget definition from an exported JSON object
- **Body**:

```json
{
  "widget_data": {
    "_format": "agnt-widget",
    "_version": "1.0.0",
    "name": "Imported Widget",
    "source_code": "<div>Imported</div>",
    ...
  }
}
```

- **Response** (201): Same as Create Widget Definition

### Capture Widget Thumbnail

**POST** `/capture-thumbnail`

- **Authentication**: Required
- **Description**: Render an HTML widget in a headless Puppeteer browser and return a JPEG screenshot as a base64 data URL. The renderer reuses a persistent browser instance (auto-closed after 60s idle) and auto-dismisses any `alert`/`confirm`/`prompt` dialogs so popup-heavy widgets don't block.
- **Body**:

```json
{
  "html": "<!DOCTYPE html><html>...</html>",
  "storageData": { "token": "<jwt>", "...": "any other localStorage keys to inject before render" }
}
```

  - `html` (required): Full HTML document for the widget.
  - `storageData` (optional): Object whose keys/values get written into the headless page's `localStorage` before the widget loads. Pass the user's token here if the widget makes authenticated fetches during render.

- **Response**:

```json
{
  "thumbnail": "data:image/jpeg;base64,..."
}
```

- **Notes**: Used by the widget editor and by the orchestrator's chat-driven widget flow (`generate_widget` / `edit_widget_code`). Capture is fire-and-forget from the frontend — the resulting `thumbnail` data URL is then PUT back to `/api/widget-definitions/:widgetId` to persist.

---

## Workflow Routes

Base path: `/api/workflows`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Handler**: `WorkflowService.healthCheck`
- **Description**: Check if the workflow service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Workflows

**GET** `/`

- **Authentication**: Required
- **Handler**: `WorkflowService.getAllWorkflows`
- **Description**: Retrieve all workflows for the authenticated user
- **Response**:

```json
[
  {
    "id": "workflow-id",
    "name": "Workflow Name",
    "description": "Workflow description",
    "status": "active|inactive",
    "nodes": [],
    "edges": [],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Get All Workflows Summary

**GET** `/summary`

- **Authentication**: Required
- **Handler**: `WorkflowService.getAllWorkflowsSummary`
- **Description**: Retrieve a lightweight summary of all workflows for the authenticated user (no full workflow_data). This is registered **before** any `/:id` routes in Express to avoid path conflicts.
- **Response**:

```json
[
  {
    "id": "workflow-id",
    "name": "Workflow Name",
    "status": "active",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

### Save Workflow

**POST** `/save`

- **Authentication**: Required
- **Handler**: `WorkflowService.saveWorkflow`
- **Body**:

```json
{
  "name": "Workflow Name",
  "description": "Workflow description",
  "nodes": [],
  "edges": [],
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "Workflow Name",
    "description": "Workflow description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Analyze Dependencies

**POST** `/analyze-dependencies`

- **Authentication**: Required
- **Handler**: `WorkflowService.analyzeDependencies`
- **Description**: Analyze node dependencies within a workflow. This is registered **before** any `/:id` routes in Express to avoid path conflicts.
- **Body**: Workflow data with nodes and edges
- **Response**: Dependency analysis result

### Get Workflow by ID

**GET** `/:id`

- **Authentication**: Required
- **Handler**: `WorkflowService.getWorkflowById`
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Retrieve a specific workflow by ID
- **Response**:

```json
{
  "id": "workflow-id",
  "name": "Workflow Name",
  "description": "Workflow description",
  "status": "active|inactive",
  "nodes": [],
  "edges": [],
  "config": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Workflow

**PUT** `/:id`

- **Authentication**: Required
- **Handler**: `WorkflowService.updateWorkflow`
- **Parameters**:
  - `id` (path): Workflow ID
- **Body**:

```json
{
  "name": "Updated Workflow Name",
  "description": "Updated description",
  "nodes": [],
  "edges": [],
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "Updated Workflow Name",
    "description": "Updated description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Workflow

**DELETE** `/:id`

- **Authentication**: Required
- **Handler**: `WorkflowService.deleteWorkflow`
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Delete a workflow by ID
- **Response**:

```json
{
  "success": true,
  "message": "Workflow deleted successfully"
}
```

### Rename Workflow

**PUT** `/:id/name`

- **Authentication**: Required
- **Handler**: `WorkflowService.renameWorkflow`
- **Parameters**:
  - `id` (path): Workflow ID
- **Body**:

```json
{
  "name": "New Workflow Name"
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "New Workflow Name",
    "description": "Workflow description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Workflow Status

**GET** `/:id/status`

- **Authentication**: Required
- **Handler**: `WorkflowService.fetchWorkflowState`
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Fetch the current state of a workflow
- **Response**:

```json
{
  "workflowId": "workflow-id",
  "status": "active|inactive|error",
  "lastExecution": "2024-01-01T00:00:00Z",
  "executionCount": 10,
  "errorCount": 0,
  "state": {}
}
```

> **Note**: The status values are `active`, `inactive`, or `error`. There is no `completed`, `failed`, or `progress` field. This endpoint returns the workflow's activation state, not an execution progress tracker.

### Activate Workflow (Start)

**POST** `/:id/start`

- **Authentication**: Required
- **Handler**: `WorkflowService.activateWorkflow`
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Activate a workflow so it begins listening for triggers (e.g., timer, webhook). This does **not** accept runtime `inputs` — it toggles the workflow's active state.
- **Response**:

```json
{
  "success": true,
  "message": "Workflow activated successfully",
  "workflowId": "workflow-id"
}
```

### Deactivate Workflow (Stop)

**POST** `/:id/stop`

- **Authentication**: Required
- **Handler**: `WorkflowService.deactivateWorkflow`
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Deactivate a workflow so it stops listening for triggers. This does **not** cancel a currently-running execution — it toggles the workflow's active state to inactive.
- **Response**:

```json
{
  "success": true,
  "message": "Workflow deactivated successfully",
  "workflowId": "workflow-id"
}
```

---

### Workflow Version Control Routes

> These endpoints manage workflow version history, checkpoints, and comparisons.
>
> **⚠️ Known Route-Ordering Issue**: In the current `WorkflowRoutes.js`, the `/:workflowId/versions/:versionId` route is registered **before** `/:workflowId/versions/compare` and `/:workflowId/versions/stats`. Because Express matches top-down, requests to `/compare` or `/stats` may be caught by the `:versionId` parameter (with `versionId = "compare"` or `"stats"`). This should be fixed by moving `compare` and `stats` above the `:versionId` route, or by adding a regex constraint to `:versionId`.

### List Workflow Versions

**GET** `/:workflowId/versions`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.getVersionHistory`
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `limit` (query, optional): Max versions to return (default: 50)
  - `offset` (query, optional): Pagination offset (default: 0)
  - `checkpointsOnly` (query, optional): If `"true"`, only return checkpoint versions
- **Description**: List the version history for a workflow
- **Response**:

```json
{
  "success": true,
  "versions": [
    {
      "version_number": 5,
      "source": "chat",
      "change_description": "Added new API node",
      "is_checkpoint": false,
      "checkpoint_name": null,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Specific Version

**GET** `/:workflowId/versions/:versionId`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.getVersion`
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `versionId` (path): Version number (integer)
- **Description**: Get the full data for a specific workflow version
- **Response**:

```json
{
  "success": true,
  "version": {
    "version_number": 3,
    "workflow_state": { "...": "..." },
    "source": "manual",
    "change_description": "Checkpoint before refactor",
    "is_checkpoint": true,
    "checkpoint_name": "Pre-refactor",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

- **Error** (404): Version not found

### Revert to Version

**POST** `/:workflowId/revert`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.revertToVersion`
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Revert a workflow to a previous version. Broadcasts `workflow:reverted` via WebSocket.
- **Body**:

```json
{
  "versionId": 3
}
```

- **Validation**: `versionId` is required (returns 400 if missing)
- **Response**:

```json
{
  "success": true,
  "revertedToVersion": 3,
  "workflowState": { "...": "..." }
}
```

### Create Checkpoint

**POST** `/:workflowId/checkpoint`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.createCheckpoint`
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Save a named checkpoint of the current workflow state
- **Body**:

```json
{
  "name": "Before big changes",
  "currentWorkflowState": { "...": "..." }
}
```

- **Validation**: Both `name` and `currentWorkflowState` are required (returns 400 if either is missing)
- **Response**:

```json
{
  "success": true,
  "versionNumber": 6,
  "checkpointName": "Before big changes"
}
```

### Compare Versions

**GET** `/:workflowId/versions/compare?versionA=1&versionB=3`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.compareVersions`
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `versionA` (query, required): First version number
  - `versionB` (query, required): Second version number
- **Description**: Get a diff between two workflow versions
- **Validation**: Both `versionA` and `versionB` are required (returns 400 if either is missing)
- **⚠️ Note**: This route may be shadowed by `/:workflowId/versions/:versionId` — see route-ordering issue above.
- **Response**:

```json
{
  "success": true,
  "diff": {
    "nodesAdded": [],
    "nodesRemoved": [],
    "nodesModified": [],
    "edgesAdded": [],
    "edgesRemoved": []
  }
}
```

### Version Storage Stats

**GET** `/:workflowId/versions/stats`

- **Authentication**: Required
- **Handler**: `WorkflowVersionService.getStorageStats`
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Get storage statistics for a workflow's version history
- **⚠️ Note**: This route may be shadowed by `/:workflowId/versions/:versionId` — see route-ordering issue above.
- **Response**:

```json
{
  "success": true,
  "stats": {
    "totalVersions": 12,
    "checkpoints": 3,
    "totalSizeBytes": 45678,
    "oldestVersion": "2024-01-01T00:00:00Z",
    "newestVersion": "2024-03-01T00:00:00Z"
  }
}
```

---

## Group Routes

Base path: `/api/groups`

Groups organize content outputs (artifacts, generated assets) into a hierarchical tree. They support nesting via `parent_id`, custom sort order, and color-coding. All mutations broadcast realtime events (`GROUP_CREATED`, `GROUP_UPDATED`, `GROUP_DELETED`, `CONTENT_UPDATED`) to connected clients of the same user.

### List Groups

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all groups belonging to the authenticated user
- **Response**:

```json
{
  "groups": [
    {
      "id": "group-id",
      "user_id": "user-id",
      "name": "Group Name",
      "description": "Optional description",
      "color": "#6366f1",
      "sort_order": 0,
      "parent_id": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Group

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "Group Name",
  "description": "Optional description",
  "color": "#6366f1",
  "sort_order": 0,
  "parent_id": "optional-parent-group-id"
}
```

- **Description**: Create a new group. `name` is required; all other fields are optional. `color` defaults to `#6366f1`, `sort_order` to `0`, `parent_id` to `null` (top-level).
- **Response**: `201 Created` with the full group object

### Update Group

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Group ID
- **Body**: Any subset of `name`, `description`, `color`, `sort_order`, `parent_id`
- **Description**: Update fields on a group
- **Response**: Updated group object, or `404` if not found

### Delete Group

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Group ID
- **Query Parameters**:
  - `mode` (string, optional): `move` (default) reparents direct children to this group's parent (or root); `delete` lets the `ON DELETE CASCADE` remove child groups along with this one.
- **Description**: Delete a group. Use `mode=move` to preserve children, `mode=delete` to remove the entire subtree.
- **Response**:

```json
{
  "message": "Group deleted"
}
```

### Reorder Groups

**PATCH** `/reorder`

- **Authentication**: Required
- **Body**:

```json
{
  "orders": [
    { "id": "group-id-1", "sort_order": 0 },
    { "id": "group-id-2", "sort_order": 1 }
  ]
}
```

- **Description**: Update `sort_order` for multiple groups in a single call
- **Response**:

```json
{ "success": true }
```

### Move Content Output to Group

**PATCH** `/move/:outputId`

- **Authentication**: Required
- **Parameters**:
  - `outputId` (path): Content output ID
- **Body**:

```json
{
  "group_id": "target-group-id-or-null"
}
```

- **Description**: Move a single content output into a group. Pass `group_id: null` to ungroup (move to root).
- **Response**:

```json
{ "success": true }
```

### Bulk Move Content Outputs

**PATCH** `/bulk-move`

- **Authentication**: Required
- **Body**:

```json
{
  "output_ids": ["output-id-1", "output-id-2"],
  "group_id": "target-group-id-or-null"
}
```

- **Description**: Move multiple content outputs into a group in a single call
- **Response**:

```json
{ "success": true }
```

---

## Skill Discovery Routes

Base path: `/api/skills/discovered`

Skill Discovery scans the filesystem for skill definitions (e.g., a user's `~/.claude/skills/` directory or a project-local skills folder) and exposes them as a read-only catalog. Discovered skills are separate from database-backed skills until imported. Use these endpoints to browse filesystem skills and promote them into the user's skill library.

### List Discovered Skills

**GET** `/`

- **Authentication**: Required
- **Description**: Get the catalog of all filesystem-discovered skills (metadata only — no full content)
- **Response**:

```json
{
  "skills": [
    {
      "name": "skill-name",
      "description": "Skill description",
      "dirPath": "/path/to/skill/dir",
      "source": "user|project",
      "frontmatter": {}
    }
  ],
  "lastScan": "2024-01-01T00:00:00Z",
  "scanLocations": ["/path/to/scan/location"],
  "total": 42
}
```

### Rescan Skill Locations

**POST** `/rescan`

- **Authentication**: Required
- **Body** (optional):

```json
{
  "projectRoot": "/optional/project/root/path"
}
```

- **Description**: Trigger a fresh scan of the filesystem skill locations. If `projectRoot` is provided, also scan that project for local skills.
- **Response**:

```json
{
  "skills": [],
  "lastScan": "2024-01-01T00:00:00Z",
  "total": 42
}
```

### Get Discovered Skill

**GET** `/:name`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Skill name (kebab-case, matches directory name)
- **Description**: Get the full content (metadata + instructions + frontmatter) of a discovered skill
- **Response**:

```json
{
  "skill": {
    "name": "skill-name",
    "description": "Skill description",
    "instructions": "Full skill instructions markdown...",
    "frontmatter": {
      "license": "MIT",
      "compatibility": "...",
      "metadata": {},
      "allowed-tools": []
    },
    "dirPath": "/path/to/skill/dir"
  }
}
```

### List Skill Resources

**GET** `/:name/resources`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Skill name
- **Description**: List bundled resource files (non-instruction files) shipped with a skill, e.g. templates, scripts, example data
- **Response**:

```json
{
  "resources": [
    { "path": "templates/prompt.md", "size": 1234, "type": "file" }
  ]
}
```

### Read Skill Resource

**GET** `/:name/resources/*`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Skill name
  - `*` (wildcard path): Relative path to the resource file within the skill directory
- **Description**: Read the raw content of a bundled resource file. Paths are validated to prevent escaping the skill directory.
- **Response**: `text/plain; charset=utf-8` with the file contents
- **Errors**:
  - `400` if the resource path is missing
  - `403` if the path escapes the skill directory
  - `404` if the resource is not found

### Import Discovered Skill

**POST** `/:name/import`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Skill name (kebab-case)
- **Description**: Import a filesystem-discovered skill into the user's database-backed skill library. The kebab-case name is converted to Title Case for display; the original slug is preserved for lookups. Frontmatter fields (license, compatibility, metadata, allowed-tools) are copied into the skill record.
- **Response**: `201 Created`

```json
{
  "skill": {
    "id": "new-skill-id",
    "name": "Skill Name",
    "slug": "skill-name",
    "description": "...",
    "instructions": "..."
  },
  "skillId": "new-skill-id",
  "importedFrom": "/path/to/source/skill/dir"
}
```

---

## Artifacts

The **Artifacts** system is the in-app workspace for creating and editing files with an AI assistant named **Annie**. It is not a CRUD resource API — instead, all file operations happen through a single streaming chat endpoint that routes tool calls to filesystem operations against the user's configured workspace root.

### Storage

- **Default workspace root**: `~/.agnt/projects/`
- **Configurable via**: `~/.agnt/code-settings.json` → `workspaceRoot` field
- **Enforced path validation**: All tool calls resolve paths against the workspace root and reject any path traversal outside it.
- **Settings API**: Workspace root can also be read/updated via the [FileSystem Routes](#filesystem-routes) (`GET /api/filesystem/settings`, `PUT /api/filesystem/settings`).

### Chat Endpoint

**POST** `/api/orchestrator/artifact-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): User message to Annie
  - `codeContext` (object, optional): Current editor context (active file path, selection, open files). Used by the system prompt to tailor responses.
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Streaming chat handler that drives the Artifacts workspace. The handler uses the `artifact` chat configuration (`maxToolRounds: 25`, `responseType: stream`) and exposes the four workspace file tools below to the LLM.
- **Response**: Server-sent events stream (tokens, tool-call events, file events)

### Workspace Tools (called by the LLM)

These tools are not called directly over HTTP — they are invoked by the LLM during an `/artifact-chat` turn. They are listed here so integrators understand what Annie can do and what events fire.

#### `read_file`

Read the contents of a file from the workspace.

- **Parameters**:
  - `path` (string): Relative path within the workspace root
- **Returns**: File content as UTF-8 text, or an error message if the file does not exist

#### `write_file`

Create or overwrite a file in the workspace. Automatically creates any missing parent directories.

- **Parameters**:
  - `path` (string): Relative path within the workspace root
  - `content` (string): Full file content
- **Returns**: Success confirmation
- **Side effects**: Emits a `file_written` event to the frontend so the file tree and open editor tabs can refresh

#### `edit_file`

Surgical search-and-replace edits on an existing file. Preferred over `write_file` for modifications because it preserves surrounding content and uses fuzzy whitespace matching to tolerate indentation drift.

- **Parameters**:
  - `path` (string): Relative path within the workspace root
  - `edits` (array): List of `{ search, replace }` pairs applied in order
  - `description` (string, optional): Human-readable summary of the change
- **Returns**: Per-edit applied/failed summary
- **Side effects**: Emits `file_written` on success

#### `list_files`

List the contents of a workspace directory. Hidden entries (starting with `.`) are filtered out.

- **Parameters**:
  - `path` (string, optional): Relative directory path, defaults to workspace root
- **Returns**:

```json
[
  { "name": "README.md", "type": "file", "path": "README.md" },
  { "name": "src", "type": "dir", "path": "src" }
]
```

### Configuration Reference

| Location | Setting | Purpose |
| -------- | ------- | ------- |
| `backend/src/services/orchestrator/chatConfigs.js` | `artifact` entry | Tool schemas, system prompt, `maxToolRounds: 25`, `contextKey: 'codeContext'` |
| `backend/src/services/orchestrator/system-prompts/artifact-chat.js` | System prompt | Annie persona, preview capabilities, design guidance |
| `backend/src/services/orchestrator/codeTools.js` | Tool implementations | `read_file`, `write_file`, `edit_file`, `list_files` with path validation |
| `~/.agnt/code-settings.json` | `workspaceRoot` | Per-user workspace root override |

### Related Endpoints

- **Files outside chat**: Use [FileSystem Routes](#filesystem-routes) (`/api/filesystem/*`) to read, write, rename, and delete workspace files directly over HTTP (e.g., for the editor panel or external tooling).
- **Persisted artifacts**: Generated content that the user saves is stored via [Content Output Routes](#content-output-routes) (`/api/content-outputs`) and can be organized with [Group Routes](#group-routes).

---

## Direct Server Routes

These endpoints are defined directly in `server.js`, not in route files.

### Health Check

**GET** `/api/health`

- **Authentication**: None
- **Description**: Global health check endpoint
- **Response**:

```json
{
  "status": "OK"
}
```

### Get App Version

**GET** `/api/version`

- **Authentication**: None
- **Description**: Get the current application version (reads from package.json)
- **Response**:

```json
{
  "version": "0.5.0"
}
```

### Check for Updates

**GET** `/api/updates/check`

- **Authentication**: None
- **Description**: Check for application updates (proxies to agnt.gg)
- **Response**: Proxied response from update server

---

## WebSocket / Socket.IO

AGNT uses Socket.IO for real-time bidirectional communication.

### Connection

```javascript
const socket = io('http://localhost:3333');
socket.emit('authenticate', { userId: 'user-id' });
```

### Events

| Event               | Direction       | Description                                   |
| ------------------- | --------------- | --------------------------------------------- |
| `authenticate`      | Client → Server | Authenticate the socket connection            |
| `authenticated`     | Server → Client | Confirmation of successful authentication     |
| `disconnect`        | Bidirectional   | Client disconnected                           |
| `workflow:reverted` | Server → Client | Broadcast when a workflow version is reverted |
| `PLUGIN_INSTALLED`  | Server → Client | Broadcast when a plugin is installed          |

Real-time updates are broadcast via the `global.io` object throughout the backend.

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Authentication required or invalid
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

---

## Rate Limiting

Some endpoints may have rate limiting applied. Check the `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers in responses.

---

## Pagination

List endpoints that return multiple items support pagination via query parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `sort`: Sort field
- `order`: Sort order (asc, desc)

Example: `GET /api/agents?page=2&limit=10&sort=createdAt&order=desc`

---

## File Uploads

Endpoints that accept file uploads use `multipart/form-data` content type and typically have the following limits:

- Maximum file size: 20MB (varies by endpoint)
- Supported formats: Varies by endpoint (images, documents, audio, etc.)

---

## Server-Sent Events (SSE)

Streaming endpoints use Server-Sent Events for real-time updates. Connect using EventSource in JavaScript or any SSE client.

Example:

```javascript
const eventSource = new EventSource('/api/orchestrator/chat', {
  headers: {
    Authorization: 'Bearer your-token',
  },
});

eventSource.onmessage = function (event) {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

---

## WebSocket Support

Some endpoints may support WebSocket connections for real-time bidirectional communication. Check endpoint documentation for WebSocket availability.

---

## Remote API (https://api.agnt.gg/)

## Table of Contents (Remote)

- [Remote Authentication](#remote-authentication)
- [Remote Agent Routes](#remote-agent-routes)
- [Remote Auth Routes](#remote-auth-routes)
- [Remote Content Output Routes](#remote-content-output-routes)
- [Remote Custom Tool Routes](#remote-custom-tool-routes)
- [Remote Email Routes](#remote-email-routes)
- [Remote Execution Routes](#remote-execution-routes)
- [Remote Lifetime Promo Routes](#remote-lifetime-promo-routes)
- [Remote Marketplace Routes](#remote-marketplace-routes)
- [Remote Onboarding Routes](#remote-onboarding-routes)
- [Remote Referral Routes](#remote-referral-routes)
- [Remote Stream Routes](#remote-stream-routes)
- [Remote User Routes](#remote-user-routes)
- [Remote Waitlist Routes](#remote-waitlist-routes)
- [Remote Webhook Routes](#remote-webhook-routes)
- [Remote Workflow Routes](#remote-workflow-routes)

---

## Remote Authentication

Remote endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

---

## Remote Agent Routes

Base path: `https://api.agnt.gg/agents` (Internal: `AgentRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the agent service is running

### Get All Agents

**GET** `/`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve all agents for the authenticated user

### Save Agent

**POST** `/save`

- **Authentication**: Required (rate limited)
- **Description**: Create a new agent or update an existing one

### Get Agent by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve a specific agent by ID

### Update Agent

**PUT** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update an existing agent

### Delete Agent

**DELETE** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete an agent by ID

---

## Remote Auth Routes

Base path: `https://api.agnt.gg/auth` (Internal: `AuthRoutes.js`)

### Get All Providers

**GET** `/providers`

- **Authentication**: Required (rate limited)
- **Description**: Get all auth providers

### Create Provider

**POST** `/providers`

- **Authentication**: Required (rate limited)
- **Description**: Create a new auth provider

### Update Provider

**PUT** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update an existing provider

### Delete Provider

**DELETE** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete a provider

### Get Provider by ID

**GET** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Get details of a specific provider

### Store API Key

**POST** `/apikeys/:providerId`

- **Authentication**: Required (rate limited)
- **Description**: Store an API key for a provider

### Retrieve API Key

**GET** `/apikeys/:providerId`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve an API key for a provider

### Connect Provider (OAuth)

**GET** `/connect/:provider`

- **Authentication**: Required (rate limited)
- **Description**: Initiate OAuth connection for a provider

### Disconnect Provider

**POST** `/disconnect/:provider`

- **Authentication**: Required (rate limited)
- **Description**: Disconnect an OAuth provider

### Handle Callback

**POST** `/callback`

- **Authentication**: Required (rate limited)
- **Description**: Handle OAuth callback

### Local Callback

**GET** `/callback/:provider`

- **Authentication**: None
- **Description**: Handle local OAuth callback

### Zapier Callback

**POST** `/callback/zapier`

- **Authentication**: None
- **Description**: Handle Zapier webhook callback

### Get Connected Apps

**GET** `/connected`

- **Authentication**: Required (rate limited)
- **Description**: Get list of connected applications

### Get Valid Token

**GET** `/valid-token`

- **Authentication**: Required (rate limited)
- **Description**: Check if the current token is valid

### Get Google Search Keys

**GET** `/google-search-keys`

- **Authentication**: Required (rate limited)
- **Description**: Get Google search configuration keys

---

## Remote Content Output Routes

Base path: `https://api.agnt.gg/content-outputs` (Internal: `ContentOutputRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check service health

### Get All Content Outputs

**GET** `/`

- **Authentication**: Required (rate limited)
- **Description**: List all content outputs

### Save Content Output

**POST** `/save`

- **Authentication**: Required (rate limited)
- **Description**: Create or update content output

### Get Content Output by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Get specific content output

### Update Content Output

**PUT** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update existing content output

### Delete Content Output

**DELETE** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete content output

### Get by Workflow

**GET** `/workflow/:workflowId`

- **Authentication**: Required (rate limited)
- **Description**: Get outputs for a specific workflow

### Get by Tool

**GET** `/tool/:toolId`

- **Authentication**: Required (rate limited)
- **Description**: Get outputs for a specific tool

---

## Remote Custom Tool Routes

Base path: `https://api.agnt.gg/custom-tools` (Internal: `CustomToolRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Get All

**GET** `/`

- **Authentication**: Required (rate limited)

### Save

**POST** `/save`

- **Authentication**: Required (rate limited)

### Get by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)

### Update

**PUT** `/:id`

- **Authentication**: Required (rate limited)

### Delete

**DELETE** `/:id`

- **Authentication**: Required (rate limited)

---

## Remote Email Routes

Base path: `https://api.agnt.gg/email` (Internal: `EmailRoutes.js`)

### Initialize

**POST** `/initialize`

- **Authentication**: Required (rate limited)

### Cleanup

**POST** `/cleanup`

- **Authentication**: Required (rate limited)

### Poll Emails

**GET** `/poll`

- **Authentication**: Required (rate limited)

### Send Email

**POST** `/send`

- **Authentication**: Required (rate limited)

### Send Feedback

**POST** `/send-feedback`

- **Authentication**: Required (rate limited)

### Send Enterprise Inquiry

**POST** `/send-enterprise-inquiry`

- **Authentication**: Required (rate limited)

### Confirm Processed

**POST** `/confirm-processed`

- **Authentication**: Required (rate limited)

---

## Remote Execution Routes

Base path: `https://api.agnt.gg/executions` (Internal: `ExecutionRoutes.js`)

### Get Executions

**GET** `/`

- **Authentication**: Required (rate limited)

### Get Activity Data

**POST** `/activity`

- **Authentication**: Required (rate limited)

### Get Details

**GET** `/:id`

- **Authentication**: Required (rate limited)

---

## Remote Lifetime Promo Routes

Base path: `https://api.agnt.gg/promo/lifetime` (Internal: `LifetimePromoRoutes.js`)

### Get Status

**GET** `/status`

- **Authentication**: None

### Create Checkout

**POST** `/checkout`

- **Authentication**: Required

### Get My Purchase

**GET** `/my-purchase`

- **Authentication**: Required

---

## Remote Marketplace Routes

Base path: `https://api.agnt.gg/marketplace` (Internal: `MarketplaceRoutes.js`)

### Get All Items

**GET** `/items`

- **Authentication**: None

### Get Featured Items

**GET** `/items/featured`

- **Authentication**: None

### Get Item Details

**GET** `/items/:id`

- **Authentication**: None

### Get Item Reviews

**GET** `/items/:id/reviews`

- **Authentication**: None

### Get Item Versions

**GET** `/items/:id/versions`

- **Authentication**: None

### Install Item

**POST** `/items/:id/install`

- **Authentication**: Required (rate limited)

### Purchase Item

**POST** `/items/:id/purchase`

- **Authentication**: Required (rate limited)

### Update Installed Item

**POST** `/items/:id/update`

- **Authentication**: Required (rate limited)

### Publish

**POST** `/publish`

- **Authentication**: Required (rate limited)

### Update Listing

**PUT** `/items/:id`

- **Authentication**: Required (rate limited)

### Unpublish Listing

**PUT** `/items/:id/unpublish`

- **Authentication**: Required (rate limited)

### Republish Listing

**PUT** `/items/:id/republish`

- **Authentication**: Required (rate limited)

### My Purchases

**GET** `/my-purchases`

- **Authentication**: Required (rate limited)

### My Earnings

**GET** `/my-earnings`

- **Authentication**: Required (rate limited)

### Stripe Connect

**POST** `/stripe/connect`

- **Authentication**: Required (rate limited)

---

## Remote Onboarding Routes

Base path: `https://api.agnt.gg/onboarding` (Internal: `OnboardingRoutes.js`)

### Get Progress

**GET** `/progress`

- **Authentication**: Required (rate limited)

### Complete Onboarding

**POST** `/complete`

- **Authentication**: Required (rate limited)

### Analytics

**GET** `/analytics`

- **Authentication**: Required (rate limited)

### Unsubscribe

**GET/POST** `/unsubscribe`

- **Authentication**: None

---

## Remote Referral Routes

Base path: `https://api.agnt.gg/referrals` (Internal: `ReferralRoutes.js`)

### Get Count

**GET** `/count`

- **Authentication**: None

### Create Referral

**POST** `/create`

- **Authentication**: None

### Get Network Score

**GET** `/network-score/:email`

- **Authentication**: None

### Verify Code

**GET** `/verify/:code`

- **Authentication**: None

### Get Leaderboard

**GET** `/leaderboard`

- **Authentication**: None

### Process Referral

**POST** `/referral`

- **Authentication**: None

### Update Pseudonym

**POST** `/update-pseudonym`

- **Authentication**: Required (JWT header)

### Get Commission Summary

**GET** `/commissions/summary`

- **Authentication**: Required (rate limited)

---

## Remote Stream Routes

Base path: `https://api.agnt.gg/streams` (Internal: `StreamRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Start Tool Forge Stream

**POST** `/start-tool-forge-stream`

- **Authentication**: Required (rate limited, supports file upload)

### Start Chat Stream

**POST** `/start-chat-stream`

- **Authentication**: Required (rate limited, supports file upload)

### Generate Tool

**POST** `/generate-tool`

- **Authentication**: Required (rate limited)

---

## Remote User Routes

Base path: `https://api.agnt.gg/users` (Internal: `UserRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Register

**POST** `/register`

- **Authentication**: None

### Login

**POST** `/login`

- **Authentication**: None

### Get Profile

**GET** `/profile`

- **Authentication**: Required (rate limited)

### Update Profile

**PUT** `/profile`

- **Authentication**: Required (rate limited)

### Subscription Status

**GET** `/subscription/status`

- **Authentication**: Required (No rate limit)

### Create Subscription

**POST** `/subscription/create`

- **Authentication**: Required (No rate limit)

---

## Remote Waitlist Routes

Base path: `https://api.agnt.gg/waitlist` (Internal: `WaitlistRoutes.js`)

### Get Count

**GET** `/count`

- **Authentication**: None

### Join Waitlist

**POST** `/join`

- **Authentication**: None

---

## Remote Webhook Routes

Base path: `https://api.agnt.gg/webhooks` (Internal: `WebhookRoutes.js`)

### Register Webhook

**POST** `/register`

- **Authentication**: None (Internal Service Call, rate limited)

### Poll Webhooks

**GET** `/poll`

- **Authentication**: None (Internal Service Call, rate limited)

### Webhook Handler

**ALL** `/:workflowId`

- **Authentication**: None
- **Description**: Catch-all for incoming webhooks

---

## Remote Workflow Routes

Base path: `https://api.agnt.gg/workflows` (Internal: `WorkflowRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Get All Workflows

**GET** `/`

- **Authentication**: Required (rate limited)

### Save Workflow

**POST** `/save`

- **Authentication**: Required (rate limited)

### Get Workflow by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)

### Start Workflow

**POST** `/:id/start`

- **Authentication**: Required (rate limited)

### Stop Workflow

**POST** `/:id/stop`

- **Authentication**: Required (rate limited)

---

_This documentation covers all API endpoints as of v0.5.0. For the most up-to-date information, please refer to the source code in `backend/src/routes/`._
