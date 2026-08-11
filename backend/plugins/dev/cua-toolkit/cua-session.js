// cua-session.js — declare, inspect, escalate and end a driver SESSION.
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
import { asBool, resolveDriverPath, notInstalledResult, ensureReady, startSession, endSession, getSessionState, escalateSession, callTool } from './lib/driver.js';

const CURSOR_ACTIONS = new Set(['cursor_on', 'cursor_off', 'cursor_theme']);

class CuaSession {
  constructor() { this.name = 'cua-session'; }

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
            success: !o.refused,
            action, session,
            captureScope: j.capture_scope ?? captureScope,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            active: j.active === true,
            revived: j.revived === true,
            result: j,
            error: o.refused ? o.summary : null,
            hint: 'Pass this same session id to cua-observe / cua-input / cua-act so every call shares one cursor and one capture policy. Call action="end" when the run finishes — otherwise the idle TTL reclaims it and the cursor lingers.',
          };
        }

        case 'state': {
          const o = await getSessionState(session);
          const j = o.json || {};
          return {
            success: !o.refused,
            action, session,
            captureScope: j.capture_scope ?? null,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            escalationReason: j.escalation_reason ?? null,
            result: j,
            error: o.refused ? o.summary : null,
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
            success: !o.refused,
            action, session,
            effectiveScope: j.effective_scope ?? null,
            desktopUnlocked: j.desktop_unlocked === true,
            result: j,
            error: o.refused ? o.summary : null,
            hint: 'Desktop scope is now live: use cua-observe mode="desktop" and act with screen-absolute pixels. Window-scoped tools are disabled for this session — end it and start a new id to get them back.',
          };
        }

        case 'end': {
          const o = await endSession(session);
          return {
            success: !o.refused,
            action, session,
            active: o.json?.active === true,
            result: o.json,
            error: o.refused ? o.summary : null,
            hint: 'Cursor removed, recording stopped, per-session config cleared.',
          };
        }

        case 'cursor_on':
        case 'cursor_off': {
          const o = await callTool('set_agent_cursor_enabled', { session, enabled: action === 'cursor_on' }, { timeoutMs: 15000 });
          return { success: !o.refused, action, session, result: o.json, error: o.refused ? o.summary : null };
        }

        case 'cursor_theme': {
          if (!themeId) return { success: false, error: 'action="cursor_theme" requires themeId (a PREINSTALLED theme id — theme files and inline animation data are never accepted through an agent tool).' };
          const o = await callTool('set_agent_cursor_theme', { session, theme_id: themeId }, { timeoutMs: 15000 });
          return { success: !o.refused, action, session, themeId, result: o.json, error: o.refused ? o.summary : null };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: start, state, escalate, end, cursor_on, cursor_off, cursor_theme.` };
      }
    } catch (e) {
      return { success: false, action, session, error: e?.message || String(e) };
    }
  }
}

export default new CuaSession();
