// LLM layer for the report. STRICT CONTRACT: the model receives ONLY the verified
// findings produced by scanners and writes an executive summary + per-finding
// explanation/fix. It is explicitly instructed that it may NOT invent findings, change
// severities, or add vulnerabilities. Its output is prose only; the findings, counts,
// and risk score are computed deterministically and are never sourced from the model.

import { run, resolveBin, hasBin } from './util.js';
import https from 'https';

/**
 * Generate report prose from findings.
 * @returns {Promise<{execSummary:string, perFinding:Object<string,{explanation,impact,fix}>, provider:string, error?:string}>}
 */
export async function generateReportProse(findings, summary, provider = 'claude-code') {
  if (provider === 'none' || !findings.length) {
    return { execSummary: templateSummary(findings, summary), perFinding: {}, provider: 'template' };
  }
  const prompt = buildPrompt(findings, summary);
  let raw;
  try {
    if (provider === 'claude-code') raw = await viaClaudeCode(prompt);
    else if (provider === 'openrouter') raw = await viaOpenRouter(prompt);
    else if (provider === 'openai') raw = await viaOpenAI(prompt);
    else if (provider === 'anthropic') raw = await viaAnthropic(prompt);
    else raw = null;
  } catch (e) {
    return { execSummary: templateSummary(findings, summary), perFinding: {}, provider: 'template', error: e.message };
  }
  if (!raw) {
    return { execSummary: templateSummary(findings, summary), perFinding: {}, provider: 'template', error: 'LLM produced no output; used template.' };
  }
  const parsed = parseModelJson(raw);
  if (!parsed) {
    // Model returned prose but not our JSON shape: use it as the exec summary verbatim.
    return { execSummary: raw.slice(0, 6000), perFinding: {}, provider };
  }
  return { execSummary: parsed.execSummary || templateSummary(findings, summary), perFinding: parsed.perFinding || {}, provider };
}

function buildPrompt(findings, summary) {
  // Give the model a compact, ID-keyed view of the verified findings.
  const compact = findings.map((f) => ({
    id: f.id, severity: f.severity, title: f.title, cwe: f.cwe,
    file: f.file, line: f.line, tool: f.tool, evidence: f.evidence?.slice(0, 300),
    category: f.category,
  }));
  return `You are a senior application-security engineer writing a security assessment report.

STRICT RULES — you MUST follow these:
1. You are given a list of findings ALREADY VERIFIED by automated scanners (semgrep, npm audit, web recon, etc.). Each has a real file:line or URL.
2. You MUST NOT invent, add, or hypothesize any vulnerability that is not in the provided findings list.
3. You MUST NOT change any severity. Report severities as given.
4. For each finding, explain in plain English WHAT it is, WHY it matters (impact/blast radius), and give a CONCRETE, specific fix (ideally with a code-level suggestion).
5. Write a crisp executive summary a non-security engineer can understand.
6. Be direct and technical. No filler, no marketing.

TARGET: ${summary?.repoName || summary?.target || 'unknown'} (${summary?.kind || '?'})
RISK SCORE (computed deterministically, do not change): ${summary?.risk}/100, grade ${summary?.grade}
SEVERITY COUNTS: ${JSON.stringify(summary?.counts || {})}

VERIFIED FINDINGS (JSON):
${JSON.stringify(compact, null, 1)}

Respond with ONLY a JSON object in this exact shape (no markdown fences):
{
  "execSummary": "2-4 paragraph executive summary of the overall security posture, the most serious issues, and recommended priorities.",
  "perFinding": {
    "<finding id>": { "explanation": "what this is", "impact": "why it matters / blast radius", "fix": "concrete remediation, ideally with a code snippet" }
  }
}
Include an entry in perFinding for every finding id. Keep each field focused.`;
}

// ---- Claude Code (keyless: spawn the user's own CLI) ----
async function viaClaudeCode(prompt) {
  if (!(await hasBin('claude'))) throw new Error('Claude Code CLI (claude) not found on PATH');
  // Strip injected provider keys so the CLI uses the user's own login, not ours.
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) delete env[k];
  // `claude -p "<prompt>"` prints the assistant reply to stdout.
  const r = await run('claude', ['-p', prompt], { timeout: 180000, env });
  if (r.code !== 0 && !r.stdout) throw new Error(`claude exited ${r.code}: ${(r.stderr || '').slice(0, 200)}`);
  return r.stdout.trim();
}

// ---- OpenRouter ----
function viaOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  return httpsJson('openrouter.ai', '/api/v1/chat/completions', key, {
    model: process.env.SENTINEL_MODEL || 'anthropic/claude-3.5-sonnet',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096, temperature: 0.2,
  }, (j) => j.choices?.[0]?.message?.content);
}

// ---- OpenAI ----
function viaOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return httpsJson('api.openai.com', '/v1/chat/completions', key, {
    model: process.env.SENTINEL_MODEL || 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096, temperature: 0.2,
  }, (j) => j.choices?.[0]?.message?.content);
}

// ---- Anthropic ----
function viaAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: process.env.SENTINEL_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096, messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).content?.[0]?.text); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

function httpsJson(hostname, path, key, payload, pick) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'content-length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(pick(JSON.parse(d))); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

/** Extract the first balanced JSON object from model output (handles ```json fences). */
function parseModelJson(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function templateSummary(findings, summary) {
  if (!findings.length) return 'No security findings were produced by the scanners. This does not prove the target is free of vulnerabilities, but no issues matched the enabled rulesets.';
  const c = summary?.counts || {};
  const top = findings.slice(0, 3).map((f) => `${f.severity.toUpperCase()} — ${f.title} (${f.file || 'n/a'}${f.line ? ':' + f.line : ''})`).join('; ');
  return `Sentinel produced ${findings.length} verified finding(s): ${c.critical || 0} critical, ${c.high || 0} high, ${c.medium || 0} medium, ${c.low || 0} low. ` +
    `Overall risk score ${summary?.risk}/100 (grade ${summary?.grade}). Highest-priority items: ${top}. ` +
    `Every finding below is backed by a scanner match at a specific location; address critical and high severities first.`;
}
