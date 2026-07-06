// The Sentinel engine: orchestrates ingest → scanners → normalize → dedupe → score.
// Shared by all three tool nodes (scan/report/audit) and the standalone frontend.

import { ingest, detectLanguages } from './ingest.js';
import { dedupe, computeScore, sortFindings } from './findings.js';
import { run, hasBin } from './util.js';
import { runSemgrep } from '../scanners/semgrep.js';
import { runSecrets } from '../scanners/secrets.js';
import { runDeps } from '../scanners/deps.js';
import { runWebRecon } from '../scanners/webrecon.js';
import { rmSync } from 'fs';

/**
 * Full scan pipeline.
 * @param {string} target  git URL | local dir | http(s) URL
 * @param {object} opts { depth, webActiveProbe, onProgress }
 * @returns {Promise<{success, findings, summary, target, scanners, error?}>}
 */
export async function scan(target, opts = {}) {
  const { depth = 'standard', webActiveProbe = true, onProgress = () => {} } = opts;
  const progress = (msg) => { try { onProgress(msg); } catch { /* ignore */ } };
  const startedAt = Date.now();
  let resolved = null;

  try {
    resolved = await ingest(target, { onProgress: progress });

    // ---- URL target: web recon only ----
    if (resolved.kind === 'url') {
      const web = await runWebRecon(resolved.url, { activeProbe: webActiveProbe, onProgress: progress });
      const findings = sortFindings(dedupe(web.findings));
      const summary = buildSummary(findings, {
        target: resolved.url, kind: 'url', depth,
        scanners: [{ name: 'web-recon', ran: web.ran, error: web.error }],
        durationMs: Date.now() - startedAt,
      });
      return { success: true, findings, summary, target: { kind: 'url', url: resolved.url }, scanners: summary.scanners };
    }

    // ---- code target (git or local) ----
    const dir = resolved.dir;
    const langInfo = detectLanguages(dir);
    progress(`Detected: ${langInfo.languages.join(', ') || 'no recognized source'} | ecosystems: ${langInfo.ecosystems.join(', ') || 'none'}`);

    const scannerRuns = [];
    const allFindings = [];

    // Run code scanners. semgrep + secrets always; deps when an ecosystem is present.
    const [sg, sec, deps] = await Promise.all([
      runSemgrep(dir, { depth, onProgress: progress }),
      runSecrets(dir, { onProgress: progress }),
      runDeps(dir, langInfo.ecosystems, { onProgress: progress }),
    ]);

    scannerRuns.push({ name: 'semgrep', ran: sg.ran, error: sg.error, count: sg.findings.length });
    scannerRuns.push({ name: 'detect-secrets', ran: sec.ran, error: sec.error, count: sec.findings.length });
    scannerRuns.push({ name: 'dependency-audit', ran: deps.ran.length > 0, error: deps.errors.join('; ') || undefined, count: deps.findings.length, detail: deps.ran });
    allFindings.push(...sg.findings, ...sec.findings, ...deps.findings);

    // Deep mode: git-history secret sweep (only meaningful for real git repos).
    if (depth === 'deep') {
      const hist = await gitHistorySecretSweep(dir, { onProgress: progress });
      scannerRuns.push({ name: 'git-history-secrets', ran: hist.ran, error: hist.error, count: hist.findings.length });
      allFindings.push(...hist.findings);
    }

    const findings = sortFindings(dedupe(allFindings));
    const summary = buildSummary(findings, {
      target: resolved.sourceUrl || dir,
      kind: resolved.kind,
      repoName: resolved.repoName,
      languages: langInfo.languages,
      ecosystems: langInfo.ecosystems,
      depth,
      scanners: scannerRuns,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      findings,
      summary,
      target: { kind: resolved.kind, path: dir, repoName: resolved.repoName, languages: langInfo.languages, ecosystems: langInfo.ecosystems, sourceUrl: resolved.sourceUrl },
      scanners: scannerRuns,
    };
  } catch (err) {
    return { success: false, findings: [], summary: null, target: null, error: err.message };
  } finally {
    // Clean up cloned temp dirs.
    if (resolved?.isTemp && resolved.dir) {
      try { rmSync(resolved.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function buildSummary(findings, meta) {
  const score = computeScore(findings);
  return {
    ...score, // risk, grade, counts, total
    target: meta.target,
    kind: meta.kind,
    repoName: meta.repoName,
    languages: meta.languages || [],
    ecosystems: meta.ecosystems || [],
    depth: meta.depth,
    scanners: meta.scanners || [],
    durationMs: meta.durationMs,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Deep-mode git history secret sweep. Greps the full commit history for high-signal
 * secret patterns that may have been committed then removed. Bounded to keep it fast.
 */
async function gitHistorySecretSweep(dir, { onProgress } = {}) {
  const log = (m) => onProgress && onProgress(m);
  if (!(await hasBin('git'))) return { findings: [], ran: false, error: 'git not available' };
  // Ensure it's a git repo with history (shallow clones have depth 1; unshallow a bit).
  log('Sweeping git history for secrets …');
  const patterns = [
    ['AWS Access Key', 'AKIA[0-9A-Z]{16}', 'CWE-798'],
    ['Private Key block', '-----BEGIN [A-Z ]*PRIVATE KEY-----', 'CWE-798'],
    ['Generic API token assignment', '(api[_-]?key|secret|token|password)["\\x27\\s:=]+[A-Za-z0-9/+_\\-]{16,}', 'CWE-798'],
  ];
  const findings = [];
  for (const [name, re, cwe] of patterns) {
    const r = await run('git', ['-C', dir, 'grep', '-nIE', '--all-match', '-e', re, '$(git rev-list --all)'], { timeout: 45000 });
    // git grep over all revs via rev-list isn't portable through argv; use log -p fallback.
  }
  // Portable approach: scan `git log -p` output for the patterns.
  const logRes = await run('git', ['-C', dir, 'log', '-p', '--all', '--max-count=400', '--no-color'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (logRes.code !== 0 && !logRes.stdout) {
    return { findings: [], ran: false, error: 'no git history available (shallow clone)' };
  }
  const { makeFinding, PROVENANCE } = await import('./findings.js');
  const lines = logRes.stdout.split('\n');
  const seen = new Set();
  for (const [name, reStr, cwe] of patterns) {
    const re = new RegExp(reStr);
    for (const line of lines) {
      if (!line.startsWith('+')) continue; // only added lines
      if (re.test(line)) {
        const key = name + '::' + line.slice(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(makeFinding({
          tool: 'git-history', ruleId: name, title: `Secret in git history: ${name}`,
          description: `A ${name} pattern appears in the repository's commit history. Even if removed from the current tree, it remains recoverable from history and must be treated as compromised.`,
          severity: 'high', confidence: 0.6, provenance: PROVENANCE.TOOL_VERIFIED, cwe,
          file: 'git history', evidence: `${name} matched in a historical commit (value redacted).`,
          recommendation: 'Rotate the credential now. Purge it from history with git filter-repo/BFG and force-push, then invalidate the old value.',
          category: 'secret',
        }));
        if (findings.length >= 25) break;
      }
    }
  }
  log(`git-history: ${findings.length} historical secret(s).`);
  return { findings, ran: true };
}
