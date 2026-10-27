/**
 * A TEAM MEMBER'S OWN CLAUDE CODE / CODEX SIGN-IN ON A HOSTED INSTANCE.
 *
 * On a desktop, a Claude Code or Codex sign-in is one per machine: the
 * connection reads and writes the CLI's files and AGNT's credential store. On
 * a hosted team instance that one sign-in is the owner's, so a member needs
 * their own, and it must not live on the instance (whoever runs it could read
 * it there).
 *
 * So each member gets their own connection (connectionRuntime's
 * createManagedConnection, the same code the owner's runs) whose credential
 * store and files are ONE DOCUMENT in that member's vault on api.agnt.gg,
 * reached with that member's own session. It never reads the instance's CLI
 * files, keychain or environment, so it cannot pick up the owner's sign-in.
 * Sign-in, refresh and sign-out all write back to the member's vault.
 *
 * Which connection a call uses (subscriptionConnectionFor):
 *   owner / desktop          the instance's own connection, as before;
 *   member, signed in         their own;
 *   member, not signed in     the owner's, only if the owner shares it;
 *   otherwise                 none, and the caller says how to fix it.
 */
import axios from 'axios';
import { createManagedConnection, getConnection } from './connectionRuntime.js';
import { getSessionToken } from '../auth/sessionTokenCache.js';
import { isHostedMember, MEMBER_SIGNIN_PROVIDERS, sharesSubscription } from '../auth/memberAi.js';

/** A path nothing on the instance uses: the member's files exist only in their vault document. */
const VAULT_HOME = '/agnt-member-vault';
const CACHE_MAX = 500;
const DOC_VERSION = 1;

const needsSignIn = () => Object.assign(new Error('Sign in to AGNT again to use your own subscription here.'), { status: 401 });

/** The member's vault on api.agnt.gg, asked with their own session. */
export function memberVault({ remoteUrl = process.env.REMOTE_URL || 'https://api.agnt.gg', http = axios, sessionToken = getSessionToken } = {}) {
  const base = String(remoteUrl).replace(/\/+$/, '');
  const headers = (memberId) => {
    const token = sessionToken(memberId);
    if (!token) throw needsSignIn();
    return { Authorization: `Bearer ${token}` };
  };
  return {
    async read(memberId, providerId) {
      try {
        const { data } = await http.get(`${base}/auth/valid-token`, { params: { providerId }, headers: headers(memberId), timeout: 8000 });
        return data?.access_token || null;
      } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
      }
    },
    async write(memberId, providerId, text) {
      await http.post(`${base}/auth/apikeys/${encodeURIComponent(providerId)}`, { apiKey: text }, { headers: headers(memberId), timeout: 8000 });
    },
    async remove(memberId, providerId) {
      await http.post(`${base}/auth/disconnect/${encodeURIComponent(providerId)}`, {}, { headers: headers(memberId), timeout: 8000 });
    },
  };
}

/** The vault document: what the connection would otherwise keep in its store and files. */
export function parseDocument(text, providerId) {
  const empty = { v: DOC_VERSION, store: null, files: {} };
  if (!text) return empty;
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.v === DOC_VERSION) return { v: DOC_VERSION, store: parsed.store ?? null, files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {} };
  } catch { /* A bare token saved by hand: read below. */ }
  // A bare Claude Code token (sk-ant-...) saved as an ordinary key still works.
  if (providerId === 'claude-code' && /^sk-ant-/.test(String(text).trim())) return { ...empty, store: { claudeAiOauth: { accessToken: String(text).trim() } } };
  return empty;
}

const isBlank = (value) => value == null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);
export const isEmptyDocument = (doc) => isBlank(doc.store) && Object.values(doc.files).every(isBlank);

/**
 * The credential store and files a member's connection uses: their vault
 * document, changed in memory first (the connection's I/O is synchronous) and
 * saved to the vault in order behind it.
 */
export function vaultBackedStorage(doc, persist) {
  const enoent = (filename) => Object.assign(new Error(`ENOENT: ${filename}`), { code: 'ENOENT' });
  const credentialStore = {
    readCredential: () => (doc.store ? structuredClone(doc.store) : null),
    writeCredential: (_id, data) => { doc.store = structuredClone(data); persist(); },
    clearCredential: () => { doc.store = null; persist(); },
    getCredentialPath: (id) => `vault:${id}`,
    hasCredential: () => !isBlank(doc.store),
  };
  const files = {
    readJson: (filename) => (doc.files[filename] && typeof doc.files[filename] === 'object' ? structuredClone(doc.files[filename]) : null),
    writeJson: (filename, value) => { doc.files[filename] = structuredClone(value); persist(); },
    exists: (filename) => filename in doc.files,
    unlink: (filename) => { delete doc.files[filename]; persist(); },
    readText: (filename) => { if (typeof doc.files[filename] !== 'string') throw enoent(filename); return doc.files[filename]; },
    writeText: (filename, text) => { doc.files[filename] = String(text); persist(); },
    realpath: (filename) => filename,
  };
  return { credentialStore, files };
}

const cache = new Map();

/** Test seam. */
export function forgetMemberConnections() { cache.clear(); }

/**
 * This member's own connection for a subscription provider, loaded from their
 * vault once and kept for the life of the process.
 */
export async function memberConnection(memberId, providerId, { vault = memberVault(), create = createManagedConnection } = {}) {
  if (!MEMBER_SIGNIN_PROVIDERS.has(providerId)) throw new Error(`Members cannot sign in to ${providerId} here`);
  const key = `${memberId}\u0000${providerId}`;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached.connection; }

  const doc = parseDocument(await vault.read(memberId, providerId), providerId);
  let saving = Promise.resolve();
  const persist = () => {
    const snapshot = isEmptyDocument(doc) ? null : JSON.stringify(doc);
    saving = saving
      .then(() => (snapshot ? vault.write(memberId, providerId, snapshot) : vault.remove(memberId, providerId)))
      .catch((error) => console.warn(`[member sign-in] could not save ${providerId} to the member's vault: ${error.message}`));
  };
  const { credentialStore, files } = vaultBackedStorage(doc, persist);
  const connection = create(providerId, { credentialStore, files, homedir: () => VAULT_HOME, env: {}, readSecretJson: () => null });
  connection.flushVault = () => saving;
  cache.set(key, { connection });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return connection;
}

const signedIn = (connection) => Boolean(connection?.describeCredential?.().connected);

/**
 * The connection a call by `userId` should use for a subscription provider, or
 * null when this member has none: not signed in, and the owner does not share
 * theirs.
 */
export async function subscriptionConnectionFor(userId, providerId, options = {}) {
  if (!isHostedMember(userId)) return getConnection(providerId);
  if (MEMBER_SIGNIN_PROVIDERS.has(providerId)) {
    const own = await memberConnection(userId, providerId, options);
    if (signedIn(own)) return own;
  }
  return sharesSubscription(providerId) ? getConnection(providerId) : null;
}

/** What to tell a member who has no usable sign-in for this provider. */
export function noSubscriptionMessage(name) {
  return `Sign in with your own ${name} in Settings \u2192 Connected Apps, or ask the owner to share theirs in Settings \u2192 Members.`;
}
