/**
 * Async Tool Execution Guidance
 * Shared across all chat types (orchestrator, agents, workflows, goals)
 */

export const ASYNC_EXECUTION_GUIDANCE = `
# Async & Periodic Tool Execution

Every tool supports async/background execution via built-in parameters:

## Parameters (available on ALL tools):
- \`_executeAsync\`: true → Run tool in background, return immediately
- \`_interval\`: seconds → Re-run tool every N seconds (requires _executeAsync)
- \`_stopAfter\`: integer → Stop after N iterations (requires _interval)
- \`_duration\`: minutes → Stop after N minutes total (requires _interval)
- \`_estimatedMinutes\`: number → Optional duration estimate for UI

## When to use async:
- User asks for background/async execution → add _executeAsync: true
- User wants periodic/recurring tasks → add _executeAsync + _interval + _stopAfter or _duration
- Long-running operations (scraping, processing) → use _executeAsync: true

## Examples:

**Run tool once in background:**
{ "_executeAsync": true }

**Roll dice every 60 seconds, 5 times:**
{ "dieType": "d6", "_executeAsync": true, "_interval": 60, "_stopAfter": 5 }

**Scrape a site every 5 minutes for 1 hour:**
{ "url": "https://example.com", "_executeAsync": true, "_interval": 300, "_duration": 60 }

## What happens:
1. Tool returns immediately with an execution ID
2. User can keep chatting while it runs
3. Results arrive via autonomous message when complete
4. User can stop via Stop button in UI

## Important:
- Without _executeAsync, tools run synchronously (normal behavior)
- Tell the user when you start a background task
- These parameters work with EVERY tool - they are universal
`;

export default ASYNC_EXECUTION_GUIDANCE;
