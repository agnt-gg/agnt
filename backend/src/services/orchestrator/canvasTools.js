// Canvas awareness tools — the agent's window into (and hands on) the One
// Canvas workspace page (/workspace).
//
// PULL, NOT PUSH. Nothing about the canvas is injected into the prompt; the
// agent calls these tools when the conversation makes the canvas relevant
// ("this workflow", "the traces window", "what's on my canvas?"). Tool
// PRESENCE is the awareness signal — the schemas live in the stable cached
// prefix, so unlike a per-turn manifest they never invalidate the prompt
// cache and cost nothing until called.
//
// TRANSPORT is a verbatim clone of the proven tutorial scan rail
// (tutorialTools.scan_page_elements):
//   executor → createPendingScan(requestId) → io.emit('canvas:request') to
//   the user's room → a browser tab answers via 'canvas:response' → server.js
//   resolves the pending promise. First response wins; 6s timeout is a
//   truthful "canvas not open in any tab", not a crash.
//
// READS (state/inspect): any tab may answer. Workspace state lives in
// localStorage, which every same-origin tab shares — the canvas does not need
// to be the visible screen to be known. Hidden tabs delay their response so a
// foreground tab wins when one exists.
//
// WRITES (open/close/move): ONLY the visible tab executes. Every tab in the
// room receives the request, and localStorage is shared — if hidden tabs also
// executed, one open_canvas_widget would add N widgets. Reads are idempotent;
// writes are not. No visible tab ⇒ timeout ⇒ honest error.
//
// NAMING: everything here says "canvas", never "workspace" —
// workspaceContext.js already means the user's file directory in the system
// prompt, and a second meaning of "workspace" would confuse the model before
// it confused anyone else.

import { randomUUID } from 'crypto';
import { createPendingScan, cancelPendingScan } from './tutorialScanRegistry.js';

const TIMEOUT_MS = 6000;

export function getCanvasToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_canvas_state',
        description:
          'Snapshot of the Workspaces page (/workspace): every workspace tab, and each open widget window with its instanceId, widget type, name, grid position/size, and any bound object (e.g. the workflow id a Workflow Forge window is editing). Call this FIRST whenever the user refers to their workspace, their canvas, or to things on them — "this workflow", "that traces window", "the widget on the right", "close that", "what am I looking at?". Cheap; answers from any open tab.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'inspect_canvas_widget',
        description:
          "Deep-read ONE widget window on the canvas: its visible text content and interactive elements, scoped to that window's DOM subtree. Use after get_canvas_state when you need what a window actually SHOWS — which trace is failing, what the goal board says, what a custom widget is displaying. Requires the canvas to be visible in a tab. Pass the instanceId from get_canvas_state.",
        parameters: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'The widget instanceId from get_canvas_state (e.g. "w_abc123").',
            },
          },
          required: ['instanceId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_canvas_widget',
        description:
          'Open a widget window on the Workspaces page — deliberately place a workflow editor, traces list, goals board, or any registry/custom widget next to the conversation. Optionally give a grid position. Only works while the user has the workspace visible in a tab.',
        parameters: {
          type: 'object',
          properties: {
            widgetId: {
              type: 'string',
              description:
                "Widget id: a built-in like 'traces', 'goals', 'workflow-forge', 'artifacts', 'memory', 'dashboard', or a custom widget id (cw_…). get_canvas_state lists what is already open.",
            },
            col: { type: 'integer', description: 'Optional grid column 0-11 to place at.' },
            row: { type: 'integer', description: 'Optional grid row 0-7 to place at.' },
          },
          required: ['widgetId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'close_canvas_widget',
        description:
          'Close one widget window on the Workspaces page by its instanceId (from get_canvas_state). Only works while the user has the workspace visible in a tab.',
        parameters: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'The instanceId of the window to close.' },
          },
          required: ['instanceId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_canvas_widget',
        description:
          'Move and/or resize one widget window on the workspace grid (12 columns × 8 rows). Provide the instanceId from get_canvas_state plus any of col/row/cols/rows. Only works while the user has the workspace visible in a tab.',
        parameters: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'The instanceId of the window to move/resize.' },
            col: { type: 'integer', description: 'New grid column (0-11).' },
            row: { type: 'integer', description: 'New grid row (0-7).' },
            cols: { type: 'integer', description: 'New width in columns (1-12).' },
            rows: { type: 'integer', description: 'New height in rows (1-8).' },
          },
          required: ['instanceId'],
        },
      },
    },
  ];
}

/** name → the action string the browser-side bridge dispatches on. */
const TOOL_ACTIONS = {
  get_canvas_state: 'state',
  inspect_canvas_widget: 'inspect',
  open_canvas_widget: 'open',
  close_canvas_widget: 'close',
  move_canvas_widget: 'move',
};

export function isCanvasTool(name) {
  return Object.prototype.hasOwnProperty.call(TOOL_ACTIONS, name);
}

export async function executeCanvasTool(functionName, args, authToken, context) {
  const action = TOOL_ACTIONS[functionName];
  if (!action) {
    return { success: false, error: `Unknown canvas tool: ${functionName}` };
  }

  const userId = context?.userId;
  if (!userId) {
    return { success: false, error: 'No userId in context — canvas access requires an authenticated user.' };
  }
  if (!global.io) {
    return { success: false, error: 'Socket.IO not initialized — cannot reach the canvas.' };
  }

  const requestId = `canvas-${randomUUID().slice(0, 8)}`;
  const pending = createPendingScan(requestId, TIMEOUT_MS);

  try {
    global.io.to(`user:${userId}`).emit('canvas:request', { requestId, action, args: args || {} });
    console.log(`[canvasTools] ${functionName} → ${requestId} for user ${userId}`);
  } catch (emitErr) {
    // cancelPendingScan REJECTS the pending promise; on this path nothing ever
    // awaits it, so without an attached catch that rejection surfaces as an
    // unhandled error long after this function returned.
    pending.catch(() => {});
    cancelPendingScan(requestId, 'emit_failed');
    return { success: false, error: `Failed to broadcast canvas request: ${emitErr.message}` };
  }

  try {
    const result = await pending;
    // The browser bridge returns a complete result object (success flag
    // included) so failure detail composed where the state lives survives the
    // trip intact.
    if (result && typeof result === 'object' && !Array.isArray(result)) return result;
    return { success: true, result };
  } catch (timeoutErr) {
    const readonly = action === 'state' || action === 'inspect';
    return {
      success: false,
      error: readonly
        ? 'No browser tab answered — the AGNT app does not appear to be open. The canvas can only be read while the app is running.'
        : 'No visible browser tab answered — workspace changes only apply while the user has the Workspaces page visible. Ask them to open /workspace.',
      detail: timeoutErr.message,
    };
  }
}
