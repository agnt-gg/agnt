/**
 * mobileOutbound — Annie texts the user first.
 *
 * mobileReceiver answers texts; this starts them: a worker chat finished, a
 * reminder came due. Both go to mobile.agnt.gg's POST /mobile/v1/outbound,
 * which sends to the owner's verified phone routed to this instance.
 *
 * The service is the authority on everything that matters: which phone, STOP,
 * and billing (an outbound text is one billed text, refused once the
 * allowance is gone). This side only shapes the message the way a reply is
 * shaped (toTextReply + attachments) and never throws: a text that cannot go
 * out is a logged outcome, not a failed turn.
 *
 * `key` is the idempotency key. The same key is one text, however many times
 * a retry or a restart sends it.
 */
import { callService as defaultCallService } from './agntServices.js';
import { findOutboundFiles, sendMedia } from './mobileMedia.js';
import { toTextReply } from './mobileReceiver.js';

const REFUSALS = {
  phone_not_found: 'no_phone',
  monthly_allowance_exhausted: 'allowance_exhausted',
  pro_required: 'not_subscribed',
  authentication_required: 'signed_out',
};

const defaultResolveImage = async (id) => (await import('./ImageStorage.js')).findImageFile(id);

/** Is any verified, unpaused phone linked to this account? Never throws. */
export async function hasLinkedPhone({ callService = defaultCallService } = {}) {
  try {
    const { phones } = await callService('mobile', '/phones', { timeoutMs: 10_000, retries: 1, planGate: false });
    return Array.isArray(phones) && phones.some((phone) => phone?.state === 'active');
  } catch {
    return false;
  }
}

/**
 * Text the user. `text` may be a full chat answer: images and file:/// links
 * in it travel as attachments, the rest is cut down to a text.
 *
 * `sent` is retained for existing worker-report callers: it means submitted to
 * the gateway queue, NOT delivered to the phone. User-facing receipts must use
 * textQueueReceipt so queue acceptance cannot be mistaken for delivery.
 *
 * @returns {Promise<{sent:boolean, id?:string, duplicate?:boolean, reason?:string}>}
 */
export async function textUser({ text, imageIds = [], key }, { callService = defaultCallService, fetchImpl = fetch, resolveImage = defaultResolveImage } = {}) {
  if (typeof key !== 'string' || key.length < 8) return { sent: false, reason: 'idempotency_key_required' };
  try {
    const outgoing = await findOutboundFiles(String(text || ''), { imageIds, resolveImage });
    const attached = outgoing.length ? await sendMedia(null, outgoing, { callService, fetchImpl }) : [];
    const body = toTextReply(text, { attached });
    const result = await callService('mobile', '/outbound', {
      method: 'POST',
      body: { text: body, media: attached.map((file) => file.mediaId), key },
      timeoutMs: 30_000,
      planGate: false,
    });
    if (typeof result?.id !== 'string' || !result.id.trim()) {
      console.warn('[mobileOutbound] queue acceptance unconfirmed: no message id');
      return { sent: false, reason: 'queue_unconfirmed' };
    }
    return { sent: true, id: result.id, duplicate: result.duplicate === true };
  } catch (error) {
    const reason = REFUSALS[error?.code] || error?.code || error?.message || 'send_failed';
    if (!REFUSALS[error?.code]) console.warn('[mobileOutbound] text not sent:', reason);
    return { sent: false, reason };
  }
}

/** The outbound endpoint acknowledges a queue entry; it cannot certify delivery. */
export function textQueueReceipt(result) {
  if (!result?.sent || typeof result.id !== 'string' || !result.id.trim()) {
    return { success: false, deliveryConfirmed: false, error: 'Text queue acceptance could not be confirmed.' };
  }
  return {
    success: true,
    id: result.id,
    queued: true,
    deliveryConfirmed: false,
    duplicate: result.duplicate === true,
    message: 'Queued the text for delivery. This is not confirmation that the phone received it.',
  };
}

export default { textUser, hasLinkedPhone };
