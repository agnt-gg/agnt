// autonomousFollowupConfig.js — opt-in list of tools whose async completion
// should trigger an LLM-narrated follow-up message in the chat.
//
// BACKGROUND
// ----------
// When an async tool finishes, two things happen in parallel:
//
//   1. AsyncToolQueue broadcasts `chat:async_tool_completed` via SSE.
//      The frontend handler at frontend/src/store/features/chat.js
//      (SCOPED_UPDATE_TOOL_CALL_RESULT) updates the tool-call card on the
//      ORIGINAL assistant message in place. The user sees the result
//      attached where they'd expect it.
//
//   2. If the tool's onComplete callback is wired (see OrchestratorService
//      around the asyncToolQueue.enqueue call), AutonomousMessageService
//      synthesises a "system: tool completed" turn, re-invokes the LLM,
//      and streams the LLM's response as a BRAND-NEW assistant message.
//
// (2) is the autonomous follow-up — useful when the tool ran long enough
// that the original message scrolled out of view and the user would benefit
// from a fresh recap. Useless (and noisy) for tools where the result is
// self-explanatory and the originating message is still on screen.
//
// THIS FILE
// ---------
// This Set is the allowlist. A tool listed here keeps the autonomous
// follow-up. Any tool NOT listed gets only the in-place update on its
// existing tool card — no extra assistant message gets spawned.
//
// Default is empty: no tool spawns a follow-up. Add a tool name here only
// when the LLM's commentary on its result genuinely adds value (e.g.
// long-running research, multi-iteration background sweeps where the
// original turn has likely scrolled off-screen by the time results arrive).
//
// Matching is by exact function name (the `functionName` passed to the
// tool dispatcher). Plugin/MCP tool names work the same way.

export const AUTONOMOUS_FOLLOWUP_TOOLS = new Set([
  // Add tool names here when they need LLM-narrated follow-up on async
  // completion. Empty default = every async tool result simply attaches
  // to its originating tool-call card; no extra message is spawned.
]);

export function shouldTriggerAutonomousFollowup(functionName) {
  return AUTONOMOUS_FOLLOWUP_TOOLS.has(functionName);
}
