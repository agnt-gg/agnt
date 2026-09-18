/**
 * The Jev tool-call gate: turn a proposed tool call into allow / confirm /
 * block, using a typed classification plus deterministic local evidence.
 *
 * Pure with respect to the filesystem — configuration and the question spec
 * are modules, not files read at import time. The only I/O is the HTTP call
 * in classifyState, which the caller can substitute.
 */
import { decide } from './decide.js';
import { canonicalPath, isNonPathToken } from './paths.js';
import { scanForSecrets } from './secretScan.js';
import { fingerprintArgs } from './fingerprint.js';
import { DEFAULTS, MODES, CONFIRM_POLICIES } from './defaults.js';
import { SPEC } from './questions.js';

/**
 * Built-in defaults, overridable per-process by the environment.
 *
 * `JEV_TOOL_GATE_MODE` and `JEV_TOOL_GATE_CONFIRM` are read here and nowhere
 * else. An unrecognised value is ignored rather than throwing: a typo in an
 * env var must not take the tool path down.
 */
export function loadConfig() {
  const envMode = String(process.env.JEV_TOOL_GATE_MODE || '').toLowerCase();
  const mode = MODES.includes(envMode) ? envMode : DEFAULTS.mode;
  const envConfirm = String(process.env.JEV_TOOL_GATE_CONFIRM || '').toLowerCase();
  const confirmPolicy = CONFIRM_POLICIES.includes(envConfirm)
    ? envConfirm
    : DEFAULTS.confirmPolicy;
  return { ...DEFAULTS, mode, confirmPolicy };
}

export function loadSpec() {
  return SPEC;
}

export function shouldGate(toolName, args = {}, gatedTools = loadConfig().gatedTools) {
  const name = String(toolName || "");
  const rule = gatedTools?.[name];
  if (rule === true) return true;
  if (Array.isArray(rule)) {
    const op = String(args.operation || "").toLowerCase();
    if (!op) return true;
    return rule.includes(op);
  }
  return false;
}

/**
 * `confirmPolicy` decides what enforce does with a `confirm`.
 *
 * Default is "proceed", and that default is load-bearing: there is no UI that
 * can ask the user mid-tool, so refusing a confirm is not "asking", it is a
 * silent denial. The soak measured 14.3% confirms — enforcing those would kill
 * one call in seven, including any opaque `sh script.sh` the model cannot read.
 * Set "refuse" only once a real pause path exists. `block` always refuses.
 */
export function applyMode(verdict, mode, confirmPolicy = "proceed") {
  const action = verdict?.action || "confirm";
  if (mode === "off") {
    return { proceed: true, applied: "off", would: action, verdict };
  }
  if (mode === "dry-run") {
    return { proceed: true, applied: "dry-run", would: action, verdict };
  }
  const confirmProceeds = action === "confirm" && confirmPolicy !== "refuse";
  return {
    proceed: action === "allow" || confirmProceeds,
    applied: "enforce",
    would: action,
    confirmPolicy,
    ...(confirmProceeds ? { confirmProceeded: true } : {}),
    verdict,
  };
}

/** Short reason the chat can show when Jev did not run. */
export function failOpenNotice(reason) {
  const r = String(reason || "unknown");
  let why = "TypeSafe/Jev did not respond";
  if (/402/.test(r)) why = "TypeSafe has no credits or payment failed (HTTP 402)";
  else if (/429/.test(r)) why = "TypeSafe rate-limited the request (HTTP 429)";
  else if (/401/.test(r)) why = "TypeSafe rejected the API key (HTTP 401)";
  else if (/5\d\d/.test(r)) why = `TypeSafe is down (HTTP ${r.match(/5\d\d/)?.[0]})`;
  else if (/timeout|Timeout/i.test(r)) why = "TypeSafe timed out";
  else if (/missing-key|not-connected|unreadable/.test(r)) why = "TypeSafe is not connected (no usable key)";
  else if (/empty-answers/.test(r)) why = "Jev returned no answers";
  else if (r.startsWith("typesafe-http-")) why = `TypeSafe returned HTTP ${r.replace("typesafe-http-", "")}`;
  return `Jev did not work: ${why}. The tool still ran; this was not a Jev allow. Tell the user that Jev did not run.`;
}

/** TypeSafe down / unpaid / no key must not stall tools — even in enforce. */
export function failOpen(reason, mode, extra = {}) {
  const { error, ...rest } = extra;
  const err = error || reason;
  return {
    proceed: true,
    applied: mode,
    would: "unavailable",
    verdict: { action: "unavailable", reasons: [reason] },
    failOpen: true,
    error: err,
    notice: failOpenNotice(err),
    ...rest,
  };
}

/**
 * Redacted fingerprint of the call, for the audit log.
 * Canonicalised first so equivalent path spellings share one hash, and
 * wrapped because a fingerprinting fault must never stall a tool.
 */
export function safeFingerprint(toolName, args, opts = {}) {
  try {
    return fingerprintArgs({ toolName, args: canonicalizeArgs(args || {}, opts) });
  } catch {
    return null;
  }
}

/** Log-safe evidence: paths and why, never content. */
export function summarizeEvidence(evidence) {
  if (!evidence) return null;
  return {
    scanned: evidence.scanned,
    hasRealSecret: evidence.hasRealSecret,
    allAbsent: evidence.allAbsent,
    egress: evidence.egress,
    secretPaths: (evidence.secretPaths || []).map((p) => `${p.why}:${p.path}`),
  };
}

export function redactArgs(args) {
  if (!args || typeof args !== "object") return args;
  const out = { ...args };
  for (const key of ["content", "code", "body", "html", "text"]) {
    if (typeof out[key] === "string" && out[key].length > 400) {
      out[key] = `${out[key].slice(0, 400)}…[truncated ${out[key].length} chars]`;
    }
  }
  return out;
}

export function looksLikePath(token) {
  const t = String(token || "");
  if (!t || t.startsWith("-")) return false;
  // A URL or git remote contains "/" but is not a file. Canonicalising one
  // corrupts it into a bogus local path before Jev ever sees it.
  if (isNonPathToken(t)) return false;
  return t.startsWith("~") || t.startsWith("$HOME") || t.startsWith("/") || t.includes("/");
}

/** A token wrapped in matching quotes: `"~/.ssh/config"`, `'/etc/hosts'`. */
const QUOTED_TOKEN = /^(["'])([\s\S]*)\1$/;

/**
 * Split a command into tokens and the whitespace between them, so rejoining
 * is lossless.
 *
 * Splitting on `/\S+/` instead cuts a quoted path IN HALF at its space:
 * `cat "/a dir/key"` became the three fragments `"/a`, `dir/key`, `key"`, each
 * canonicalised separately into a different absolute path. Quoting is exactly
 * what a caller does to a path containing a space, so that is the case most
 * likely to be quoted and was the case handled worst.
 *
 * An unterminated quote yields one long token, which simply fails to look like
 * a path and is returned unchanged.
 */
export function tokenizeCommand(command) {
  const parts = [];
  let buf = "";
  let quote = null;

  const flush = () => {
    if (buf) parts.push({ text: buf, isToken: true });
    buf = "";
  };

  for (const c of String(command)) {
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (/\s/.test(c)) {
      flush();
      parts.push({ text: c, isToken: false });
      continue;
    }
    buf += c;
  }
  flush();
  return parts;
}

/**
 * One token -> its canonical spelling.
 *
 * Two wrappers are peeled before the path is recognised, and both were bugs
 * when they were not:
 *
 *   QUOTES      `cat "~/.ssh/config"` — the token starts with `"`, so it is
 *               neither `~` nor absolute, but it does contain `/`, so it was
 *               treated as RELATIVE and became
 *               `<projectDir>/"~/.ssh/config"`. Jev was then asked about a
 *               path that exists nowhere. Quoting is the most ordinary thing
 *               a caller does to a path with a `~` or a space in it.
 *
 *   ASSIGNMENT  `KEYFILE=~/.ssh/config` — resolving the whole token produced
 *               `<projectDir>/KEYFILE=~/.ssh/config`, corrupting the
 *               fingerprint and hiding a real path from the scan.
 *
 * Both peel recursively, so `KEYFILE="~/.ssh/config"` works. Recursion
 * terminates because each peel strictly shortens the token.
 *
 * The quotes are RESTORED around the canonical path rather than dropped: this
 * string is shown to a reviewer in the audit preview and sent to the model as
 * the proposed command, and a path containing a space must stay quoted to
 * still read as one argument. `secretScan` unquotes independently, so the two
 * layers agree on the file without needing to agree on the spelling.
 */
export function canonicalizeToken(token, canonOpts = {}) {
  const raw = String(token);

  const quoted = QUOTED_TOKEN.exec(raw);
  if (quoted) {
    const [, quote, inner] = quoted;
    return `${quote}${canonicalizeToken(inner, canonOpts)}${quote}`;
  }

  const eq = raw.indexOf("=");
  if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) {
    const name = raw.slice(0, eq + 1);
    return name + canonicalizeToken(raw.slice(eq + 1), canonOpts);
  }

  return looksLikePath(raw) ? canonicalPath(raw, canonOpts) : raw;
}

/**
 * Classify-time only. Execution still uses the caller's original args.
 * Collapses ~, $HOME, //, and /./ so equivalent spellings are one string.
 */
export function canonicalizeArgs(args, opts = {}) {
  if (!args || typeof args !== "object") return args;
  const out = { ...args };
  const projectDir = opts.projectDir || out.directory || out.cwd || process.cwd();
  const home = opts.home;
  const canonOpts = home ? { home, projectDir } : { projectDir };
    if (typeof out.command === "string") {
      out.command = tokenizeCommand(out.command)
        .map((part) => (part.isToken ? canonicalizeToken(part.text, canonOpts) : part.text))
        .join("");
    }
  for (const key of ["path", "directory", "cwd", "dest", "destination", "from", "to"]) {
    if (typeof out[key] === "string" && looksLikePath(out[key])) {
      out[key] = canonicalPath(out[key], canonOpts);
    }
  }
  return out;
}

export function buildState({ toolName, args, userRequest, policy, home, projectDir }) {
  const redacted = redactArgs(args || {});
  const proposedArgs = canonicalizeArgs(redacted, { home, projectDir });
  return {
    user_request: userRequest || "",
    proposed: { tool: toolName, ...proposedArgs },
    policy: policy || loadConfig().policy,
  };
}

export async function classifyState(state, { key, spec, timeoutMs }) {
  const s = spec || loadSpec();
  const res = await fetch(s.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: s.model,
      state,
      questions: s.questions,
    }),
    signal: AbortSignal.timeout(timeoutMs || 12000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`typesafe-http-${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function assessToolCall({
  toolName,
  args,
  userRequest,
  key,
  mode,
  spec,
  config,
  classify = classifyState,
}) {
  const cfg = config || loadConfig();
  const usedMode = mode || cfg.mode;
  const s = spec || loadSpec();

  const fingerprint = safeFingerprint(toolName, args);

  if (usedMode === "off") {
    return { ...applyMode({ action: "allow", reasons: ["gate-off"] }, "off", cfg.confirmPolicy), fingerprint };
  }
  if (!shouldGate(toolName, args, cfg.gatedTools)) {
    return {
      proceed: true,
      applied: usedMode,
      would: "skip",
      verdict: { action: "skip", reasons: ["not-gated"] },
      fingerprint,
    };
  }

  // Deterministic and offline. Runs BEFORE the key check so proven secret
  // material still blocks when TypeSafe is down, unpaid, or not connected.
  let evidence = null;
  try {
    evidence = scanForSecrets(args || {}, {});
  } catch {
    evidence = null; // a scanner fault must never stall a tool
  }
  if (evidence?.hasRealSecret) {
    const verdict = decide(
      { reversibility: { type: "choice", choice: "read_only", confidence: 1 },
        exfiltrates_secrets: { noul: 1 }, user_explicitly_asked: { noul: 0 }, jailbreak_or_override: { noul: 0 } },
      s.thresholds,
      evidence,
    );
    return {
      ...applyMode(verdict, usedMode, cfg.confirmPolicy),
      model: "local-scan",
      evidence: summarizeEvidence(evidence),
      fingerprint,
    };
  }

  if (!key) {
    return failOpen("missing-key", usedMode, { evidence: summarizeEvidence(evidence), fingerprint });
  }

  try {
    const state = buildState({ toolName, args, userRequest, policy: cfg.policy });
    const result = await classify(state, { key, spec: s, timeoutMs: cfg.timeoutMs });
    if (!result?.answers || typeof result.answers !== "object" || !Object.keys(result.answers).length) {
      return failOpen("empty-answers", usedMode, {
        model: result?.model || null,
        usage: result?.usage || null,
        evidence: summarizeEvidence(evidence),
        fingerprint,
      });
    }
    const verdict = decide(result.answers, s.thresholds, evidence);
    return {
      ...applyMode(verdict, usedMode, cfg.confirmPolicy),
      model: result.model || null,
      usage: result.usage || null,
      answers: result.answers || null,
      evidence: summarizeEvidence(evidence),
      fingerprint,
    };
  } catch (e) {
    return failOpen(e.message || "classify-error", usedMode, {
      error: e.message || "classify-error",
      evidence: summarizeEvidence(evidence),
      fingerprint,
    });
  }
}
