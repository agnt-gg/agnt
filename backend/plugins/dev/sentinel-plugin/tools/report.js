// AGNT node: sentinel-report — turn findings into an HTML + Markdown report via the LLM.
//
// Findings may arrive as: an inline array, a full scan-output object, a JSON string, or
// — from the compact sentinel-scan node — a `findingsPath` pointing at the persisted
// full array on disk. We resolve all of those. The rendered HTML/Markdown can be very
// large, so we persist them to disk and return PATHS plus a short prose excerpt, never
// the full strings inline (that would overflow the context cap).
import { readFile } from 'fs/promises';
import { generateReportProse } from '../core/llm.js';
import { renderHtml, renderMarkdown } from '../core/render.js';
import { persistReport } from '../core/output.js';

async function resolveFindings(params, inputData) {
  let findings = params.findings ?? inputData?.findings ?? inputData;
  let summary = params.summary ?? inputData?.summary ?? null;

  // Prefer the persisted full array when a path is available (compact scan output).
  const findingsPath = params.findingsPath ?? inputData?.findingsPath ?? null;
  if (findingsPath) {
    try {
      const raw = JSON.parse(await readFile(findingsPath, 'utf8'));
      findings = Array.isArray(raw) ? raw : raw.findings;
      summary = summary || raw.summary;
    } catch { /* fall through to inline resolution */ }
  }

  if (findings && !Array.isArray(findings) && Array.isArray(findings.findings)) {
    summary = summary || findings.summary;
    findings = findings.findings;
  }
  if (typeof findings === 'string') {
    try { const p = JSON.parse(findings); findings = Array.isArray(p) ? p : p.findings; summary = summary || p.summary; } catch { /* leave */ }
  }
  return { findings: Array.isArray(findings) ? findings : [], summary };
}

class SentinelReport {
  constructor() { this.name = 'sentinel-report'; }

  async execute(params, inputData, workflowEngine) {
    const { findings, summary } = await resolveFindings(params, inputData);
    if (!findings.length && !summary) {
      return { success: false, error: 'No findings provided to report on.' };
    }
    try {
      const provider = params.provider || 'claude-code';
      console.log(`[sentinel-report] generating narrative via ${provider} for ${findings.length} finding(s)`);
      const prose = await generateReportProse(findings, summary, provider);
      const html = renderHtml(findings, summary, prose);
      const markdown = renderMarkdown(findings, summary, prose);

      const { reportPath, markdownPath, persistError } =
        await persistReport(html, markdown, summary, summary?.repoName);
      if (persistError) console.warn('[sentinel-report] could not save file:', persistError);

      // Short excerpt of the narrative so the caller sees prose without the full report.
      const excerpt = typeof prose?.summary === 'string'
        ? (prose.summary.length > 1200 ? prose.summary.slice(0, 1200) + '…' : prose.summary)
        : null;

      return {
        success: true,
        summary,
        totalFindings: findings.length,
        reportPath,
        markdownPath,
        narrativeExcerpt: excerpt,
        narrativeProvider: prose.provider,
        error: prose.error || persistError || null,
      };
    } catch (e) {
      console.error('[sentinel-report] error:', e);
      return { success: false, error: e.message };
    }
  }
}

export default new SentinelReport();
