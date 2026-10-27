/**
 * Text Annie on a team instance: which teammate a phone belongs to.
 *
 * Every phone is on the instance owner's Mobile account (the owner's plan pays
 * for the team's texts, and the instance polls with the owner's credential).
 * A teammate's phone additionally names the teammate (`memberId`, stored by
 * mobile.agnt.gg), and the instance answers its texts AS that teammate: their
 * own Main chat, their own AI settings, member isolation.
 *
 * So this proxy must (a) tag a phone a teammate links with their id, and
 * (b) show and let them manage only their own phones. The owner sees and
 * manages every phone on the account, the teammates' included.
 */
import { isNonOwnerMember } from './security/memberIsolation.js';
import { credentialUserId } from './auth/tenantOwnership.js';

/** The teammate making this request, or null for the owner / a desktop install. */
export function textingMember(req) {
  const id = req?.user?.id || req?.user?.userId;
  return typeof id === 'string' && isNonOwnerMember(id) ? credentialUserId(id.trim()) : null;
}

/** The phones this caller may see: a teammate sees their own; the owner sees all. */
export function visiblePhones(phones, memberId) {
  const list = Array.isArray(phones) ? phones : [];
  return memberId ? list.filter((phone) => phone?.memberId === memberId) : list;
}

/** Refuse a teammate acting on a phone that is not theirs (answers as not found). */
export async function assertOwnPhone(phoneId, memberId, listPhones) {
  if (!memberId) return;
  const phones = await listPhones();
  if (!visiblePhones(phones, memberId).some((phone) => phone.id === phoneId)) {
    throw Object.assign(new Error('phone_not_found'), { status: 404, code: 'phone_not_found' });
  }
}
