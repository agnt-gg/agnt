// AGNT node: sentinel-scan — deterministic scan only (no LLM). Ground-truth findings.
//
// The full findings array can be hundreds of KB on a large repo, which overflows the
// orchestrator context cap if returned inline. We ALWAYS persist the full array to disk
// and return a compact digest (summary + top findings + path). Downstream nodes that
// need every finding read `findingsPath`; sentinel-report also accepts that file.
import { scan } from '../core/engine.js';
import { persistFindings } from '../core/output.js';

class SentinelScan {
  constructor() { this.name = 'sentinel-scan'; }

  async execute(params, inputData, workflowEngine) {
    const target = (params.target || inputData?.target || '').trim();
    if (!target) return { success: false, error: 'A target (git URL, local path, or URL) is required.' };
    try {
      const res = await scan(target, {
        depth: params.depth || 'standard',
        webActiveProbe: params.webActiveProbe !== false,
        onProgress: (m) => console.log('[sentinel-scan]', m),
      });

      const { findingsPath, topFindings, totalFindings, truncated, persistError } =
        await persistFindings(res.findings, res.summary, res.summary?.repoName);

      return {
        success: res.success,
        summary: res.summary,
        target: res.target,
        totalFindings,
        findings: topFindings,          // capped, severity-sorted slice (context-safe)
        truncated,                      // true if more findings exist on disk
        findingsPath,                   // full array persisted here as JSON
        error: res.error || persistError || null,
      };
    } catch (e) {
      console.error('[sentinel-scan] error:', e);
      return { success: false, findings: [], summary: null, error: e.message };
    }
  }
}

export default new SentinelScan();
