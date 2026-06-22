import { randomUUID } from 'crypto';
import { TOUR_TARGETS_BY_ID, listTargets, resolveTargetIdToSelector } from './tutorialTargets.js';
import { createPendingScan, cancelPendingScan } from './tutorialScanRegistry.js';

export function getTutorialToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_tutorial_targets',
        description: 'Return ONLY the small curated registry of pre-tagged elements with stable named ids (e.g. "sidebar.workflows"). This is a hand-maintained list of ~10-20 entries — NOT a full inventory of what is on the page. Use this only when you want a friendly named id like "sidebar.workflows" for a polished, repeatable tour. For "what is on this page right now?" / "show me everything I can click" / any open-ended discovery, call scan_page_elements instead — it returns the LIVE DOM with every visible button, link, and input, no tagging required.',
        parameters: {
          type: 'object',
          properties: {
            screen: {
              type: 'string',
              description: 'Optional screen name to filter (e.g. "WorkflowsScreen", "AgentsScreen", "DashboardScreen"). Omit to list every registered target.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'highlight_element',
        description: 'Briefly point at a single UI element with a tooltip — use this inline during chat instead of writing "click the button in the top-right corner". For a multi-step walkthrough, use start_guided_tour instead.',
        parameters: {
          type: 'object',
          properties: {
            targetTourId: { type: 'string', description: 'The id from list_tutorial_targets (preferred).' },
            targetSelector: { type: 'string', description: 'Raw CSS selector. Only use if no targetTourId fits.' },
            title: { type: 'string', description: 'Short label shown in the popup.' },
            content: { type: 'string', description: 'One-line explanation.' },
            position: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'center'], description: 'Popup placement relative to the target. Defaults to "bottom".' },
            autoDismissMs: { type: 'integer', description: 'Auto-close after N ms. Omit to require user dismissal.' },
          },
          required: ['title', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_guided_tour',
        description: 'Run a multi-step interactive tour. Each step highlights one element with a tooltip; steps can navigate routes, wait for clicks, or auto-advance. Prefer this over long text instructions when the user asks "how do I…".',
        parameters: {
          type: 'object',
          properties: {
            tourId: { type: 'string', description: 'Stable id used for localStorage tracking and dedupe. Use a slug like "intro-to-workflows".' },
            title: { type: 'string', description: 'Short label for the tour itself (shown in logs / consent prompt).' },
            steps: {
              type: 'array',
              description: 'Ordered list of tour steps.',
              items: {
                type: 'object',
                properties: {
                  targetTourId: { type: 'string', description: 'Preferred. From list_tutorial_targets.' },
                  targetSelector: { type: 'string', description: 'Raw CSS selector escape hatch.' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  position: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'center'], description: 'Popup placement. Defaults to "bottom".' },
                  route: { type: 'string', description: 'SPA route to navigate to BEFORE rendering this step.' },
                  action: { type: 'string', enum: ['highlight', 'simulateClick', 'waitForClick'], description: 'What the popup does at this step. Defaults to "highlight".' },
                  autoAdvanceMs: { type: 'integer', description: 'Auto-advance to the next step after N ms.' },
                  enforce: { type: 'boolean', description: 'If true, the tour halts (not skips) when this target is missing.' },
                  mediaUrl: { type: 'string', description: 'Optional GIF/video URL to show inside the popup.' },
                  narration: { type: 'string', description: 'Optional TTS text. Frontend may speak this while the highlight shows.' },
                },
                required: ['title', 'content'],
              },
            },
          },
          required: ['tourId', 'steps'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scan_page_elements',
        description: 'PREFERRED tool for discovering what is on the user\'s current page. Takes a live DOM snapshot and returns every visible interactive element (buttons, links, inputs, anything with role="button" or data-tour-id) ordered top-to-bottom. ALWAYS call this — not list_tutorial_targets — when the user says things like "what is on this page", "discover what is available", "show me everything I can click", "give me a tour of this page", or before any open-ended highlight/tour where you do not already know exact named targets. Returns up to 200 elements as { text, tag, role, tourId, selector, bbox }. Pass each element\'s `selector` value directly as `targetSelector` to highlight_element or start_guided_tour — no further lookup needed. Times out after ~6s if no client tab responds.',
        parameters: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Optional case-insensitive substring filter against element text. e.g. "workflow" returns only elements whose visible label contains "workflow".',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'end_guided_tour',
        description: 'Force-close any active guided tour. Use when the user says "stop the tour" or after a navigation that obsoletes the current tour.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Why the tour is ending (for logs).' },
          },
        },
      },
    },
  ];
}

// Validates one step's target and produces the resolved selector + safeToSimulate hint.
function resolveStepTarget(step) {
  if (step.targetTourId) {
    const meta = TOUR_TARGETS_BY_ID[step.targetTourId];
    if (!meta) {
      return { error: `Unknown targetTourId "${step.targetTourId}". Call list_tutorial_targets to see valid ids.` };
    }
    const selector = resolveTargetIdToSelector(step.targetTourId);
    return { selector, safeToSimulate: meta.safeToSimulate, screen: meta.screen };
  }
  if (step.targetSelector) {
    return { selector: step.targetSelector, safeToSimulate: false, screen: null };
  }
  if (step.position === 'center') {
    return { selector: null, safeToSimulate: false };
  }
  return { error: 'Step is missing both targetTourId and targetSelector.' };
}

export async function executeTutorialTool(functionName, args, authToken, context) {
  console.log(`[tutorialTools] ${functionName} called with`, JSON.stringify(args).slice(0, 500), `userId=${context?.userId || '∅'}`);
  switch (functionName) {
    case 'list_tutorial_targets': {
      const items = listTargets(args?.screen);
      return {
        success: true,
        count: items.length,
        targets: items,
        hint: 'Use the `id` field as targetTourId in highlight_element or start_guided_tour steps.',
      };
    }

    case 'highlight_element': {
      const resolved = resolveStepTarget(args || {});
      if (resolved.error) return { success: false, error: resolved.error };

      const step = {
        targetSelector: resolved.selector,
        title: args.title,
        content: args.content,
        position: args.position || 'bottom',
        action: 'highlight',
        autoAdvanceMs: args.autoDismissMs,
      };

      const highlightResult = {
        success: true,
        message: `Highlighting "${args.title}"`,
        // Picked up by chatUnified.js → AIGuidedTourHost via window event.
        frontendEvents: [
          {
            type: 'tutorial:start',
            data: {
              tourId: `highlight-${randomUUID().slice(0, 8)}`,
              mode: 'pointTo',
              steps: [step],
            },
          },
        ],
      };
      console.log('[tutorialTools] highlight_element emitting frontendEvent', JSON.stringify(highlightResult.frontendEvents).slice(0, 300));
      return highlightResult;
    }

    case 'start_guided_tour': {
      const resolvedSteps = [];
      const errors = [];

      const rawSteps = Array.isArray(args?.steps) ? args.steps : [];
      for (let i = 0; i < rawSteps.length; i++) {
        const raw = rawSteps[i];
        const resolved = resolveStepTarget(raw);
        if (resolved.error) {
          errors.push({ index: i, error: resolved.error });
          continue;
        }
        // Reject simulateClick on unsafe targets — registry decides, not the LLM.
        let action = raw.action || 'highlight';
        if (action === 'simulateClick' && resolved.safeToSimulate === false) {
          action = 'waitForClick';
        }
        resolvedSteps.push({
          targetSelector: resolved.selector,
          title: raw.title,
          content: raw.content,
          position: raw.position || 'bottom',
          route: raw.route,
          action,
          autoAdvanceMs: raw.autoAdvanceMs,
          enforce: raw.enforce === true,
          mediaUrl: raw.mediaUrl,
          narration: raw.narration,
        });
      }

      if (resolvedSteps.length === 0) {
        return { success: false, error: 'No valid steps after target resolution.', errors };
      }

      return {
        success: true,
        tourId: args.tourId,
        stepCount: resolvedSteps.length,
        skippedSteps: errors,
        message: `Started tour "${args.tourId}" with ${resolvedSteps.length} step(s).`,
        frontendEvents: [
          {
            type: 'tutorial:start',
            data: {
              tourId: args.tourId,
              mode: 'tour',
              title: args.title,
              steps: resolvedSteps,
            },
          },
        ],
      };
    }

    case 'scan_page_elements': {
      const userId = context?.userId;
      if (!userId) {
        return { success: false, error: 'No userId in context — page scan requires an authenticated user.' };
      }
      if (!global.io) {
        return { success: false, error: 'Socket.IO not initialized — cannot request page scan.' };
      }

      const requestId = `scan-${randomUUID().slice(0, 8)}`;
      const filter = (args && typeof args.filter === 'string') ? args.filter : null;
      const TIMEOUT_MS = 6000;

      const pending = createPendingScan(requestId, TIMEOUT_MS);

      try {
        global.io.to(`user:${userId}`).emit('tutorial:scan_request', { requestId, filter });
        console.log(`[tutorialTools] scan_page_elements requested ${requestId} for user ${userId} (filter=${filter || '∅'})`);
      } catch (emitErr) {
        cancelPendingScan(requestId, 'emit_failed');
        return { success: false, error: `Failed to broadcast scan request: ${emitErr.message}` };
      }

      try {
        const elements = await pending;
        console.log(`[tutorialTools] scan_page_elements ${requestId} resolved with ${elements.length} elements`);
        return {
          success: true,
          count: elements.length,
          elements,
          hint: 'Pass an element\'s `selector` value as `targetSelector` to highlight_element or start_guided_tour step.',
        };
      } catch (waitErr) {
        return { success: false, error: waitErr.message };
      }
    }

    case 'end_guided_tour': {
      return {
        success: true,
        message: `Tour ended: ${args?.reason || 'requested by assistant'}`,
        frontendEvents: [
          { type: 'tutorial:end', data: { reason: args?.reason || 'assistant_request' } },
        ],
      };
    }

    default:
      return { success: false, error: `Unknown tutorial tool: ${functionName}` };
  }
}
