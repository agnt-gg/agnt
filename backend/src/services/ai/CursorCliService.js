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
const DEFAULT_TIMEOUT_MS = Number(process.env.AGNT_CURSOR_TIMEOUT_MS || 300000); // 5 min
// Above this size the prompt is piped via stdin instead of argv. Windows caps
// the whole command line at 32,767 UTF-16 chars (spawn ENAMETOOLONG); POSIX
// has ARG_MAX. `cursor-agent -p` reads the prompt from stdin when no
// positional prompt is given — verified live with a 60KB prompt 2026-07-27.
const PROMPT_ARGV_THRESHOLD = process.platform === 'win32' ? 28 * 1024 : 80 * 1024;
// Grace period after we see the terminal result before force-killing the hung CLI.
const POST_RESULT_KILL_MS = 500;

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
  // Streaming handlers. Supplying either switches the CLI to stream-json and
  // emits token deltas as they arrive instead of one blob at the end.
  onDelta = null,
  onReasoning = null,
} = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error('cursor_exec: prompt is required');
  }
  const streaming = typeof onDelta === 'function' || typeof onReasoning === 'function';
  const invocation = resolveCursorInvocation();
  const workdir = cwd ? expandUserPath(cwd) : getDefaultWorkdir();
  try { fs.mkdirSync(workdir, { recursive: true }); } catch { /* ignore */ }

  // stream-json emits NDJSON with per-token deltas; plain json emits a single
  // terminal object. Only opt into streaming when a handler wants the deltas,
  // so the non-streaming path keeps its proven behaviour.
  const args = ['-p', '--output-format', streaming ? 'stream-json' : 'json'];
  if (streaming) args.push('--stream-partial-output');
  if (force) args.push('--force');
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
        finish(new Error(`cursor_exec: timed out after ${timeoutMs}ms. stderr: ${stderr.slice(0, 400)}`), true);
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
          // With --stream-partial-output the CLI emits BOTH incremental deltas
          // (which carry timestamp_ms) and a final consolidated assistant
          // message (which does not). Counting both doubles the text, so the
          // presence of timestamp_ms is the delta discriminator.
          if (!streaming || obj.timestamp_ms == null) return;
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
  runExec,
};
