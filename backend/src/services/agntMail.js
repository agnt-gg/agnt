/**
 * The agent inbox on mail.agnt.gg.
 *
 * One inbox per PERSON, created the first time anything needs it and cached
 * for the life of the process. On a desktop that is the signed-in account; on
 * a hosted team instance each member has their own (the team plan pools quota,
 * never inboxes), and `actor` says whose. Its address is what the Receive Email
 * trigger shows and what Send Email sends from.
 */
import { callService, neverReached, memberActor } from './agntServices.js';
import { legacyMail } from './legacyRelay.js';

const OWNER = '';
/** @type {Map<string, object>} inbox by person ('' = the account holder) */
const cachedInboxes = new Map();
const inFlight = new Map();

export async function defaultInbox(actor) {
  const person = memberActor(actor) ?? OWNER;
  if (cachedInboxes.has(person)) return cachedInboxes.get(person);
  if (inFlight.has(person)) return inFlight.get(person);
  const pending = (async () => {
    const list = await callService('mail', '/inboxes', { actor });
    const active = (list.inboxes || []).filter((i) => i.state === 'active');
    // The service lists only this person's inboxes. Oldest active first; there
    // is no name field, so age is the tie-breaker.
    let inbox = active.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))[0];
    if (!inbox) {
      inbox = await callService('mail', '/inboxes', { method: 'POST', idempotent: true, body: {}, actor });
    }
    cachedInboxes.set(person, inbox);
    inFlight.delete(person);
    return inbox;
  })().catch((error) => {
    inFlight.delete(person);
    throw error;
  });
  inFlight.set(person, pending);
  return pending;
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

/** Forget the cached inboxes (sign-out, account switch). */
export function resetInboxCache() {
  cachedInboxes.clear();
  inFlight.clear();
}

/**
 * Send from the account inbox. If mail.agnt.gg cannot be connected to at all,
 * the message goes out through the api.agnt.gg relay instead - only then,
 * because any other failure (a refusal, a timeout, a dropped connection) may
 * mean it was already accepted, and sending again would deliver it twice.
 * Attachments have no legacy path, so a message with them is never rerouted.
 */
export async function sendMail({ to, subject, text, html, attachments, inReplyTo, workflowId, actor }) {
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  try {
    const inbox = await defaultInbox(actor);
    const body = { to, subject, text: text ?? '' };
    if (html) body.html = html;
    if (hasAttachments) body.attachments = attachments;
    if (inReplyTo) body.inReplyTo = inReplyTo;
    const result = await callService('mail', `/inboxes/${inbox.id}/messages`, { method: 'POST', idempotent: true, body, actor });
    return { ...result, from: inbox.address };
  } catch (error) {
    // The legacy relay has no per-member identity: a member's mail never takes it.
    if (!neverReached(error) || hasAttachments || memberActor(actor)) throw error;
    console.warn(`agntMail: mail.agnt.gg unreachable (${error.detail?.causeCode}); sending through the legacy relay`);
    const result = await legacyMail.send({ to, subject, text, html, workflowId }).catch((legacyError) => {
      console.error(`agntMail: legacy relay also failed: ${legacyError.message}`);
      throw error; // report the primary failure; the fallback was a bonus
    });
    return { id: result.messageId || null, state: 'sent_via_legacy_relay', from: null, via: 'legacy' };
  }
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
export async function listInbound({ since = 0, limit = 50, actor } = {}) {
  const inbox = await defaultInbox(actor);
  const fresh = [];
  let cursor = '';
  for (let page = 0; page < 20 && fresh.length < limit; page++) {
    const data = await callService('mail', `/inboxes/${inbox.id}/messages`, { query: cursor ? { cursor } : undefined, actor });
    const summaries = data.messages || [];
    for (const s of summaries) if ((s.createdAt || 0) > since) fresh.push(s);
    if (!data.nextCursor || summaries.length === 0) break;
    cursor = data.nextCursor;
  }
  fresh.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const messages = [];
  for (const s of fresh.slice(0, limit)) {
    const detail = await callService('mail', `/inboxes/${inbox.id}/messages/${s.id}`, { actor });
    messages.push({ ...s, ...detail });
  }
  return { inbox, messages };
}
