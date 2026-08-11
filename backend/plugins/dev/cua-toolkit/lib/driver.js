// lib/driver.js — shared helpers for locating + invoking the Cua Driver (trycua/cua)
// Cross-platform, but Windows-first since that's the target host.
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';

export function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

export function asInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? def), 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// Resolve the cua-driver binary. Checks PATH first, then the known Windows install junction,
// then the platform-standard ~/.local/bin location.  We deliberately prefer the ABSOLUTE
// install path so a fresh terminal is NOT required for PATH to update (Windows quirk eliminated).
export function resolveDriverPath() {
  const plat = process.platform;
  const candidates = [];

  if (plat === 'win32') {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(lad, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe'),
      // legacy layout (<= v0.2.13)
      path.join(lad, 'Programs', 'trycua', 'cua-driver-rs', 'bin', 'cua-driver.exe'),
      // install-home layout (~/.cua-driver) used by the release installer
      path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver.exe')
    );
  } else {
    candidates.push(
      path.join(os.homedir(), '.local', 'bin', 'cua-driver'),
      path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver')
    );
  }

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return { found: true, path: c, onPath: false }; } catch { /* ignore */ }
  }
  // Fall back to bare name and rely on PATH resolution.
  return { found: false, path: plat === 'win32' ? 'cua-driver.exe' : 'cua-driver', onPath: true };
}

// Run cua-driver <subcommand> [jsonArg] and capture stdout/stderr.
// Cua's CLI shape:  cua-driver <tool> '<json>'   e.g.  cua-driver click '{"pid":844,...}'
export function runDriver(subcommand, jsonArg = null, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const { path: bin } = resolveDriverPath();
    // Cua Driver exposes automation tools via: cua-driver call <tool> <json>
    // (verified against 0.19.x). Management commands remain top-level:
    // status, doctor, serve, stop, --version, list-tools, describe <tool>.
    const management = new Set(['--version', 'status', 'doctor', 'serve', 'stop', 'list-tools', 'describe']);
    const args = management.has(subcommand) ? [subcommand] : ['call', subcommand];
    if (jsonArg != null) args.push(typeof jsonArg === 'string' ? jsonArg : JSON.stringify(jsonArg));

    let stdout = '';
    let stderr = '';
    let done = false;

    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(e?.message || e), error: 'spawn_failed' });
    }

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: -1, stdout, stderr, error: 'timeout', timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const notFound = /ENOENT/i.test(String(e?.message));
      resolve({ ok: false, code: -1, stdout, stderr: String(e?.message || e), error: notFound ? 'not_installed' : 'spawn_error' });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), error: code === 0 ? null : 'nonzero_exit' });
    });
  });
}

// ---------------------------------------------------------------------------
// THE 0.19 OUTCOME CONTRACT
// ---------------------------------------------------------------------------
// Every acting tool answers with a CLOSED vocabulary instead of prose, and the
// process EXIT CODE IS 0 EVEN FOR A REFUSAL. Measured on 0.19.3 (see
// projects/cua-tests/probe-0193.mjs + probe-success.mjs), there are three
// distinct envelopes and a caller that knows only one of them is wrong:
//
//   success  { "effect":"unverifiable", "route":"accessibility",
//              "delivery":{"mode":"background"} }
//   refusal  { "status":"refused", "refusal":{"code":"stale_element_token",
//              "message":"..."} }
//   refusal' { "effect":"refused", "code":"ambiguous_window_target", ... }
//   plain    Failed to activate packaged app "...": Package was not found.
//            (0x80073CF1)                         <- NOT JSON, still exit 0
//
// That fourth one is the nastiest and it bit this plugin in live testing: a
// launch that hard-failed reported success:true, because the response parsed
// as neither success nor refusal and the exit code said 0. A tool that reports
// success for something that never happened is worse than one that errors.
//
// *** THE SINGLE MOST IMPORTANT FACT IN THIS FILE ***
// effect:"unverifiable" IS NOT FAILURE. A measured click on the Calculator's
// "Seven" button returned exactly that, and verify_state then proved the
// display read "Display is 7". The driver is declining to overclaim, not
// reporting a no-op. Treating unverifiable as failure makes a working agent
// give up; treating it as success makes a broken one keep going. The only
// correct response is to VERIFY — which is why verify_state exists and why
// the act loop calls it.
export const EFFECTS = ['confirmed', 'partial', 'unverifiable', 'suspected_noop', 'refused'];
export const ROUTES = ['accessibility', 'synthetic_events', 'global_input', 'dom', 'trusted_input'];
// Closed reason vocabulary — branch on these, never on human-readable text.
export const REASONS = ['route_unavailable', 'delivery_failed', 'effect_unconfirmed', 'suspected_noop', 'permission_required'];
// Escalation targets are HARNESS INSTRUCTIONS, never an automatic retry.
export const ESCALATIONS = ['pixel', 'px', 'foreground', 'page', 'session'];

/**
 * Normalize any driver response into one outcome object.
 * Never throws: an unparseable response becomes { parsed:false } rather than
 * an exception, because a shape we don't recognize must not look like success.
 */
export function readOutcome(r) {
  const raw = `${r?.stdout || ''}${r?.stderr || ''}`;
  const json = parseDriverJson(r?.stdout);
  const out = {
    parsed: !!json,
    json,
    raw: raw.slice(0, 2000),
    effect: json?.effect ?? null,
    route: json?.route ?? null,
    deliveryMode: json?.delivery?.mode ?? null,
    deliveredCount: json?.delivery?.delivered_count ?? null,
    evidence: Array.isArray(json?.evidence) ? json.evidence : null,
    code: json?.refusal?.code ?? json?.code ?? null,
    message: json?.refusal?.message ?? json?.message ?? null,
    escalation: null,
    escalationReason: null,
  };

  // escalation is { recommended | target, reason } depending on tool + version.
  const esc = json?.escalation;
  if (esc && typeof esc === 'object') {
    out.escalation = esc.target ?? esc.recommended ?? null;
    out.escalationReason = esc.reason ?? null;
  }

  // UNKNOWN IS LOUD.
  //
  // First attempt at this was a list of error words (failed|cannot|denied…).
  // It shipped and immediately missed a second real failure whose wording was
  // "could not find a UIA AcceleratorKey … PostMessage is ignored by this
  // target" — no listed word, so a no-op was reported as success AGAIN. Adding
  // another word to the list would just move the goalpost; the flaw is the
  // premise that failures can be recognised by vocabulary.
  //
  // 0.19 returns a JSON ActionResult for every action it actually performs, so
  // the sound rule is the inverse: a response we cannot parse is NOT evidence
  // of success. Unparseable ⇒ failure, unless it is explicitly affirmative
  // (the driver's own "✅ …" lines, which are a documented plain-text success).
  const plainText = raw.trim();
  const affirmative = /^\s*(✅|ok\b|success\b|done\b|waited\b|zoomed\b)/i.test(plainText)
    || /^\s*(performed|posted|invoked|clicked|typed)\b/i.test(plainText);
  out.plainTextError = !json && plainText.length > 0 && !affirmative;
  out.unparsedResponse = !json && plainText.length > 0;

  out.refused = json?.status === 'refused' || json?.effect === 'refused';
  // Spawn-level failure (binary missing, timeout) is separate from a refusal.
  out.transportFailed = r?.ok === false && !out.refused;

  // "Did the input land?" — deliberately conservative. unverifiable counts as
  // DELIVERED (see the note above); only an explicit refusal, a suspected
  // no-op, or a legacy delivery_failed marker counts as not delivered.
  const legacyFail = !json && /delivery_failed|background_unavailable/i.test(raw);
  out.notDelivered = out.refused || out.effect === 'suspected_noop' || legacyFail || out.plainTextError;
  out.ok = !out.transportFailed && !out.notDelivered;

  // ONE CLASS FOR CALLERS: "this did not happen." A structured refusal and a
  // plain-text failure are different envelopes but the same fact, and code
  // that branches only on `refused` under-reacts to the other. The act loop
  // learned this the hard way — it let a model re-issue a set_value that had
  // already been rejected twice, because the rejection was plain text.
  out.failedHard = out.refused || out.plainTextError || out.effect === 'suspected_noop';

  // One human-readable line for prompts and tool output.
  out.summary = out.refused
    ? `REFUSED (${out.code || 'unknown'}): ${out.message || 'no message'}`
    : out.plainTextError
      ? `FAILED: ${plainText.slice(0, 300)}`
      : out.transportFailed
      ? `TRANSPORT ERROR: ${(r?.stderr || r?.error || 'driver call failed').slice(0, 200)}`
      : out.effect
        ? `effect=${out.effect} route=${out.route || '?'}${out.escalation ? ` escalation=${out.escalation}` : ''}`
        : (r?.stdout || 'ok').slice(0, 200);

  return out;
}

/** Run a tool and return the normalized outcome in one step. */
export async function callTool(tool, arg = {}, opts = {}) {
  const r = await runDriver(tool, arg, opts);
  if (r.error === 'not_installed') return { ...readOutcome(r), notInstalled: true };
  return readOutcome(r);
}

// Best-effort JSON parse of driver stdout (Cua returns JSON for most tools).
export function parseDriverJson(out) {
  if (!out) return null;
  try { return JSON.parse(out); } catch { /* fall through */ }
  // Some commands print a leading human banner then JSON; grab the first {...} or [...] block.
  const m = out.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
  if (m) { try { return JSON.parse(m[1]); } catch { /* ignore */ } }
  return null;
}

// Detect the Windows Session-0 trap: window tools silently return empty arrays
// when the driver runs in a non-interactive session. We surface this clearly.
export function detectSession0(doctorText) {
  if (!doctorText) return false;
  return /Session 0|no attached interactive desktop|window-driving tools.*empty/i.test(doctorText);
}

export function notInstalledResult() {
  return {
    success: false,
    installed: false,
    error: 'Cua Driver is not installed. Run cua-setup with action="ensure" (confirm=true) to auto-install + start it, or action="install".',
  };
}

// ---------------------------------------------------------------------------
// Bootstrap layer — lets every tool self-heal so the user never runs manual steps.
// ---------------------------------------------------------------------------

export function isInstalled() {
  const r = resolveDriverPath();
  return r.found; // found === absolute binary exists on disk
}

// Run the official installer (Windows PowerShell / *nix bash). Returns combined output.
export function installDriver({ timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    let proc, out = '';
    if (process.platform === 'win32') {
      const cmd = 'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex';
      proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
    } else {
      const cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"';
      proc = spawn('/bin/bash', ['-lc', cmd]);
    }
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, output: out + `\n[spawn error] ${e?.message}` }));
    proc.on('close', (code) => resolve({ ok: code === 0, output: out }));
    setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } resolve({ ok: false, output: out + '\n[timeout]' }); }, timeoutMs);
  });
}

export async function isDaemonRunning() {
  const st = await runDriver('status', null, { timeoutMs: 8000 });
  return /running/i.test(st.stdout) && !/not running/i.test(st.stdout);
}

// Start the long-running daemon detached (needed for element-index cache persistence).
export function startDaemon() {
  return new Promise((resolve) => {
    const { path: bin } = resolveDriverPath();
    let child;
    try {
      child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch (e) {
      return resolve({ ok: false, error: e?.message });
    }
    setTimeout(() => resolve({ ok: true, pid: child.pid ?? null }), 1500);
  });
}

// The one-call self-heal used by every runtime tool.
// install (optional) -> ensure daemon up -> return readiness.
// Pass { allowInstall } to permit auto-install when the binary is missing.
export async function ensureReady({ allowInstall = false } = {}) {
  const steps = [];

  // 1. Binary present?
  if (!isInstalled()) {
    if (!allowInstall) {
      return { ready: false, installed: false, error: notInstalledResult().error, steps };
    }
    steps.push('installing driver…');
    const ins = await installDriver();
    steps.push(ins.ok ? 'install ok' : 'install failed');
    if (!isInstalled()) {
      return { ready: false, installed: false, error: 'Auto-install ran but binary did not appear.', installerTail: ins.output.slice(-1500), steps };
    }
  }

  // 2. Daemon up? (cheap to check; auto-start if not)
  let running = await isDaemonRunning();
  if (!running) {
    steps.push('starting daemon…');
    await startDaemon();
    running = await isDaemonRunning();
    steps.push(running ? 'daemon up' : 'daemon start unconfirmed');
  } else {
    steps.push('daemon already running');
  }

  return { ready: true, installed: true, daemonRunning: running, steps };
}

// ---------------------------------------------------------------------------
// 0.19.x snapshot layer — one call per (pid, window_id) per turn.
// ---------------------------------------------------------------------------

/**
 * Take a get_window_state snapshot and normalize it for reasoning + acting.
 *
 * Driver ≥0.17 contract (verified live on 0.19.3):
 *   - returns { snapshot_id, elements[], tree_markdown, total_element_count, ... }
 *   - each element: { element_index, element_token, role, label, value, enabled,
 *     selected, frame:{x,y,w,h}, parent_index, depth }
 *   - element-addressed actions (click / type_text / set_value / press_key)
 *     REQUIRE the element_token (or element_index + snapshot_id) from the
 *     CURRENT snapshot — stale snapshots fail closed. Always re-snapshot
 *     before acting.
 *   - capture_mode is deprecated/ignored; include_screenshot chooses the cheap
 *     tree-only path.
 *
 * The screenshot is routed through screenshot_out_file (temp PNG, read +
 * deleted) so multi-megabyte base64 never rides through stdout parsing.
 */
export async function snapshotWindow(pid, windowId, {
  includeScreenshot = true,
  query = null,
  maxElements = null,
  maxDepth = null,
  timeoutMs = 45000,
  session = null,
} = {}) {
  const arg = { pid, window_id: windowId, include_screenshot: !!includeScreenshot };
  if (session) arg.session = session;
  if (query) arg.query = String(query);
  if (maxElements) arg.max_elements = maxElements;
  if (maxDepth) arg.max_depth = maxDepth;

  let shotFile = null;
  if (includeScreenshot) {
    shotFile = path.join(os.tmpdir(), `cua-shot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`);
    arg.screenshot_out_file = shotFile;
  }

  const r = await runDriver('get_window_state', arg, { timeoutMs });
  if (r.error === 'not_installed') return { ok: false, error: 'not_installed' };

  const state = parseDriverJson(r.stdout) || {};
  if (!r.ok && !state.elements) {
    if (shotFile) { try { fs.unlinkSync(shotFile); } catch { /* ignore */ } }
    return { ok: false, error: r.stderr || r.stdout?.slice(0, 500) || r.error || 'get_window_state failed' };
  }

  const elements = (Array.isArray(state.elements) ? state.elements : []).map((el) => ({
    index: el.element_index,
    token: el.element_token || null,
    role: el.role || '',
    label: el.label || '',
    value: el.value ?? '',
    enabled: el.enabled !== false,
    selected: el.selected === true,
    frame: el.frame || null,
    parentIndex: el.parent_index ?? null,
    depth: el.depth ?? null,
  }));

  let screenshotB64 = null;
  if (shotFile) {
    try {
      screenshotB64 = fs.readFileSync(shotFile).toString('base64');
    } catch { /* driver may embed instead */ }
    try { fs.unlinkSync(shotFile); } catch { /* ignore */ }
  }
  if (!screenshotB64) {
    screenshotB64 = state.screenshot || state.image || state.screenshot_base64 || null;
  }

  return {
    ok: true,
    snapshotId: state.snapshot_id || null,
    elements,
    treeMarkdown: state.tree_markdown || '',
    totalElementCount: state.total_element_count ?? elements.length,
    returnedElementCount: state.returned_element_count ?? elements.length,
    elementsComplete: state.elements_complete !== false,
    screenshotB64,
    // 0.19 surfaces its own confidence in the observation. `degraded` means the
    // AX walk came back empty (non-AX surface) and the accompanying escalation
    // normally says "px" — act off the screenshot in this same response.
    degraded: state.degraded === true,
    degradedReason: state.degraded_reason || null,
    escalation: state.escalation?.recommended ?? state.escalation?.target ?? null,
    escalationReason: state.escalation?.reason || null,
    screenshotError: state.screenshot_error || null,
    raw: state,
  };
}

// ---------------------------------------------------------------------------
// Sessions — the headline of "computer-use 2.0".
// ---------------------------------------------------------------------------
// A declared session gives the run (a) its OWN colour-coded cursor overlay so
// the user can watch the agent work WITHOUT the physical pointer ever moving,
// and (b) a capture policy. `auto` starts window-only and refuses desktop-wide
// perception until the window ladder is exhausted and escalate_session is
// called explicitly — escalation is PERMANENT for that session id.
// Measured: get_desktop_state under a fresh auto session returns
// { code: "desktop_escalation_required" } with exit 0.
export async function startSession(session, { captureScope = 'auto', cursorThemeId = null } = {}) {
  const arg = { session, capture_scope: captureScope };
  if (cursorThemeId) arg.cursor_theme = { theme_id: cursorThemeId };
  return callTool('start_session', arg, { timeoutMs: 15000 });
}
export async function endSession(session) {
  return callTool('end_session', { session }, { timeoutMs: 15000 });
}
export async function getSessionState(session) {
  return callTool('get_session_state', { session }, { timeoutMs: 15000 });
}
export async function escalateSession(session, reason = 'other', detail = null) {
  const allowed = ['ax_tree_pixel_mismatch', 'background_delivery_failed', 'foreground_ineffective', 'no_window_target', 'other'];
  const arg = { session, reason: allowed.includes(reason) ? reason : 'other' };
  if (detail) arg.detail = String(detail).slice(0, 200);
  return callTool('escalate_session', arg, { timeoutMs: 15000 });
}

/**
 * Deterministic postcondition check against ONE exact window.
 *
 * This is the fix for the central weakness of a screenshot-judging loop: the
 * model deciding "looks done to me". verify_state evaluates structured state
 * and answers satisfied | unsatisfied | unknown, and UNKNOWN NEVER MEANS
 * SUCCESS. Measured on Calculator: after a click whose own result was only
 * `effect:"unverifiable"`, a label_contains predicate returned
 * status:"satisfied" with observed_json proving label "Display is 7".
 *
 * Predicate shapes (AND-ed, 1..8):
 *   { window:  { exists: true } }
 *   { window:  { bounds: { x, y, width, height, tolerance_px } } }
 *   { element: { selector: { role?, label_contains? }, exists: true } }
 *   { element: { selector: {...}, value_equals: "...", enabled: true, selected: true } }
 * NOTE element.exists only accepts `true` — absence cannot be proven because
 * element walks are not exhaustive, so the driver rejects `false` rather than
 * returning a forever-unknown predicate.
 */
export async function verifyState(pid, windowId, expect, { session = null, timeoutMs = 4000, stableSamples = 1 } = {}) {
  const arg = {
    pid,
    window_id: windowId,
    expect: Array.isArray(expect) ? expect.slice(0, 8) : [expect],
    timeout_ms: Math.max(0, Math.min(10000, timeoutMs)),
    stable_samples: Math.max(1, Math.min(5, stableSamples)),
  };
  if (session) arg.session = session;
  const r = await runDriver('verify_state', arg, { timeoutMs: timeoutMs + 15000 });
  const json = parseDriverJson(r.stdout);
  const predicates = Array.isArray(json?.predicates) ? json.predicates : [];
  return {
    ok: r.ok,
    status: json?.status || (r.ok ? 'unknown' : 'error'),
    satisfied: json?.status === 'satisfied',
    stable: json?.stable === true,
    samples: json?.samples ?? null,
    elapsedMs: json?.elapsed_ms ?? null,
    predicates: predicates.map((p) => ({
      index: p.index,
      status: p.status,
      unknownReason: p.unknown_reason || null,
      observed: p.observed_json || null,
    })),
    // A refusal here is usually window_scope_disabled (session already escalated
    // to desktop scope) — that is a policy answer, not a failed assertion.
    code: json?.refusal?.code ?? json?.code ?? null,
    raw: (r.stdout || r.stderr || '').slice(0, 1200),
  };
}

/**
 * Resolve an application-menu path natively and invoke its final item.
 * Uses ExpandCollapsePattern at each hop and Invoke/SelectionItem at the leaf,
 * re-resolving the live hierarchy after every expansion. It NEVER falls back
 * to pixels: missing, ambiguous, disabled or mismatched segments fail closed
 * with a `menu_path_unavailable` refusal (measured). That is the whole point —
 * clicking a menu blind is how agents open the wrong thing.
 */
export async function invokeMenu(pid, windowId, menuPath, { session = null } = {}) {
  const arg = { pid, window_id: windowId, path: menuPath.slice(0, 16).map((s) => String(s).slice(0, 200)) };
  if (session) arg.session = session;
  return callTool('invoke_menu', arg, { timeoutMs: 30000 });
}

/** Clipboard. The reliable way into surfaces that refuse programmatic text. */
export async function clipboardWrite({ text = null, imagePath = null, filePath = null, session = null } = {}) {
  const arg = {};
  if (text != null) arg.text = String(text);
  else if (imagePath) arg.image_path = String(imagePath);
  else if (filePath) arg.file_path = String(filePath);
  else throw new Error('clipboardWrite needs exactly one of text / imagePath / filePath.');
  if (session) arg.session = session;
  return callTool('clipboard_write', arg, { timeoutMs: 20000 });
}
export async function clipboardRead({ includeText = false, session = null } = {}) {
  const arg = { include_text: !!includeText };
  if (session) arg.session = session;
  return callTool('clipboard_read', arg, { timeoutMs: 20000 });
}

/** Installed AND running apps, with launch_path for round-tripping to launch_app. */
export async function listApps() {
  const r = await runDriver('list_apps', {}, { timeoutMs: 60000 });
  const json = parseDriverJson(r.stdout);
  const apps = Array.isArray(json?.apps) ? json.apps : (Array.isArray(json) ? json : []);
  return { ok: r.ok, apps, raw: r.stderr?.slice(0, 400) || null };
}

/** Full-display capture. Refused under an un-escalated `auto` session by design. */
export async function desktopState({ session = null } = {}) {
  const file = path.join(os.tmpdir(), `cua-desk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`);
  const arg = { screenshot_out_file: file };
  if (session) arg.session = session;
  const r = await runDriver('get_desktop_state', arg, { timeoutMs: 45000 });
  const json = parseDriverJson(r.stdout) || {};
  let b64 = null;
  try { b64 = fs.readFileSync(file).toString('base64'); } catch { /* driver may have refused */ }
  try { fs.unlinkSync(file); } catch { /* ignore */ }
  if (!b64) b64 = json.screenshot || json.image || null;
  return {
    ok: r.ok && !!b64,
    code: json.refusal?.code ?? json.code ?? null,
    effectiveScope: json.effective_scope || null,
    screenshotB64: b64,
    screenSize: json.screen_size || (json.width && json.height ? { width: json.width, height: json.height } : null),
    raw: json,
  };
}

/**
 * Full-resolution crop of a window region — for reading small text the
 * downscaled snapshot blurs. Returns base64 image data.
 * GOTCHA (measured): the field is named `screenshot_png_b64` but `format` and
 * `mime_type` both say jpeg. Trust mime_type, not the field name.
 * Also measured: zoom hard-fails on a MINIMIZED window — GDI returns an
 * all-black bitmap, so the driver refuses rather than hand back a black image.
 */
export async function zoomRegion(pid, windowId, x1, y1, x2, y2) {
  const r = await runDriver('zoom', { pid, window_id: windowId, x1, y1, x2, y2 }, { timeoutMs: 30000 });
  const json = parseDriverJson(r.stdout);
  if (!json) return { ok: false, error: (r.stdout || r.stderr || 'zoom failed').slice(0, 400) };
  return {
    ok: true,
    b64: json.screenshot_png_b64 || json.screenshot || null,
    mime: json.mime_type || json.screenshot_mime_type || 'image/png',
    width: json.width ?? null,
    height: json.height ?? null,
  };
}

/** Move/resize one exact window, with the driver's own geometry read-back. */
export async function setWindowFrame(pid, windowId, x, y, width, height, { session = null } = {}) {
  const arg = { pid, window_id: windowId, x, y, width, height };
  if (session) arg.session = session;
  return callTool('set_window_frame', arg, { timeoutMs: 20000 });
}
