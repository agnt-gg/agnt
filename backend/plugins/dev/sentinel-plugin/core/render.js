// Report renderers: findings + LLM prose → standalone HTML and Markdown.
// The HTML is self-contained (inline CSS), dark, and designed to be genuinely readable:
// severity-sorted, collapsible per finding, showing exact file:line:CWE, evidence, and fix.

const SEV_COLOR = { critical: '#ff3b6b', high: '#ff8a3d', medium: '#ffd23d', low: '#4dd4ff', info: '#8b9bb4' };
const SEV_BG = { critical: 'rgba(255,59,107,.12)', high: 'rgba(255,138,61,.12)', medium: 'rgba(255,210,61,.12)', low: 'rgba(77,212,255,.10)', info: 'rgba(139,155,180,.10)' };
const GRADE_COLOR = { A: '#19ef83', B: '#8ee04e', C: '#ffd23d', D: '#ff8a3d', F: '#ff3b6b' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderHtml(findings, summary, prose) {
  const per = prose?.perFinding || {};
  const counts = summary?.counts || {};
  const target = esc(summary?.repoName || summary?.target || 'target');
  const grade = summary?.grade || 'A';
  const gradeColor = GRADE_COLOR[grade] || '#8b9bb4';

  const donut = severityDonut(counts);
  const findingCards = findings.map((f, i) => card(f, per[f.id], i)).join('\n');
  const scannerRows = (summary?.scanners || []).map((s) =>
    `<tr><td>${esc(s.name)}</td><td>${s.ran ? '<span class="ok">ran</span>' : '<span class="skip">skipped</span>'}</td><td>${s.count ?? 0}</td><td class="muted">${esc(s.error || s.detail?.join?.(', ') || '')}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sentinel Report — ${target}</title><style>
:root{--bg:#0b0e14;--panel:#141925;--panel2:#1b2130;--line:#242c3d;--text:#e6ecf5;--muted:#8b9bb4;--accent:#12e0ff;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:48px 24px 80px}
header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
.logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#12e0ff,#7d3de5);display:flex;align-items:center;justify-content:center;font-size:22px}
h1{font-size:26px;margin:0;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:14px;margin-top:2px}
.hero{display:grid;grid-template-columns:180px 1fr;gap:24px;margin:32px 0;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px}
.grade{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.grade .big{font-size:72px;font-weight:800;line-height:1;color:${gradeColor}}
.grade .risk{color:var(--muted);font-size:13px}
.donut{display:flex;align-items:center;gap:20px}
.summary{margin:24px 0;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px 24px}
.summary h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:0 0 12px}
.summary p{margin:0 0 12px;color:#cdd6e6}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.chip{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.findings{margin-top:32px}
.findings h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:14px}
details.f{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
details.f[open]{border-color:var(--accent)}
summary.fh{list-style:none;cursor:pointer;padding:16px 18px;display:flex;align-items:center;gap:14px}
summary.fh::-webkit-details-marker{display:none}
.sev{font-size:11px;font-weight:800;letter-spacing:.06em;padding:4px 9px;border-radius:6px;white-space:nowrap}
.ftitle{flex:1;font-weight:600}
.floc{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12.5px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
.fbody{padding:4px 18px 20px;border-top:1px solid var(--line)}
.kv{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.tag{font-size:11.5px;padding:3px 9px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);color:var(--muted)}
.fbody h4{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}
.fbody p{margin:0;color:#cdd6e6}
pre.ev{background:#0a0d13;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#9fe8c9;white-space:pre-wrap;word-break:break-word}
.fix{background:rgba(25,239,131,.06);border:1px solid rgba(25,239,131,.25);border-radius:8px;padding:12px 14px;color:#d6f5e5}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.ok{color:#19ef83}.skip{color:var(--muted)}.muted{color:var(--muted)}
footer{margin-top:40px;color:var(--muted);font-size:12px;text-align:center;line-height:1.7}
.prov{font-size:10.5px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:2px 7px}
</style></head><body><div class="wrap">
<header><div class="logo">🛡️</div><div><h1>Sentinel Security Report</h1><div class="sub">${target} · ${esc(summary?.kind || '')} · ${esc((summary?.languages || []).join(', ') || 'n/a')} · ${new Date(summary?.generatedAt || Date.now()).toLocaleString()}</div></div></header>

<div class="hero">
  <div class="grade"><div class="big">${grade}</div><div class="risk">Risk ${summary?.risk ?? 0}/100</div></div>
  <div class="donut">${donut}<div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${summary?.total ?? 0} verified findings across ${(summary?.scanners||[]).filter(s=>s.ran).length} scanner(s)</div>
    <div class="chips">
      ${sevChip('critical', counts.critical)}${sevChip('high', counts.high)}${sevChip('medium', counts.medium)}${sevChip('low', counts.low)}${sevChip('info', counts.info)}
    </div>
  </div></div>
</div>

<div class="summary"><h2>Executive Summary</h2>${(prose?.execSummary || '').split(/\n\n+/).map(p=>`<p>${esc(p)}</p>`).join('')}
${prose?.provider ? `<div style="margin-top:8px"><span class="prov">narrative: ${esc(prose.provider)}</span> <span class="prov">findings: scanner-verified (deterministic)</span></div>` : ''}</div>

<div class="findings"><h2>Findings (${findings.length})</h2>
${findings.length ? findingCards : '<p class="muted">No findings.</p>'}
</div>

<div class="summary"><h2>Scanners</h2><table><thead><tr><th>Scanner</th><th>Status</th><th>Findings</th><th>Notes</th></tr></thead><tbody>${scannerRows}</tbody></table></div>

<footer>Generated by <strong>Sentinel</strong> for AGNT · Every finding is backed by a real scanner match at a specific location.<br>
The AI narrative explains verified findings only — it cannot invent, add, or re-rank vulnerabilities. Risk score is computed deterministically from scanner output.</footer>
</div></body></html>`;
}

function card(f, prose, i) {
  const sev = f.severity;
  const loc = f.file ? `${esc(f.file)}${f.line ? ':' + f.line : ''}` : esc(f.category);
  return `<details class="f"${i === 0 && (sev === 'critical' || sev === 'high') ? ' open' : ''}>
<summary class="fh">
  <span class="sev" style="color:${SEV_COLOR[sev]};background:${SEV_BG[sev]}">${sev.toUpperCase()}</span>
  <span class="ftitle">${esc(f.title)}</span>
  <span class="floc">${loc}</span>
</summary>
<div class="fbody">
  <div class="kv">
    ${f.cwe ? `<span class="tag">${esc(f.cwe)}</span>` : ''}
    ${f.owasp ? `<span class="tag">${esc(f.owasp)}</span>` : ''}
    <span class="tag">tool: ${esc(f.tool)}</span>
    <span class="tag">${esc(f.provenance)}</span>
    ${f.ruleId ? `<span class="tag">${esc(String(f.ruleId).slice(0, 48))}</span>` : ''}
  </div>
  <h4>What it is</h4><p>${esc(prose?.explanation || f.description || f.title)}</p>
  ${prose?.impact ? `<h4>Why it matters</h4><p>${esc(prose.impact)}</p>` : ''}
  ${f.evidence ? `<h4>Evidence</h4><pre class="ev">${esc(f.evidence)}</pre>` : ''}
  <h4>How to fix</h4><div class="fix">${esc(prose?.fix || f.recommendation || 'Review the flagged code and remediate per the CWE guidance.')}</div>
  ${f.references?.length ? `<h4>References</h4><p>${f.references.map(r => `<a href="${esc(r)}" style="color:var(--accent)">${esc(r)}</a>`).join('<br>')}</p>` : ''}
</div></details>`;
}

function sevChip(sev, n) {
  n = n || 0;
  return `<span class="chip" style="color:${SEV_COLOR[sev]};border-color:${SEV_COLOR[sev]}44">${n} ${sev}</span>`;
}

function severityDonut(counts) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const total = order.reduce((a, s) => a + (counts[s] || 0), 0) || 1;
  let acc = 0;
  const segs = order.map((s) => {
    const v = counts[s] || 0; const frac = v / total;
    const seg = `${SEV_COLOR[s]} ${(acc * 100).toFixed(2)}% ${((acc + frac) * 100).toFixed(2)}%`;
    acc += frac; return v ? seg : null;
  }).filter(Boolean).join(', ');
  return `<div style="width:96px;height:96px;border-radius:50%;background:conic-gradient(${segs || '#242c3d 0% 100%'});display:flex;align-items:center;justify-content:center">
    <div style="width:62px;height:62px;border-radius:50%;background:var(--panel);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px">${total === 1 && !order.some(s=>counts[s]) ? 0 : order.reduce((a,s)=>a+(counts[s]||0),0)}</div></div>`;
}

export function renderMarkdown(findings, summary, prose) {
  const c = summary?.counts || {};
  let md = `# Sentinel Security Report — ${summary?.repoName || summary?.target || 'target'}\n\n`;
  md += `**Risk:** ${summary?.risk}/100 (grade ${summary?.grade}) · **Findings:** ${summary?.total} `;
  md += `(${c.critical||0} critical, ${c.high||0} high, ${c.medium||0} medium, ${c.low||0} low, ${c.info||0} info)\n\n`;
  md += `Generated ${summary?.generatedAt} · Target: ${summary?.target} (${summary?.kind})\n\n`;
  md += `## Executive Summary\n\n${prose?.execSummary || ''}\n\n## Findings\n\n`;
  for (const f of findings) {
    const p = prose?.perFinding?.[f.id] || {};
    md += `### [${f.severity.toUpperCase()}] ${f.title}\n\n`;
    md += `- **Location:** \`${f.file || f.category}${f.line ? ':' + f.line : ''}\`\n`;
    md += `- **CWE:** ${f.cwe || 'n/a'} · **Tool:** ${f.tool} · **Provenance:** ${f.provenance}\n\n`;
    md += `**What it is:** ${p.explanation || f.description || f.title}\n\n`;
    if (p.impact) md += `**Why it matters:** ${p.impact}\n\n`;
    if (f.evidence) md += `**Evidence:**\n\n\`\`\`\n${f.evidence}\n\`\`\`\n\n`;
    md += `**Fix:** ${p.fix || f.recommendation || 'Remediate per CWE guidance.'}\n\n---\n\n`;
  }
  return md;
}
