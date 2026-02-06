# Async Tool Calls Architecture Design

## Problem Statement

Currently, when the agent/orchestrator executes tool calls during chat:
1. **Tools block the conversation** - The LLM waits for ALL tools to complete before continuing
2. **User is stuck waiting** - No way to see progress or interact while tools run
3. **Long-running tools freeze chat** - A 60-minute dice roller blocks for an hour
4. **Manual trigger required** - User must send a message to get AI responses

**The user's requirement:** *"You must keep it in chat"* - The AI needs to autonomously post updates to the chat WITHOUT requiring human interaction to trigger each response.

## Current Architecture Flow

```
User sends message
  ↓
OrchestratorService receives request
  ↓
LLM generates response with tool_calls
  ↓
[ BLOCKING LOOP ] Tool execution (line 709-863)
  ├─ await executeTool() for EACH tool
  ├─ Wait for ALL tools to complete
  └─ Return results to LLM
  ↓
LLM processes results
  ↓
Response sent to user
```

**Key bottleneck:** Line 713 in `OrchestratorService.js`:
```javascript
const toolPromises = toolCalls.map(async (toolCall) => {
  // ... await executeTool() blocks here
});
```

## Proposed Solution: Async Tool Execution System

### Architecture Changes

#### 1. **Tool Execution Queue + Background Workers**

```
┌─────────────────────────────────────┐
│   Orchestrator Chat Handler         │
│   - LLM makes tool calls             │
│   - Queue tools (non-blocking)       │
│   - Continue conversation            │
└─────────────────────────────────────┘
            ↓ (enqueue)
┌─────────────────────────────────────┐
│   Tool Execution Queue               │
│   - In-memory queue (Map)            │
│   - Track: pending, running, done    │
│   - Support: sync + async tools      │
└─────────────────────────────────────┘
            ↓ (worker processes)
┌─────────────────────────────────────┐
│   Background Tool Workers            │
│   - Execute tools asynchronously     │
│   - Stream progress updates          │
│   - Report results when done         │
└─────────────────────────────────────┘
            ↓ (push updates)
┌─────────────────────────────────────┐
│   Real-time Broadcast (Socket.IO)   │
│   - Push tool progress to frontend   │
│   - AI can autonomously post msgs    │
└─────────────────────────────────────┘
```

#### 2. **Two Types of Tool Execution**

##### **Synchronous Tools** (existing behavior)
- Fast tools (<2 seconds)
- Examples: `execute_javascript_code`, `web_scrape`, `file_operations`
- Behavior: Execute immediately, wait for result, continue

##### **Asynchronous Tools** (new behavior)
- Long-running tools (>2 seconds, or marked as async)
- Examples: `roll_dice_for_hour`, `train_model`, `bulk_processing`
- Behavior: Queue tool, continue conversation, receive updates

##### **Tool Metadata Flag**
```javascript
// In tool schema:
{
  name: "roll_dice_periodically",
  executionMode: "async", // <-- NEW FLAG
  estimatedDuration: 3600000, // 1 hour in ms
  supportsProgressUpdates: true
}
```

#### 3. **Conversation Context Preservation**

**Challenge:** If AI continues the conversation while tools run, how does it reference results later?

**Solution:** Tool status tracking + deferred result injection

```javascript
conversationContext.asyncTools = new Map();
// Structure:
{
  toolCallId: {
    status: "queued" | "running" | "completed" | "failed",
    toolName: "roll_dice_periodically",
    startTime: 1738803850000,
    estimatedCompletion: 1738807450000,
    partialResults: [...], // Progress updates
    finalResult: null,
    progressCallback: (update) => { /* broadcast to chat */ }
  }
}
```

#### 4. **AI Autonomous Posting Mechanism**

This is the KEY innovation - the AI can post to chat WITHOUT user interaction.

**How it works:**

```javascript
// When async tool completes:
function onAsyncToolComplete(toolCallId, result) {
  const toolInfo = conversationContext.asyncTools.get(toolCallId);

  // Mark as completed
  toolInfo.status = "completed";
  toolInfo.finalResult = result;

  // 🚨 CRITICAL: Trigger AI to generate autonomous message
  // This bypasses the "user must send message" requirement
  await triggerAutonomousAIResponse(conversationId, {
    type: "tool_result_available",
    toolCallId,
    toolName: toolInfo.toolName,
    result
  });
}

async function triggerAutonomousAIResponse(conversationId, eventData) {
  // Find the conversation context
  const context = conversationManager.get(conversationId);

  // Inject a system message about the tool completion
  const systemUpdate = {
    role: "system",
    content: `Tool ${eventData.toolName} (ID: ${eventData.toolCallId}) has completed.
Result: ${JSON.stringify(eventData.result)}

You should now inform the user about this result in a natural way.`
  };

  // Add to message history
  context.messages.push(systemUpdate);

  // 🎯 Call LLM to generate autonomous response
  const aiResponse = await adapter.callStream(
    context.messages,
    context.toolSchemas,
    (chunk) => {
      // Stream response chunks to chat
      broadcastToUser(context.userId, RealtimeEvents.CHAT_CONTENT_DELTA, {
        conversationId,
        delta: chunk.delta,
        autonomous: true // Flag this as AI-initiated
      });
    }
  );

  // Add AI response to history
  context.messages.push(aiResponse);
}
```

**Result:** AI can now post messages WITHOUT user interaction!

#### 5. **Frontend Changes**

The frontend needs to support autonomous AI messages:

```javascript
// In Vue store or chat component:
socket.on(RealtimeEvents.CHAT_CONTENT_DELTA, (data) => {
  if (data.autonomous) {
    // AI-initiated message, create new message bubble
    createNewAssistantMessage(data);
  } else {
    // User-triggered response, append to existing message
    appendToCurrentMessage(data);
  }
});
```

### Implementation Files

#### New Files

1. **`backend/src/services/AsyncToolQueue.js`**
   - Tool execution queue
   - Worker pool management
   - Progress tracking

2. **`backend/src/services/ConversationManager.js`**
   - Active conversation tracking
   - Context preservation between autonomous messages
   - Message history management

3. **`backend/src/services/AutonomousMessageService.js`**
   - Trigger AI to generate messages without user input
   - Handle tool completion events
   - Manage autonomous conversation flow

#### Modified Files

1. **`backend/src/services/OrchestratorService.js`**
   - Lines 709-863: Tool execution loop
   - Add: Check if tool is async
   - Add: Queue async tools vs execute sync tools
   - Add: Continue conversation with "tool pending" status

2. **`backend/src/services/orchestrator/tools.js`**
   - Add: `executionMode` metadata to tool schemas
   - Add: Progress callback support
   - Modify: Tool execution to support callbacks

3. **`backend/src/utils/realtimeSync.js`**
   - Add: New events for autonomous messages
   - Add: `AUTONOMOUS_MESSAGE_START`
   - Add: `ASYNC_TOOL_PROGRESS`

4. **`frontend/src/store/modules/chat.js`**
   - Handle autonomous message events
   - Create new message bubbles for AI-initiated messages
   - Display async tool progress indicators

### Example: Dice Rolling for an Hour

```javascript
// User: "Roll dice every minute for an hour"

// 1. LLM calls tool:
{
  toolCallId: "call_abc123",
  function: {
    name: "roll_dice_periodically",
    arguments: {
      interval: 60000,      // 1 minute
      duration: 3600000,    // 1 hour
      diceCount: 2,
      sides: 6
    }
  }
}

// 2. Orchestrator detects async tool:
const toolSchema = getToolSchema("roll_dice_periodically");
if (toolSchema.executionMode === "async") {
  // Queue tool for background execution
  asyncToolQueue.enqueue(toolCallId, functionName, functionArgs, {
    conversationId,
    userId,
    progressCallback: (progress) => {
      // AI posts update to chat autonomously
      triggerAutonomousAIResponse(conversationId, {
        type: "tool_progress",
        toolCallId,
        progress
      });
    },
    completionCallback: (result) => {
      // AI posts final result to chat autonomously
      triggerAutonomousAIResponse(conversationId, {
        type: "tool_result_available",
        toolCallId,
        result
      });
    }
  });

  // 3. AI continues conversation immediately:
  return {
    tool_call_id: toolCallId,
    role: "tool",
    content: JSON.stringify({
      status: "queued",
      message: "Dice rolling started! I'll post results every minute.",
      estimatedCompletion: Date.now() + 3600000
    })
  };
}

// 4. Background worker executes:
async function executeDiceRollingTool(args, callbacks) {
  const totalRolls = args.duration / args.interval; // 60 rolls

  for (let i = 0; i < totalRolls; i++) {
    // Roll dice
    const roll = rollDice(args.diceCount, args.sides);

    // 🎯 Progress callback triggers autonomous AI message
    callbacks.progressCallback({
      rollNumber: i + 1,
      totalRolls,
      result: roll,
      timestamp: Date.now()
    });

    // Wait for next interval
    await sleep(args.interval);
  }

  // Final completion
  callbacks.completionCallback({
    success: true,
    totalRolls,
    summary: "Completed all 60 dice rolls over 1 hour"
  });
}

// 5. Every minute, AI autonomously posts:
// "🎲 Roll #1: ⚃ ⚅ = 9"
// "🎲 Roll #2: ⚁ ⚃ = 5"
// ... (user doesn't need to send any messages!)
```

### Benefits

✅ **Non-blocking** - User can continue chatting while tools run
✅ **Autonomous updates** - AI posts progress WITHOUT user interaction
✅ **Progress visibility** - See tool execution status in real-time
✅ **Backward compatible** - Sync tools work exactly as before
✅ **Scalable** - Multiple async tools can run concurrently
✅ **Cancellable** - User can stop long-running tools
✅ **Context preserved** - AI remembers what tools are running

### Challenges & Solutions

#### Challenge 1: **Conversation state management**
- **Problem:** Conversation ends when SSE response closes
- **Solution:** ConversationManager keeps context alive after response ends

#### Challenge 2: **Multiple autonomous messages**
- **Problem:** What if 3 tools complete at once?
- **Solution:** Queue autonomous messages, post sequentially with delays

#### Challenge 3: **User interruption**
- **Problem:** User sends new message while async tool runs
- **Solution:** Preserve async tool context across new user messages

#### Challenge 4: **Error handling**
- **Problem:** Async tool fails after AI already responded
- **Solution:** AI posts autonomous error message with recovery suggestions

### Migration Path

**Phase 1:** Infrastructure (Week 1)
- Create AsyncToolQueue
- Create ConversationManager
- Add autonomous message triggering

**Phase 2:** Tool Integration (Week 2)
- Mark existing tools as sync/async
- Add progress callback support
- Update tool execution in OrchestratorService

**Phase 3:** Frontend Updates (Week 3)
- Handle autonomous message events
- Display async tool progress UI
- Add tool cancellation controls

**Phase 4:** Testing & Polish (Week 4)
- Test with various async tools
- Handle edge cases (errors, cancellation, etc.)
- Performance optimization

### Open Questions

1. **Token limits:** How do we handle autonomous messages consuming user's tokens?
   - **Proposal:** Flag autonomous messages, optionally make them free

2. **Rate limiting:** What if a tool triggers 1000 autonomous messages?
   - **Proposal:** Throttle autonomous messages (max 1 per second)

3. **Conversation expiry:** How long do we keep conversation context alive?
   - **Proposal:** 24 hours after last user message, or until async tools complete

4. **Multi-tab sync:** What if user has multiple tabs open?
   - **Solution:** Already handled by Socket.IO broadcasting

---

**Conclusion:** This architecture enables true autonomous agent behavior where the AI can continue working and posting updates WITHOUT blocking or requiring user interaction. The dice rolling example becomes trivial - just queue the tool, let it run for an hour, and the AI autonomously posts each roll.
