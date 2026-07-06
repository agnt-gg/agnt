// The single normalized Finding schema + dedupe + deterministic scoring.
//
// DESIGN INVARIANT (the anti-T3MP3ST rule):
//   Every finding has a `provenance` tier. Only `tool-verified` findings may carry
//   HIGH or CRITICAL severity. An `llm-observation` is capped at INFO and can NEVER
//   raise the risk score. The LLM describes; scanners decide. This is enforced in
//   clampSeverityByProvenance() and is the reason this tool won't produce a wall of
//   confident, unverified guesses.

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
export const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// Provenance tiers, most trustworthy last.
export const PROVENANCE = {
  TOOL_VERIFIED: 'tool-verified',   // a scanner matched a rule at a real location
  LLM_TRIAGED: 'llm-triaged',       // tool-verified, then LLM added context/severity
  LLM_OBSERVATION: 'llm-observation', // LLM-only note; capped at INFO, never scores
};
const PROVENANCE_RANK = { 'llm-observation': 0, 'llm-triaged': 1, 'tool-verified': 2 };

/**
 * Build a normalized finding. Missing fields are defaulted; severity is clamped by
 * provenance so an LLM note can never masquerade as a critical bug.
 */
export function makeFinding(raw) {
  const f = {
    id: raw.id || cryptoRandomId(),
    tool: raw.tool || 'unknown',
    ruleId: raw.ruleId || '',
    title: (raw.title || 'Untitled finding').trim(),
    description: (raw.description || '').trim(),
    severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'info',
    confidence: typeof raw.confidence === 'number' ? clamp01(raw.confidence) : 0.7,
    provenance: PROVENANCE_RANK[raw.provenance] != null ? raw.provenance : PROVENANCE.TOOL_VERIFIED,
    cwe: normalizeCwe(raw.cwe),
    owasp: raw.owasp || '',
    // Location — the whole point. For code findings these are populated; for
    // network/web findings `file` may be a URL and line may be null.
    file: raw.file || null,
    line: Number.isInteger(raw.line) ? raw.line : (raw.line ? parseInt(raw.line, 10) || null : null),
    endLine: Number.isInteger(raw.endLine) ? raw.endLine : null,
    column: Number.isInteger(raw.column) ? raw.column : null,
    // Evidence — the receipt. A code snippet, a matched string (redacted for secrets),
    // an HTTP header, a CVE id + version. Never empty for tool-verified findings.
    evidence: (raw.evidence || '').toString().slice(0, 4000),
    // Remediation — populated by scanners when known, enriched by the LLM later.
    recommendation: (raw.recommendation || '').trim(),
    references: Array.isArray(raw.references) ? raw.references.slice(0, 10) : [],
    category: raw.category || 'code', // code | secret | dependency | web | config
    fingerprint: '',
  };
  f.severity = clampSeverityByProvenance(f.severity, f.provenance);
  f.fingerprint = dedupKey(f);
  return f;
}

/** Provenance ceiling: LLM-only observations can never exceed INFO. */
export function clampSeverityByProvenance(severity, provenance) {
  if (provenance === PROVENANCE.LLM_OBSERVATION) return 'info';
  return SEVERITIES.includes(severity) ? severity : 'info';
}

/**
 * Dedup key — lifted in spirit from T3MP3ST's pack/board (`file :: CWE :: line-bucket`),
 * the one genuinely good idea in that codebase. Two findings mapping to the same key
 * are the same lead; we keep the higher-provenance / higher-severity one.
 * Line is bucketed by 15 so trivial line drift doesn't create duplicates.
 */
export function dedupKey(f) {
  if (f.category === 'dependency' && f.ruleId) {
    // deps dedup on advisory + package, not file:line
    return `dep::${(f.ruleId || '').toLowerCase()}::${(f.title || '').toLowerCase().slice(0, 40)}`;
  }
  if (f.category === 'web' && f.file) {
    return `web::${(f.ruleId || f.title || '').toLowerCase()}::${f.file}`;
  }
  const file = (f.file || '').replace(/\\/g, '/').toLowerCase();
  const cwe = (f.cwe || 'nocwe').toLowerCase();
  const bucket = f.line != null ? Math.floor(f.line / 15) : 'x';
  const rule = (f.ruleId || '').toLowerCase();
  return `${file}::${cwe}::${bucket}::${rule}`;
}

/** Collapse duplicates, keeping the strongest evidence. */
export function dedupe(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const k = f.fingerprint || dedupKey(f);
    const existing = byKey.get(k);
    if (!existing) { byKey.set(k, f); continue; }
    if (isStronger(f, existing)) {
      // merge: keep stronger record but preserve the richer evidence/recommendation
      f.evidence = f.evidence || existing.evidence;
      f.recommendation = f.recommendation || existing.recommendation;
      byKey.set(k, f);
    }
  }
  return [...byKey.values()];
}

function isStronger(a, b) {
  const pa = PROVENANCE_RANK[a.provenance] ?? 0;
  const pb = PROVENANCE_RANK[b.provenance] ?? 0;
  if (pa !== pb) return pa > pb;
  const sa = SEVERITY_RANK[a.severity] ?? 0;
  const sb = SEVERITY_RANK[b.severity] ?? 0;
  if (sa !== sb) return sa > sb;
  return (a.confidence || 0) > (b.confidence || 0);
}

/**
 * Deterministic risk score (0-100). Computed ONLY from tool-verified + llm-triaged
 * findings. Weighted by severity; saturates so 500 lows don't equal one critical.
 * The LLM never touches this number.
 */
export function computeScore(findings) {
  const weights = { critical: 40, high: 18, medium: 7, low: 2, info: 0 };
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let raw = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    if (f.provenance === PROVENANCE.LLM_OBSERVATION) continue; // never scores
    raw += weights[f.severity] || 0;
  }
  // Saturating curve: risk = 100 * (1 - e^(-raw/60)). One critical ≈ 49, two ≈ 74.
  const risk = Math.round(100 * (1 - Math.exp(-raw / 60)));
  let grade;
  if (counts.critical > 0 || risk >= 75) grade = 'F';
  else if (counts.high > 0 || risk >= 50) grade = 'D';
  else if (risk >= 30) grade = 'C';
  else if (risk >= 12) grade = 'B';
  else grade = 'A';
  return { risk, grade, counts, total: findings.length };
}

/** Sort findings for presentation: severity desc, then category, then file. */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const s = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (s) return s;
    const c = (a.category || '').localeCompare(b.category || '');
    if (c) return c;
    return (a.file || '').localeCompare(b.file || '');
  });
}

// ---- small helpers ----
function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function normalizeCwe(cwe) {
  if (!cwe) return '';
  const s = String(cwe).toUpperCase();
  const m = s.match(/CWE[-\s]?(\d+)/);
  if (m) return `CWE-${m[1]}`;
  if (/^\d+$/.test(s)) return `CWE-${s}`;
  return s.startsWith('CWE') ? s : '';
}
function cryptoRandomId() {
  return 'f_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
