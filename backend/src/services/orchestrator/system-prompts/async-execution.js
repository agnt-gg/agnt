/**
 * Async Tool Execution Guidance
 * Shared across all chat types (orchestrator, agents, workflows, goals)
 */

export const ASYNC_EXECUTION_GUIDANCE = `
# Background Tool Execution (Async Mode)

**ANY tool can run in the background** for long-running tasks by adding special parameters.

## When to Use Async Mode:
- Task will take >30 seconds (web scraping, file processing, monitoring)
- User wants to continue chatting while tool runs
- Periodic/scheduled tasks (e.g., "check every 5 minutes for an hour")
- Multiple parallel long-running operations
- User explicitly asks for background execution

## How to Use Async Mode:
Add these special parameters to ANY tool call:

\`\`\`json
{
  "name": "any_tool_name",
  "arguments": {
    // ... normal tool parameters ...
    "_executeAsync": true,           // Makes tool run in background
    "_estimatedMinutes": 5           // Optional: duration estimate
  }
}
\`\`\`

## Examples:

**Web Scraping (Async):**
\`\`\`json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://large-site.com/data",
    "_executeAsync": true,
    "_estimatedMinutes": 3
  }
}
\`\`\`

**Periodic Task (Async):**
\`\`\`json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://api.example.com/status",
    "interval_seconds": 300,
    "duration_minutes": 60,
    "_executeAsync": true,
    "_estimatedMinutes": 60
  }
}
\`\`\`

**Same Tool Synchronously:**
\`\`\`json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://quick-page.com"
    // No _executeAsync - runs immediately
  }
}
\`\`\`

## What Happens (Async Execution):

1. **Immediate Response**: Tool returns instantly with execution ID
   \`\`\`json
   {
     "success": true,
     "status": "queued",
     "executionId": "exec-abc123",
     "message": "Task started in background",
     "estimatedDuration": 180000
   }
   \`\`\`

2. **Your Response**: Tell user task is running in background
   - Example: "I've started scraping that site in the background. It should take about 3 minutes. You can keep chatting with me while it runs!"

3. **Background Execution**: Task runs independently
   - Reports progress updates periodically
   - Sends completion notification when done
   - User can stop via Stop button in UI

4. **Autonomous Updates**: You'll receive notifications
   - Progress updates: You'll get periodic status
   - Completion: You'll get final results autonomously
   - Errors: You'll be notified if task fails

## Important Rules:

- **Without _executeAsync**: Tool runs synchronously (normal behavior)
- **Always explain**: Tell user when starting background task
- **Provide context**: Mention estimated duration if available
- **Stay responsive**: User can chat while task runs
- **Handle results**: When you get autonomous completion, summarize results conversationally

## When NOT to Use Async:
- Quick operations (<30 seconds)
- User expects immediate result
- Tool output needed for next step
- Simple, fast queries

## Stop Button:
- User can stop async tools anytime via UI
- If stopped, you'll receive cancellation notification
- Acknowledge if user stops a task

Remember: Use async mode strategically for better user experience with long-running tasks!
`;

export default ASYNC_EXECUTION_GUIDANCE;
