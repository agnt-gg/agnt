/**
 * The pre-0.6.7 relay on api.agnt.gg (REMOTE_URL), kept as a fallback.
 *
 * Webhooks: senders configured before the move still post to
 * api.agnt.gg/webhook/<workflowId>. Those events are queued there, scoped to
 * the workflow's owner, and collected here alongside webhooks.agnt.gg — so an
 * old URL keeps working for as long as the workflow is active.
 *
 * Mail: outbound only, and only when mail.agnt.gg could not be reached at all
 * (see agntMail.sendMail). Inbound email has no legacy path: the old queue
 * cannot tell whose mail is whose, so the server retired it.
 *
 * A 410 or 404 means the server has retired the route. The source is then
 * skipped for 15 minutes rather than called every poll, and resumes on its own
 * if the route comes back.
 */
import { authHeader } from './auth/sessionTokenCache.js';

const TIMEOUT_MS = 10_000;
export const RETIRED_RETRY_MS = 15 * 60 * 1000;

const pausedUntil = new Map(); // source -> epoch ms

export class LegacyRelayError extends Error {
  constructor(source, status, code, message) {
    super(`legacy ${source}: ${message || code}`);
    this.source = source;
    this.status = status;
    this.code = code;
  }
}

const baseUrl = () => process.env.REMOTE_URL || 'https://api.agnt.gg';

async function request(source, path, body) {
  if (Date.now() < (pausedUntil.get(source) || 0)) throw new LegacyRelayError(source, 410, 'paused', 'retired route, retrying later');
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new LegacyRelayError(source, 0, 'unreachable', error.message);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 410 || res.status === 404) {
    pausedUntil.set(source, Date.now() + RETIRED_RETRY_MS);
    throw new LegacyRelayError(source, res.status, 'retired', data.message);
  }
  if (!res.ok || data.success === false) throw new LegacyRelayError(source, res.status, data.error || 'failed', data.message || data.error || `HTTP ${res.status}`);
  pausedUntil.delete(source);
  return data;
}

export const legacyWebhooks = {
  /** The URL third parties were given before webhooks.agnt.gg. */
  url: (workflowId) => `${baseUrl()}/webhook/${workflowId}`,
  /** The server takes the owner from the session token, never from this body. */
  register: (webhook) =>
    request('webhooks', '/webhooks/register', {
      workflowId: webhook.workflowId,
      method: webhook.method || null,
      authType: webhook.authType || null,
      authToken: webhook.authToken || null,
      username: webhook.username || null,
      password: webhook.password || null,
      responseMode: webhook.responseMode || 'Immediate',
    }),
  unregister: (workflowId) => request('webhooks', '/webhooks/unregister', { workflowId }),
  /** Pending events for these workflows, claimed for this caller. */
  poll: async (workflowIds) => (await request('webhooks', '/webhooks/poll', { workflowIds })).triggers || [],
  confirm: (triggerIds) => request('webhooks', '/webhooks/confirm-processed', { processedTriggerIds: triggerIds }),
  release: (triggerIds) => request('webhooks', '/webhooks/release', { triggerIds }),
};

export const legacyMail = {
  /** Same body the 0.6.6 Send Email node posted. */
  send: ({ to, subject, text, html, workflowId }) =>
    request('mail', '/email/send', { params: { to, subject, body: html || text || '', isHtml: Boolean(html) }, workflowId: workflowId || null }),
};

export function __resetLegacyRelayForTests() {
  pausedUntil.clear();
}
