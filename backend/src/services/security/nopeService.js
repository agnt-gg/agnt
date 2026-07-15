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
import SecurityPolicyService from './SecurityPolicyService.js';
import { resolveCredentialDecision, resolveViolationDecision } from './securityPolicy.js';

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

const recordSanitization = (mode) => (redactions, toolName) =>
  appendLog({
    type: mode === 'enforce' ? 'sanitize_enforce' : 'sanitize_report',
    toolName,
    // Labels and paths only; matched secret material is never logged.
    redactions: redactions.map((redaction) => ({ label: redaction.label, path: redaction.path })),
  });

// Shared DLP catalog used for returned output and pre-execution arguments.
// Provider-specific formats catch known keys; assignment/URL patterns catch
// future providers and ordinary TOKEN= / PASSWORD= / CLIENT_SECRET= values.
const COMMON_SECRET_PATTERNS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'OpenAI-compatible API key', severity: 'high' },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, label: 'Anthropic API key', severity: 'high' },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS access key', severity: 'critical' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'Google API key', severity: 'high' },
  { pattern: /\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, label: 'GitHub token', severity: 'high' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: 'GitLab token', severity: 'high' },
  { pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/g, label: 'Groq API key', severity: 'high' },
  { pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, label: 'Stripe key', severity: 'critical' },
  { pattern: /\br8_[A-Za-z0-9]{30,}\b/g, label: 'Replicate token', severity: 'high' },
  { pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,}\b/g, label: 'SendGrid key', severity: 'high' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: 'Slack token', severity: 'high' },
  { pattern: /\b(?:SK|AC)[0-9a-fA-F]{32}\b/g, label: 'Twilio credential', severity: 'high' },
  { pattern: /\b(?:npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})\b/g, label: 'Package or model registry token', severity: 'high' },
  { pattern: /\b(?:lin_api|vercel|shpat|shpua|shppa|shpss)_[A-Za-z0-9_-]{20,}\b/g, label: 'Service API token', severity: 'high' },
  { pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`]+/gi, label: 'Database connection string', severity: 'high' },
  { pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, label: 'Private key', severity: 'critical' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'JWT token', severity: 'high' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, label: 'Bearer token', severity: 'high' },
  { pattern: /\b[A-Za-z][A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|env[_-]?key)\s*[:=]\s*["']?[^\s,"'`;]{8,}/gi, label: 'Assigned secret', severity: 'high' },
];

export const resolvePolicyCredentialDecision = resolveCredentialDecision;

function detectCommonSecretViolations(value) {
  const findings = new Map();
  const inspect = (candidate, key = '') => {
    // Dedicated credential fields are intentional authentication inputs. They
    // are never copied into messages/body/content by the central wrapper.
    if (key === '__auth' || SENSITIVE_KEY.test(key)) return;
    if (Array.isArray(candidate)) return candidate.forEach((item) => inspect(item));
    if (candidate && typeof candidate === 'object') {
      return Object.entries(candidate).forEach(([childKey, childValue]) => inspect(childValue, childKey));
    }
    if (typeof candidate !== 'string') return;

    for (const { pattern, label, severity } of COMMON_SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(candidate)) findings.set(label, severity);
    }
  };
  inspect(value);
  return [...findings].map(([label, severity]) => ({
    rule: 'cred-api-key-leak',
    description: label,
    category: 'credentials',
    severity,
  }));
}

const nope = NOPE.preset('audit', {
  sanitizeMode: 'report',
  outputPatterns: COMMON_SECRET_PATTERNS,
  telemetry: { enabled: true, retention: '7d' },
  onSanitize: recordSanitization('report'),
});

// NOPE instances keep sanitizeMode internally, so redaction uses a dedicated
// sanitizer while rule checking continues through the singleton above.
const enforcingSanitizer = NOPE.preset('audit', {
  sanitizeMode: 'enforce',
  outputPatterns: COMMON_SECRET_PATTERNS,
  telemetry: { enabled: true, retention: '7d' },
  onSanitize: recordSanitization('enforce'),
});

// ── Enforcement policy ──────────────────────────────────────────────────────



// ── Param hygiene ───────────────────────────────────────────────────────────

const SENSITIVE_KEY = /token|secret|apikey|api_key|password|credential|authorization/i;

/**
 * Return a shallow copy of params with __auth and token-shaped keys removed.
 * Used before checking workflow-node params: NodeExecutor injects real OAuth
 * tokens as `__auth` (NodeExecutor.js:156), and credential-looking values
 * would false-positive the credentials rules on every authed plugin node.
 */
export function stripSensitiveParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;  const { __auth, ...checkable } = params;
  for (const key of Object.keys(checkable)) {
    if (SENSITIVE_KEY.test(key)) delete checkable[key];
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
const WORKFLOW_SECURITY_FIELDS = new Set([
  'command',
  'code',
  'query',
  'sql',
  'operation',
  'path',
  'filePath',
  'rootDirectory',
  'url',
  'method',
  'executable',
  'args',
  'host',
  'image',
  'volumes',
]);

/**
 * Select only fields that can influence an execution sink.
 *
 * Workflow parameter resolution can inline megabytes of user data into a code
 * template. Scanning that entire resolved blob as shell syntax creates false
 * positives and conflates data with executable intent. Code nodes therefore
 * scan the authored source template. Other nodes scan only resolved fields
 * that can select an operation, destination, executable, query, or path.
 */
export function selectWorkflowSecurityArgs(nodeType, authoredParams = {}, resolvedParams = {}) {
  const authored = stripSensitiveParams(authoredParams) || {};
  const resolved = stripSensitiveParams(resolvedParams) || {};

  if (nodeType === 'execute-javascript' || nodeType === 'execute-python') {
    return { code: typeof authored.code === 'string' ? authored.code : '' };
  }

  const selected = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (WORKFLOW_SECURITY_FIELDS.has(key)) selected[key] = value;
  }
  return selected;
}

export async function checkAction({ toolName, args, userId, role, surface, workflowPolicy }) {
  try {
    const { policy, revision, scope } = await SecurityPolicyService.getEffectivePolicy({ userId, workflowPolicy });
    const result = nope.check(
      { tool: toolName, params: args, command: args?.command, code: args?.code },
      { userId, role: role || 'user' }
    );

    const combinedViolations = [...result.violations, ...detectCommonSecretViolations(args)];
    const uniqueViolations = [...new Map(combinedViolations.map((violation) => [`${violation.rule}:${violation.description}`, violation])).values()];
    const evaluated = uniqueViolations.map((violation) => ({
      ...violation,
      ...resolveViolationDecision(violation, policy),
    }));
    const blocking = evaluated.filter((violation) => violation.decision === 'block');
    const blocked = blocking.length > 0;

    if (evaluated.length > 0) {
      const action = blocked ? 'blocked' : (evaluated.some((v) => v.decision === 'audit') ? 'audit' : 'allow');
      appendLog({
        type: 'check',
        surface,
        toolName,
        userId,
        role,
        action,
        policy: {
          mode: policy.mode,
          revision,
          scope,
          outputScanning: policy.outputScanning,
          credentials: resolveCredentialDecision(policy),
        },
        violations: evaluated.map(({ rule, severity, category, decision, source }) => ({ rule, severity, category, decision, source })),
      });
      if (userId) {
        try {
          broadcastToUser(
            userId,
            blocked ? RealtimeEvents.SECURITY_BLOCKED : RealtimeEvents.SECURITY_WARNED,
            {
              toolName,
              mode: action,
              policy: {
                mode: policy.mode,
                revision,
                scope,
                outputScanning: policy.outputScanning,
                credentials: resolveCredentialDecision(policy),
              },
              violations: evaluated,
            }
          );
        } catch {
          /* SSE failure must not affect the gate */
        }
      }
    }

    return {
      allowed: !blocked,
      audited: evaluated.some((v) => v.decision === 'audit'),
      violations: evaluated,
      blockedRules: blocking.map((v) => v.rule),
      policy: {
        mode: policy.mode,
        revision,
        scope,
        outputScanning: policy.outputScanning,
        credentials: resolveCredentialDecision(policy),
      },
    };
  } catch (err) {
    // Internal gate error (not a detected threat) — fail open so a bug in the
    // gate can never take down every tool call. Logged for review.
    appendLog({ type: 'gate_error', toolName, error: err.message });
    return {
      allowed: true,
      audited: false,
      violations: [],
      blockedRules: [],
      policy: { mode: 'balanced', revision: 0, scope: 'fallback', outputScanning: 'report', credentials: 'audit' },
    };
  }
}

// ── Output scan (report-only) ───────────────────────────────────────────────

/** Strings above this size are not scanned — perf ceiling for regex sweeps. */
const SCAN_CEILING = 2_000_000;

/**
 * Report-only output scan. NEVER mutates — always returns the original value.
 * JSON strings are parsed first so the scan sees individual fields (a 100-byte
 * secret inside a 500KB JSON envelope would otherwise hide behind the
 * sanitizer's own 64KB/base64 binary guard). */
export function sanitizeArguments(args, toolName, outputScanning = 'report', credentialDecision = 'audit') {
  if (outputScanning !== 'enforce' || credentialDecision === 'allow' || args === null || args === undefined) return args;

  // Credential-named fields are inputs a tool needs for authentication. They
  // stay intact; all other fields (message, body, content, query, etc.) are DLP
  // sanitized centrally before any native or plugin executor sees them.
  const sanitizeValue = (value, key = '') => {
    // Preserve explicit authentication channels so API/plugin calls still work.
    // Content-bearing fields remain fully scanned by the shared catalog.
    if (key === '__auth' || SENSITIVE_KEY.test(key)) return value;
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)]));
    }
    return enforcingSanitizer.sanitize(value, `${toolName}:arguments`);
  };

  try {
    return sanitizeValue(args);
  } catch {
    return args;
  }
}

export function scanOutput(result, toolName, outputScanning = 'report', credentialDecision = 'audit') {
  if (outputScanning === 'off' || credentialDecision === 'allow') return result;
  if (typeof result === 'string' && result.length >= SCAN_CEILING) return result;
  if (result === null || result === undefined) return result;

  try {
    let parsed = result;
    let parsedJson = false;
    if (typeof result === 'string') {
      try {
        parsed = JSON.parse(result);
        parsedJson = true;
      } catch {
        parsed = result;
      }
    }

    const sanitizer = outputScanning === 'enforce' ? enforcingSanitizer : nope;
    const scanned = sanitizer.sanitize(parsed, toolName);
    if (outputScanning !== 'enforce') return result;
    if (typeof result !== 'string') return scanned;
    return parsedJson ? JSON.stringify(scanned) : scanned;
  } catch {
    // Output scanning must never break tool execution.
    return result;
  }
}

// ── Reporting surface (consumed by Phase 2 SecurityRoutes) ──────────────────

export function securityReport() {
  return nope.report();
}

export function securityDashboard() {
  return nope.dashboard();
}

export { nope };
