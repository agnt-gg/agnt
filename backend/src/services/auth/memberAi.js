/**
 * WHOSE AI A MEMBER USES ON A HOSTED TEAM INSTANCE.
 *
 * A Business instance is one machine owned by one account and used by a team.
 * The owner's keys and sign-ins live on this instance. A member's own keys and
 * sign-ins live in their own vault on api.agnt.gg and are reached with their
 * own session, so they are never written here. A member's AI call resolves:
 *
 *   1. their own credential (key, or their own Claude Code / Codex sign-in);
 *   2. the owner's, when the owner lends it:
 *        - API keys: when the team pays for members' AI (the default);
 *        - subscriptions (Claude Code, Codex, Kimi Code, ...): only the ones
 *          the owner chose to share with the team;
 *   3. nothing: the provider is not available to them.
 *
 * Only AI model providers are ever lent. Connected apps (Gmail, GitHub, ...)
 * stay the owner's: a member reading the owner's mailbox is a different
 * decision from a member spending the team's model budget.
 *
 * The owner's credential never reaches the member: on a hosted instance members
 * cannot run code, read files or query the database (security/memberIsolation.js),
 * and a credential goes to the provider SDK, never into a prompt.
 */
import fs from 'node:fs';
import path from 'node:path';
import pathManager from '../../utils/PathManager.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { isTenantInstance, tenantOwnerId } from './tenantOwnership.js';

export const BILLING = Object.freeze({ TEAM: 'team', MEMBER: 'member' });

/** Signed in through this instance's own login: on a hosted instance, the owner's. */
export const INSTANCE_LOGIN_PROVIDERS = Object.freeze(new Set([
  'local', 'claude-code', 'openai-codex', 'grok-build', 'cursor-cli', 'gemini-cli', 'antigravity',
]));

/** A member can sign in to these with their own account (memberConnections.js). */
export const MEMBER_SIGNIN_PROVIDERS = Object.freeze(new Set(['claude-code', 'openai-codex']));

/** One person's subscription: lent to the team only if the owner shares it. */
export const SUBSCRIPTION_PROVIDERS = Object.freeze(new Set([
  ...[...INSTANCE_LOGIN_PROVIDERS].filter((id) => id !== 'local'), 'kimi-code', 'cline-pass',
]));

export const providerKey = (providerId) => getProviderConfig(String(providerId || ''))?.key || String(providerId || '').toLowerCase();

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

export function isSubscription(providerId) {
  return SUBSCRIPTION_PROVIDERS.has(providerKey(providerId));
}

/** The owner's choices, kept with the instance's data (one small file, like instance-team.json). */
export function fileSettingsStore(file = pathManager.getDataPath('member-ai.json')) {
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    },
    write(settings) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ ...settings, updatedAt: new Date().toISOString() }));
      fs.renameSync(temp, file);
    },
  };
}

let store = null;
const settingsStore = () => (store ??= fileSettingsStore());

/** Test seam: replace the store (pass null to restore the file store). */
export function useSettingsStore(next) { store = next; }

function settings() {
  const raw = settingsStore().read();
  if (typeof raw === 'string') return { billing: raw };
  return raw && typeof raw === 'object' ? raw : {};
}
const save = (next) => settingsStore().write(next);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/** Who pays for members' AI keys. The team does unless the owner chose otherwise. */
export function memberAiBilling() {
  return settings().billing === BILLING.MEMBER ? BILLING.MEMBER : BILLING.TEAM;
}

export function setMemberAiBilling(billing) {
  if (!Object.values(BILLING).includes(billing)) throw invalid('Choose "team" or "member"');
  save({ ...settings(), billing });
  return memberAiBilling();
}

export function teamPaysForMembers() {
  return memberAiBilling() === BILLING.TEAM;
}

/** The subscriptions the owner lets the whole team use. None unless chosen. */
export function sharedSubscriptions() {
  const list = Array.isArray(settings().sharedSubscriptions) ? settings().sharedSubscriptions : [];
  return new Set(list.filter((id) => SUBSCRIPTION_PROVIDERS.has(id)));
}

export function sharesSubscription(providerId) {
  return sharedSubscriptions().has(providerKey(providerId));
}

export function setSharedSubscriptions(list) {
  if (!Array.isArray(list) || list.some((id) => !SUBSCRIPTION_PROVIDERS.has(id))) throw invalid('Choose subscriptions AGNT knows');
  save({ ...settings(), sharedSubscriptions: [...new Set(list)] });
  return [...sharedSubscriptions()];
}

/** May a member use the owner's credential for this provider? */
export function canLendToMember(providerId) {
  if (!isAiProvider(providerId)) return false;
  if (isSubscription(providerId)) return sharesSubscription(providerId);
  return teamPaysForMembers();
}

/**
 * Refuse a provider a member can never use on this instance. Everything else
 * is decided by which credential resolves (AuthManager, memberConnections.js).
 */
export function assertMemberCanUseProvider(providerId) {
  const key = providerKey(providerId);
  if (key === 'agnt') return;
  const config = getProviderConfig(String(providerId || ''));
  if (!config) throw new Error('Members can use the AI models listed for them. Custom providers belong to this instance\u2019s owner.');
  if (INSTANCE_LOGIN_PROVIDERS.has(key) && !MEMBER_SIGNIN_PROVIDERS.has(key) && !sharesSubscription(key)) {
    throw new Error(`${config.name} on this instance is the owner\u2019s sign-in. Ask the owner to share it with the team in Settings \u2192 Members.`);
  }
}
