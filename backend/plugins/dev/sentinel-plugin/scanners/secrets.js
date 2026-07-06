// Secret scanner via detect-secrets (Python, already installed: v5.4.3).
// Finds committed API keys, tokens, private keys, high-entropy strings — with file:line.
// Secret VALUES are never emitted; we redact to type + location only.

import { run, pythonModuleAvailable } from '../core/util.js';
import { makeFinding, PROVENANCE } from '../core/findings.js';

const SECRET_CWE = 'CWE-798'; // Use of Hard-coded Credentials

export async function runSecrets(dir, opts = {}) {
  const { timeout = 180000, onProgress } = opts;
  const log = (m) => onProgress && onProgress(m);

  const py = await pythonModuleAvailable('detect_secrets');
  if (!py) return { findings: [], ran: false, error: 'detect-secrets not installed', meta: {} };

  log('Scanning for hard-coded secrets …');
  // `detect-secrets scan <dir>` emits a JSON baseline with results keyed by file path.
  const r = await run(py, ['-m', 'detect_secrets', 'scan', dir], { timeout, cwd: dir });

  let parsed;
  try {
    const js = r.stdout.indexOf('{');
    parsed = js >= 0 ? JSON.parse(r.stdout.slice(js)) : null;
  } catch { parsed = null; }

  if (!parsed || !parsed.results) {
    if (r.spawnError || r.code < 0) {
      return { findings: [], ran: false, error: `detect-secrets failed: ${(r.stderr || r.spawnError || '').slice(0, 300)}`, meta: {} };
    }
    return { findings: [], ran: true, meta: { note: 'no secrets detected' } };
  }

  const findings = [];
  for (const [file, hits] of Object.entries(parsed.results)) {
    for (const h of hits) {
      const relPath = file.replace(dir, '').replace(/^[\\/]/, '') || file;
      findings.push(makeFinding({
        tool: 'detect-secrets',
        ruleId: h.type || 'Secret',
        title: `Possible hard-coded secret: ${h.type || 'unknown type'}`,
        description: `A ${h.type || 'secret'} pattern was detected in source. Hard-coded credentials in a repository can be extracted by anyone with read access and must be rotated and moved to a secret manager or environment variable.`,
        severity: 'high',
        confidence: h.is_verified ? 0.95 : 0.6,
        provenance: PROVENANCE.TOOL_VERIFIED,
        cwe: SECRET_CWE,
        owasp: 'A07:2021',
        file: relPath,
        line: h.line_number ?? null,
        evidence: `${relPath}:${h.line_number ?? '?'} — ${h.type || 'secret'} (value redacted)`,
        recommendation: 'Rotate the exposed credential immediately, remove it from source, and load it from an environment variable or secret manager. Purge it from git history if committed.',
        category: 'secret',
      }));
    }
  }
  log(`detect-secrets: ${findings.length} potential secret(s).`);
  return { findings, ran: true, meta: {} };
}
