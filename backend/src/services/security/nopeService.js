/**
 * nopeService — the single security-gate singleton for AGNT (PRD-051).
 *
 * Wraps @agnt-gg/nope (published 2026-07-13) around the tool-execution
 * chokepoint. NOBODY else in the codebase imports @agnt-gg/nope directly —
 * every security-related touch goes through this module so the posture
 * (block set, thresholds, exemptions) lives in exactly one place.
 *
 * PHASE 1 POSTURE — BLOCK-CRITICAL + AUDIT-THE-REST:
 *   - CRITICAL-severity violations are BLOCKED from day 1. rm -rf, disk
 *     format/dd, DROP TABLE/TRUNCATE/DELETE-without-WHERE, shutdown,
 *     kill-all, firewall flush, curl|bash, reverse shells, secret-file
 *     exfil, cloud-metadata SSRF, host-root docker mounts DO NOT EXECUTE.
 *   - A small, explicit AUDIT_ONLY_RULES exemption list keeps critical rules
 *     that false-positive on AGNT's own documented patterns in audit mode
 *     (verified 2026-07-14: cred-env-file-send fires on the fetchJSON /
 *     AGNT_AUTH_TOKEN pattern every code tool uses; RFC1918 SSRF rules fire
 *     on legitimate home-lab / LAN automations).
 *   - Everything below critical (high/medium/low) is AUDIT ONLY in Phase 1:
 *     recorded + broadcast, never blocked. The soak window tunes these
 *     before Phase 2 tightens the threshold.
 *   - scanOutput() NEVER mutates tool results (sanitizeMode 'report').
 *   - The gate FAILS OPEN on internal errors only (a bug in the gate itself
 *     must not take down every tool call). A detected threat is never an
 *     "internal error" — detection either blocks or audits per the rules.
 *
 * Telemetry is durable: NOPE's report() is in-memory only, so every event is
 * also appended to %APPDATA%/AGNT/security-audit.jsonl — the soak survives
 * app restarts and the Phase 2 threshold decision reads from this file.
 */
import fs from 'fs';
import path from 'path';
import { NOPE } from '@agnt-gg/nope';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';
import pathManager from '../../utils/PathManager.js';

// ── Durable telemetry ───────────────────────────────────────────────────────

const LOG_DIR = pathManager.getRootDir();
export const AUDIT_LOG_PATH = path.join(LOG_DIR, 'security-audit.jsonl');

function appendLog(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    /* telemetry must never break execution */
  }
}

// ── The NOPE instance ───────────────────────────────────────────────────────

const nope = NOPE.preset('audit', {
  // 'report' = detect + telemetry, output returned UNMODIFIED (never redacts).
  // Output redaction flips on in Phase 2 after redaction telemetry review.
  sanitizeMode: 'report',
  telemetry: { enabled: true, retention: '7d' },
  onSanitize: (redactions, toolName) =>
    appendLog({
      type: 'sanitize_report',
      toolName,
      // labels + paths only — never log matched secret material
      redactions: redactions.map((r) => ({ label: r.label, path: r.path })),
    }),
});

// ── Enforcement policy ──────────────────────────────────────────────────────

/** Severities that BLOCK execution in Phase 1. Phase 2 adds 'high'. */
const BLOCKED_SEVERITIES = new Set(['critical']);

/**
 * Critical rules verified (2026-07-14) to false-positive on legitimate,
 * documented AGNT usage. These stay AUDIT-ONLY until the rules are tightened
 * upstream — every hit is still logged and broadcast for the soak review.
 *
 *  - cred-env-file-send: fires on AGNT's own fetchJSON pattern
 *    (fetch + process.env.AGNT_AUTH_TOKEN), which every code tool uses.
 *  - net-ssrf-private-*: home-lab / LAN automations legitimately target
 *    RFC1918 + link-local addresses (Home Assistant, NAS, printers).
 *    Cloud-metadata SSRF (net-ssrf-metadata) is NOT exempt — it blocks.
 */
const AUDIT_ONLY_RULES = new Set([
  'cred-env-file-send',
  'net-ssrf-private-10',
  'net-ssrf-private-172',
  'net-ssrf-private-192',
  'net-ssrf-ipv6-private',
]);

// ── Param hygiene ───────────────────────────────────────────────────────────

const SENSITIVE_KEY = /token|secret|apikey|api_key|password|credential|authorization/i;

/**
 * Return a shallow copy of params with __auth and token-shaped keys removed.
 * Used before checking workflow-node params: NodeExecutor injects real OAuth
 * tokens as `__auth` (NodeExecutor.js:156), and credential-looking values
 * would false-positive the credentials rules on every authed plugin node.
 */
export function stripSensitiveParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const { __auth, ...checkable } = params;
  for (const k of Object.keys(checkable)) {
    if (SENSITIVE_KEY.test(k)) delete checkable[k];
  }
  return checkable;
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Gate a tool action.
 *
 * PHASE 1 CONTRACT:
 *   - Critical violations (minus the verified-FP exemption list) return
 *     { allowed: false, blockedRules } — the caller MUST NOT execute.
 *   - Everything else returns { allowed: true } with violations recorded
 *     for the soak (wouldBlock marks what Phase 2 strict WOULD stop).
 *   - Fail-open ONLY on internal gate errors (never on detected threats).
 *
 * @param {object} opts
 * @param {string} opts.toolName  Tool being executed
 * @param {object} opts.args      Resolved arguments (strip secrets first for workflow params)
 * @param {string} [opts.userId]
 * @param {string} [opts.role]    'user' | 'agent' | 'goal' | 'workflow'
 * @param {string} [opts.surface] 'orchestrator' | 'workflow'
 * @returns {{ allowed: boolean, audited: boolean, violations: Array, blockedRules: string[] }}
 */
export function checkAction({ toolName, args, userId, role, surface }) {
  try {
    const result = nope.check(
      { tool: toolName, params: args, command: args?.command, code: args?.code },
      { userId, role: role || 'user' }
    );

    const blocking = result.violations.filter(
      (v) => BLOCKED_SEVERITIES.has(v.severity) && !AUDIT_ONLY_RULES.has(v.rule)
    );
    const blocked = blocking.length > 0;

    if (result.violations.length > 0) {
      const wouldBlock =
        blocked ||
        result.violations.some((v) => v.severity === 'critical' || v.severity === 'high');
      appendLog({
        type: 'check',
        surface,
        toolName,
        userId,
        role,
        action: blocked ? 'blocked' : 'audit',
        wouldBlock,
        violations: result.violations.map((v) => ({ rule: v.rule, severity: v.severity })),
      });
      if (userId) {
        try {
          broadcastToUser(
            userId,
            blocked ? RealtimeEvents.SECURITY_BLOCKED : RealtimeEvents.SECURITY_WARNED,
            {
              toolName,
              mode: blocked ? 'blocked' : 'audit',
              wouldBlock,
              violations: result.violations,
            }
          );
        } catch {
          /* SSE failure must not affect the gate */
        }
      }
    }

    return {
      allowed: !blocked,
      audited: true,
      violations: result.violations,
      blockedRules: blocking.map((v) => v.rule),
    };
  } catch (err) {
    // Internal gate error (not a detected threat) — fail open so a bug in the
    // gate can never take down every tool call. Logged for review.
    appendLog({ type: 'gate_error', toolName, error: err.message });
    return { allowed: true, audited: false, violations: [], blockedRules: [] };
  }
}

// ── Output scan (report-only) ───────────────────────────────────────────────

/** Strings above this size are not scanned — perf ceiling for regex sweeps. */
const SCAN_CEILING = 2_000_000;

/**
 * Report-only output scan. NEVER mutates — always returns the original value.
 * JSON strings are parsed first so the scan sees individual fields (a 100-byte
 * secret inside a 500KB JSON envelope would otherwise hide behind the
 * sanitizer's own 64KB/base64 binary guard).
 */
export function scanOutput(result, toolName) {
  try {
    if (typeof result === 'string' && result.length < SCAN_CEILING) {
      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch {
        parsed = result;
      }
      nope.sanitize(parsed, toolName); // report mode: telemetry only, input returned untouched
    }
  } catch {
    /* never throw from telemetry */
  }
  return result; // ALWAYS the original in Phase 1
}

// ── Reporting surface (consumed by Phase 2 SecurityRoutes) ──────────────────

export function securityReport() {
  return nope.report();
}

export function securityDashboard() {
  return nope.dashboard();
}

export { nope };
