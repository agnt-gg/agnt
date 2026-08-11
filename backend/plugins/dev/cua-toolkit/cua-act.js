// cua-act.js — autonomous computer-use loop on Cua Driver 0.19.x.
//
// v0.5.0 rebuilds the loop around three things 0.19 gives us that the previous
// version could not use:
//
//   1. SESSIONS. The run declares a session id, so the driver paints its own
//      colour-coded cursor overlay (your physical mouse is never moved) and
//      enforces a capture policy. The session is ended in a finally block, so
//      an abort can't leave a cursor stranded on screen.
//
//   2. THE CLOSED OUTCOME CONTRACT. Actions answer with { effect, route,
//      delivery, escalation } instead of prose, and a REFUSAL still exits 0.
//      *** effect:"unverifiable" is NOT failure *** — it is the driver
//      declining to overclaim. The old loop regex-matched raw text for
//      "delivery_failed", which cannot distinguish these cases at all.
//
//   3. verify_state. The weakest link in any screenshot loop is the model
//      grading its own homework. Now every step may declare a postcondition
//      and the DRIVER measures it against real window state. Unknown never
//      counts as success, and `done` is refused until the goal predicate is
//      actually satisfied.
//
// Per step: observe → reason (one JSON action) → act → MEASURE → repeat.
// Reasoning runs on whatever provider/model the user selected for this
// conversation; nothing is pinned or silently substituted.
import {
  asBool, asInt, resolveDriverPath, notInstalledResult, ensureReady,
  snapshotWindow, callTool, verifyState, invokeMenu, clipboardWrite, zoomRegion,
  startSession, endSession, escalateSession,
} from './lib/driver.js';
import { resolveSession, resolveAuthToken, callLlm, extractJson } from './lib/llm.js';

const MAX_ELEMENTS_FOR_PROMPT = 220;
const MAX_TREE_CHARS = 14000;

function compactElements(elements) {
  return elements
    .filter((e) => e.enabled !== false)
    .slice(0, MAX_ELEMENTS_FOR_PROMPT)
    .map((e) => `[${e.index}] ${e.role}${e.label ? ` "${e.label}"` : ''}${e.value ? ` = ${String(e.value).slice(0, 120).replace(/\n/g, ' ')}` : ''}`)
    .join('\n');
}

/**
 * Turn the driver's structured verdict into an instruction the model cannot
 * misread. A live run of the previous version showed the model repeating an
 * identical no-op three times because the failure was buried in a JSON blob it
 * had to notice on its own — legible to the driver, invisible to the reasoner.
 * Anything load-bearing gets promoted to plain imperative text.
 */
function outcomeNotice(o, verdict) {
  if (!o) return '';
  const lines = [];

  if (o.failedHard) {
    lines.push('', `!! THE LAST ACTION FAILED${o.code ? ` (${o.code})` : ''}. IT DID NOT HAPPEN. Nothing changed.`);
    const why = o.message || (o.plainTextError ? o.summary.replace(/^FAILED:\s*/, '') : '');
    if (why) lines.push(`   Driver said: ${String(why).slice(0, 400)}`);
    if (o.code === 'stale_element_token') lines.push('   Element indices from the snapshot above are the CURRENT ones — use those, not older numbers.');
    else if (o.code === 'ambiguous_window_target') lines.push('   The app owns several windows; this loop targets exactly one. Prefer an element-addressed action.');
    else if (o.code === 'menu_path_unavailable') lines.push('   That menu path does not exist. Read the real labels in the tree above — they are case-sensitive and must be immediate children.');
    if (/does not implement ValuePattern/i.test(o.summary || '')) lines.push('   THIS ELEMENT CANNOT TAKE set_value AT ALL. Do not try it again on this element under any reasoning. For text, use "type_xy" at the field\'s pixel centre.');
    if (/AcceleratorKey/i.test(o.summary || '')) lines.push('   Background key combos do not reach this XAML target. If you need a shortcut, pass x,y (a pixel inside the field) so focus is established first, and add "deliveryMode":"foreground".');
    lines.push('   DO NOT repeat that same action unchanged.');
  } else if (o.effect === 'suspected_noop') {
    lines.push('', '!! The driver believes the last action changed NOTHING. Do not repeat it — choose a different element or a different approach.');
  } else if (o.escalation === 'foreground') {
    lines.push('', '!! Background delivery cannot reach that target. Reply with the SAME action plus "deliveryMode":"foreground" to briefly front the window (it is restored afterwards). This is the driver\'s own instruction, not a guess.');
  } else if (o.escalation === 'pixel' || o.escalation === 'px') {
    lines.push('', '!! The accessibility route could not prove that landed. Act by PIXEL instead: use click_xy / type with x,y read off the screenshot.');
  } else if (o.effect === 'unverifiable') {
    lines.push('', 'NOTE: the driver dispatched the action but cannot prove its effect. That is normal and NOT a failure — judge from the fresh state below, and use "expect" on your next action so the driver measures it for you.');
  }

  if (verdict) {
    lines.push('', verdict.satisfied
      ? `✅ MEASURED: your stated postcondition ("${verdict.label}") IS satisfied in real window state${verdict.via === 'snapshot' ? ' (found in an element value)' : ''}.`
      : verdict.status === 'unknown'
        ? `⚠️ MEASURED: postcondition ("${verdict.label}") is UNKNOWN — neither the driver nor a full element scan could find it. Unknown NEVER means success; treat the action as having achieved nothing and try a different route.`
        : `❌ MEASURED: postcondition ("${verdict.label}") is NOT satisfied. The action did not achieve what you predicted — change route, do not retry it.`);
  }
  return lines.join('\n');
}

function buildStepPrompt({ goal, stepNum, maxSteps, snap, history, lastOutcome, lastVerdict, goalCheck }) {
  const historyText = history.length
    ? history.map((h, i) => `${i + 1}. ${h.action}${h.detail ? ` (${h.detail})` : ''} → ${h.outcome}`).join('\n')
    : '(none yet)';

  const degradedNote = snap.degraded
    ? `\n!! THIS SURFACE HAS NO ACCESSIBILITY TREE (${snap.degradedReason || 'non-AX surface'}). Element indices are unavailable — act by PIXEL off the screenshot (click_xy / type with x,y).`
    : '';

  return [
    'You are a precise Windows computer-use agent driving ONE window in the background.',
    'You never steal focus and never move the physical mouse — the driver routes through the accessibility layer and paints its own cursor overlay.',
    `GOAL: ${goal}`,
    `STEP ${stepNum} of ${maxSteps}.`,
    goalCheck ? `GOAL POSTCONDITION (the driver will measure this before accepting "done"): ${goalCheck}` : '',
    '',
    'ACTIONS SO FAR:',
    historyText,
    lastOutcome ? `\nLAST ACTION: ${lastOutcome.summary}` : '',
    outcomeNotice(lastOutcome, lastVerdict),
    '',
    `INTERACTIVE ELEMENTS (index → role/label/value) — snapshot ${snap.snapshotId}:`,
    compactElements(snap.elements) || '(no interactive elements found)',
    degradedNote,
    '',
    'ACCESSIBILITY TREE (truncated):',
    snap.treeMarkdown.slice(0, MAX_TREE_CHARS),
    '',
    'The attached screenshot shows the window RIGHT NOW. Cross-check it against the tree — the tree lies on some surfaces (Electron echoes writes it never rendered; virtualized rows report bogus frames).',
    '',
    'Reply with EXACTLY ONE JSON object and NOTHING else:',
    '{"action":"click","elementIndex":N,"reason":"...","expect":"text that will appear when this worked"}',
    '{"action":"double_click","elementIndex":N,"reason":"..."}',
    '{"action":"right_click","elementIndex":N,"reason":"..."}',
    '{"action":"click_xy","x":N,"y":N,"reason":"..."}  // window-local screenshot pixels; for canvas/custom surfaces absent from the tree',
    '{"action":"type","elementIndex":N,"text":"...","reason":"..."}  // routes through UIA ValuePattern when the element supports it',
    '{"action":"type_xy","x":N,"y":N,"text":"...","reason":"..."}  // pixel-focus then type. THE RELIABLE TEXT ROUTE for XAML/WinUI3/Electron editors (Windows 11 Notepad included), and it still needs no foreground. Use the CENTRE of the field as read off the screenshot.',
    '{"action":"paste_text","text":"...","x":N,"y":N,"reason":"..."}  // clipboard + Ctrl+V at a pixel. Last resort for very long text; replaces the clipboard and usually needs "deliveryMode":"foreground".',
    '{"action":"set_value","elementIndex":N,"value":"...","reason":"..."}  // atomic whole-value write: dropdowns, checkboxes, sliders, native fields',
    '{"action":"invoke_menu","menuPath":["File","Save As..."],"reason":"..."}  // native menu resolution, never a blind click. PREFER THIS over clicking menus.',
    '{"action":"press_key","key":"return|tab|escape|up|down|f5|a|1...","modifiers":["ctrl"],"reason":"..."}',
    '{"action":"hotkey","keys":["ctrl","s"],"reason":"..."}',
    '{"action":"scroll","direction":"up|down|left|right","amount":3,"reason":"..."}',
    '{"action":"zoom","x1":N,"y1":N,"x2":N,"y2":N,"reason":"read small text"}  // native-resolution crop, max 500px wide',
    '{"action":"verify","expect":"text that should be present now","reason":"..."}  // measure without acting',
    '{"action":"wait","ms":1000,"reason":"UI still loading"}',
    '{"action":"done","summary":"what was accomplished, verified from the CURRENT state"}',
    '{"action":"fail","summary":"why the goal cannot be reached"}',
    '',
    'Optional on any acting step: "deliveryMode":"foreground" (ONLY after the driver told you background cannot land) and "expect":"..." (a substring of a label that will exist once the action worked — the driver measures it for you and tells you the truth).',
    '',
    'Rules:',
    '- ONE action per reply. Strict JSON. No markdown fences, no prose.',
    '- Prefer elementIndex over pixels. The indices above are valid for THIS snapshot only.',
    '- Prefer invoke_menu over clicking through menus rather than hunting for menu items by pixel.',
    '- TEXT ENTRY LADDER (measured, follow it in order): 1) "type" with elementIndex. 2) If that came back UNPROVEN and your "expect" was not satisfied, it was a SILENT NO-OP — immediately switch to "type_xy" at the centre of the field. That is the route that works on Windows 11 Notepad and other XAML/Electron editors. 3) Only then consider paste_text. Never just retry step 1.',
    '- Never pass deliveryMode:"foreground" preemptively because a target "looks like" Chromium/Electron. Wait for the driver to say so — fronting on a guess steals the user\'s focus.',
    '- Declare "done" only when the goal is VISIBLY achieved in the current state, not after merely issuing the action you hope achieves it.',
    '- If an action was refused, change something. Repeating it unchanged will fail identically.',
  ].filter(Boolean).join('\n');
}

class CuaAct {
  constructor() { this.name = 'cua-act'; }

  async execute(params, inputData, workflowEngine) {
    const goal = String(params?.goal || '').trim();
    const pid = Number.parseInt(params?.pid, 10);
    const windowId = Number.parseInt(params?.windowId, 10);
    const maxSteps = asInt(params?.maxSteps, 12, 1, 50);
    const dryRun = params?.dryRun == null ? false : asBool(params.dryRun);
    const confirm = asBool(params?.confirm);
    const stepDelayMs = asInt(params?.stepDelayMs, 600, 0, 10000);
    const goalCheck = String(params?.successContains || '').trim() || null;
    const showCursor = params?.showCursor == null ? true : asBool(params.showCursor);

    if (!goal) return { success: false, error: 'goal is required.' };
    if (Number.isNaN(pid) || Number.isNaN(windowId)) {
      return { success: false, error: 'pid and windowId are required (from cua-windows).' };
    }
    if (!dryRun && !confirm) {
      return {
        success: false,
        status: 'blocked',
        error: 'Live driving requires confirm=true. Use dryRun=true to preview the first planned action without dispatching input.',
      };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    let llmSession, authToken;
    try {
      llmSession = resolveSession(params, workflowEngine);
      authToken = resolveAuthToken(params, workflowEngine);
    } catch (e) {
      return { success: false, error: `LLM bridge unavailable: ${e.message}` };
    }

    // One driver session per run: own cursor colour, own capture policy.
    // Reused ids would share a cursor between concurrent runs, so it carries
    // the pid and a random suffix.
    const driverSession = String(params?.session || '').trim()
      || `agnt-act-${pid}-${Math.random().toString(36).slice(2, 8)}`;
    let sessionStarted = false;
    if (showCursor && !dryRun) {
      const s = await startSession(driverSession, { captureScope: 'auto' });
      sessionStarted = !s.refused;
    }

    const history = [];
    const steps = [];
    let lastOutcome = null;
    let lastVerdict = null;
    let status = 'max_steps';
    let finalSummary = null;
    let lastSnap = null;
    let escalatedForeground = false;
    const stallCounter = new Map();
    const hardFailedSigs = new Set();
    const sess = sessionStarted ? driverSession : null;

    /**
     * Measure a postcondition against REAL state, two ways.
     *
     * verify_state is authoritative but only matches element LABELS, and its
     * element walk is not always exhaustive — on Notepad it returns
     * unknown/observation_unavailable because the document text lives in the
     * editor's VALUE, not its label, and the walk reports elements_complete
     * false. A verifier that can never see the thing being typed is worse than
     * none: it turns every text goal into "unknown" forever.
     *
     * So: driver first (trusted), then a full scan of the fresh snapshot's
     * labels AND values. The fallback is still real UIA state read this turn —
     * it is a second look at the same evidence, not a guess, and it is
     * reported as via:"snapshot" so the distinction stays visible.
     */
    const measure = async (needle) => {
      const label = String(needle).slice(0, 200);
      let driver = null;
      try {
        driver = await verifyState(pid, windowId, [{ element: { selector: { label_contains: label }, exists: true } }], { session: sess, timeoutMs: 2500, stableSamples: 1 });
      } catch { /* fall through to the snapshot scan */ }
      if (driver?.satisfied) return { label, satisfied: true, status: 'satisfied', via: 'verify_state', predicates: driver.predicates };

      const fresh = await snapshotWindow(pid, windowId, { includeScreenshot: false, session: sess });
      if (fresh.ok) {
        const hay = fresh.elements.map((e) => `${e.label || ''}\u0000${e.value ?? ''}`).join('\u0001');
        if (hay.toLowerCase().includes(label.toLowerCase())) {
          return { label, satisfied: true, status: 'satisfied', via: 'snapshot', predicates: driver?.predicates || null };
        }
      }
      return { label, satisfied: false, status: driver?.status || 'unknown', via: driver ? 'verify_state' : 'snapshot', predicates: driver?.predicates || null };
    };

    try {
      for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
        // 1. OBSERVE — fresh snapshot, fresh tokens.
        const snap = await snapshotWindow(pid, windowId, { includeScreenshot: true, session: sess });
        if (!snap.ok) {
          status = 'error';
          finalSummary = `Observation failed at step ${stepNum}: ${snap.error}`;
          break;
        }
        // A minimized window has NO tree and NO screenshot — the loop is blind.
        // Restore it (rendered, still not focused) rather than flailing.
        if (snap.degraded && snap.totalElementCount === 0 && !snap.screenshotB64) {
          const r = await callTool('bring_to_front', { pid, window_id: windowId, ...(sess ? { session: sess } : {}) }, { timeoutMs: 20000 });
          history.push({ action: 'bring_to_front', detail: 'window was minimized', outcome: r.ok ? 'restored (rendered, not focused)' : r.summary });
          await new Promise((res) => setTimeout(res, 800));
          const re = await snapshotWindow(pid, windowId, { includeScreenshot: true, session: sess });
          if (re.ok && re.totalElementCount > 0) Object.assign(snap, re);
          else {
            status = 'error';
            finalSummary = 'The target window is minimized and could not be restored — a minimized window exposes no accessibility tree and cannot be screenshotted, so it cannot be driven.';
            break;
          }
        }
        lastSnap = snap;

        // 2. REASON.
        const prompt = buildStepPrompt({ goal, stepNum, maxSteps, snap, history, lastOutcome, lastVerdict, goalCheck });
        let decision;
        try {
          const text = await callLlm({
            prompt,
            imageB64: snap.screenshotB64,
            provider: llmSession.provider,
            model: llmSession.model,
            authToken,
          });
          decision = extractJson(text);
          if (!decision || !decision.action) throw new Error(`LLM reply was not an action JSON: ${String(text).slice(0, 300)}`);
        } catch (e) {
          status = 'error';
          finalSummary = `Reasoning failed at step ${stepNum}: ${e.message}`;
          break;
        }

        const detail = decision.elementIndex != null ? `#${decision.elementIndex}`
          : Array.isArray(decision.menuPath) ? decision.menuPath.join(' > ')
          : decision.text ? JSON.stringify(String(decision.text).slice(0, 60))
          : decision.key || (decision.keys || []).join('+') || decision.direction || decision.summary?.slice(0, 80) || '';
        steps.push({ step: stepNum, action: decision.action, detail, reason: decision.reason || decision.summary || '', snapshotId: snap.snapshotId });

        // ── DONE: gated on a real measurement when one was requested. ───────
        if (decision.action === 'done') {
          if (goalCheck) {
            const v = await measure(goalCheck);
            steps[steps.length - 1].verified = v;
            if (!v?.satisfied) {
              // The model claimed completion the driver cannot confirm. Do not
              // accept it — feed the measurement back and keep working.
              lastVerdict = v || { label: goalCheck, satisfied: false, status: 'unknown' };
              lastOutcome = null;
              history.push({ action: 'done(claimed)', detail: goalCheck, outcome: `REJECTED — postcondition ${v?.status || 'unknown'}` });
              steps[steps.length - 1].outcome = `done rejected: postcondition "${goalCheck}" is ${v?.status || 'unknown'}`;
              if (stepNum === maxSteps) { status = 'failed'; finalSummary = `Agent declared done, but the goal postcondition "${goalCheck}" was never satisfied.`; }
              continue;
            }
          }
          status = 'completed';
          finalSummary = decision.summary || 'Goal achieved.';
          break;
        }
        if (decision.action === 'fail') { status = 'failed'; finalSummary = decision.summary || 'Agent declared the goal unreachable.'; break; }

        if (dryRun) {
          status = 'dry_run';
          finalSummary = `DRY RUN — first planned action: ${decision.action} ${detail}. Re-run with dryRun=false confirm=true to execute.`;
          break;
        }

        // Loop guard. 3 for ordinary repeats (scrolling three times is not a
        // stall), but 2 when the driver already REFUSED the identical action —
        // repeating a refusal is never progress.
        const sig = `${decision.action}|${detail}|${decision.deliveryMode || ''}`;
        stallCounter.set(sig, (stallCounter.get(sig) || 0) + 1);
        const repeats = stallCounter.get(sig);
        // An action the driver has ALREADY rejected cannot succeed unchanged,
        // so it gets one strike, not three. Tracked per-signature rather than
        // "the last action" — a model that alternates A,B,A,B would otherwise
        // never trip the guard.
        const previouslyRejected = hardFailedSigs.has(sig);
        if (repeats >= 3 || (repeats >= 2 && previouslyRejected)) {
          status = 'failed';
          finalSummary = previouslyRejected
            ? `Stopped: re-issued "${sig}" after the driver had already rejected it. Repeating a rejected action cannot succeed.`
            : `Stalled: action "${sig}" repeated 3 times without progress.`;
          break;
        }

        // 3. ACT.
        let outcome = null;
        try {
          outcome = await this.dispatch(decision, { pid, windowId, snap, session: sess });
          if (decision.deliveryMode === 'foreground') escalatedForeground = true;
        } catch (e) {
          outcome = { ok: false, refused: false, summary: `ERROR: ${e.message}`, effect: null, route: null, code: null, escalation: null };
        }
        lastOutcome = outcome;
        if (outcome.failedHard) hardFailedSigs.add(sig);
        steps[steps.length - 1].effect = outcome.effect;
        steps[steps.length - 1].route = outcome.route;
        steps[steps.length - 1].outcome = outcome.summary;

        if (stepDelayMs) await new Promise((res) => setTimeout(res, stepDelayMs));

        // 4. MEASURE — the model's own stated postcondition, checked by the
        //    driver against real state instead of by the model against a JPEG.
        lastVerdict = null;
        if (decision.expect && decision.action !== 'verify') {
          lastVerdict = await measure(decision.expect);
          steps[steps.length - 1].verified = lastVerdict;
        }

        history.push({
          action: decision.action,
          detail,
          outcome: outcome.failedHard ? `FAILED (${outcome.code || 'rejected'}) — DID NOT HAPPEN, do not repeat`
            : lastVerdict?.satisfied ? `ok — postcondition verified`
            : lastVerdict && !lastVerdict.satisfied ? `dispatched (${outcome.effect || 'ok'}) but postcondition ${lastVerdict.status}`
            : outcome.summary.slice(0, 120),
        });
      }

      if (status === 'max_steps') finalSummary = `Reached maxSteps (${maxSteps}) without the agent declaring done.`;

      // Final independent measurement, regardless of what the agent claimed.
      let goalVerified = null;
      if (goalCheck && !dryRun) goalVerified = await measure(goalCheck);

      const imageHtml = lastSnap?.screenshotB64
        ? `<img src="data:image/png;base64,${lastSnap.screenshotB64}" alt="Final window state (goal: ${goal.slice(0, 60)})" style="max-width:100%;border-radius:8px;border:1px solid #2a2a3a;" />`
        : null;

      return {
        success: status === 'completed' || status === 'dry_run',
        status,
        goal,
        pid,
        windowId,
        session: sessionStarted ? driverSession : null,
        cursorShown: sessionStarted,
        provider: llmSession.provider,
        model: llmSession.model || '(provider default)',
        providerSource: llmSession.fromSession ? 'session default' : 'params/fallback',
        stepsTaken: steps.length,
        maxSteps,
        steps,
        goalVerified,
        foregroundEscalated: escalatedForeground,
        summary: finalSummary,
        imageHtml,
        bootstrap: boot.steps,
        note: status === 'completed'
          ? `✅ ${finalSummary}${goalVerified?.satisfied ? ' (postcondition independently verified)' : ''}`
          : status === 'dry_run' ? finalSummary
          : `${status.toUpperCase()}: ${finalSummary}`,
      };
    } catch (e) {
      return { success: false, status: 'error', error: e?.message || String(e), steps };
    } finally {
      // Never leave a cursor stranded, even on an abort.
      if (sessionStarted) { try { await endSession(driverSession); } catch { /* ignore */ } }
    }
  }

  async dispatch(decision, { pid, windowId, snap, session }) {
    const base = () => {
      const b = { pid };
      if (session) b.session = session;
      if (decision.deliveryMode === 'foreground') b.delivery_mode = 'foreground';
      return b;
    };
    const byIndex = (n) => {
      const el = snap.elements.find((e) => e.index === Number(n));
      if (!el) throw new Error(`elementIndex ${n} is not in the current snapshot (${snap.elements.length} elements).`);
      return el.token ? { element_token: el.token } : { element_index: el.index, snapshot_id: snap.snapshotId, window_id: windowId };
    };

    switch (decision.action) {
      case 'click':
      case 'double_click':
      case 'right_click':
        return callTool(decision.action, { ...base(), ...byIndex(decision.elementIndex) }, { timeoutMs: 30000 });

      case 'click_xy': {
        if (decision.x == null || decision.y == null) throw new Error('click_xy requires x and y.');
        return callTool('click', { ...base(), window_id: windowId, x: Number(decision.x), y: Number(decision.y) }, { timeoutMs: 30000 });
      }

      case 'type':
      case 'type_xy': {
        if (!decision.text) throw new Error('type requires text.');
        const arg = { ...base(), text: String(decision.text) };
        const wantsPixel = decision.action === 'type_xy' || (decision.x != null && decision.y != null);
        if (wantsPixel) {
          if (decision.x == null || decision.y == null) throw new Error('type_xy requires x and y (the centre of the field, in screenshot pixels).');
          arg.x = Number(decision.x); arg.y = Number(decision.y); arg.window_id = windowId;
        } else if (decision.elementIndex != null) {
          Object.assign(arg, byIndex(decision.elementIndex));
        } else {
          arg.window_id = windowId;
        }
        return callTool('type_text', arg, { timeoutMs: 45000 });
      }

      // The route into editors that expose no ValuePattern. Reference case:
      // the Windows 11 Notepad text area, where type_text can only fall back to
      // synthetic events that need foreground focus.
      case 'paste_text': {
        if (!decision.text) throw new Error('paste_text requires text.');
        const w = await clipboardWrite({ text: String(decision.text), session });
        if (!w.ok) return w;
        const arg = { ...base(), window_id: windowId, keys: ['ctrl', 'v'] };
        // A pixel anchor is what makes Ctrl+V reach a XAML host at all: it
        // clicks to establish real renderer focus first. Measured on Win11
        // Notepad, the anchorless form is refused outright (no matching UIA
        // AcceleratorKey) and even the anchored one needs foreground.
        if (decision.x != null && decision.y != null) { arg.x = Number(decision.x); arg.y = Number(decision.y); }
        return callTool('hotkey', arg, { timeoutMs: 30000 });
      }

      case 'set_value': {
        if (decision.value == null) throw new Error('set_value requires value.');
        return callTool('set_value', { ...base(), value: String(decision.value), ...byIndex(decision.elementIndex) }, { timeoutMs: 30000 });
      }

      case 'invoke_menu': {
        const path = Array.isArray(decision.menuPath) ? decision.menuPath
          : String(decision.text || '').split('>').map((s) => s.trim()).filter(Boolean);
        if (!path.length) throw new Error('invoke_menu requires menuPath.');
        return invokeMenu(pid, windowId, path, { session });
      }

      case 'press_key': {
        if (!decision.key) throw new Error('press_key requires key.');
        const arg = { ...base(), window_id: windowId, key: String(decision.key) };
        if (Array.isArray(decision.modifiers) && decision.modifiers.length) arg.modifiers = decision.modifiers;
        if (decision.elementIndex != null) Object.assign(arg, byIndex(decision.elementIndex));
        return callTool('press_key', arg, { timeoutMs: 30000 });
      }

      case 'hotkey': {
        const keys = Array.isArray(decision.keys) ? decision.keys : String(decision.keys || '').split('+').filter(Boolean);
        if (keys.length < 2) throw new Error('hotkey requires at least two keys.');
        return callTool('hotkey', { ...base(), window_id: windowId, keys }, { timeoutMs: 30000 });
      }

      case 'scroll':
        return callTool('scroll', {
          ...base(), window_id: windowId,
          direction: ['up', 'down', 'left', 'right'].includes(decision.direction) ? decision.direction : 'down',
          amount: Math.max(1, Math.min(50, Number(decision.amount) || 3)),
        }, { timeoutMs: 30000 });

      case 'zoom': {
        const z = await zoomRegion(pid, windowId, Number(decision.x1), Number(decision.y1), Number(decision.x2), Number(decision.y2));
        return { ok: z.ok, refused: !z.ok, effect: z.ok ? 'confirmed' : 'refused', route: 'accessibility', code: null, escalation: null, summary: z.ok ? `zoomed ${z.width}x${z.height}` : `zoom failed: ${z.error}` };
      }

      case 'verify': {
        const v = await verifyState(pid, windowId, [{ element: { selector: { label_contains: String(decision.expect || '') }, exists: true } }], { session, timeoutMs: 3000 });
        return { ok: true, refused: false, effect: v.satisfied ? 'confirmed' : 'unverifiable', route: 'accessibility', code: null, escalation: null, summary: `verify "${decision.expect}" → ${v.status}` };
      }

      case 'wait': {
        const ms = Math.max(100, Math.min(10000, Number(decision.ms) || 1000));
        await new Promise((res) => setTimeout(res, ms));
        return { ok: true, refused: false, effect: 'confirmed', route: null, code: null, escalation: null, summary: `waited ${ms}ms` };
      }

      default:
        throw new Error(`Unknown action from LLM: ${decision.action}`);
    }
  }
}

export default new CuaAct();
