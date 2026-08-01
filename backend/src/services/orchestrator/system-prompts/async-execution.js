/**
 * Async Tool Execution Guidance
 * Shared across all chat types (orchestrator, agents, workflows, goals).
 *
 * COMPRESSED 2026-07-31. This block was 1,259 tokens (~1,826 calibrated) to
 * describe six optional flags, and it shipped on every turn for any user with
 * async enabled. Most of that length was worked examples of the same JSON
 * object with different field values, which a model does not need spelled out
 * six ways.
 *
 * What survived the cut is only the material that is (a) not inferable from
 * the parameter names, or (b) a rule the model got WRONG in practice — the
 * dependency ordering, the sync-preview duplication, the buffered periodic
 * output, and the two-layer result status. Those stay because each one cost a
 * real failed turn at some point.
 */

export const ASYNC_EXECUTION_GUIDANCE = `
# Async & Periodic Tool Execution

Add these to ANY tool call to run it in the background. They work on every
tool, including ones whose schema does not list them:

- \`_executeAsync: true\` — run in background, return an execution ID now
- \`_interval: N\` — repeat every N SECONDS (requires _executeAsync)
- \`_stopAfter: N\` — stop after N iterations (requires _interval)
- \`_duration: N\` — stop after N MINUTES (requires _interval)
- \`_delayFirst: true\` — skip the immediate first run; wait one _interval. Use for "do this in N seconds"
- \`_estimatedMinutes: N\` — UI hint only, no scheduling effect

## Parallel vs sequential — the decision that matters
Does any task need another task's output?
- NO -> emit them as multiple tool calls in the SAME message, each with \`_executeAsync: true\`. They run concurrently. Maximize this.
- YES -> run SEQUENTIALLY, no async. An async call returns only an execution ID, so a later call referencing Task A's data gets undefined.

## Never preview an async result synchronously
If you queue a tool async, do NOT also call it synchronously in the same turn to
show the answer now — the user asked for it later. Acknowledge the queue and
stop; the follow-up message delivers the real result. Duplicate sync calls are
rejected by the orchestrator and produce double output.

## Periodic runs buffer their output
A task with \`_interval\` delivers NOTHING until the whole schedule completes,
then delivers every iteration at once. Say so when starting a long one, or the
user will think it is broken.

## Reading results
Two layers, check both: outer \`status: "completed"\` means it ran; inner
\`result.success\` means the operation itself worked (see \`result.error\`).

Attach these params to the real tool that does the work — never to a
placeholder timer/sleep tool. Tell the user when something starts in the
background and that they can stop it.
`;

export default ASYNC_EXECUTION_GUIDANCE;
