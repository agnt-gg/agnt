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
export async function listInbound({ since, limit = 50 } = {}) {
  const inbox = await defaultInbox();
  const data = await callService('mail', `/inboxes/${inbox.id}/messages`, { query: { since, limit } });
  return { inbox, messages: data.messages || [] };
}
