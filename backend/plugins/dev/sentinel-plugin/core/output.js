// Shared output-shaping for the Sentinel tool nodes.
//
// Problem this solves: on a large repo the findings array (and the rendered HTML /
// Markdown report) can be hundreds of KB. Returning those inline from a tool node
// overflows the orchestrator's context-protection cap and the whole result is dropped
// with "result exceeded the N-char context-protection cap" — i.e. the tool *looks*
// broken even though the scan ran fine.
//
// The fix: always persist the full payload to disk and return a COMPACT result — the
// summary, a capped slice of the highest-severity findings, path(s) to the full data,
// and explicit truncation metadata. Downstream nodes that need every finding read the
// JSON file; the chat/orchestrator gets a digest that always fits in context.

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

// Hard ceilings. Kept well under the 400k context cap so the compact result — even
// with long evidence strings — never trips it. Findings are pre-sorted by severity by
// the engine, so the slice is always the most important ones.
const MAX_INLINE_FINDINGS = 40;
const MAX_EVIDENCE_CHARS = 400;

/** Absolute path to the sentinel output dir (created on demand). */
export function reportsDir() {
  const base = process.env.USER_DATA_PATH || process.cwd();
  return join(base, 'sentinel-reports');
}

/** Trim a single finding to a bounded, context-safe shape for inline return. */
function slimFinding(f) {
  const ev = typeof f.evidence === 'string' && f.evidence.length > MAX_EVIDENCE_CHARS
    ? f.evidence.slice(0, MAX_EVIDENCE_CHARS) + '…'
    : f.evidence;
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    tool: f.tool,
    ruleId: f.ruleId,
    title: f.title,
    file: f.file,
    line: f.line,
    cwe: f.cwe,
    confidence: f.confidence,
    evidence: ev,
  };
}

/**
 * Persist the full findings array to disk and build a compact, context-safe summary
 * of it for inline return.
 * @returns {Promise<{ findingsPath: string|null, topFindings: object[], totalFindings: number, truncated: boolean, persistError?: string }>}
 */
export async function persistFindings(findings, summary, baseName = 'scan') {
  const all = Array.isArray(findings) ? findings : [];
  const safeName = String(summary?.repoName || baseName).replace(/[^\w.-]/g, '_');
  let findingsPath = null;
  let persistError;
  try {
    const dir = reportsDir();
    await mkdir(dir, { recursive: true });
    findingsPath = join(dir, `sentinel-${safeName}-${Date.now()}.findings.json`);
    await writeFile(findingsPath, JSON.stringify({ summary, findings: all }, null, 2), 'utf8');
  } catch (e) {
    persistError = e.message;
    findingsPath = null;
  }
  return {
    findingsPath,
    topFindings: all.slice(0, MAX_INLINE_FINDINGS).map(slimFinding),
    totalFindings: all.length,
    truncated: all.length > MAX_INLINE_FINDINGS,
    ...(persistError ? { persistError } : {}),
  };
}

/**
 * Persist the rendered HTML + Markdown report to disk. Returns paths only — the full
 * strings are never returned inline (they can be hundreds of KB).
 * @returns {Promise<{ reportPath: string|null, markdownPath: string|null, persistError?: string }>}
 */
export async function persistReport(html, markdown, summary, baseName = 'report') {
  const safeName = String(summary?.repoName || baseName).replace(/[^\w.-]/g, '_');
  const stamp = Date.now();
  let reportPath = null;
  let markdownPath = null;
  let persistError;
  try {
    const dir = reportsDir();
    await mkdir(dir, { recursive: true });
    reportPath = join(dir, `sentinel-${safeName}-${stamp}.html`);
    await writeFile(reportPath, html ?? '', 'utf8');
    if (typeof markdown === 'string' && markdown.length) {
      markdownPath = join(dir, `sentinel-${safeName}-${stamp}.md`);
      await writeFile(markdownPath, markdown, 'utf8');
    }
  } catch (e) {
    persistError = e.message;
  }
  return { reportPath, markdownPath, ...(persistError ? { persistError } : {}) };
}

export { MAX_INLINE_FINDINGS };
