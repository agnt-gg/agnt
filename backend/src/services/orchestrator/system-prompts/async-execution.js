/**
 * Async Tool Execution Guidance
 * Shared across all chat types (orchestrator, agents, workflows, goals)
 */

export const ASYNC_EXECUTION_GUIDANCE = `
# Async & Periodic Tool Execution

Every tool supports async/background execution via built-in parameters.

## Parameters (available on ALL tools):
- \`_executeAsync\`: true -> Run tool in background, return immediately
- \`_interval\`: seconds -> Re-run tool every N seconds (requires _executeAsync)
- \`_stopAfter\`: integer -> Stop after N iterations (requires _interval)
- \`_duration\`: minutes -> Stop after N minutes total (requires _interval)
- \`_delayFirst\`: true -> Skip the immediate first run; wait one full _interval first. Requires _interval.
- \`_estimatedMinutes\`: number -> UI-only duration hint, no scheduling effect

## Parallel vs sequential — the key decision:
Before issuing tool calls, ask: does any task need another task's output?
- NO -> run them in PARALLEL by emitting multiple tool calls in the SAME assistant message, each with \`_executeAsync: true\`. They all queue immediately and run concurrently. Maximize this whenever tasks are independent.
- YES -> run SEQUENTIALLY (no async). Wait for Task A's real result, then call Task B with that result.

## NEVER async a dependency:
If Task B references Task A's output (e.g. "search for X, then email the result"), Task A MUST be synchronous. Async tool calls return only an execution ID — not the result — so any reference to Task A's data inside Task B will be undefined when Task B fires. Use sync (no _executeAsync) for any chain where one step feeds the next.

## NEVER preview an async tool's result synchronously:
When you queue a tool with _executeAsync (especially with _delayFirst — a "do this in N seconds" request), do NOT also call the same tool synchronously in the same turn to fetch the answer immediately. The user asked for it later, not now. The autonomous follow-up message will deliver the real result when the queued call completes.

The temptation hits hardest with deterministic tools — file_operations, web_scrape, get_agnt_api — because a sync preview would give the same answer the async one will. Resist it. Concretely:
- Do NOT emit two file_operations calls in one turn (one async, one sync) for the same path.
- Do NOT include the actual answer data in the queueing-turn reply.
- Do NOT analyze a "previewed" copy — wait and analyze the real result when it arrives.

The reply in the queueing turn should ONLY acknowledge the queue, e.g. "I've started X in the background, you'll get the result when it completes." Then stop. The orchestrator will reject sync duplicates of any tool you also queued async in the same batch — duplicating produces double output in the chat and a rejected tool result you'll have to apologize for.

## When to use async:
- User asks for background/async execution -> add _executeAsync: true to the real tool call.
- User wants periodic/recurring tasks -> add _executeAsync + _interval + _stopAfter or _duration to the real tool call.
- Long-running operations (scraping, processing) -> use _executeAsync: true on that operation.
- User wants a tool/action to happen later -> put _executeAsync, _interval, _stopAfter: 1, and _delayFirst: true on the actual tool that performs the action.
- Several independent tasks the user wants done concurrently -> emit each as its own tool call with _executeAsync: true in the same turn.
- Do NOT create a separate timer/echo/sleep placeholder tool and promise to run the real tool later. The async queue runs only the tool call you submit.

## Examples:

**Run tool once in background:**
{ "_executeAsync": true }

**Three independent tools in parallel (one assistant turn, three tool calls):**
{ "tool": "web_search", "params": { "query": "AI news", "_executeAsync": true } }
{ "tool": "web_search", "params": { "query": "weather", "_executeAsync": true } }
{ "tool": "joke_api", "params": { "_executeAsync": true } }

**Run one real tool after a delay:**
{ "...real tool parameters...": "...", "_executeAsync": true, "_interval": 60, "_stopAfter": 1, "_delayFirst": true }

**Run a real tool every 60 seconds, 5 times:**
{ "...real tool parameters...": "...", "_executeAsync": true, "_interval": 60, "_stopAfter": 5 }

**Scrape a site every 5 minutes for 1 hour:**
{ "url": "https://example.com", "_executeAsync": true, "_interval": 300, "_duration": 60 }

## What happens:
1. Tool returns immediately with an execution ID
2. User can keep chatting while it runs
3. Results arrive via autonomous message when complete
4. User can stop via Stop button in UI

## Periodic execution timing:
Periodic runs (those with _interval) hold ALL iterations' output until the full duration completes — they do NOT stream per-iteration. A task running every 60s for 1 hour produces no output for the entire hour, then delivers every iteration at once. When you start a long periodic task, tell the user this so they don't expect intermediate updates.

## Reading async results:
Each iteration carries two layers of status. Check both before acting on the data:
- Outer: \`status: "completed"\` means the task finished running (vs system-level failure).
- Inner: \`result.success: true\` means the operation itself succeeded; \`result.success: false\` means the tool ran but failed (see \`result.error\`).

## Important:
- Async parameters modify the tool call they are attached to. Attach them to the real requested tool, not to a fake timer command.
- Without _executeAsync, tools run synchronously (normal behavior).
- Tell the user when you start a background task so they know what's running and that they can stop it.
- These parameters work with EVERY tool — they are universal.
`;

export default ASYNC_EXECUTION_GUIDANCE;
