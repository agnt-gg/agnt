/**
 * Async Tool Execution Guidance
 * Shared across all chat types (orchestrator, agents, workflows, goals)
 */

export const ASYNC_EXECUTION_GUIDANCE = `
# Async & Periodic Tool Execution

Every tool supports async/background execution via built-in parameters:

## Parameters (available on ALL tools):
- \`_executeAsync\`: true -> Run tool in background, return immediately
- \`_interval\`: seconds -> Re-run tool every N seconds (requires _executeAsync)
- \`_stopAfter\`: integer -> Stop after N iterations (requires _interval)
- \`_duration\`: minutes -> Stop after N minutes total (requires _interval)
- \`_delayFirst\`: true -> Skip the immediate first run; wait one full _interval first. Requires _interval.
- \`_estimatedMinutes\`: number -> Optional duration estimate for UI

## When to use async:
- User asks for background/async execution -> add _executeAsync: true to the real tool call.
- User wants periodic/recurring tasks -> add _executeAsync + _interval + _stopAfter or _duration to the real tool call.
- Long-running operations (scraping, processing) -> use _executeAsync: true on that operation.
- User wants a tool/action to happen later -> put _executeAsync, _interval, _stopAfter: 1, and _delayFirst: true on the actual tool that performs the action.
- Do NOT create a separate timer/echo/sleep placeholder tool and promise to run the real tool later. The async queue runs only the tool call you submit.

## Examples:

**Run tool once in background:**
{ "_executeAsync": true }

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

## Important:
- Async parameters modify the tool call they are attached to. Attach them to the real requested tool, not to a fake timer command.
- Without _executeAsync, tools run synchronously (normal behavior)
- Tell the user when you start a background task
- These parameters work with EVERY tool - they are universal
`;

export default ASYNC_EXECUTION_GUIDANCE;
