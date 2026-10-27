/**
 * WHOSE AI A MEMBER USES ON A HOSTED TEAM INSTANCE.
 *
 * A Business instance is one machine owned by one account and used by a team.
 * The owner's keys live in this instance's database. A member's personal keys
 * live in their own vault on api.agnt.gg and are fetched with their own
 * session, so they are never written here. A member's AI call resolves:
 *
 *   1. their own key, from their own vault;
 *   2. the team's key (the owner's) when the owner pays for members' AI;
 *   3. nothing: the provider is not available to them.
 *
 * Only AI model providers are ever lent. Connected apps (Gmail, GitHub, ...)
 * stay the owner's: a member reading the owner's mailbox is a different
 * decision from a member spending the team's model budget.
 *
 * Subscription sign-ins are one person's licence, so they are never lent. The
 * CLI logins are also stored in this instance's own files, which makes them
 * the owner's: a member cannot use those here at all, even with no team key.
 *
 * The key never reaches the member: on a hosted instance members cannot run
 * code, read files or query the database (security/memberIsolation.js), and a
 * key goes to the provider SDK, never into a prompt.
 */
import fs from 'node:fs';
import path from 'node:path';
import pathManager from '../../utils/PathManager.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { isTenantInstance, tenantOwnerId } from './tenantOwnership.js';

export const BILLING = Object.freeze({ TEAM: 'team', MEMBER: 'member' });

/** Signed in through this instance's own CLI login: that login is the owner's. */
export const INSTANCE_LOGIN_PROVIDERS = Object.freeze(new Set([
  'local', 'claude-code', 'openai-codex', 'grok-build', 'cursor-cli', 'gemini-cli', 'antigravity',
]));

/** One person's subscription: usable with the member's own credential, never lent. */
const PERSONAL_SUBSCRIPTIONS = new Set([...INSTANCE_LOGIN_PROVIDERS, 'kimi-code', 'cline-pass']);

const providerKey = (providerId) => getProviderConfig(String(providerId || ''))?.key || String(providerId || '').toLowerCase();

/**
 * Is this caller a member (not the owner) of the hosted instance it is using?
 * Fails closed: with no owner configured, nobody is the owner.
 */
export function isHostedMember(userId) {
  return isTenantInstance() && userId !== tenantOwnerId();
}

/** An AI model provider AGNT knows. AGNT Models is credentialed separately. */
export function isAiProvider(providerId) {
  return providerKey(providerId) !== 'agnt' && Boolean(getProviderConfig(String(providerId || '')));
}

/** May the team's key for this provider be used by a member? */
export function isLendable(providerId) {
  return isAiProvider(providerId) && !PERSONAL_SUBSCRIPTIONS.has(providerKey(providerId));
}

/**
 * Refuse a provider a member can never use on this instance. Everything else
 * is decided by which credential resolves (AuthManager).
 */
export function assertMemberCanUseProvider(providerId) {
  const key = providerKey(providerId);
  if (key === 'agnt') return;
  const config = getProviderConfig(String(providerId || ''));
  if (!config) throw new Error('Members can use the AI models listed for them. Custom providers belong to this instance\u2019s owner.');
  if (INSTANCE_LOGIN_PROVIDERS.has(key)) {
    throw new Error(`${config.name} signs in on this instance as its owner, so members cannot use it here. Pick another model, or add your own key in Settings \u2192 Connected Apps.`);
  }
}

/** The owner's choice, stored with the instance's data (one small file, like instance-team.json). */
export function fileBillingStore(file = pathManager.getDataPath('member-ai.json')) {
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.billing ?? null; } catch { return null; }
    },
    write(billing) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ billing, updatedAt: new Date().toISOString() }));
      fs.renameSync(temp, file);
    },
  };
}

let store = null;
const billingStore = () => (store ??= fileBillingStore());

/** Test seam: replace the store (pass null to restore the file store). */
export function useBillingStore(next) { store = next; }

/** Who pays for members' AI on this instance. The team does unless the owner chose otherwise. */
export function memberAiBilling() {
  return billingStore().read() === BILLING.MEMBER ? BILLING.MEMBER : BILLING.TEAM;
}

export function setMemberAiBilling(billing) {
  if (!Object.values(BILLING).includes(billing)) throw Object.assign(new Error('Choose "team" or "member"'), { status: 400 });
  billingStore().write(billing);
  return memberAiBilling();
}

export function teamPaysForMembers() {
  return memberAiBilling() === BILLING.TEAM;
}
