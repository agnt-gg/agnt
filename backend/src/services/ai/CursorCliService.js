/**
 * CursorCliService — local wrapper around the Cursor Agent CLI (`cursor-agent`).
 *
 * Auth: reuses the CLI's own login (`cursor-agent login`, session in ~/.cursor).
 *       We NEVER reimplement Cursor OAuth — the CLI owns the network + creds.
 *
 * Headless invocation:
 *   cursor-agent -p --output-format json --force --model <m> "<prompt>"
 *
 * IMPORTANT QUIRK (confirmed 2026-07): `cursor-agent -p` frequently DOES NOT EXIT
 * after emitting its final result line (Cursor forum: "print mode hangs
 * indefinitely and never returns"). So we parse stdout line-by-line, resolve as
 * soon as we see the terminal {"type":"result"} object, then kill the process
 * ourselves. We also enforce a hard timeout.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { resolveCursorInvocation } from '../../utils/cliInvocation.js';

const DEFAULT_MODEL = process.env.AGNT_CURSOR_DEFAULT_MODEL || 'cursor-grok-4.5-high';
const FALLBACK_TIMEOUT_MS = 300000; // 5 min
// Parse the env override defensively: Number('garbage') is NaN and
// setTimeout(fn, NaN) fires immediately (treated as 0), which would make every
// Cursor call insta-timeout on a typo'd AGNT_CURSOR_TIMEOUT_MS. Only accept a
// finite, positive value; otherwise fall back to the safe default.
function resolveDefaultTimeoutMs() {
  const raw = process.env.AGNT_CURSOR_TIMEOUT_MS;
  if (raw == null || raw === '') return FALLBACK_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_TIMEOUT_MS;
}
const DEFAULT_TIMEOUT_MS = resolveDefaultTimeoutMs();
// Above this size the prompt is piped via stdin instead of argv. Windows caps
// the whole command line at 32,767 UTF-16 chars (spawn ENAMETOOLONG); POSIX
// has ARG_MAX. `cursor-agent -p` reads the prompt from stdin when no
// positional prompt is given — verified live with a 60KB prompt 2026-07-27.
const PROMPT_ARGV_THRESHOLD = process.platform === 'win32' ? 28 * 1024 : 80 * 1024;
// Grace period after we see the terminal result before force-killing the hung CLI.
const POST_RESULT_KILL_MS = 500;

// --- resilience helpers (AGNT local patch) ---------------------------------
// Healthy cursor-agent calls return in ~6s; the 300s default only ever fires on
// a genuine stall. Retry ONCE with a FRESH session — a stalled session never
// recovers, so resuming it would simply re-hang.
const RETRY_ON_TIMEOUT = process.env.AGNT_CURSOR_RETRY !== '0';

// Cursor's Free plan refuses every named model:
//   ActionRequiredError: Named models unavailable. Free plans can only use Auto.
// That is a property of the ACCOUNT, not of the call, so it fails identically
// forever — and AGNT passes --model on EVERY invocation (getDefaultModel plus
// four hardcoded 'cursor-grok-4.5-high' literals in StreamEngine/tools.js).
// On such an account the whole provider is dead, and the only clue was an
// error saying "usage limit reached", which points nowhere near the cause.
//
// Recover once, then remember: the first rejection is the entire entitlement
// answer, so later calls go straight to 'auto' rather than paying a doomed
// round-trip each time.
const AUTO_MODEL = 'auto';
const NAMED_MODEL_REJECTED = /named models?\s+(?:are\s+)?unavailable|can only use auto/i;
let namedModelsUnavailable = false;

function isTimeoutError(e) {
  return /timed out after \d+ms/.test(e?.message || '');
}

// runExec RESOLVES { success: false, error, raw } for a rejected model — it
// only REJECTS on timeout/auth/spawn — so this reads a returned value, not a
// thrown one.
function isNamedModelRejection(result) {
  if (!result || result.success !== false) return false;
  return NAMED_MODEL_REJECTED.test(`${result.error || ''}\n${result.raw || ''}`);
}

// The CLI prints "cursor-retrieval: tracing to '<logfile>'" on every run.
// Strip it so it never leaks into an agent-visible error string.
function cleanStderr(s) {
  return String(s || '')
    .split('\n')
    .filter((l) => !/^\s*cursor-retrieval: tracing to /.test(l))
    .join('\n');
}

export function getDefaultTimeoutMs() {
  return DEFAULT_TIMEOUT_MS;
}

/**
 * runExec plus the two recoveries that need memory across attempts: a stalled
 * session, and an account that cannot use named models. Preferred entry point
 * for all callers.
 */
async function runExecResilient(opts = {}) {
  // A retry is only safe while nothing has reached the caller yet. The old
  // test for that was "onDelta or onReasoning was supplied" — a proxy that
  // silently drifted the moment onToolCall/onInit were added (a tool-only
  // observer would have been re-fed its events, the exact duplication this
  // guard exists to prevent), and that also refused a perfectly safe retry
  // whenever the stall happened before the first token. Count what was
  // actually emitted instead: that predicate cannot drift from the handler
  // list, because it IS the handler list.
  //
  // onInit is deliberately not counted. It describes the run rather than the
  // answer, and a retry genuinely IS a second run with its own session id, so
  // a second init is accurate rather than duplicated.
  let emittedPayload = 0;
  const tap = (fn) => (typeof fn === 'function'
    ? (...args) => { emittedPayload += 1; return fn(...args); }
    : fn);
  const attempt = {
    ...opts,
    onDelta: tap(opts.onDelta),
    onReasoning: tap(opts.onReasoning),
    onToolCall: tap(opts.onToolCall),
  };

  // Already learned this account is Auto-only — don't spend a round-trip
  // rediscovering it on every single call.
  if (namedModelsUnavailable && (attempt.model ?? DEFAULT_MODEL) !== AUTO_MODEL) {
    attempt.model = AUTO_MODEL;
  }

  let result;
  try {
    result = await runExec(attempt);
  } catch (err) {
    if (!RETRY_ON_TIMEOUT || emittedPayload > 0 || !isTimeoutError(err)) throw err;
    console.warn('[CursorCliService] stall detected, retrying once with a fresh session');
    // A stalled session never recovers, so resuming it would simply re-hang.
    return runExec({ ...attempt, resume: false, sessionId: null });
  }

  if (isNamedModelRejection(result) && (attempt.model ?? DEFAULT_MODEL) !== AUTO_MODEL) {
    if (!namedModelsUnavailable) {
      namedModelsUnavailable = true;
      console.warn(
        `[CursorCliService] this Cursor account cannot use named models (requested '${attempt.model ?? DEFAULT_MODEL}'). `
        + `Falling back to '${AUTO_MODEL}' for the rest of this process. `
        + 'Set AGNT_CURSOR_DEFAULT_MODEL=auto to make that explicit, or upgrade the Cursor plan.',
      );
    }
    if (emittedPayload > 0) return result;
    // Unlike a stall, the CLI rejected at startup and never touched the
    // session. Keep resume/sessionId and swap only the model — dropping them
    // here would silently discard the conversation's history.
    return runExec({ ...attempt, model: AUTO_MODEL });
  }

  return result;
}

/**
 * Forget the learned model entitlement. Used by tests, and by anyone who
 * upgrades a Cursor plan and would otherwise need a backend restart before the
 * named model became reachable again.
 */
function resetModelEntitlement() {
  namedModelsUnavailable = false;
}
// --- end resilience helpers ------------------------------------------------


function expandUserPath(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveCursorBin() {
  if (process.env.AGNT_CURSOR_BIN) return expandUserPath(process.env.AGNT_CURSOR_BIN);
  const candidates = [
    path.join(os.homedir(), '.local/bin/cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
    path.join(os.homedir(), '.cursor/bin/cursor-agent'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'cursor-agent'; // fall back to PATH
}

// Only expose the binary's own directory on PATH when it is an actual path
// (contains a separator). Never prepend '.' — that would let a stray
// cursor-agent in the CWD be executed (security).
function binDirForPath(bin) {
  if (bin && bin.includes(path.sep)) {
    const d = path.dirname(bin);
    if (d && d !== '.') return d;
  }
  return null;
}

function pathEnv(bin) {
  const d = binDirForPath(bin);
  const base = process.env.PATH || '';
  return d ? `${d}${path.delimiter}${base}` : base;
}

function getDefaultWorkdir() {
  const configured = process.env.AGNT_CURSOR_WORKDIR;
  const dir = configured ? expandUserPath(configured) : path.join(os.homedir(), 'services/agnt-cursor-work');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function getDefaultModel() {
  // Handing a new client a default the account provably cannot run would make
  // it fail on first use. Once entitlement is known, report what works.
  return namedModelsUnavailable ? AUTO_MODEL : DEFAULT_MODEL;
}

/**
 * Check whether the Cursor CLI is authenticated.
 * Runs `cursor-agent status` and looks for a "Logged in" marker.
 */
async function checkAuth({ timeoutMs = 25000 } = {}) {
  // Invocation, not bare bin: on Windows the CLI is a .cmd shim Node cannot
  // spawn; resolveCursorInvocation returns the underlying node.exe + index.js.
  const invocation = resolveCursorInvocation();
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(invocation.command, [...invocation.args, 'status'], {
      env: { ...process.env, HOME: os.homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ loggedIn: false, raw: out, error: 'status timeout' }), timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      const loggedIn = /logged in/i.test(out) && !/not logged in/i.test(out);
      const emailMatch = out.match(/Logged in as\s+([^\s]+)/i);
      done({ loggedIn, email: emailMatch ? emailMatch[1] : null, raw: out.trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ loggedIn: false, raw: out, error: err.message });
    });
  });
}

/**
 * Run a headless Cursor Agent prompt.
 * Returns { success, text, model, sessionId, usage, exitCode, raw }.
 */
async function runExec({
  prompt,
  model = DEFAULT_MODEL,
  cwd,
  force = true,
  resume = false,
  sessionId = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  // Execution policy. `force` auto-approves every tool the agent decides to
  // run (shell, write, network) — it is the CLI's YOLO switch, so callers get
  // to decide rather than having it welded on at the spawn site. `mode`
  // selects a read-only posture: 'plan' proposes an approach without editing,
  // 'ask' answers questions. Auto-approval is meaningless under both.
  mode = null,
  sandbox = null,
  // Streaming handlers. Supplying any of these switches the CLI to stream-json
  // and emits events as they arrive instead of one blob at the end.
  onDelta = null,
  onReasoning = null,
  onToolCall = null,
  onInit = null,
} = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error('cursor_exec: prompt is required');
  }
  if (mode != null && !READ_ONLY_MODES.has(mode)) {
    throw new Error(`cursor_exec: unsupported mode '${mode}' (expected 'plan' or 'ask')`);
  }
  const resolvedSandbox = normalizeSandbox(sandbox);
  const streaming = typeof onDelta === 'function'
    || typeof onReasoning === 'function'
    || typeof onToolCall === 'function'
    || typeof onInit === 'function';
  const invocation = resolveCursorInvocation();
  const workdir = cwd ? expandUserPath(cwd) : getDefaultWorkdir();
  try { fs.mkdirSync(workdir, { recursive: true }); } catch { /* ignore */ }

  // stream-json emits NDJSON with per-token deltas; plain json emits a single
  // terminal object. Only opt into streaming when a handler wants the deltas,
  // so the non-streaming path keeps its proven behaviour.
  const args = ['-p', '--output-format', streaming ? 'stream-json' : 'json'];
  // Partial output only concerns text. Asking for it when the caller wants
  // tool events alone would multiply the event volume for nobody's benefit.
  if (onDelta || onReasoning) args.push('--stream-partial-output');
  // A read-only mode cannot edit anything, so auto-approval would be both
  // pointless and misleading to anyone reading the process list.
  if (force && !mode) args.push('--force');
  if (mode) args.push('--mode', mode);
  if (resolvedSandbox) args.push('--sandbox', resolvedSandbox);
  if (model) args.push('--model', model);
  if (resume && sessionId) args.push('--resume', sessionId);
  else if (resume) args.push('--continue');
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  const promptText = String(prompt);
  const promptViaStdin = promptText.length > PROMPT_ARGV_THRESHOLD;
  if (!promptViaStdin) args.push(promptText);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resultObj = null;
    let settled = false;

    const child = spawn(invocation.command, [...invocation.args, ...args], {
      cwd: workdir,
      env: { ...process.env, HOME: os.homedir(), PATH: pathEnv(invocation.command) },
      stdio: [promptViaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    if (promptViaStdin) {
      // EPIPE here means the CLI died before reading — the close handler
      // will surface that; don't let the write throw synchronously.
      child.stdin.on('error', () => {});
      child.stdin.end(promptText);
    }

    const finish = (payload, isError = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (isError) reject(payload);
      else resolve(payload);
    };

    const hardTimer = setTimeout(() => {
      // If we already captured a result but the process just won't die, return it.
      if (resultObj) {
        finish(buildResult(resultObj, stdout, model));
      } else {
        finish(new Error(`cursor_exec: timed out after ${timeoutMs}ms. stderr: ${cleanStderr(stderr).slice(0, 400)}`), true);
      }
    }, timeoutMs);

    // Incremental line parser. Each complete line is examined exactly once —
    // the previous implementation re-scanned the entire stdout buffer on every
    // chunk, which is quadratic in output size.
    let lineBuffer = '';

    const handleObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      switch (obj.type) {
        case 'assistant': {
          // With --stream-partial-output the CLI emits real deltas AND
          // consolidated re-sends of text it has already delivered. There are
          // TWO kinds of re-send and both have to be dropped or text doubles:
          //   end-of-turn flush   -> timestamp_ms absent
          //   pre-tool-call flush -> timestamp_ms present, model_call_id present
          // Only an event carrying a timestamp and no model_call_id is new.
          // The model_call_id half of this test was missing, so every sentence
          // emitted just before a tool call reached the user twice. It went
          // unnoticed because it only shows up on runs that call tools, and no
          // existing streaming test drives one.
          if (!streaming || obj.timestamp_ms == null || obj.model_call_id != null) return;
          const parts = Array.isArray(obj.message?.content) ? obj.message.content : [];
          const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
          if (text && onDelta) onDelta(text);
          return;
        }
        case 'thinking': {
          if (!streaming || obj.subtype !== 'delta') return;
          if (typeof obj.text === 'string' && obj.text && onReasoning) onReasoning(obj.text);
          return;
        }
        case 'tool_call': {
          // Previously swallowed by `default:`. That meant while Cursor read,
          // wrote and ran shell commands against the user's checkout, AGNT
          // observed precisely nothing until the final blob landed.
          if (!onToolCall) return;
          const summary = summarizeToolCall(obj);
          if (summary) onToolCall(summary);
          return;
        }
        case 'system': {
          // Emitted once at startup. Carries what is needed to attribute the
          // run: which session, which checkout, which model actually served it
          // (Cursor may substitute), and the permission posture in effect.
          if (obj.subtype !== 'init' || !onInit) return;
          onInit({
            sessionId: obj.session_id || null,
            cwd: obj.cwd || null,
            model: obj.model || null,
            permissionMode: obj.permissionMode || obj.permission_mode || null,
            // A source label ('login' | 'env' | 'flag'), never the secret.
            apiKeySource: obj.apiKeySource || obj.api_key_source || null,
          });
          return;
        }
        case 'result': {
          if (resultObj) return;
          resultObj = obj;
          // Got the terminal object — the CLI often hangs now. Kill shortly.
          setTimeout(() => finish(buildResult(obj, stdout, model)), POST_RESULT_KILL_MS);
          return;
        }
        default:
      }
    };

    const consumeLines = (flush = false) => {
      const lines = lineBuffer.split('\n');
      // Keep the trailing partial line unless we are flushing at close.
      lineBuffer = flush ? '' : lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('{')) continue;
        try {
          handleObject(JSON.parse(line));
        } catch { /* partial or non-JSON line — ignore */ }
      }
    };

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      lineBuffer += text;
      consumeLines();
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      // Flush any trailing line, then fall back to a whole-buffer scan in case
      // the terminal object was pretty-printed across lines.
      consumeLines(true);
      if (!resultObj) {
        try {
          const match = stdout.match(/\{[\s\S]*"type"\s*:\s*"result"[\s\S]*\}/);
          if (match) handleObject(JSON.parse(match[0]));
        } catch { /* not recoverable — fall through to the error paths */ }
      }
      if (settled) return;
      clearTimeout(hardTimer);
      if (resultObj) {
        finish(buildResult(resultObj, stdout, model));
        return;
      }
      // No structured result. Surface an error, including any usage-limit / auth text.
      const combined = (stdout + '\n' + stderr).trim();
      if (/not logged in|please.*log ?in|unautheni?ticated/i.test(combined)) {
        finish(new Error('cursor_exec: not authenticated. Run `cursor-agent login` in a terminal.'), true);
        return;
      }
      if (/usage limit|ActionRequiredError|spend limit/i.test(combined)) {
        // Two very different failures share this branch. A spend/usage limit is
        // temporary and model-specific; a rejected named model is a permanent
        // property of the account. Calling the second one a "usage limit" sent
        // anyone debugging it looking for a quota that was never the problem.
        finish({
          success: false,
          error: NAMED_MODEL_REJECTED.test(combined)
            ? `cursor_exec: this Cursor account cannot use named models (requested '${model}'). `
              + "Free plans are limited to 'auto' — set AGNT_CURSOR_DEFAULT_MODEL=auto or upgrade the plan."
            : 'cursor_exec: model usage limit reached. Try a different model (e.g. composer-2.5 or auto).',
          raw: combined.slice(0, 800),
          exitCode: code ?? 1,
        });
        return;
      }
      finish({
        success: false,
        error: `cursor_exec: CLI exited (${code}) with no result. ${stderr.slice(0, 400) || stdout.slice(0, 400)}`,
        exitCode: code ?? 1,
      });
    });

    child.on('error', (err) => finish(new Error(`cursor_exec spawn failed: ${err.message}`), true));
  });
}

const READ_ONLY_MODES = new Set(['plan', 'ask']);

// `--sandbox` takes exactly 'enabled' | 'disabled'. It normally arrives via
// CURSOR_CLI_SANDBOX, where the natural spelling is a boolean — and the CLI
// hard-rejects `--sandbox true`, so a plausible typo in an env var took the
// provider down with an error from a process nobody was watching. `mode` is
// already validated here for the same reason; this closes the other half.
// Normalize the boolean spellings, pass the CLI's own literals through, and
// reject anything else at the call site, where the message can name the fix.
const SANDBOX_ALIASES = new Map([
  [true, 'enabled'], ['true', 'enabled'], ['enabled', 'enabled'],
  [false, 'disabled'], ['false', 'disabled'], ['disabled', 'disabled'],
]);

function normalizeSandbox(value) {
  if (value == null || value === '') return null;
  const resolved = SANDBOX_ALIASES.get(typeof value === 'string' ? value.trim().toLowerCase() : value);
  if (!resolved) {
    throw new Error(
      `cursor_exec: unsupported sandbox '${value}' (expected 'enabled' or 'disabled'; `
      + 'CURSOR_CLI_SANDBOX also accepts true/false)',
    );
  }
  return resolved;
}

// Longest string carried out of a tool event. A write call's args hold the
// entire new file body and a read result holds the entire file that was read;
// forwarding those verbatim would push megabytes through the event stream and
// into the logs. Consumers that need full content should read the file.
const TOOL_TEXT_MAX = 240;

function briefText(value) {
  if (typeof value !== 'string') return undefined;
  if (value.length <= TOOL_TEXT_MAX) return value;
  return `${value.slice(0, TOOL_TEXT_MAX)}… (+${value.length - TOOL_TEXT_MAX} more chars)`;
}

/**
 * Cursor nests each tool event under a single key naming the tool, e.g.
 * { readToolCall: {…} }, { writeToolCall: {…} }, { shellToolCall: {…} }.
 * Flatten that to a stable { id, name, status, path, command, stats } shape so
 * consumers need not know Cursor's wire format, and keep it small. Returns
 * null for anything unrecognised rather than guessing at a shape.
 *
 * The key must actually look like a tool entry. Matching any object-valued key
 * would let a future sibling of metadata be reported as though it were a tool,
 * inventing a name from whatever that key happened to be called. Dropping an
 * event we cannot identify is the better failure: a missing entry in a
 * progress feed is recoverable, a fabricated one is not.
 */
function summarizeToolCall(obj) {
  const payload = obj?.tool_call;
  if (!payload || typeof payload !== 'object') return null;
  const key = Object.keys(payload)
    .find((k) => k.endsWith('ToolCall') && payload[k] && typeof payload[k] === 'object');
  if (!key) return null;
  const inner = payload[key];
  const args = inner.args && typeof inner.args === 'object' ? inner.args : {};
  const summary = {
    id: obj.call_id || obj.id || null,
    name: key.replace(/ToolCall$/, ''),
    status: obj.subtype === 'completed' ? 'completed' : 'started',
  };
  if (typeof args.path === 'string') summary.path = args.path;
  const command = briefText(args.command);
  if (command !== undefined) summary.command = command;
  // `result` appears only on the completed event, as a one-of:
  // { success: {…} } | { error: … }.
  const result = inner.result && typeof inner.result === 'object' ? inner.result : null;
  if (result) {
    if (result.error != null) {
      summary.error = briefText(
        typeof result.error === 'string' ? result.error : JSON.stringify(result.error),
      );
    } else if (result.success && typeof result.success === 'object') {
      const stats = {};
      for (const f of ['linesCreated', 'linesRemoved', 'fileSize', 'totalLines', 'exitCode']) {
        if (typeof result.success[f] === 'number') stats[f] = result.success[f];
      }
      if (Object.keys(stats).length) summary.stats = stats;
    }
  }
  return summary;
}

function buildResult(obj, rawStdout, model) {
  const isError = obj.is_error === true || obj.subtype === 'error';
  return {
    success: !isError,
    provider: 'cursor-cli',
    model,
    text: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result ?? ''),
    sessionId: obj.session_id || null,
    requestId: obj.request_id || null,
    usage: obj.usage || null,
    durationMs: obj.duration_ms ?? null,
    exitCode: isError ? 1 : 0,
    ...(isError ? { error: obj.error || obj.subtype || 'cursor error' } : {}),
  };
}

export default {
  getDefaultModel,
  getDefaultWorkdir,
  resolveCursorBin,
  checkAuth,
  runExec: runExecResilient,
  runExecRaw: runExec,
  getDefaultTimeoutMs,
  resetModelEntitlement,
};
