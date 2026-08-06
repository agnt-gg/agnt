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

function isTimeoutError(e) {
  return /timed out after \d+ms/.test(e?.message || '');
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

/** runExec + one retry on a stall. Preferred entry point for all callers. */
async function runExecResilient(opts = {}) {
  try {
    return await runExec(opts);
  } catch (err) {
    // Never retry a STREAMING call: if the first attempt already emitted any
    // onDelta/onReasoning output before stalling, a retry would push a second,
    // duplicated token stream into the same consumer. A streamed timeout is
    // rare and is better surfaced as an error than re-streamed.
    const isStreaming =
      typeof opts.onDelta === 'function' || typeof opts.onReasoning === 'function';
    if (!RETRY_ON_TIMEOUT || isStreaming || !isTimeoutError(err)) throw err;
    console.warn('[CursorCliService] stall detected, retrying once with a fresh session');
    return runExec({ ...opts, resume: false, sessionId: null });
  }
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
  return DEFAULT_MODEL;
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
  if (streaming) args.push('--stream-partial-output');
  // A read-only mode cannot edit anything, so auto-approval would be both
  // pointless and misleading to anyone reading the process list.
  if (force && !mode) args.push('--force');
  if (mode) args.push('--mode', mode);
  if (sandbox) args.push('--sandbox', sandbox === true ? 'enabled' : sandbox);
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
        finish({
          success: false,
          error: 'cursor_exec: model usage limit reached. Try a different model (e.g. composer-2.5 or auto).',
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
 */
function summarizeToolCall(obj) {
  const payload = obj?.tool_call;
  if (!payload || typeof payload !== 'object') return null;
  const key = Object.keys(payload).find((k) => payload[k] && typeof payload[k] === 'object');
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
};
