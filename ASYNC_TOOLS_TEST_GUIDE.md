# Async Tools Testing Guide

## 🎉 Implementation Complete!

All async tool functionality has been implemented. Here's how to test it:

## What Was Built

### Backend Services
1. **AsyncToolQueue** - Manages background tool execution with progress tracking
2. **ConversationManager** - Keeps conversation contexts alive for autonomous messages
3. **AutonomousMessageService** - Triggers AI responses without user input
4. **Async Tool System** - Modified OrchestratorService to detect and queue async tools

### Example Async Tool
- **roll_dice_periodically** - Rolls dice at intervals for a specified duration
  - Supports: progress updates, customizable dice count, sides, interval, and duration

### Frontend Updates
- Real-time event handlers for autonomous messages
- Socket.IO listeners for async tool progress
- Chat store updates to display AI-initiated messages

## How to Test

### 1. Start the Application

```bash
# Terminal 1: Start backend
npm start

# Terminal 2: Start frontend dev server (if not running)
cd frontend && npm run dev
```

### 2. Test Async Dice Roller

Open the AGNT app and chat with the orchestrator. Try these prompts:

**Short Test (2 minutes):**
```
Can you roll 2 dice every 10 seconds for 2 minutes? Show me each roll in chat.
```

**Hour-Long Test (original requirement):**
```
Hey can you roll dice every minute for the next hour?
You MUST show me the dice here in chat each minute autonomously.
```

## What Should Happen

### Immediate Response
1. AI responds: "I've started the dice roller in the background! You'll see updates every [interval]."
2. Tool is queued (you'll see async_tool_queued event in console)

### During Execution
1. **Every interval** (minute/10 seconds), the AI autonomously posts a message like:
   ```
   🎲 Roll #5: ⚃ ⚅ = 9
   ```
2. These messages appear **without you sending anything** - that's the key!
3. Check browser console for `[Realtime]` logs showing autonomous messages

### After Completion
1. AI posts a final summary message autonomously
2. Shows statistics (highest, lowest, average rolls)

## Expected Console Logs

### Backend Logs:
```
[AsyncToolQueue] Queued async tool: roll_dice_periodically
[AsyncToolQueue] Started async tool: roll_dice_periodically
[AsyncTool:DiceRoller] Starting: 60 rolls over 60 minutes
[AsyncTool:DiceRoller] Roll 1/60: 3, 5 = 8
[AutonomousMessage] Triggering autonomous message for tool progress
[AutonomousMessage] Generating autonomous response for conversation abc123
```

### Frontend Console Logs:
```
[Realtime] Async tool queued: roll_dice_periodically
[Realtime] Autonomous message started
[Realtime] Autonomous content delta: 🎲
[Realtime Chat] Processing event: autonomous_message_start
```

## Advanced Testing

### Test Multiple Async Tools
Start multiple dice rollers with different intervals:
```
Roll 2d6 every 30 seconds for 5 minutes
Also roll 3d8 every minute for 10 minutes
```

Both should report progress autonomously and independently.

### Test Tab Sync
1. Open AGNT in two browser tabs
2. Start async dice roller in Tab 1
3. Switch to Tab 2 - you should see autonomous messages appearing there too!
4. This proves real-time sync works

### Test During Long Duration
1. Start the 1-hour dice roller
2. Close the chat/navigate away
3. Come back later - the tool should still be running
4. AI should continue posting updates when you return

## Architecture Verification

### Key Files to Inspect:
- `backend/src/services/AsyncToolQueue.js` - Queue management
- `backend/src/services/ConversationManager.js` - Context preservation
- `backend/src/services/AutonomousMessageService.js` - AI triggering
- `backend/src/services/OrchestratorService.js` - Lines ~772-830 (async tool detection)
- `backend/src/services/orchestrator/asyncTools.js` - Example async tool
- `frontend/src/composables/useRealtimeSync.js` - Socket.IO events
- `frontend/src/store/features/chat.js` - Event handlers

## Troubleshooting

### Async Tool Not Starting
- Check console for `[AsyncToolQueue]` logs
- Verify tool schema is loaded: Call `getAvailableToolSchemas()` and check for `roll_dice_periodically`

### No Autonomous Messages
- Check `[AutonomousMessage]` logs in backend
- Verify conversation context is stored: Look for `[ConversationManager] Stored context`
- Check Socket.IO connection: Frontend console should show `[Realtime] Connected to server`

### Messages Not Appearing in Frontend
- Check browser console for `[Realtime Chat]` logs
- Verify `autonomous_message_start` events are received
- Check Vuex state: Open Vue DevTools → Vuex → chat module

## Next Steps

### Create More Async Tools
Use `roll_dice_periodically` as a template:

```javascript
// In backend/src/services/orchestrator/asyncTools.js
export async function my_long_task(args, onProgress) {
  // Your long-running logic here
  for (let i = 0; i < 10; i++) {
    // Do work
    const result = doSomeWork(i);

    // Report progress (triggers autonomous AI message)
    if (onProgress) {
      onProgress({ step: i, result });
    }

    // Wait before next iteration
    await sleep(60000); // 1 minute
  }

  return { success: true, completed: 10 };
}

export const ASYNC_TOOLS = {
  my_long_task: {
    schema: { /* OpenAI function schema */ },
    executionMode: 'async',
    supportsProgressUpdates: true,
    execute: my_long_task,
  },
  // ... existing tools
};
```

## Success Criteria

✅ Dice rolls appear in chat every minute WITHOUT user interaction
✅ AI messages are autonomous (no manual trigger needed)
✅ Progress is tracked and reported in real-time
✅ Final summary appears when dice rolling completes
✅ Works across multiple browser tabs (real-time sync)
✅ Conversation context preserved throughout execution

---

**Ready to test! Try it out and let me know how it goes!** 🚀
