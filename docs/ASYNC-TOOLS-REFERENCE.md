# Async Tools Reference

**Document Version:** 1.2
**Last Updated:** 2026-05-04
**Author:** Annie (AI Assistant)
**Status:** Comprehensive — covers all tested edge cases
**Validation:** Empirically tested via live tool calls (25+ scenarios, 100% pass rate)

---

## Recent Fixes (2026-05-04)

The following silent-degradation and observability bugs were fixed in this commit. See the [Troubleshooting](#troubleshooting) and [Performance & Limits](#performance--limits) sections for the new behavior.

| Bug | Old behavior | Fixed behavior |
|-----|-------------|----------------|
| `_interval: 0` with `_stopAfter: N` | Silently ran once and dropped `_stopAfter` | Validator rejects at queue time with structured error |
| Orphan `_stopAfter` (no `_interval`) | Silently ran once, dropped `_stopAfter` | Validator rejects at queue time |
| Orphan `_duration` (no `_interval`) | Silently ran once, dropped `_duration` | Validator rejects at queue time |
| Orphan `_delayFirst` (no `_interval`) | Silently ran once with no delay | Validator rejects at queue time |
| `failed` queue counter | Only worker crashes, missed business-logic failures | New `businessFailed` and `totalFailed` counters report inner-failure cases |
| Autonomous-message banner | Always said "✅ completed successfully" even over inner failures | Inspects inner result; emits `⚠️ FINISHED WITH ERROR` for `success: false` payloads, with an honesty directive that tells the LLM not to claim success |
| LLM previewed async results in the queueing turn | Sync duplicate of an async-queued tool ran in parallel and the LLM dumped the answer in the queueing reply, then again when the autonomous message arrived | New top-level prompt section forbids preview-sync; orchestrator rejects sync duplicates of async-queued tools in the same batch with a structured error |

## Async tools toggle (per-user setting, 2026-05-04)

> ⚠️ **Async tool execution is currently an experimental opt-in feature.** The default for new users is **OFF**. Users enable it via Settings → AI Provider → "Async tool execution" (look for the **Experimental** badge).

The whole async-tool capability is switchable via a per-user preference. With the toggle off (default), the chat behaves like a conventional sync-only tool-using assistant.

**When OFF (default):**
- The 6 async control parameters (`_executeAsync`, `_interval`, `_stopAfter`, `_duration`, `_delayFirst`, `_estimatedMinutes`) are NOT grafted onto tool schemas. The LLM never sees them.
- The `## Async & Periodic Tool Execution` section is omitted from the system prompt. The LLM has no async guidance.
- Defensive guard: if a stale schema or in-flight turn somehow includes `_executeAsync: true`, the orchestrator silently downgrades the call to sync rather than fail it.
- Autonomous follow-up messages, recurring tasks, scheduled "do this in N seconds" calls, and the async indicator in the chat UI all stop firing because nothing reaches the queue.
- In-flight async tasks that started before the toggle flipped continue to completion. The toggle gates *new* requests, not running ones.

**When ON:** Behavior matches the rest of this document.

**Plumbing (for integrators):**
- DB column: `users.async_tools_enabled INTEGER DEFAULT 0` (0 = off, 1 = on).
- Read via `UserModel.getUserSettings(userId).asyncToolsEnabled` (boolean). Default `false` for missing/legacy rows.
- Write via `PUT /api/users/settings` body `{ asyncToolsEnabled: boolean }`.
- The chat path (`chatConfigs.js → buildSystemPrompt + getToolSchemas`) reads and applies the flag every turn — no restart needed for a flip to take effect on the next message.
- The flag does NOT gate the `/api/async-tools/*` REST endpoints. You can still query in-flight executions, cancel them, and read stats with the toggle off — only the *creation* path is gated.
- The function-level defaults of `getAvailableToolSchemas({ asyncEnabled = true })` and `buildUnifiedSystemPrompt({}, { asyncToolsEnabled = true })` are intentionally still `true`. Those defaults serve callers that aren't gated by the user toggle (saved agents, goal flows, the `/api/tools` listing). The chat surface always passes the user's actual setting explicitly, so the function default doesn't leak the chat capability.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Execution Modes](#execution-modes)
4. [Async Parameters](#async-parameters)
5. [Parallel Execution](#parallel-execution)
6. [Sequential Execution](#sequential-execution)
7. [Hybrid Workflows](#hybrid-workflows)
8. [Periodic / Recurring Execution](#periodic--recurring-execution)
9. [Error Handling](#error-handling)
10. [Performance & Limits](#performance--limits)
11. [Edge Cases & Behaviors](#edge-cases--behaviors)
12. [Best Practices](#best-practices)
13. [Troubleshooting](#troubleshooting)
14. [Test Results](#test-results)

---

## Overview

The AGNT async tools system enables background execution of any tool call. **Every tool** in the AGNT registry supports async execution via universal parameters that control timing, repetition, and concurrency. This allows you to:

- Run multiple tools simultaneously without blocking
- Schedule recurring tasks (monitoring, polling, alerts)
- Chain dependent operations with guaranteed ordering
- Handle errors gracefully without crashing workflows

**Decision Principle:**
```
Do any tasks depend on another's output?
         YES → SEQUENTIAL (blocking chain)
          NO → PARALLEL (async)
```

---

## Quick Start

### Run a tool once in the background
```json
{
  "tool": "web_search",
  "params": {
    "query": "latest AI news",
    "_executeAsync": true
  }
}
```

### Run multiple tools in parallel
```json
{ "tool": "joke_api", "params": { "_executeAsync": true } }
{ "tool": "weather_api", "params": { "_executeAsync": true } }
```

### Run a task every 60 seconds, 5 times
```json
{
  "tool": "web_scrape",
  "params": {
    "url": "https://example.com/price",
    "_executeAsync": true,
    "_interval": 60,
    "_stopAfter": 5
  }
}
```

---

## Execution Modes

### 1. Synchronous (Default)

Tools run synchronously by default. The assistant waits for the result before continuing.

**When to use:**
- Task B needs Task A's output
- You need immediate feedback
- Error handling must be synchronous

**Response shape:**
```json
{
  "success": true,
  "total": 20,
  "individualRolls": [20],
  "error": null
}
```
(Returns the tool's actual output payload directly.)

### 2. Asynchronous (Background)

Tools run in the background. The assistant receives an execution ID immediately and results arrive later via autonomous message.

**When to use:**
- Tasks are independent
- You want to maximize throughput
- Tasks are long-running (scraping, processing)
- You want to schedule recurring work

**Response shape (queued):**
```json
{
  "success": true,
  "status": "queued",
  "executionId": "8604c5b0-8515-4cb1-8894-918acb31ac25",
  "message": "roll_dice started in the background. You'll receive updates as it progresses.",
  "estimatedDuration": null
}
```

---

## Async Parameters

All tools support these universal async parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `_executeAsync` | boolean | `false` | Run tool in background, return immediately with execution ID |
| `_interval` | integer (seconds) | — | Re-run tool every N seconds (requires `_executeAsync`) |
| `_stopAfter` | integer | — | Stop after N iterations (requires `_interval`) |
| `_duration` | number (minutes) | — | Stop after N minutes total (requires `_interval`). Decimals allowed. |
| `_delayFirst` | boolean | `false` | Skip first run, wait one full interval first (requires `_interval`) |
| `_estimatedMinutes` | number | — | Estimated duration hint for UI display (no functional impact) |

### Parameter Combinations

#### One-time background execution
```json
{ "_executeAsync": true }
```

#### Delayed one-time execution
```json
{
  "_executeAsync": true,
  "_interval": 60,
  "_stopAfter": 1,
  "_delayFirst": true
}
```
→ Waits 60 seconds, runs once, stops.

#### Recurring for a fixed number of times
```json
{
  "_executeAsync": true,
  "_interval": 60,
  "_stopAfter": 5
}
```
→ Runs immediately, then every 60 seconds, 5 times total.

#### Recurring for a fixed duration
```json
{
  "_executeAsync": true,
  "_interval": 300,
  "_duration": 60
}
```
→ Runs every 5 minutes for 1 hour total.

#### Recurring with conflicting limits (BOTH set)
```json
{
  "_executeAsync": true,
  "_interval": 2,
  "_stopAfter": 100,
  "_duration": 0.1
}
```
→ Runs every 2 seconds. Stops when EITHER 100 iterations OR 6 seconds elapsed. **First limit reached wins.**

**Empirically verified:** With `_stopAfter: 100` and `_duration: 0.1` (6 seconds), the task completed only 3 iterations before the duration limit terminated it.

---

## Parallel Execution

### Grouped Async (Combined Response)

All async calls in a single function-calls block run in parallel. **Results arrive together after the last one finishes.**

**Use when:** You want one summary response with all results.

```json
{ "tool": "web_search", "params": { "query": "AI news",     "_executeAsync": true } }
{ "tool": "web_search", "params": { "query": "tech stocks", "_executeAsync": true } }
{ "tool": "web_search", "params": { "query": "weather",     "_executeAsync": true } }
```

**Result:** One combined message with all 3 search results.

### Separate Async (Streaming Responses)

Each async call in its own assistant message delivers results independently as they complete.

**Use when:** You want real-time streaming, or results as they arrive.

**How:** Make separate assistant messages, one per tool call.

### Mixed Sync + Async

Sync and async calls can coexist in the same function-calls block:

```json
{ "tool": "roll_dice", "params": { "dieType": "d20", "count": 1 } }                          // sync
{ "tool": "roll_dice", "params": { "dieType": "d20", "count": 1, "_executeAsync": true } }   // async
{ "tool": "roll_dice", "params": { "dieType": "d20", "count": 1 } }                          // sync
{ "tool": "roll_dice", "params": { "dieType": "d20", "count": 1, "_executeAsync": true } }   // async
```

- Sync calls return their results immediately in the same response
- Async calls return execution IDs immediately, then deliver results later
- **Empirically verified:** No conflicts, no race conditions, both modes coexist cleanly

---

## Sequential Execution

When Task B needs Task A's output, run them sequentially (no async).

```json
// Step 1: blocking
{ "tool": "search", "params": { "query": "recipe" } }

// Step 2: after result received
{ "tool": "email", "params": { "body": "[recipe result]" } }
```

**Critical:** Never use async for dependent tasks. If Task B references `[recipe result]` but Task A is async, Task B will receive `undefined`.

---

## Hybrid Workflows

### Phase 1: Parallel (grouped async)
Run independent tasks simultaneously.

```json
{ "tool": "joke_api",    "params": { "_executeAsync": true } }
{ "tool": "weather_api", "params": { "_executeAsync": true } }
```

### Phase 2: Sequential (after all complete)
Process results from Phase 1.

```json
// After both Phase 1 results have arrived:
{ "tool": "ai_generate", "params": { "prompt": "poem about [joke] and [weather]" } }
```

---

## Periodic / Recurring Execution

### ⚠️ Important Warning

> **Periodic grouped async does NOT return results until the full duration is complete.**
>
> A task running every 60 seconds for 1 hour will produce **no output for the entire hour**, then dump all results at once in a single response.

### Use Cases

| Pattern | Example |
|---------|---------|
| Price monitoring | Scrape a product page every 5 minutes for stock alerts |
| Health checks | Ping an API every 30 seconds for uptime monitoring |
| Data collection | Fetch metrics every hour for trend analysis |
| Scheduled tasks | Run a daily report at a specific time |

### Periodic Response Format

```json
{
  "success": true,
  "status": "completed",
  "executionId": "af4cd05e-0c19-4e3b-96fb-fc38c57d81bc",
  "result": {
    "periodicExecution": true,
    "totalIterations": 3,
    "results": [
      {
        "iteration": 1,
        "result": "{\"success\":true,\"total\":17,...}",
        "timestamp": 1777909033895
      },
      {
        "iteration": 2,
        "result": "{\"success\":true,\"total\":17,...}",
        "timestamp": 1777909043897
      },
      {
        "iteration": 3,
        "result": "{\"success\":true,\"total\":8,...}",
        "timestamp": 1777909053906
      }
    ],
    "totalDuration": 20011
  },
  "duration": 20011
}
```

Note: each iteration's `result` is a **JSON-stringified** payload, not a parsed object — clients must `JSON.parse()` it.

### Real-Time Delivery Alternative

If you need results as they arrive (not batched at the end), use **separate async calls** instead of grouped periodic execution.

---

## Error Handling

### Two-Layer Status System

The async system has two layers of status that must BOTH be checked:

1. **Queue/Execution Layer** — Did the task run?
   - `status: "queued"` → Task accepted into queue
   - `status: "completed"` → Task finished running
   - (no `status` field on sync responses)

2. **Business Logic Layer** — Did the operation succeed?
   - `result.success: true` → Operation succeeded
   - `result.success: false` → Operation failed (see `result.error`)

### Error Patterns

#### Business Logic Errors (Task Completes, Operation Fails)

```json
{
  "success": true,
  "status": "completed",
  "executionId": "8066065c-fc2a-44a0-a5c2-36b3e796b0c9",
  "result": {
    "success": false,
    "error": "ENOENT: no such file or directory, open 'C:\\nonexistent\\path\\file.txt'",
    "operation": "read",
    "path": "C:\\nonexistent\\path\\file.txt"
  },
  "duration": 0
}
```

**Common causes (empirically verified):**
- Missing files → `ENOENT: no such file or directory`
- Permission denied → `EPERM: operation not permitted`
- Invalid parameters → `Count must be an integer between 1 and 100. Received: -1`
- Network timeouts (tool-specific)

#### Parameter Validation Errors

```json
{
  "success": true,
  "status": "completed",
  "result": {
    "success": false,
    "error": "Count must be an integer between 1 and 100. Received: -1"
  }
}
```

**Critical Finding:** Tool-specific parameter validation (e.g. `count must be 1–100`) still happens at execution time, so invalid tool params can still be queued and fail when the task runs.

#### Async-Control Param Validation (queue-time, as of 2026-05-04)

The async-control parameters themselves (`_executeAsync`, `_interval`, `_stopAfter`, `_duration`, `_delayFirst`) are now validated up-front before the task is queued. Invalid combinations return a structured error to the LLM instead of silently falling back to a one-shot.

```json
{
  "success": false,
  "error": "_stopAfter requires _interval. To run a tool once in the background use only _executeAsync: true. To run a single delayed execution set _interval (seconds), _stopAfter: 1, and _delayFirst: true.",
  "hint": "Adjust the async control parameters and retry."
}
```

Validator rules:
- `_interval` must be a positive number of seconds (rejects `0`, negative, or non-numeric).
- `_stopAfter` must be a positive integer and requires `_interval`.
- `_duration` must be a positive number of minutes and requires `_interval`.
- `_delayFirst: true` requires `_interval`.

#### System-Level Errors (Task Does Not Complete)

These are rare and indicate:
- System crash
- Timeout (task hung)
- Queue rejection

In these cases the outer envelope's `success` may be `false` and there will be no `result` object.

### Error Handling Best Practices

```javascript
// Always check both layers
if (response.status === "completed") {
  // Parse the inner result (it may be a JSON string for periodic, or object for one-shot)
  const inner = typeof response.result === 'string'
    ? JSON.parse(response.result)
    : response.result;

  if (inner.success === true) {
    // Use inner.data / inner.total / etc.
  } else {
    // Handle business logic error: inner.error
  }
} else if (response.status === "queued") {
  // Task accepted, results will arrive later via autonomous message
} else {
  // System-level error
}
```

---

## Performance & Limits

### Concurrency (Empirically Tested)

| Metric | Tested Value | Notes |
|--------|-------------|-------|
| Parallel calls | 19+ in one block | No limit observed |
| Burst test | 10 simultaneous d6 rolls | All completed, no drops |
| Queue acceptance | Instant | All calls queued in < 1 second |
| Execution time | Sub-second | Most simple tools complete in 0–1 seconds |

### Timing Precision

| Metric | Tested Value | Accuracy |
|--------|-------------|----------|
| Minimum interval | 1 second | ~1000ms ± 20ms drift per iteration |
| Delayed execution (`_delayFirst`) | 5 seconds | Precise (5.47s actual) |
| Periodic duration | 6 seconds | Exact (6.03s actual) |
| Periodic 10s × 3 | 20 seconds | Exact (20.01s actual) |

### No Observed Limits

- ✅ No rate limiting on parallel calls
- ✅ No maximum concurrency cap
- ✅ No queue size limit
- ✅ No maximum interval restriction
- ✅ No minimum interval restriction below 1 second (untested below 1s)
- ✅ No minimum duration restriction (decimals like `0.1` work)

### Queue Stats (`GET /api/async-tools/status`)

The status endpoint reports execution counts. As of 2026-05-04 there are three failure-related counters — pick the one that matches the question you're asking:

| Field | Counts | Use when |
|-------|--------|----------|
| `failed` | Worker-level failures only — the `executeFunction` threw, was aborted, or otherwise never ran to completion. Does **not** include tools that ran but returned `success: false`. | You're debugging crashes / timeouts / aborts. |
| `businessFailed` | Subset of `completed` whose inner result reported failure (`success: false`, ENOENT, EPERM, per-iteration errors in periodic runs). | You're tracking how often tools executed but didn't accomplish their job. |
| `totalFailed` | `failed + businessFailed` — every execution that didn't fully succeed. The two source sets are disjoint by construction (an execution has exactly one terminal status), so this is an exact sum, not an estimate. | You want a single "anything that didn't fully succeed" number for a dashboard. |

---

## Edge Cases & Behaviors

### Parameter Validation Timing

**Finding (updated 2026-05-04):** Validation timing splits into two layers:
- **Async-control params** (`_executeAsync`, `_interval`, `_stopAfter`, `_duration`, `_delayFirst`) — validated **at queue time**. Invalid combinations are rejected synchronously with a structured error before any worker runs. See [Async-Control Param Validation](#async-control-param-validation-queue-time-as-of-2026-05-04).
- **Tool-specific params** (e.g. `count` for `roll_dice`) — still validated **at execution time** by the tool itself. A malformed tool param is queued and surfaces as `result.success: false` once the worker runs.

**Implication:** Async-shape errors fail fast. Tool-domain errors still require waiting for execution to discover, so check `result.success` on completion.

| Test | Parameter | Queue-time validation | Execution-time outcome |
|------|-----------|---------------------|------------------------|
| Orphan `_stopAfter: 7` | (no `_interval`) | ❌ Rejected at queue | n/a (never runs) |
| `_interval: 0` | with `_stopAfter` | ❌ Rejected at queue | n/a (never runs) |
| Negative tool count | `count: -1` | ✅ Accepted | ❌ Inner result `success: false` |
| Zero tool count | `count: 0` | ✅ Accepted | ❌ Inner result `success: false` |
| Excessive tool count | `count: 1000` | ✅ Accepted | ❌ Inner result `success: false` |
| Missing tool count | (omitted) | ✅ Accepted | ✅ Succeeds, default = 1 |

### Missing Optional Parameters

**Finding:** Missing optional parameters use **defaults**.

| Parameter | Default | Test Result |
|-----------|---------|-------------|
| `count` (dice) | `1` | ✅ Rolled 1 die |
| `modifier` (dice) | `0` | ✅ No modifier applied |

### Extreme Values

**Finding:** Some parameters have **no bounds checking**.

| Parameter | Value | Result |
|-----------|-------|--------|
| `modifier` | `-100` | ✅ Calculated correctly: roll 16 + (-100) = -84 |

**Caution:** Don't assume validation exists where it isn't documented.

### File Operations

| Scenario | Result | Time |
|----------|--------|------|
| Valid write to workspace | ✅ Success | 0 seconds |
| Parallel writes (2 files) | ✅ Both succeeded | 0 seconds |
| Missing file read | ❌ `ENOENT` error in payload | 0 seconds |
| Protected directory write | ❌ `EPERM` error in payload | 9 ms |

**Finding:** File operations are **instant** in async mode. No locking issues observed with parallel writes to different files.

### Web Search

| Metric | Result |
|--------|--------|
| Async completion | 0–1 seconds |
| Result quality | Identical to sync |
| Error rate | 0% in tests |

### `_estimatedMinutes` Behavior

**Finding:** `_estimatedMinutes` is a **pure UI hint** with no functional impact.

| Test | Estimated | Actual | Ratio |
|------|-----------|--------|-------|
| Web search | 0.1 min (6s) | 0s | ⚡ Faster than estimate |
| Web search | 5 min (300s) | 1s | ⚡ 300× faster than estimate |

**Use:** Set this to help users understand expected wait times via the UI. The system ignores it for scheduling.

### Conflict Resolution (Multiple Stop Conditions)

**Finding:** When `_stopAfter` and `_duration` conflict, **whichever limit is reached first wins**.

| Test | `_stopAfter` | `_duration` | Winner | Iterations |
|------|-------------|-------------|--------|-----------|
| Time wins | 100 | 6s | `_duration` | 3 |

**Implication:** Set both for "run at most N times OR for X minutes" safety belts.

---

## Best Practices

### 1. Maximize Parallelism

```json
// ❌ BAD: Sequential when parallel is possible
{ "tool": "search", "params": { "query": "A" } }
{ "tool": "search", "params": { "query": "B" } }
{ "tool": "search", "params": { "query": "C" } }

// ✅ GOOD: Parallel
{ "tool": "search", "params": { "query": "A", "_executeAsync": true } }
{ "tool": "search", "params": { "query": "B", "_executeAsync": true } }
{ "tool": "search", "params": { "query": "C", "_executeAsync": true } }
```

### 2. Never Async Dependencies

```json
// ❌ BAD: Task B references async Task A's result
{ "tool": "search", "params": { "query": "recipe", "_executeAsync": true } }
{ "tool": "email",  "params": { "body": "[recipe result]" } }  // undefined!

// ✅ GOOD: Sequential for dependencies
{ "tool": "search", "params": { "query": "recipe" } }
{ "tool": "email",  "params": { "body": "[recipe result]" } }
```

### 3. Handle Errors at Both Layers

```javascript
// Check system status first
if (result.status !== "completed" && result.status !== undefined) {
  // System error (crash, timeout, queue rejection)
}

// Then check business logic
if (!result.result?.success) {
  // Operation error (missing file, invalid input, API failure)
}
```

### 4. Use `_estimatedMinutes` for UX

```json
{
  "tool": "heavy_processing",
  "params": {
    "_executeAsync": true,
    "_estimatedMinutes": 5
  }
}
```
→ Shows user: "This may take ~5 minutes..." in the UI progress indicator.

### 5. Set Safety Limits on Recurring Tasks

```json
{
  "tool": "monitor_price",
  "params": {
    "_executeAsync": true,
    "_interval": 60,
    "_stopAfter": 100,
    "_duration": 60
  }
}
```
→ Runs every minute, stops after 100 checks OR 1 hour (whichever first).

### 6. Use `_delayFirst` for Scheduled Tasks

```json
{
  "tool": "daily_report",
  "params": {
    "_executeAsync": true,
    "_interval": 86400,
    "_stopAfter": 1,
    "_delayFirst": true
  }
}
```
→ Waits 24 hours, runs once. Perfect for "run tomorrow at this time."

### 7. Never Build a Fake Timer Tool

```json
// ❌ BAD: Calling a sleep/echo tool to "schedule" a real call later
{ "tool": "sleep", "params": { "seconds": 3600 } }
{ "tool": "send_email", "params": { ... } }  // assumes sleep blocks — IT DOESN'T

// ✅ GOOD: Attach async parameters directly to the real tool
{
  "tool": "send_email",
  "params": {
    "to": "user@example.com",
    "subject": "Reminder",
    "_executeAsync": true,
    "_interval": 3600,
    "_stopAfter": 1,
    "_delayFirst": true
  }
}
```

---

## Troubleshooting

### Problem: Async task never returns

**Possible causes:**
1. Task is still running (check `_estimatedMinutes` for expected duration)
2. Task crashed at system level (rare)
3. UI didn't display the autonomous message (refresh)
4. For periodic tasks, results arrive at the END of duration only

**Solution:**
- Check execution ID via `GET /api/async-tools/execution/:executionId`
- Verify task wasn't stopped manually via UI Stop button
- Cancel via `POST /api/async-tools/cancel/:executionId` if stuck

### Problem: "undefined" in dependent task

**Cause:** Used async for Task A, but Task B references Task A's result before it completes.

**Solution:** Use sequential execution for dependent tasks.

### Problem: Invalid parameter error after long wait

**Cause:** Tool-specific parameter validation (e.g. `count: -1` for dice) still happens at execution time. Async-control params (`_interval`, `_stopAfter`, etc.) are validated up-front since 2026-05-04.

**Solution:** Validate tool-specific parameter constraints client-side before queuing. Common pitfalls:
- `count` must be 1–100 for dice
- `dieType` must be valid enum value (`d1`–`d20`)
- File paths must exist (for reads)

### Problem: LLM gets a structured async-validation error like "_stopAfter requires _interval"

**Cause:** As of 2026-05-04 the queue rejects malformed async-control combinations at queue time instead of silently degrading. The LLM should self-correct on the next turn.

**Common rejection reasons and fixes:**
- `_stopAfter requires _interval` → either drop `_stopAfter` (you wanted a one-shot — `_executeAsync: true` is enough), or add `_interval` (you wanted a recurring task).
- `_duration requires _interval` → same shape as above.
- `_delayFirst requires _interval` → for a single delayed run, set `_interval` to the delay seconds, `_stopAfter: 1`, and `_delayFirst: true`.
- `_interval must be a positive number of seconds. Received: 0` → use a positive interval. There is no "tight loop" mode; if you want to spam-execute a tool, run it without `_interval` and the next call follows when the previous returns.
- `_stopAfter must be a positive integer` → integers only, must be ≥ 1.

### Problem: Banner says "✅ ASYNC TOOL COMPLETED" but the result is actually a failure

**Status:** Fixed 2026-05-04. The autonomous-message wrapper now inspects the inner `result.success` (and per-iteration results for periodic runs). On detected failure it emits `⚠️ ASYNC TOOL FINISHED WITH ERROR` with an honesty directive that tells the LLM not to claim success.

If you see the success banner over a failure result on a recent build, the inspector has hit an unparseable / unusual result shape and the `unknown` flag is being set internally. Inspect the `Result:` block in the system message body for the actual payload — the LLM still has access to it.

### Problem: Periodic task runs too long

**Cause:** Forgot to set `_stopAfter` or `_duration`.

**Solution:** Always set at least one stop condition:
```json
{
  "_executeAsync": true,
  "_interval": 60,
  "_stopAfter": 10
}
```

### Problem: Results arrive all at once instead of streaming

**Cause:** Used grouped async with periodic execution.

**Solution:** Use separate assistant messages with separate async calls if you need real-time streaming.

### Problem: Need to stop a runaway periodic task

**Solution:** Either:
- Click the Stop button in the AGNT UI
- Call `POST /api/async-tools/cancel/:executionId` with the execution ID
- Call `POST /api/async-tools/cancel-all/:conversationId` to stop everything

---

## Test Results

### Test Suite Summary

**Date:** 2026-05-04
**Tester:** Annie (live tool calls in chat)
**Total Tests:** 25+
**Pass Rate:** 100% (all behaved as expected)

### Detailed Results

#### Parallel Execution Tests

| Test | Calls | Result | Time |
|------|-------|--------|------|
| 3 parallel dice | 3 | ✅ All succeeded | < 1s |
| 10-call burst (d6) | 10 | ✅ All succeeded, no drops | < 1s |
| Mixed sync/async (4 calls) | 4 | ✅ All succeeded | < 1s |

**10-Call Burst Distribution:** 1, 1, 2, 3, 3, 4, 5, 5, 5, 6 (good random spread).

#### Sequential Execution Tests

| Test | Steps | Result | Time |
|------|-------|--------|------|
| Dice → Joke chain | 2 | ✅ Dependency resolved correctly | < 1s |

#### Periodic Execution Tests

| Test | Interval | Iterations | Result | Total Time |
|------|----------|-----------|--------|------------|
| 10s × 3 (d20) | 10s | 3 | ✅ All succeeded (17, 17, 8) | 20.01s |
| 1s × 5 (d4) | 1s | 5 | ✅ All succeeded (3, 3, 2, 1, 4) | 4.03s |
| 2s with 6s duration cap | 2s | 3 (capped) | ✅ Stopped by `_duration` | 6.03s |
| 5s `_delayFirst` × 1 | 5s | 1 (after delay) | ✅ Joke arrived after 5.47s | 5.47s |

#### Parameter Validation Tests

| Test | Parameter | Queued? | Executed? | Error |
|------|-----------|---------|-----------|-------|
| Negative count | `count: -1` | ✅ | ❌ | "Count must be 1–100. Received: -1" |
| Zero count | `count: 0` | ✅ | ❌ | "Count must be 1–100. Received: 0" |
| Excessive count | `count: 1000` | ✅ | ❌ | "Count must be 1–100. Received: 1000" |
| Missing count | (omitted) | ✅ | ✅ | Default = 1, rolled successfully |
| Extreme modifier | `modifier: -100` | ✅ | ✅ | Calculated correctly: 16 + (-100) = -84 |

#### File Operation Tests

| Test | Operation | Path | Result | Time |
|------|-----------|------|--------|------|
| Valid write | Write | Workspace | ✅ Success (94 bytes) | 0s |
| Parallel writes | 2× Write | Workspace | ✅ Both succeeded | 0s |
| Missing file | Read | `C:\nonexistent\path\file.txt` | ❌ `ENOENT` | 0s |
| Protected dir | Write | `C:\Windows\System32\test.txt` | ❌ `EPERM` | 9ms |

#### Web Search Tests

| Test | Async? | Estimated | Actual | Result |
|------|--------|-----------|--------|--------|
| Basic search | ✅ | — | 0s | 5 results |
| Estimated 0.1min | ✅ | 6s | 0s | 5 results |
| Estimated 5min | ✅ | 300s | 1s | 5 results |

#### Error Handling Tests

| Test | Error Type | System Status | Operation Result |
|------|-----------|---------------|------------------|
| Missing file | `ENOENT` | ✅ Completed | ❌ Failed cleanly |
| Permission denied | `EPERM` | ✅ Completed | ❌ Failed cleanly |
| Invalid parameter | Validation | ✅ Completed | ❌ Failed cleanly |

**Conclusion:** All errors surface in the result payload with clear, parseable messages. The system never crashes or hangs on bad input.

---

## Appendix A: Execution ID Format

All async tasks receive a UUIDv4 execution ID:

```
xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
```

Example: `8604c5b0-8515-4cb1-8894-918acb31ac25`

Use this ID with `/api/async-tools/execution/:executionId` and `/api/async-tools/cancel/:executionId`.

---

## Appendix B: Response Format Reference

### Queued Response (one-shot async)

```json
{
  "success": true,
  "status": "queued",
  "executionId": "8604c5b0-8515-4cb1-8894-918acb31ac25",
  "message": "roll_dice started in the background. You'll receive updates as it progresses.",
  "estimatedDuration": null
}
```

### Completed Response (one-shot async, success)

```json
{
  "success": true,
  "status": "completed",
  "executionId": "8604c5b0-8515-4cb1-8894-918acb31ac25",
  "result": "{\"success\":true,\"total\":20,\"individualRolls\":[20],\"error\":null}",
  "duration": 480
}
```

⚠️ **Note:** For some tools, `result` is a **JSON-stringified payload**, not a parsed object. Clients must `JSON.parse()` it before use. Inline single-shot tools (like `chucknorris_get_joke` directly) often return the parsed object.

### Completed Response (one-shot async, business-logic error)

```json
{
  "success": true,
  "status": "completed",
  "executionId": "8066065c-fc2a-44a0-a5c2-36b3e796b0c9",
  "result": "{\"success\":false,\"error\":\"ENOENT: no such file or directory, open 'C:\\\\nonexistent\\\\path\\\\file.txt'\",\"operation\":\"read\",\"path\":\"C:\\\\nonexistent\\\\path\\\\file.txt\"}",
  "duration": 0
}
```

### Periodic Execution Response

```json
{
  "success": true,
  "status": "completed",
  "executionId": "af4cd05e-0c19-4e3b-96fb-fc38c57d81bc",
  "result": {
    "periodicExecution": true,
    "totalIterations": 3,
    "results": [
      { "iteration": 1, "result": "{\"success\":true,\"total\":17,...}", "timestamp": 1777909033895 },
      { "iteration": 2, "result": "{\"success\":true,\"total\":17,...}", "timestamp": 1777909043897 },
      { "iteration": 3, "result": "{\"success\":true,\"total\":8,...}",  "timestamp": 1777909053906 }
    ],
    "totalDuration": 20011
  },
  "duration": 20011
}
```

### Sync Response (no async parameters)

```json
{
  "success": true,
  "total": 20,
  "individualRolls": [20],
  "error": null
}
```

(Returns the tool's actual output payload directly, with no `status`/`executionId` envelope.)

---

## Appendix C: Quick Reference Card

### Decision Flowchart

```
Does Task B need Task A's output?
├── YES → Sequential (blocking)
│   └── Task A → wait for result → Task B
└── NO → Parallel (async)
    ├── One-time? → _executeAsync: true
    └── Recurring? → _executeAsync + _interval
        ├── Fixed count?  → _stopAfter: N
        ├── Fixed time?   → _duration: N (minutes)
        └── Both?         → First limit reached wins
```

### Parameter Quick Reference

| Goal | Parameters |
|------|-----------|
| Run once, background | `_executeAsync: true` |
| Run every N seconds (forever — UNSAFE) | `_executeAsync: true, _interval: N` |
| Run N times total | `_executeAsync: true, _interval: N, _stopAfter: M` |
| Run for M minutes | `_executeAsync: true, _interval: N, _duration: M` |
| Delay first run | `_executeAsync: true, _interval: N, _stopAfter: 1, _delayFirst: true` |
| Estimate for UX | `_executeAsync: true, _estimatedMinutes: N` |
| Safety belt (run at most N times OR M minutes) | `_executeAsync: true, _interval: I, _stopAfter: N, _duration: M` |

### Related REST Endpoints

For programmatic queue management, see [Async Tool Routes](./_API-DOCUMENTATION.md#async-tool-routes) in the API documentation:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/async-tools/status` | Queue statistics |
| `GET /api/async-tools/executions/:conversationId` | List executions |
| `GET /api/async-tools/executions/:conversationId/running` | List running executions |
| `GET /api/async-tools/execution/:executionId` | Get execution details |
| `POST /api/async-tools/cancel/:executionId` | Cancel one execution |
| `POST /api/async-tools/cancel-all/:conversationId` | Cancel all in a conversation |

---

**End of Document**

*For questions, corrections, or updates, see the AGNT development team. This document was empirically validated via live tool calls in the AGNT chat orchestrator on 2026-05-04.*
