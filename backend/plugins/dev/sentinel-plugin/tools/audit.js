// AGNT node: sentinel-audit — one-shot scan + report. What the simple frontend calls.
//
// Persists the full findings array AND the rendered HTML/Markdown report to disk, and
// returns a compact digest (summary + top findings + paths + prose excerpt). The full
// payloads are never returned inline — on a large repo they overflow the context cap.
import { scan } from '../core/engine.js';
import { generateReportProse } from '../core/llm.js';
import { renderHtml, renderMarkdown } from '../core/render.js';
import { persistFindings, persistReport } from '../core/output.js';

class SentinelAudit {
  constructor() { this.name = 'sentinel-audit'; }

  async execute(params, inputData, workflowEngine) {
    const target = (params.target || inputData?.target || '').trim();
    if (!target) return { success: false, error: 'A target (git URL, local path, or URL) is required.' };

    try {
      console.log('[sentinel-audit] scanning', target);
      const res = await scan(target, {
        depth: params.depth || 'standard',
        webActiveProbe: params.webActiveProbe !== false,
        onProgress: (m) => console.log('[sentinel-audit]', m),
      });
      if (!res.success) return { success: false, findings: [], summary: null, error: res.error };

      const provider = params.provider || 'claude-code';
      const prose = await generateReportProse(res.findings, res.summary, provider);
      const html = renderHtml(res.findings, res.summary, prose);
      const markdown = renderMarkdown(res.findings, res.summary, prose);

      const [{ findingsPath, topFindings, totalFindings, truncated }, { reportPath, markdownPath, persistError }] =
        await Promise.all([
          persistFindings(res.findings, res.summary, res.summary?.repoName),
          persistReport(html, markdown, res.summary, res.summary?.repoName),
        ]);
      if (persistError) console.warn('[sentinel-audit] could not save report:', persistError);

      const excerpt = typeof prose?.summary === 'string'
        ? (prose.summary.length > 1200 ? prose.summary.slice(0, 1200) + '…' : prose.summary)
        : null;

      return {
        success: true,
        summary: res.summary,
        totalFindings,
        findings: topFindings,          // capped, severity-sorted slice (context-safe)
        truncated,
        findingsPath,                   // full array on disk
        reportPath,                     // full HTML report on disk
        markdownPath,                   // full Markdown report on disk
        narrativeExcerpt: excerpt,
        narrativeProvider: prose.provider,
        error: prose.error || persistError || null,
      };
    } catch (e) {
      console.error('[sentinel-audit] error:', e);
      return { success: false, findings: [], summary: null, error: e.message };
    }
  }
}

export default new SentinelAudit();
