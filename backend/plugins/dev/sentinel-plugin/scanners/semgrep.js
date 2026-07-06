// SAST scanner via semgrep. Produces real file:line:CWE findings across many languages.
//
// Windows note: the `semgrep` console-script shim is flaky, so we invoke it via the
// Python module entry point (`python -m semgrep`) which is reliable. We fall back to a
// resolved `semgrep` binary if the module form isn't available.
//
// We use `--config auto` (semgrep registry rules) when online, and always include the
// bundled `p/ci` + language rulesets. Output is `--json` which carries check_id, path,
// start.line, end.line, severity, and metadata.cwe / metadata.owasp.

import { readFileSync } from 'fs';
import { run, semgrepInvoker } from '../core/util.js';
import { makeFinding, PROVENANCE } from '../core/findings.js';

const SEMGREP_SEVERITY = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };

// Semgrep redacts the matched source preview (`extra.lines`) to this sentinel when a
// registry rule requires an authenticated Semgrep account. The true LOCATION
// (path + start/end line) is always present regardless of login, so when we see the
// sentinel we read the real snippet straight off disk. Handles the empty case too.
const REDACTED_LINES = /^\s*requires? login\s*$/i;

/**
 * Per-scan cache of file contents split into lines, so reading evidence for hundreds of
 * findings across the same files reads each file at most once. Keyed by absolute path.
 */
function makeLineReader() {
  const cache = new Map();
  return function readLines(absPath, startLine, endLine) {
    if (!absPath || !Number.isInteger(startLine)) return '';
    let lines = cache.get(absPath);
    if (lines === undefined) {
      try { lines = readFileSync(absPath, 'utf8').split(/\r?\n/); }
      catch { lines = null; }
      cache.set(absPath, lines);
    }
    if (!lines) return '';
    const from = Math.max(1, startLine);
    const to = Math.min(lines.length, Number.isInteger(endLine) && endLine >= startLine ? endLine : startLine);
    // Cap multi-line matches so a giant match can't bloat a finding.
    const slice = lines.slice(from - 1, Math.min(to, from + 19));
    return slice.join('\n').trim();
  };
}

/**
 * @param {string} dir  directory to scan
 * @param {object} opts { depth: 'standard'|'deep', timeout, onProgress }
 * @returns {Promise<{findings:array, ran:boolean, error?:string, meta:object}>}
 */
export async function runSemgrep(dir, opts = {}) {
  const { depth = 'standard', timeout = 300000, onProgress } = opts;
  const log = (m) => onProgress && onProgress(m);

  const inv = await semgrepInvoker();
  if (!inv) {
    return { findings: [], ran: false, error: 'semgrep not installed / not runnable', meta: {} };
  }

  log('Running semgrep SAST scan …');

  // Rule configs. `p/default` is the offline-capable baseline that reliably runs on
  // Windows. Deep mode layers on security-audit + secrets + owasp packs. We deliberately
  // AVOID `--config auto` as the sole config because it requires network and can yield
  // empty output when offline; deep mode adds it as an extra layer only.
  const configs = depth === 'deep'
    ? ['--config', 'p/default', '--config', 'p/security-audit', '--config', 'p/secrets', '--config', 'p/owasp-top-ten']
    : ['--config', 'p/default', '--config', 'p/secrets'];

  const args = [
    ...inv.args,
    'scan',
    ...configs,
    '--json',
    '--no-git-ignore',           // scan everything we cloned
    '--timeout', '30',           // per-rule timeout (seconds)
    '--max-target-bytes', '2000000',
    '--metrics', 'off',
    dir,
  ];

  const r = await run(inv.py, args, { timeout, cwd: dir });

  // semgrep exits 1 when findings exist — that's success, not failure. Only a missing
  // JSON body or a hard error (exit >= 2 with no json) is a real failure.
  let parsed;
  try {
    const jsonStart = r.stdout.indexOf('{');
    parsed = jsonStart >= 0 ? JSON.parse(r.stdout.slice(jsonStart)) : null;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    // Retry once with the minimal default ruleset only.
    log('semgrep produced no output; retrying with minimal ruleset …');
    const offlineArgs = [...inv.args, 'scan', '--config', 'p/default', '--json',
      '--no-git-ignore', '--metrics', 'off', '--timeout', '30', dir];
    const r2 = await run(inv.py, offlineArgs, { timeout, cwd: dir });
    try {
      const js = r2.stdout.indexOf('{');
      parsed = js >= 0 ? JSON.parse(r2.stdout.slice(js)) : null;
    } catch { parsed = null; }
    if (!parsed) {
      return {
        findings: [], ran: false,
        error: `semgrep produced no parseable output (exit ${r.code}). ${(r.stderr || '').slice(0, 300)}`,
        meta: {},
      };
    }
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const readLines = makeLineReader();
  const findings = results.map((res) => normalizeSemgrepResult(res, dir, readLines));
  const errors = Array.isArray(parsed.errors) ? parsed.errors.length : 0;

  log(`semgrep: ${findings.length} finding(s).`);
  return {
    findings,
    ran: true,
    meta: { rulesErrors: errors, paths: parsed.paths?.scanned?.length || undefined },
  };
}

function normalizeSemgrepResult(res, dir, readLines) {
  const extra = res.extra || {};
  const meta = extra.metadata || {};
  const sevRaw = (extra.severity || 'INFO').toUpperCase();
  let severity = SEMGREP_SEVERITY[sevRaw] || 'low';

  // Bump severity for high-impact CWE classes semgrep sometimes marks WARNING.
  const cweStr = Array.isArray(meta.cwe) ? meta.cwe.join(' ') : (meta.cwe || '');
  const critClasses = /(CWE-89|CWE-78|CWE-94|CWE-77|CWE-502|CWE-611|CWE-798|SQL Injection|Command Injection|Remote Code|Deserializ)/i;
  if (severity === 'medium' && critClasses.test(cweStr + ' ' + (extra.message || ''))) {
    severity = 'high';
  }

  const relPath = (res.path || '').replace(dir, '').replace(/^[\\/]/, '') || res.path;

  // Prefer semgrep's own preview; if it's missing or the "requires login" redaction
  // sentinel, recover the real matched source line(s) from disk using the exact
  // line range semgrep reported (always accurate, no account needed).
  let lines = extra.lines || '';
  if (!lines || REDACTED_LINES.test(lines)) {
    lines = (readLines ? readLines(res.path, res.start?.line, res.end?.line) : '') || '';
  }

  return makeFinding({
    tool: 'semgrep',
    ruleId: res.check_id || '',
    title: shortTitle(extra.message || res.check_id || 'SAST finding'),
    description: (extra.message || '').trim(),
    severity,
    confidence: meta.confidence === 'HIGH' ? 0.9 : meta.confidence === 'LOW' ? 0.5 : 0.75,
    provenance: PROVENANCE.TOOL_VERIFIED,
    cwe: Array.isArray(meta.cwe) ? meta.cwe[0] : meta.cwe,
    owasp: Array.isArray(meta.owasp) ? meta.owasp[0] : meta.owasp,
    file: relPath,
    line: res.start?.line ?? null,
    endLine: res.end?.line ?? null,
    column: res.start?.col ?? null,
    evidence: lines ? String(lines).slice(0, 600) : `${relPath}:${res.start?.line ?? '?'} (rule: ${res.check_id || 'n/a'})`,
    recommendation: meta.fix || extra.fix || (meta.references ? '' : ''),
    references: Array.isArray(meta.references) ? meta.references : [],
    category: 'code',
  });
}

function shortTitle(msg) {
  const first = String(msg).split(/[.\n]/)[0].trim();
  return first.length > 120 ? first.slice(0, 117) + '…' : first;
}
