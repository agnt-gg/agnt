// lib/llm.js — session-default LLM bridge for the cua autonomous loop.
//
// THE CONTRACT: the loop reasons with whatever provider/model the USER has
// selected for this conversation/workspace — never a pinned model. From chat,
// the orchestrator passes the session's { provider, model, normalizedProvider,
// userId } on the workflowEngine context object; those are AUTHORITATIVE and a
// param-supplied override is ignored (same philosophy as the native Browser
// Agent tool: substituting models behind the user's back hides the real
// configuration knob). Outside chat (raw /api/tools execute, workflows),
// params.provider/params.model act as the fallback.
//
// Transport: POST /api/tools/generate_with_ai_llm/execute on loopback — the
// same universal LLM action node every workflow uses, so ALL providers work:
// OpenAI, Anthropic, Gemini, Grok, Groq, DeepSeek, and the OAuth/CLI-backed
// ones (claude-code, codex, gemini-cli, antigravity, cursor...) that cannot be
// handed to a third-party SDK.
//
// Auth: the plugin runs inside the backend process, so it mints a short-lived
// internal HS256 token from JWT_SECRET + the calling user's id (same pattern
// as the visual-adjudicator plugin). params.authToken wins when provided.
import crypto from 'crypto';

const TOOL_EXEC_PATH = '/api/tools/generate_with_ai_llm/execute';
const DEFAULT_PORT = process.env.PORT || 3333;

export function resolveSession(params = {}, workflowEngine = null) {
  const sessionProvider = workflowEngine?.provider || workflowEngine?.normalizedProvider || null;
  const sessionModel = (workflowEngine?.model || '').trim() || null;
  // Session wins. Params only fill the gap when there is no session context.
  const provider = sessionProvider || String(params.provider || '').trim() || 'OpenAI';
  const model = sessionModel || String(params.model || '').trim() || '';
  return { provider, model, fromSession: !!sessionProvider };
}

function mintInternalToken(userId, ttlSeconds = 900) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET unavailable in plugin runtime; cannot mint internal token.');
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ id: userId, userId, auth_type: 'internal-cua-toolkit', iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${head}.${body}.${sig}`;
}

export function resolveAuthToken(params = {}, workflowEngine = null) {
  if (params.authToken) return String(params.authToken);
  const userId = workflowEngine?.userId || params.userId;
  if (userId && process.env.JWT_SECRET) {
    try { return mintInternalToken(String(userId)); } catch { /* fall through */ }
  }
  if (process.env.AGNT_AUTH_TOKEN) return process.env.AGNT_AUTH_TOKEN;
  throw new Error('No auth token available: run from chat/agent context (userId present), or pass authToken.');
}

/**
 * One LLM step. Vision mode when imageB64 is provided, plain text otherwise.
 * Returns the raw generated text. Throws on transport or provider failure —
 * the loop surfaces that as a step error rather than guessing.
 */
export async function callLlm({ prompt, imageB64 = null, provider, model, authToken, port = DEFAULT_PORT, timeoutMs = 120000 }) {
  const args = imageB64
    ? {
        mode: 'Vision (Image → Text)',
        provider,
        model,
        visionPrompt: prompt,
        visionImage: imageB64.startsWith('data:') ? imageB64 : `data:image/png;base64,${imageB64}`,
      }
    : { mode: 'Text Generation', provider, model, prompt };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}${TOOL_EXEC_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ args }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`generate_with_ai_llm HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
    }
    // /api/tools returns the tool result — usually { success, result } or the flat tool output.
    const payload = body?.result ?? body;
    const text = payload?.generatedText ?? payload?.result?.generatedText ?? '';
    if (payload?.error) throw new Error(`LLM error (${provider}${model ? '/' + model : ''}): ${payload.error}`);
    if (!text) throw new Error(`LLM returned no text. Raw keys: ${Object.keys(payload || {}).join(', ')}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first JSON object from LLM text (handles ```json fences and prose). */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* next */ }
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* next */ } }
  }
  return null;
}
