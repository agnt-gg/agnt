/**
 * Share links: a sanitized bundle published to agnt.gg as an UNLISTED page,
 * that anyone with the link can view and install into their own AGNT.
 *
 * The link is a pointer, never a payload (the same rule as electron/deepLink.js):
 * `https://agnt.gg/s/<id>` and `agnt://shared?id=<id>` carry only the id. The
 * receiver fetches the bundle from the one fixed origin below, previews it, and
 * installs only after confirming. Every definition is sanitized AGAIN on the
 * way in by installBundle, so the share service never has to be trusted to
 * clean anything, and a link created by anyone gets the same treatment.
 */
import { buildBundle, installBundle, previewBundle, redactSecrets } from './TeamBundle.js';
import { nodeProvider as defaultNodeProvider } from './nativeStore.js';

export const SHARE_ORIGIN = 'https://agnt.gg';
const SHARE_ID = /^[A-Za-z0-9_-]{6,64}$/;
/** The sharer's referral code, as the share service recorded it. Anything else is dropped. */
const REFERRAL_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const refuse = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };

/** The share service origin. Overridable for local development only, and never to anything but https or loopback. */
export function shareOrigin(value = process.env.AGNT_SHARE_ORIGIN || SHARE_ORIGIN) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error('Share origin must be https');
  return url.origin;
}

/** Accepts a bare id, a https://agnt.gg/s/<id> page link, or an agnt://shared?id=<id> app link. Anything else is refused. */
export function shareIdFrom(value, origin = shareOrigin()) {
  const text = String(value || '').trim();
  if (SHARE_ID.test(text)) return text;
  let url = null;
  try { url = new URL(text); } catch { /* refused below */ }
  if (url?.protocol === 'agnt:') {
    // Only the `shared` verb names a share link; the verb may arrive as the host or the path (see electron/deepLink.js).
    const verb = (url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
    const id = url.searchParams.get('id');
    if (verb === 'shared' && id && SHARE_ID.test(id)) return id;
  }
  if (url && url.origin === new URL(origin).origin) {
    const match = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{6,64})\/?$/);
    if (match) return match[1];
  }
  return refuse(400, 'That is not an AGNT share link');
}

/** The only way this backend talks to the share service: one fixed origin, no redirects, bounded time. */
export function publicShareClient({ fetchImpl = fetch, origin = shareOrigin() } = {}) {
  const call = async (path, authorization, options = {}) => {
    const response = await fetchImpl(origin + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) refuse(401, 'Sign in to AGNT to create share links');
    // A 404 with a code is the service explaining itself (e.g. a conversation link is not installable); a bare 404 is a dead link.
    if (response.status === 404) refuse(404, result.code ? result.error : 'This share link no longer exists', { code: result.code });
    if (!response.ok) refuse(response.status >= 500 ? 502 : response.status, result.error || 'The share service refused the request', { code: result.code });
    return result;
  };
  return {
    origin,
    publish: (authorization, payload) => call('/api/shared', authorization, { method: 'POST', body: JSON.stringify(payload) }),
    fetch: id => call('/api/shared/' + encodeURIComponent(id) + '/bundle'),
    revoke: (authorization, id) => call('/api/shared/' + encodeURIComponent(id), authorization, { method: 'DELETE' }),
  };
}

/** Build a sanitized bundle of `items` owned by `ownerId` and publish it. Returns the link and what went into it. */
export async function publishLink({ store, ownerId, items, includeDependencies = true, authorization, client, nodeProvider = defaultNodeProvider }) {
  const { bundle, preview } = await buildBundle(store, ownerId, items, { includeDependencies, nodeProvider });
  const root = preview.items.find(item => !item.dependency) || preview.items[0];
  const extra = preview.items.length - 1;
  const title = root.name + (extra > 0 ? ' + ' + extra + ' more' : '');
  const published = await client.publish(authorization, {
    title,
    kind: root.kind,
    bundle,
    summary: { items: preview.items.map(({ kind, name, dependency }) => ({ kind, name, dependency })), needs: preview.needs },
  });
  if (!published?.id || !SHARE_ID.test(published.id)) refuse(502, 'The share service did not return a link');
  const hashes = Object.fromEntries(bundle.items.map(item => [item.kind + ':' + item.sourceId, item.hash]));
  return { id: published.id, url: client.origin + '/s/' + published.id, title, root: { kind: root.kind, id: root.id }, hash: hashes[root.kind + ':' + root.id], items: preview.items, needs: preview.needs, removed: preview.removed };
}

const MAX_SNAPSHOT_MESSAGES = 1000;
const MAX_SNAPSHOT_CHARS = 100_000;

/**
 * A conversation as a read-only snapshot: the words said, nothing else. Tool
 * calls, reasoning, files and metadata are dropped; image references become a
 * placeholder; credential-shaped runs are replaced in place. Pure.
 */
export function conversationSnapshot(content) {
  let parsed = {};
  try { parsed = typeof content === 'string' ? JSON.parse(content) : content || {}; } catch { parsed = {}; }
  let removed = 0;
  const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
    .filter(message => (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
    .slice(-MAX_SNAPSHOT_MESSAGES)
    .map(message => {
      const redacted = redactSecrets(message.content.replace(/\{\{IMAGE_REF:[^}]+\}\}/g, '[image]'));
      removed += redacted.removed;
      return { role: message.role, text: redacted.text.slice(0, MAX_SNAPSHOT_CHARS) };
    });
  return { title: typeof parsed.title === 'string' ? parsed.title : null, messages, removed };
}

/** Publish one of the owner's conversations as a read-only snapshot link. */
export async function publishConversation({ output, ownerId, authorization, client }) {
  if (!output || output.user_id !== ownerId) refuse(404, 'Conversation not found');
  const snapshot = conversationSnapshot(output.content);
  if (!snapshot.messages.length) refuse(422, 'This conversation has nothing to share yet');
  const title = (output.title || snapshot.title || 'Conversation').slice(0, 160);
  const published = await client.publish(authorization, { title, kind: 'conversation', transcript: { messages: snapshot.messages } });
  if (!published?.id || !SHARE_ID.test(published.id)) refuse(502, 'The share service did not return a link');
  return { id: published.id, url: client.origin + '/s/' + published.id, title, root: { kind: 'conversation', id: output.id }, messages: snapshot.messages.length, removed: snapshot.removed };
}

/** Fetch a shared bundle and describe it, re-running the same sanitize install will. Installs nothing. */
export async function previewLink({ link, client, nodeProvider = defaultNodeProvider }) {
  const id = shareIdFrom(link, client.origin);
  const shared = await client.fetch(id);
  const ref = REFERRAL_CODE.test(shared.ref || '') ? shared.ref : null;
  return { id, title: shared.title || 'Shared items', author: shared.author || null, ref, createdAt: shared.createdAt || null, ...previewBundle(shared.bundle, { nodeProvider }) };
}

/** Fetch a shared bundle and install a fresh, re-sanitized copy for `ownerId`. */
export async function receiveLink({ link, store, ownerId, client }) {
  const id = shareIdFrom(link, client.origin);
  const shared = await client.fetch(id);
  const { installed } = await installBundle(store, ownerId, shared.bundle);
  return { id, title: shared.title || 'Shared items', installed };
}
