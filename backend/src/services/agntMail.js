/**
 * The desktop's inbox on mail.agnt.gg.
 *
 * One inbox per account, created the first time anything needs it and cached
 * for the life of the process. Its address is what the Receive Email trigger
 * shows and what Send Email sends from.
 */
import { callService } from './agntServices.js';

let cachedInbox = null;
let inFlight = null;

export async function defaultInbox() {
  if (cachedInbox) return cachedInbox;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const list = await callService('mail', '/inboxes');
    const active = (list.inboxes || []).filter((i) => i.state === 'active');
    // Prefer the one this desktop made before; otherwise the oldest active one.
    // Oldest active inbox is the desktop's; there is no name field, so age is the tie-breaker.
    let inbox = active.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))[0];
    if (!inbox) {
      inbox = await callService('mail', '/inboxes', { method: 'POST', idempotent: true, body: {} });
    }
    cachedInbox = inbox;
    inFlight = null;
    return inbox;
  })().catch((error) => {
    inFlight = null;
    throw error;
  });
  return inFlight;
}

/**
 * A hosted instance with nothing listening on the inbox tells mail.agnt.gg to
 * stop counting it as a reader, so new mail no longer wakes it. Never creates
 * an inbox to do so: no inbox means nothing to release.
 */
export async function releaseInboxReader() {
  const list = await callService('mail', '/inboxes');
  const inbox = (list.inboxes || []).filter((i) => i.state === 'active').sort((a, b) => (a.created_at || 0) - (b.created_at || 0))[0];
  if (!inbox) return false;
  await callService('mail', `/inboxes/${inbox.id}/reader`, { method: 'DELETE' });
  return true;
}

/** Forget the cached inbox (sign-out, account switch). */
export function resetInboxCache() {
  cachedInbox = null;
  inFlight = null;
}

export async function sendMail({ to, subject, text, html, attachments, inReplyTo }) {
  const inbox = await defaultInbox();
  const body = { to, subject, text: text ?? '' };
  if (html) body.html = html;
  if (Array.isArray(attachments) && attachments.length) body.attachments = attachments;
  if (inReplyTo) body.inReplyTo = inReplyTo;
  const result = await callService('mail', `/inboxes/${inbox.id}/messages`, { method: 'POST', idempotent: true, body });
  return { ...result, from: inbox.address };
}

/** Inbound messages received after `since` (epoch ms), oldest first. */
/**
 * Inbound messages newer than `since` (createdAt, ms), oldest first, with bodies.
 *
 * The service pages summaries oldest-first behind an opaque nextCursor; there
 * is no server-side "since" filter, so paging stops as soon as a page holds
 * nothing newer than the watermark. Bodies are fetched per message because the
 * list carries only headers.
 */
export async function listInbound({ since = 0, limit = 50 } = {}) {
  const inbox = await defaultInbox();
  const fresh = [];
  let cursor = '';
  for (let page = 0; page < 20 && fresh.length < limit; page++) {
    const data = await callService('mail', `/inboxes/${inbox.id}/messages`, { query: cursor ? { cursor } : undefined });
    const summaries = data.messages || [];
    for (const s of summaries) if ((s.createdAt || 0) > since) fresh.push(s);
    if (!data.nextCursor || summaries.length === 0) break;
    cursor = data.nextCursor;
  }
  fresh.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const messages = [];
  for (const s of fresh.slice(0, limit)) {
    const detail = await callService('mail', `/inboxes/${inbox.id}/messages/${s.id}`);
    messages.push({ ...s, ...detail });
  }
  return { inbox, messages };
}
