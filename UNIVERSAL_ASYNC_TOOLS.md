# Universal Async Tool System - Implementation Complete

## What Was Implemented

### ✅ ANY Tool Can Run Async
- **No hardcoded list** - LLM decides at runtime
- **Parameter-based** - LLM adds `_executeAsync: true` to any tool call
- **Works everywhere** - Orchestrator, Agents, Workflows, Goals, Tools

### ✅ System Prompt Updates
- **New file**: `backend/src/services/orchestrator/system-prompts/async-execution.js`
- **Orchestrator prompt**: Updated with async guidance
- **Agent prompt**: Updated with async guidance (in AgentService.js)
- **Clear instructions**: LLM knows when and how to use async mode

### ✅ Dynamic Detection in OrchestratorService
- **Removed**: Hardcoded `ASYNC_TOOLS` list and `isAsyncTool()` function
- **Added**: Parameter-based detection (`_executeAsync` check)
- **Routes correctly**: Works for all chat types (agent, orchestrator, workflow, goal, tool)

### ✅ Backend Execution
- Cleans special params (`_executeAsync`, `_estimatedMinutes`) before tool execution
- Routes to correct tool executor based on chat type
- Supports all autonomous message callbacks (progress, completion, error)

---

## How It Works

### 1. LLM Decides Async Mode

**User**: "Scrape this large site but let me keep chatting"

**LLM** (Orchestrator or Agent):
```json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://large-site.com/data",
    "_executeAsync": true,
    "_estimatedMinutes": 5
  }
}
```

### 2. Backend Detects Parameter

`OrchestratorService.js` line ~774:
- Checks `functionArgs._executeAsync === true`
- Removes special params before tool execution
- Queues tool for background execution

### 3. Tool Runs in Background

- AsyncToolQueue manages execution
- Routes to correct tool executor (agent vs orchestrator vs workflow)
- Sends progress via AutonomousMessageService
- User sees Stop button in UI

### 4. Results Delivered

- LLM receives autonomous notification when complete
- LLM explains results to user conversationally
- User can continue chatting during execution

---

## Examples

### Web Scraping (Async)
```json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://news-site.com/articles",
    "_executeAsync": true,
    "_estimatedMinutes": 3
  }
}
```

### Web Scraping (Sync - No Flag)
```json
{
  "name": "web_scrape",
  "arguments": {
    "url": "https://quick-page.com"
  }
}
```

### Periodic Monitoring (Async)
```json
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
```

### File Processing (Async)
```json
{
  "name": "file_operations",
  "arguments": {
    "action": "process_large_file",
    "file_path": "/data/huge-dataset.csv",
    "_executeAsync": true,
    "_estimatedMinutes": 10
  }
}
```

---

## Files Changed

### Created
- `backend/src/services/orchestrator/system-prompts/async-execution.js`

### Modified
- `backend/src/services/orchestrator/system-prompts/orchestrator-chat.js`
  - Added import and export of `ASYNC_EXECUTION_GUIDANCE`
  - Added to system prompt template

- `backend/src/services/AgentService.js`
  - Added import of `ASYNC_EXECUTION_GUIDANCE`
  - Added to agent system prompt template (line ~252)

- `backend/src/services/OrchestratorService.js`
  - Removed `import { ASYNC_TOOLS }` from asyncTools.js
  - Removed `isAsyncTool()` function
  - Updated async detection to check `_executeAsync` parameter
  - Added dynamic routing for all chat types in async executor
  - Cleans special params before tool execution

- `backend/src/services/AutonomousMessageService.js`
  - Increased retry count to 10 with 1.5s delay (15 seconds total)
  - Made conversation not found errors less noisy

- `frontend/src/store/features/chat.js`
  - Added `dispatch` to `handleRealtimeChatEvent` parameters
  - Updated `UPDATE_TOOL_CALL_RESULT` to search for tool calls without messageId
  - Added autosave trigger after autonomous messages complete

---

## Benefits

✅ **Universal** - ANY tool works async
✅ **Flexible** - Same tool can be sync OR async
✅ **Smart** - LLM decides based on context
✅ **Simple** - Just add `_executeAsync: true`
✅ **Works everywhere** - Orchestrator, Agents, Workflows, Goals
✅ **No maintenance** - No hardcoded tool list to update
✅ **Backward compatible** - Existing tools work unchanged

---

## Testing

### Test with Orchestrator
```
User: "Scrape this site but let me keep chatting: https://example.com"
Expected: LLM adds _executeAsync: true, tool runs in background, Stop button appears
```

### Test with Agent
```
User (to agent): "Monitor this API every 5 minutes for an hour: https://api.example.com/status"
Expected: Agent adds _executeAsync: true with monitoring params, runs in background
```

### Test Sync Execution (No Flag)
```
User: "Quick scrape: https://example.com"
Expected: LLM doesn't add _executeAsync, tool runs synchronously, waits for result
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LLM (Orchestrator or Agent)                             │
│  - Receives async guidance in system prompt             │
│  - Decides: Should this tool run async?                 │
│  - Adds _executeAsync: true if yes                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  OrchestratorService.js (Line ~774)                      │
│  - Detects _executeAsync parameter                      │
│  - Removes special params (_executeAsync, _estimated*)  │
│  - Routes to AsyncToolQueue OR sync execution           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  AsyncToolQueue (If async)                               │
│  - Queues tool for background execution                 │
│  - Routes to correct executor (agent/orchestrator/etc)  │
│  - Manages progress callbacks                           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Tool Executor (executeAgentTool / executeTool / etc)   │
│  - Executes tool with cleaned arguments                 │
│  - Sends progress updates via callbacks                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  AutonomousMessageService                                │
│  - Triggers autonomous messages for progress/completion │
│  - LLM receives updates and explains to user            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Frontend                                                │
│  - Shows Stop button for async tools                    │
│  - User can continue chatting                           │
│  - Receives autonomous updates                          │
└─────────────────────────────────────────────────────────┘
```

---

## Migration from Old System

### Old Approach (Hardcoded)
```javascript
// Had to add tool to ASYNC_TOOLS object
export const ASYNC_TOOLS = {
  my_tool: {
    executionMode: 'async',
    execute: myToolFunction,
    estimatedDuration: () => 5 * 60 * 1000
  }
};
```

### New Approach (Dynamic)
```javascript
// Tool is just a regular tool
// LLM decides to run it async by adding parameter:
{
  "name": "my_tool",
  "arguments": {
    // ... normal params ...
    "_executeAsync": true,
    "_estimatedMinutes": 5
  }
}
```

---

**Implementation Complete - Ready for Production!** ✅
