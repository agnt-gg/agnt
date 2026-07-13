/**
 * annie-orchestrator-bridge.js
 *
 * Bridges an inbound Discord message into AGNT's FULL orchestrator — the same
 * `universalChatHandler` that powers the main Annie chat window. This is what
 * makes "text Annie on Discord and talk to her whole system" work.
 *
 * How it works:
 *   1. POST to http://localhost:<PORT>/api/orchestrator/agent-chat with the
 *      AGNT auth token (process.env.AGNT_AUTH_TOKEN, injected into the plugin
 *      runtime) as a Bearer token. No service-token minting needed — the plugin
 *      already runs inside the authenticated AGNT process.
 *   2. Pass a STABLE conversationId (e.g. `discord-dm-<channelId>`). The
 *      orchestrator keys conversation memory off this ID, so every message in a
 *      given Discord DM thread becomes one persistent, context-carrying
 *      conversation. Annie's userId-scoped persistent memory (recall /
 *      save_agent_memory) rides along automatically.
 *   3. Consume the Server-Sent-Events stream, buffering `content_delta` /
 *      `final_content` into the reply text and collecting any `image_generated`
 *      refs so the caller can resolve + attach them.
 *
 * The orchestrator SSE event contract (verified 2026-07-10):
 *   conversation_started  { conversationId }
 *   agent_execution_started
 *   context_status
 *   assistant_message     { assistantMessageId }
 *   content_delta         { delta, accumulated }
 *   reasoning_delta       { delta, accumulated }      (ignored for Discord)
 *   tool_start / tool_end { toolCall: { name, args, result, error } }
 *   image_generated       { imageId | id | ref, ... }
 *   final_content         { content }
 *   agent_execution_completed
 *   done                  { message }
 *   error                 { ... }
 */import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_PORT = process.env.PORT || 3333;
const ORCH_PATH = '/api/orchestrator/agent-chat';

// The orchestrator does NOT rebuild message history from its in-memory
// ConversationManager on a fresh /chat call — that store is only used for
// autonomous follow-ups. The CLIENT owns history and must send it back each
// turn (see OrchestratorService line ~1099: [...history, { role:'user', ... }]).
//
// Since the plugin is stateless per-call, we persist a compact per-conversation
// transcript to disk and replay it. This is what gives the Discord bridge real
// multi-turn memory across separate messages.
const HISTORY_DIR = path.join(os.tmpdir(), 'agnt-discord-bridge-history');
// Cap replayed history so we never blow the context window. Older turns drop off
// the front; the orchestrator's own context manager handles the rest.
const MAX_HISTORY_MESSAGES = 100;
// Chunked eviction: when the transcript exceeds MAX_HISTORY_MESSAGES, cut it
// down to (MAX - EVICTION_CHUNK) in ONE go instead of sliding the window by one
// pair every turn. A per-turn sliding window shifts history[0] on every message
// once the cap is hit, which permanently busts the LLM prompt-cache prefix
// (every turn becomes a cache miss on the history block). Chunked eviction
// keeps the prefix byte-stable for ~EVICTION_CHUNK/2 turns between cuts, so
// cache hits keep landing the vast majority of the time.
const EVICTION_CHUNK = 20;

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  let trimmed = messages.slice(-(MAX_HISTORY_MESSAGES - EVICTION_CHUNK));
  // Keep role alternation sane: replayed history should start on a user turn.
  while (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
  return trimmed;
}

function historyFilePath(conversationId) {
  const safe = String(conversationId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HISTORY_DIR, `${safe}.json`);
}

function loadHistory(conversationId) {
  try {
    const raw = fs.readFileSync(historyFilePath(conversationId), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(conversationId, messages) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    // Chunked-evict to bound file + context size while keeping a cache-stable prefix.
    const trimmed = trimHistory(messages);
    fs.writeFileSync(historyFilePath(conversationId), JSON.stringify(trimmed), 'utf8');
  } catch (err) {
    // Non-fatal — memory just won't persist this turn.
    console.warn('[AnnieBridge] Could not persist history:', err.message);
  }
}

/**
 * Clear the stored transcript for a conversation (e.g. a "reset"/"new chat"
 * command over Discord).
 */
export function clearHistory(conversationId) {
  try {
    fs.unlinkSync(historyFilePath(conversationId));
    return true;
  } catch {
    return false;
  }
}

/**
 * LIVE HISTORY — fetch the ACTUAL messages currently in a Discord channel/DM
 * via REST and shape them into orchestrator history. Discord itself is the
 * single source of truth: if a message is deleted in the DM, it no longer
 * exists in context. Nothing is persisted locally in this mode.
 */
const LIVE_HISTORY_LIMIT = 30;
const LIVE_MSG_CHAR_CAP = 4000;

export async function fetchDiscordHistory(botToken, channelId, { limit = LIVE_HISTORY_LIMIT } = {}) {
  const capped = Math.min(Math.max(Number(limit) || LIVE_HISTORY_LIMIT, 1), 100);
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=${capped}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!res.ok) {
    const errText = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`Discord history fetch failed: ${res.status} ${errText}`);
  }
  const raw = await res.json(); // Discord returns newest -> oldest
  const msgs = [];
  for (const m of raw.reverse()) {
    let text = (m.content || '').trim();
    if (Array.isArray(m.attachments) && m.attachments.length) {
      const names = m.attachments.map((a) => a.filename).join(', ');
      text = text ? `${text}\n[attachments: ${names}]` : `[attachments: ${names}]`;
    }
    if (!text) continue;
    if (text.length > LIVE_MSG_CHAR_CAP) text = text.slice(0, LIVE_MSG_CHAR_CAP) + ' …[truncated]';
    const role = m.author && m.author.bot ? 'assistant' : 'user';
    const prev = msgs[msgs.length - 1];
    if (prev && prev.role === role) prev.content += '\n' + text; // merge consecutive same-role
    else msgs.push({ role, content: text });
  }
  // Replayed history must start on a user turn for strict providers.
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

/**
 * Mint a short-lived internal AGNT JWT for a given userId, signed with the
 * backend's JWT_SECRET (available in the plugin runtime because plugins run
 * inside the main backend process which loads .env). This token passes
 * authenticateToken's jwt.verify, and extractUserId() reads payload.id.
 *
 * We hand-roll HS256 with node's crypto so we need zero extra deps
 * (jsonwebtoken is not bundled with this plugin).
 *
 * @param {string} userId
 * @param {number} [ttlSeconds=300]  short TTL — a bridge call completes in seconds
 * @returns {string} a signed JWT
 */
function mintInternalToken(userId, ttlSeconds = 300) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not available in plugin runtime; cannot mint internal token for orchestrator bridge.');
  }
  const b64url = (buf) =>
    Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: userId,
    userId: userId,
    auth_type: 'internal-discord-bridge',
    iat: now,
    exp: now + ttlSeconds,
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

/**
 * Parse a running SSE buffer into complete frames. Returns { frames, rest }
 * where `rest` is the trailing incomplete frame to carry into the next chunk.
 */
function splitSSEFrames(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop();
  return { frames: parts, rest };
}

/**
 * Parse one SSE frame ("event: X\ndata: {...}") into { eventName, data }.
 * Returns null if there's no data payload or the data isn't valid JSON.
 */
function parseSSEFrame(frame) {
  let eventName = 'message';
  let dataStr = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  let data;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return null;
  }
  return { eventName, data };
}

/**
 * Send a message to the AGNT orchestrator and return the buffered result.
 *
 * @param {object} opts
 * @param {string} opts.message            the user's message text
 * @param {string} opts.conversationId     stable per-thread id (memory key)
 * @param {string} [opts.authToken]        AGNT bearer token (defaults to env)
 * @param {string} [opts.provider]         optional LLM provider override
 * @param {string} [opts.model]            optional model override
 * @param {number} [opts.port]             AGNT backend port (defaults to env/3333)
 * @param {number} [opts.timeoutMs=180000] hard cap on the whole stream
 * @param {function} [opts.onToolEvent]    optional callback(name, phase) for live status
 * @returns {Promise<{ reply, images, conversationId, toolsUsed, raw }>}
 */export async function askOrchestrator(opts = {}) {
  const {
    message,
    conversationId,
    userId = null,
    provider,
    model,
    port = DEFAULT_PORT,
    timeoutMs = 180000,
    onToolEvent = null,
  } = opts;

  // Resolve an auth token: explicit token wins, else mint one from userId,
  // else fall back to the env token (present only in the code-exec sandbox).
  let authToken = opts.authToken;
  if (!authToken && userId) {
    authToken = mintInternalToken(userId);
  }
  if (!authToken) {
    authToken = process.env.AGNT_AUTH_TOKEN;
  }

  if (!message || typeof message !== 'string') {
    throw new Error('askOrchestrator: message (string) is required.');
  }
  if (!conversationId) {
    throw new Error('askOrchestrator: conversationId is required (it is the memory key).');
  }  if (!authToken) {
    throw new Error('askOrchestrator: no auth token available (pass authToken or userId so one can be minted).');
  }  const url = `http://localhost:${port}${ORCH_PATH}`;

  // History source:
  //   LIVE (preferred) — botToken + resolvable channelId: fetch the ACTUAL
  //   messages currently in the Discord channel. Discord is the single source
  //   of truth — deleted messages disappear from context, nothing persisted.
  //   LEGACY fallback — non-Discord callers with no channel: temp-file transcript.
  const liveChannelId =
    opts.channelId ||
    (/^discord-dm-(\d+)$/.exec(String(conversationId)) || [])[1] ||
    null;

  let priorHistory = [];
  let liveMode = false;
  if (opts.botToken && liveChannelId) {
    liveMode = true; // live mode even on fetch failure — NEVER fall back to stale local files
    try {
      priorHistory = await fetchDiscordHistory(opts.botToken, liveChannelId, { limit: opts.historyLimit });
      // The newest channel message is (usually) the one that triggered this
      // call — the wrapped prompt already contains it verbatim, so drop it
      // from history to avoid sending it twice.
      const last = priorHistory[priorHistory.length - 1];
      if (last && last.role === 'user' && message.includes(last.content.slice(0, 200))) {
        priorHistory.pop();
      }
    } catch (err) {
      console.warn('[AnnieBridge] Live Discord history fetch failed, using EMPTY history:', err.message);
      priorHistory = [];
    }
  } else {
    priorHistory = loadHistory(conversationId);
  }

  const body = { message, conversationId, history: priorHistory };

  // STRICT TOOL WHITELIST: when provided, the backend hard-filters the tool
  // surface to exactly this list (+ a few universal tools). This is what keeps
  // DM turns lean (~tool schemas are the single biggest token payload) and
  // keeps smaller-context models (e.g. Grok 128k) under their window.
  if (Array.isArray(opts.enabledTools) && opts.enabledTools.length > 0) {
    body.enabledTools = opts.enabledTools;
  }
  if (provider) body.provider = provider;
  if (model) body.model = model;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + authToken,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`Orchestrator request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`Orchestrator request failed: ${err.message}`);
  }

  if (!res.ok) {
    clearTimeout(timeout);
    const text = await res.text().catch(() => '');
    throw new Error(`Orchestrator returned ${res.status}: ${text.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let finalText = '';
  let accumulated = '';
  let echoedConversationId = null;
  let streamError = null;
  const images = [];
  const toolsUsed = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { frames, rest } = splitSSEFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        const parsed = parseSSEFrame(frame);
        if (!parsed) continue;
        const { eventName, data } = parsed;

        switch (eventName) {
          case 'conversation_started':
            echoedConversationId = data.conversationId || echoedConversationId;
            break;
          case 'content_delta':
            // accumulated is the running full text; prefer it, fall back to delta concat
            accumulated = data.accumulated || accumulated + (data.delta || '');
            break;
          case 'final_content':
            finalText = data.content || data.message || finalText;
            break;
          case 'image_generated': {
            const ref = data.imageId || data.id || data.ref || data.imageRef || null;
            if (ref) images.push(ref);
            break;
          }
          case 'tool_start':
            if (data.toolCall?.name) {
              toolsUsed.push(data.toolCall.name);
              if (onToolEvent) { try { onToolEvent(data.toolCall.name, 'start'); } catch {} }
            }
            break;
          case 'tool_end':
            if (data.toolCall?.name && onToolEvent) {
              try { onToolEvent(data.toolCall.name, 'end'); } catch {}
            }
            break;
          case 'error':
            streamError = data.error || data.message || JSON.stringify(data);
            break;
          case 'done':
            // stream end marker; loop will exit on reader done
            break;
          default:
            break;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  if (streamError && !finalText && !accumulated) {
    throw new Error(`Orchestrator stream error: ${streamError}`);
  }  const reply = (finalText || accumulated || '').trim();

  // LEGACY mode only: persist this turn to the temp transcript. In live mode
  // Discord itself is the transcript — nothing is ever written to disk.
  if (reply && !liveMode) {
    const updated = [
      ...priorHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: reply },
    ];
    saveHistory(conversationId, updated);
  }

  return {
    reply,
    images,
    toolsUsed: [...new Set(toolsUsed)],
    conversationId: echoedConversationId || conversationId,
    historyLength: priorHistory.length + (reply ? 2 : 0),
    raw: { hadError: !!streamError, error: streamError },
  };
}

/**
 * Build the canonical conversationId for a Discord DM channel. Keeping this in
 * one place means every entry point (action, future daemon) agrees on the key,
 * so memory stays consistent.
 */
export function conversationIdForChannel(channelId) {
  return `discord-dm-${channelId}`;
}

export const _internal = { splitSSEFrames, parseSSEFrame };
