// computer-session.js — declare, inspect, escalate and end a driver SESSION.
//
// WHY THIS TOOL EXISTS (the "computer-use 2.0" headline).
// A session is a named, colour-coded identity for one agent run. Declaring it
// buys two things that anonymous calls do not get:
//
//   1. THE AGENT CURSOR. The driver paints its OWN cursor overlay in the
//      session's colour and glides it to each target. The physical pointer is
//      NEVER moved and focus is never stolen — you can watch the agent work
//      while you keep typing. Anonymous actions run cursor-less: they still
//      don't touch your mouse, they just give you nothing to watch.
//
//   2. A CAPTURE POLICY. capture_scope=auto begins window-only; desktop-wide
//      perception (get_desktop_state) and screen-absolute actions stay LOCKED
//      until the window ladder is exhausted and `escalate` is called
//      explicitly. Measured: get_desktop_state under a fresh auto session
//      returns { code: "desktop_escalation_required" }, exit 0.
//
// ESCALATION IS PERMANENT AND ONE-WAY. Once a session is escalated to desktop
// scope, window-scoped tools stay disabled for that session id for good — the
// only way back is end + start with a NEW id. That is the driver's design, not
// a limitation we added, and it is why `escalate` is gated behind confirm.
import BaseAction from '../BaseAction.js';
import { asBool, resolveDriverPath, notInstalledResult, ensureReady, startSession, endSession, getSessionState, escalateSession, callTool } from '../../../services/computerUse/driver.js';

const CURSOR_ACTIONS = new Set(['cursor_on', 'cursor_off', 'cursor_theme']);

class ComputerSession extends BaseAction {
  static schema = {
    "title": "Computer Session (Agent Cursor & Capture Scope)",
    "category": "utility",
    "type": "computer-session",
    "icon": "user",
    "description": "Declare a named session for one agent run. This is what gives the run its OWN colour-coded cursor overlay — the driver animates that overlay to each target while your physical mouse never moves — and its capture policy. capture_scope=auto starts window-only and keeps desktop-wide capture LOCKED until you escalate explicitly. Escalation is PERMANENT for that session id. the observe → input → verify loop manages a session automatically; use this tool when you are driving with computer-input by hand and want the cursor and one consistent policy across calls.",
    "parameters": {
      "action": {
        "type": "string",
        "inputType": "select",
        "required": true,
        "options": [
          "start",
          "state",
          "escalate",
          "end",
          "cursor_on",
          "cursor_off",
          "cursor_theme"
        ],
        "default": "start",
        "description": "start=declare (idempotent; refreshes idle TTL); state=read capture policy and effective scope; escalate=unlock desktop scope PERMANENTLY for this id (confirm=true); end=remove cursor, stop recording, clear per-session config; cursor_on/cursor_off=toggle the overlay; cursor_theme=select a preinstalled theme."
      },
      "session": {
        "type": "string",
        "inputType": "text",
        "required": true,
        "description": "Stable id for this run, e.g. \"invoice-run-1\". The cursor colour is derived from it, so concurrent runs must use different ids to stay visually distinct."
      },
      "captureScope": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "auto",
          "window",
          "desktop"
        ],
        "default": "auto",
        "description": "action=start only, and IMMUTABLE for the life of the session. auto=window-only until you escalate (recommended); window=strict window-only forever; desktop=full-screen capture from the outset."
      },
      "reason": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "ax_tree_pixel_mismatch",
          "background_delivery_failed",
          "foreground_ineffective",
          "no_window_target",
          "other"
        ],
        "default": "other",
        "description": "action=escalate only. Why the window ladder was insufficient."
      },
      "detail": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "action=escalate only. Short diagnostic note (max 200 chars). Never put secrets or page content here."
      },
      "themeId": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Preinstalled cursor theme id (action=cursor_theme, or an initial theme on start). Theme files and inline animation data are never accepted through an agent tool."
      },
      "confirm": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "false",
          "true"
        ],
        "default": "false",
        "description": "Required true for action=escalate, because escalation permanently disables every window-scoped tool for that session id."
      }
    },
    "outputs": {
      "success": {
        "type": "boolean",
        "description": "True when the session operation succeeded."
      },
      "action": {
        "type": "string",
        "description": "Echoed action."
      },
      "session": {
        "type": "string",
        "description": "Echoed session id."
      },
      "captureScope": {
        "type": "string",
        "description": "Declared capture policy (auto | window | desktop)."
      },
      "effectiveScope": {
        "type": "string",
        "description": "Scope actually in force right now — 'window' until an auto session is escalated."
      },
      "desktopUnlocked": {
        "type": "boolean",
        "description": "Whether desktop-wide capture and screen-absolute actions are permitted."
      },
      "escalationReason": {
        "type": "string",
        "description": "Recorded reason if this session was escalated."
      },
      "active": {
        "type": "boolean",
        "description": "Whether the session is live."
      },
      "revived": {
        "type": "boolean",
        "description": "True when start re-attached to an existing session rather than creating one."
      },
      "themeId": {
        "type": "string",
        "description": "Cursor theme applied."
      },
      "result": {
        "type": "object",
        "description": "Raw driver response."
      },
      "hint": {
        "type": "string",
        "description": "Next-step guidance."
      },
      "error": {
        "type": "string",
        "description": "Error message when success=false."
      }
    }
  };

  constructor() { super('computer-session'); }

  async execute(params) {
    const action = String(params?.action || 'start').toLowerCase();
    const session = String(params?.session || '').trim();
    const captureScope = ['auto', 'window', 'desktop'].includes(String(params?.captureScope)) ? String(params.captureScope) : 'auto';
    const reason = String(params?.reason || 'other').trim();
    const detail = String(params?.detail || '').trim() || null;
    const themeId = String(params?.themeId || '').trim() || null;
    const confirm = asBool(params?.confirm);

    if (!session) {
      return { success: false, error: 'session is required — a stable id for this run, e.g. "invoice-run-1". Concurrent runs must use different ids so each gets its own cursor.' };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    try {
      switch (action) {
        case 'start': {
          const o = await startSession(session, { captureScope, cursorThemeId: themeId });
          const j = o.json || {};
          return {
            success: o.ok,
            action, session,
            captureScope: j.capture_scope ?? captureScope,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            active: j.active === true,
            revived: j.revived === true,
            result: j,
            error: o.ok ? null : o.summary,
            hint: 'Pass this same session id to computer-observe / computer-input / the observe → input → verify loop so every call shares one cursor and one capture policy. Call action="end" when the run finishes — otherwise the idle TTL reclaims it and the cursor lingers.',
          };
        }

        case 'state': {
          const o = await getSessionState(session);
          const j = o.json || {};
          return {
            success: o.ok,
            action, session,
            captureScope: j.capture_scope ?? null,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            escalationReason: j.escalation_reason ?? null,
            result: j,
            error: o.ok ? null : o.summary,
          };
        }

        case 'escalate': {
          if (!confirm) {
            return {
              success: false, action, session,
              error: 'Escalation is PERMANENT for this session id — it unlocks desktop-wide capture and disables every window-scoped tool for the rest of the run. Pass confirm=true if that is what you want.',
            };
          }
          const o = await escalateSession(session, reason, detail);
          const j = o.json || {};
          return {
            success: o.ok,
            action, session,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            result: j,
            error: o.ok ? null : o.summary,
            hint: 'Desktop scope is now live: use computer-observe mode="desktop" and act with screen-absolute pixels. Window-scoped tools are disabled for this session — end it and start a new id to get them back.',
          };
        }

        case 'end': {
          const o = await endSession(session);
          return {
            success: o.ok,
            action, session,
            active: o.json?.active === true,
            result: o.json,
            error: o.ok ? null : o.summary,
            hint: 'Cursor removed, recording stopped, per-session config cleared.',
          };
        }

        case 'cursor_on':
        case 'cursor_off': {
          const o = await callTool('set_agent_cursor_enabled', { session, enabled: action === 'cursor_on' }, { timeoutMs: 15000 });
          return { success: o.ok, action, session, result: o.json, error: o.ok ? null : o.summary };
        }

        case 'cursor_theme': {
          if (!themeId) return { success: false, error: 'action="cursor_theme" requires themeId (a PREINSTALLED theme id — theme files and inline animation data are never accepted through an agent tool).' };
          const o = await callTool('set_agent_cursor_theme', { session, theme_id: themeId }, { timeoutMs: 15000 });
          return { success: o.ok, action, session, themeId, result: o.json, error: o.ok ? null : o.summary };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: start, state, escalate, end, cursor_on, cursor_off, cursor_theme.` };
      }
    } catch (e) {
      return { success: false, action, session, error: e?.message || String(e) };
    }
  }
}

export default new ComputerSession();
