// Dependency vulnerability scanner.
//   - JS/TS  → `npm audit --json` (built into npm, offline advisory DB via registry)
//   - Python → `pip-audit --format json` (if installed) against requirements/pyproject
// Each vulnerable package becomes a finding with the advisory id, CVE, severity, and the
// fixed version. Location is the manifest file (package.json / requirements.txt).

import { run, hasBin, pythonModuleAvailable } from '../core/util.js';
import { makeFinding, PROVENANCE } from '../core/findings.js';
import { existsSync } from 'fs';
import { join } from 'path';

const NPM_SEVERITY = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'info' };

export async function runDeps(dir, ecosystems = [], opts = {}) {
  const { timeout = 180000, onProgress } = opts;
  const log = (m) => onProgress && onProgress(m);
  const findings = [];
  const ran = [];
  const errors = [];

  if (ecosystems.includes('npm') && existsSync(join(dir, 'package.json'))) {
    log('Auditing npm dependencies …');
    const res = await auditNpm(dir, timeout);
    findings.push(...res.findings);
    if (res.ran) ran.push('npm audit'); else if (res.error) errors.push(`npm: ${res.error}`);
  }

  if (ecosystems.includes('pip')) {
    const py = await pythonModuleAvailable('pip_audit');
    if (py) {
      log('Auditing Python dependencies …');
      const res = await auditPip(py, dir, timeout);
      findings.push(...res.findings);
      if (res.ran) ran.push('pip-audit'); else if (res.error) errors.push(`pip: ${res.error}`);
    } else {
      errors.push('pip-audit not installed (skipped Python dep audit)');
    }
  }

  return { findings, ran, errors };
}

async function auditNpm(dir, timeout) {
  // npm audit REQUIRES a lockfile. If none exists, generate one WITHOUT installing
  // packages (`--package-lock-only`) into an isolated run so we never touch the user's
  // tree or hit the network for tarballs. This is fast and side-effect-free on the
  // scanned copy (which, for git targets, is a throwaway temp clone anyway).
  const hasLock = existsSync(join(dir, 'package-lock.json')) ||
                  existsSync(join(dir, 'npm-shrinkwrap.json'));
  if (!hasLock) {
    await run('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund',
      '--ignore-scripts', '--loglevel', 'error'], { timeout, cwd: dir });
  }
  const r = await run('npm', ['audit', '--json', '--audit-level=low'], { timeout, cwd: dir });
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (!parsed) {
    return { findings: [], ran: false, error: `no parseable audit output (exit ${r.code})` };
  }
  if (parsed.error) {
    return { findings: [], ran: false, error: (parsed.error.summary || parsed.error.code || 'npm audit error') };
  }
  const findings = [];
  // npm v7+ shape: parsed.vulnerabilities = { pkgName: { severity, via:[...], range, fixAvailable } }
  const vulns = parsed.vulnerabilities || {};
  for (const [pkg, v] of Object.entries(vulns)) {
    const via = Array.isArray(v.via) ? v.via : [];
    const advisories = via.filter((x) => typeof x === 'object');
    const title = advisories[0]?.title || `Vulnerable dependency: ${pkg}`;
    const cwe = advisories[0]?.cwe?.[0] || '';
    const url = advisories[0]?.url || '';
    const cve = (advisories[0]?.cve || advisories[0]?.cves?.[0]) || '';
    const fix = v.fixAvailable
      ? (typeof v.fixAvailable === 'object'
          ? `Upgrade to ${v.fixAvailable.name}@${v.fixAvailable.version}`
          : 'A fix is available via `npm audit fix`')
      : 'No fix currently available; consider replacing or pinning the dependency.';
    findings.push(makeFinding({
      tool: 'npm-audit',
      ruleId: cve || advisories[0]?.source?.toString() || pkg,
      title: `${pkg}: ${title}`,
      description: `The dependency "${pkg}" (range ${v.range || 'unknown'}) has a known ${v.severity} vulnerability${cve ? ` (${cve})` : ''}.`,
      severity: NPM_SEVERITY[v.severity] || 'medium',
      confidence: 0.9,
      provenance: PROVENANCE.TOOL_VERIFIED,
      cwe,
      file: 'package.json',
      line: null,
      evidence: `${pkg} @ ${v.range || '?'} — ${v.severity}${cve ? ' ' + cve : ''}`,
      recommendation: fix,
      references: url ? [url] : [],
      category: 'dependency',
    }));
  }
  return { findings, ran: true };
}

async function auditPip(py, dir, timeout) {
  const req = existsSync(join(dir, 'requirements.txt')) ? ['-r', join(dir, 'requirements.txt')] : [];
  const args = ['-m', 'pip_audit', '--format', 'json', ...req];
  const r = await run(py, args, { timeout, cwd: dir });
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (!parsed) return { findings: [], ran: false, error: `no parseable pip-audit output (exit ${r.code})` };
  const list = Array.isArray(parsed) ? parsed : (parsed.dependencies || []);
  const findings = [];
  for (const dep of list) {
    const vulns = dep.vulns || dep.vulnerabilities || [];
    for (const vln of vulns) {
      findings.push(makeFinding({
        tool: 'pip-audit',
        ruleId: vln.id || '',
        title: `${dep.name}: ${vln.id || 'known vulnerability'}`,
        description: (vln.description || `The Python package "${dep.name}" ${dep.version || ''} has a known vulnerability.`).slice(0, 600),
        severity: 'high',
        confidence: 0.9,
        provenance: PROVENANCE.TOOL_VERIFIED,
        file: existsSync(join(dir, 'requirements.txt')) ? 'requirements.txt' : 'pyproject.toml',
        evidence: `${dep.name} ${dep.version || ''} — ${vln.id || ''}`,
        recommendation: vln.fix_versions?.length ? `Upgrade to ${vln.fix_versions.join(' or ')}.` : 'Check the advisory for a fixed version.',
        category: 'dependency',
      }));
    }
  }
  return { findings, ran: true };
}
