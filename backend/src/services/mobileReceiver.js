/**
 * mobileReceiver — answers texts sent to Annie through mobile.agnt.gg.
 *
 *   phone -> mobile.agnt.gg queue -> (this, long-poll) -> local orchestrator
 *   -> reply -> mobile.agnt.gg -> phone
 *
 * WHY A POLL AND NOT A WEBHOOK. This instance may be a desktop behind NAT. It
 * reaches out; nothing reaches in. No port, no tunnel, no inbound attack
 * surface. The long poll costs one idle HTTP request per 25 seconds, and only
 * while a phone is actually routed here: the service answers `idle` otherwise
 * and the receiver backs off to every few minutes.
 *
 * WHAT RUNS WHERE. The service only routes and meters. Annie runs HERE, on this
 * instance's own models, tools and credits, through the same /orchestrator/chat
 * endpoint the chat window uses, so a texted request can do anything a typed
 * one can. Each phone thread is one conversation, saved like any other chat so
 * it appears in the sidebar; its plain-text transcript is the next turn's history.
 *
 * FAILURE. A text this instance cannot answer is released back to the queue
 * (another attempt, or the service's own one-hour expiry notice). Nothing is
 * acknowledged that was not answered.
 */
import { callService, hostedInstanceSlug } from './agntServices.js';
import { getSessionToken, getSessionUserId } from './auth/sessionTokenCache.js';
import { receiveMedia, findOutboundFiles, sendMedia, FILE_LINK, trimLink } from './mobileMedia.js';

const WAIT_SECONDS = 25;
const MAX_CONCURRENT = 2;
const TURN_TIMEOUT_MS = 8 * 60 * 1000;
const HISTORY_MESSAGES = 40;
const NOT_READY_MS = 60_000;
const ERROR_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * Make an answer fit a text message: no image tokens or local file links, no
 * fenced code. Links to files that go along as attachments say so; others
 * point at the app. Empty only when attachments carry the whole answer.
 */
export function toTextReply(raw, { attached = [] } = {}) {
  const sentTokens = new Set(attached.map((file) => file.token));
  let text = String(raw || '');
  text = text.replace(/```[\s\S]*?```/g, '[code is in your AGNT app]');
  text = text.replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\{\{(IMAGE|DATA)_REF:[^}]+\}\}/g, '');
  text = text.replace(/\[([^\]]+)\]\((file:\/\/[^)]+)\)/g, (_, label, url) => `${label} (${sentTokens.has(url) ? 'attached' : 'in your AGNT app'})`);
  text = text.replace(FILE_LINK, (match) => {
    const url = trimLink(match);
    return (sentTokens.has(url) ? '(attached)' : '(in your AGNT app)') + match.slice(url.length);
  });
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text) return text;
  return attached.length ? '' : 'Done. The details are in your AGNT app.';
}

/** Read one orchestrator SSE response to its final answer. */
export async function readFinalAnswer(response) {
  return (await readTurn(response)).text;
}

/** The final answer plus the ids of images the turn generated. */
export async function readTurn(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let finalText = null;
  let error = null;
  const imageIds = [];
  const handle = (block) => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    if (event === 'image_generated') { const id = parsed.imageId || parsed.id || parsed.ref; if (typeof id === 'string') imageIds.push(id); }
    else if (event === 'content_delta') accumulated = parsed.accumulated || accumulated + (parsed.delta || '');
    else if (event === 'final_content' && typeof parsed.content === 'string') finalText = parsed.content;
    else if (event === 'error' && !parsed.continuing) error = parsed.error || 'error';
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      handle(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  const text = finalText ?? accumulated;
  if (!text && error) throw new Error(error);
  return { text, imageIds };
}

export class MobileReceiver {
  constructor({ port = process.env.PORT || 3333, fetchImpl = fetch, converters, resolveImage } = {}) {
    this.base = `http://127.0.0.1:${port}/api`;
    this.fetch = fetchImpl;
    this.converters = converters;
    // Generated images are found by id in local image storage.
    this.resolveImage = resolveImage || (async (id) => (await import('./ImageStorage.js')).findImageFile(id));
    this.running = false;
    this.inFlight = new Set();
    this.failures = 0;
    this.wakeIdle = null;
  }

  /** An idle wait that kick() can end early. */
  idle(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      const self = this;
      function done() { clearTimeout(timer); if (self.wakeIdle === done) self.wakeIdle = null; resolve(); }
      this.wakeIdle = done;
    });
  }

  /** Something changed (a phone was linked or rerouted here): poll now. */
  kick() {
    this.wakeIdle?.();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop().catch((error) => console.error('[MobileReceiver] stopped:', error.message));
    console.log(`[MobileReceiver] started (${hostedInstanceSlug() ? 'cloud instance ' + hostedInstanceSlug() : 'desktop'})`);
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      // No local plan check: mobile.agnt.gg is the authority (a free account
      // may have bought standalone Mobile), and it answers `idle` cheaply.
      if (!getSessionToken()) {
        await this.idle(NOT_READY_MS);
        continue;
      }
      if (this.inFlight.size >= MAX_CONCURRENT) {
        await Promise.race(this.inFlight);
        continue;
      }
      let next;
      try {
        next = await callService('mobile', '/messages/next', { query: { wait: WAIT_SECONDS }, timeoutMs: (WAIT_SECONDS + 15) * 1000, retries: 0, planGate: false });
        this.failures = 0;
      } catch (error) {
        const wait = error.code === 'authentication_required' || error.code === 'pro_required' ? NOT_READY_MS : ERROR_BACKOFF_MS[Math.min(this.failures++, ERROR_BACKOFF_MS.length - 1)];
        if (this.failures === 1 || this.failures % 20 === 0) console.warn('[MobileReceiver] poll failed:', error.code || error.message);
        await sleep(wait);
        continue;
      }
      if (next?.idle) { await this.idle(Math.min(Number(next.retryAfterMs) || 180_000, 600_000)); continue; }
      if (!next?.message) continue;
      const task = this.handle(next.message).finally(() => this.inFlight.delete(task));
      this.inFlight.add(task);
    }
  }

  /** One text: run Annie on it, reply, or give it back. */
  async handle(message) {
    // The account's OWN credential: the signed-in session on a desktop, the
    // instance key on a hosted instance. Never a locally minted token - a
    // hosted instance verifies every token with the issuer, and a desktop
    // must not act as anyone but the account that polled for this text.
    const userId = getSessionUserId();
    try {
      const token = userId ? getSessionToken(userId) : null;
      if (!token) throw new Error('no signed-in user');
      const transcript = await this.loadTranscript(token, message.conversationId);
      const incoming = await receiveMedia(message.media || [], { fetchImpl: this.fetch, ...(this.converters ? { converters: this.converters } : {}) });
      const text = [message.text, ...incoming.notes].filter(Boolean).join('\n')
        || `(sent ${incoming.files.length === 1 ? 'an attachment' : incoming.files.length + ' attachments'})`;
      const turn = await this.ask(token, { ...message, text }, transcript.messages, incoming.files);
      const outgoing = await findOutboundFiles(turn.text, { imageIds: turn.imageIds, resolveImage: this.resolveImage });
      const attached = outgoing.length ? await sendMedia(message.id, outgoing, { callService, fetchImpl: this.fetch }) : [];
      const reply = toTextReply(turn.text, { attached });
      await callService('mobile', `/messages/${encodeURIComponent(message.id)}/reply`, { method: 'POST', body: { text: reply, media: attached.map((file) => file.mediaId) }, timeoutMs: 30_000, planGate: false });
      const sentNames = attached.map((file) => `[sent: ${file.name}]`).join(' ');
      const received = incoming.files.map((file) => `[attached: ${file.originalname}]`).join(' ');
      await this.saveTranscript(token, { ...message, text: [text, received].filter(Boolean).join('\n') }, transcript, [reply, sentNames].filter(Boolean).join('\n'))
        .catch((error) => console.warn('[MobileReceiver] transcript save failed:', error.message));
    } catch (error) {
      console.error('[MobileReceiver] could not answer a text:', error.message);
      await callService('mobile', `/messages/${encodeURIComponent(message.id)}/release`, { method: 'POST', body: {}, timeoutMs: 15_000, planGate: false }).catch(() => {});
    }
  }

  /** One orchestrator turn. Files go as a multipart upload, exactly like the chat window's. */
  async ask(token, message, history, files = []) {
    const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message.text }];
    const fields = { messages, conversationId: message.conversationId, routingMode: 'default', persistDefault: false, textMode: true };
    let body = JSON.stringify(fields);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'X-AGNT-Client-Id': 'mobile-receiver' };
    if (files.length) {
      // Strings raw, everything else JSON: the backend re-parses JSON-shaped fields.
      body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      for (const file of files) body.append('files', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    } else {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetch(`${this.base}/orchestrator/chat`, { method: 'POST', headers, body, signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`orchestrator ${response.status}`);
    return readTurn(response);
  }

  async loadTranscript(token, conversationId) {
    const response = await this.fetch(`${this.base}/content-outputs/by-conversation/${encodeURIComponent(conversationId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { id: null, messages: [] };
    const row = await response.json().catch(() => ({}));
    const output = row.output || row;
    let parsed = {};
    try { parsed = typeof output.content === 'string' ? JSON.parse(output.content) : output.content || {}; } catch { parsed = {}; }
    const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-HISTORY_MESSAGES);
    while (messages.length && messages[0].role !== 'user') messages.shift();
    return { id: output.id || null, title: parsed.title || null, messages };
  }

  async saveTranscript(token, message, transcript, reply) {
    const now = Date.now();
    const messages = [
      ...transcript.messages,
      { id: `msg-${now}-u`, role: 'user', content: message.text, timestamp: message.receivedAt || now },
      { id: `msg-${now}-a`, role: 'assistant', content: reply, timestamp: now },
    ].slice(-200);
    const title = transcript.title || ('Text · ' + message.text.replace(/\s+/g, ' ').slice(0, 60));
    const response = await this.fetch(`${this.base}/content-outputs/save`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: transcript.id || undefined,
        conversationId: message.conversationId,
        contentType: 'conversation',
        isShareable: false,
        title,
        content: JSON.stringify({ conversationId: message.conversationId, title, messages, createdAt: messages[0]?.timestamp || now, updatedAt: now }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`save ${response.status}`);
  }
}

let receiver = null;
/** The process-wide receiver, or null before boot (or when disabled). */
export const getMobileReceiver = () => receiver;
/** Start the process-wide receiver once. Safe to call repeatedly. */
export function startMobileReceiver(options) {
  if (process.env.AGNT_MOBILE_RECEIVER === '0') return null;
  if (!receiver) receiver = new MobileReceiver(options);
  receiver.start();
  return receiver;
}
