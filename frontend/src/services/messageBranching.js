/**
 * messageBranching.js — what the per-message actions (Copy, Edit, Regenerate,
 * Fork, Delete) mean on a transcript, as pure functions both chat stores and
 * both action surfaces (desktop row, phone sheet) share.
 *
 * NAMING A CUT FOR THE SERVER
 * ---------------------------
 * The server's copy of a conversation (conversation_logs) is provider-shaped
 * and carries no UI ids, so a cut is named by the user message it is anchored
 * to: its exact words, plus how many later user messages say the same thing.
 * The backend twin of this is transcriptBranching.js; the modes are its modes.
 *
 * A cut is `null` whenever this client cannot name one honestly — the anchor
 * has no text (an image-only message), or the action falls inside a turn the
 * server stores as one unit. The caller then acts on its own copy only, and
 * the server keeps what it has rather than losing something the user kept.
 */

const isUser = (message) => message?.role === 'user';
const hasWords = (message) => isUser(message) && typeof message.content === 'string' && message.content !== '';

/** The words and disambiguator of the user message at `index`. */
function anchorAt(messages, index) {
  const anchorText = messages[index].content;
  const sameTextAfter = messages.slice(index + 1).filter((m) => hasWords(m) && m.content === anchorText).length;
  return { anchorText, sameTextAfter };
}

/** Index of the user message closest before `index`, or -1. */
function previousUserIndex(messages, index) {
  for (let i = index - 1; i >= 0; i -= 1) if (isUser(messages[i])) return i;
  return -1;
}

function indexOf(messages, messageId) {
  return Array.isArray(messages) && messageId ? messages.findIndex((m) => m?.id === messageId) : -1;
}

/** Autosave's rule for a message worth saving (chat.js autosaveConversation). */
const isMeaningful = (m) => m?.role === 'user' || (m?.role === 'assistant' && !m.showProviderSetup);

/**
 * Delete `messageId` and everything after it.
 *
 * `emptied` is true when nothing worth saving would remain. That is Clear,
 * which has its own server path (a fresh conversation id, the Main chat's
 * role), so callers refuse it rather than save an empty transcript — which
 * autosave would skip, leaving the deleted messages on the server.
 *
 * @returns {{index: number, removed: number, emptied: boolean, cut: object|null}|null}
 *   null when the message is not here
 */
export function deleteCut(messages, messageId) {
  const index = indexOf(messages, messageId);
  if (index === -1) return null;
  const plan = { index, removed: messages.length - index, emptied: !messages.slice(0, index).some(isMeaningful) };
  const message = messages[index];

  if (isUser(message)) {
    return { ...plan, cut: hasWords(message) ? { ...anchorAt(messages, index), mode: 'before' } : null };
  }

  const userIndex = previousUserIndex(messages, index);
  if (userIndex === -1) {
    // Above every user message (a greeting): deleting from here removes the
    // first user message too, which is a cut the server can make.
    const next = messages.findIndex((m, i) => i > index && isUser(m));
    return { ...plan, cut: next !== -1 && hasWords(messages[next]) ? { ...anchorAt(messages, next), mode: 'before' } : null };
  }
  // A reply that is not the first after its user message (a steer split, a
  // second agent answering the same turn) shares one stored turn with the
  // replies before it. Cutting there on the server would drop replies the user
  // kept, so only this client's copy is cut.
  const midTurn = messages.slice(userIndex + 1, index).some((m) => m?.role === 'assistant');
  if (midTurn || !hasWords(messages[userIndex])) return { ...plan, cut: null };
  return { ...plan, cut: { ...anchorAt(messages, userIndex), mode: 'through' } };
}

/**
 * Fork a new conversation holding everything up to and including `messageId`.
 * A fork at a user message ends on that message, unanswered: running it is an
 * Edit & resend away. A fork at a reply keeps that reply's whole turn.
 * @returns {{messages: Array<object>, cut: object|null}|null}
 */
export function forkCut(messages, messageId) {
  const index = indexOf(messages, messageId);
  if (index === -1) return null;
  const kept = messages.slice(0, index + 1);
  const message = messages[index];

  if (isUser(message)) {
    return { messages: kept, cut: hasWords(message) ? { ...anchorAt(messages, index), mode: 'through' } : null };
  }
  const userIndex = previousUserIndex(messages, index);
  if (userIndex === -1 || !hasWords(messages[userIndex])) return { messages: kept, cut: null };
  return { messages: kept, cut: { ...anchorAt(messages, userIndex), mode: 'turn' } };
}

/**
 * The user message a reply answered — what Regenerate sends again. Only the
 * immediately preceding user message qualifies; an image-only one cannot be
 * resent as words, so there is nothing to regenerate from.
 * @returns {object|null}
 */
export function regenerateSource(messages, messageId) {
  const index = indexOf(messages, messageId);
  if (index === -1 || messages[index]?.role !== 'assistant') return null;
  const userIndex = previousUserIndex(messages, index);
  if (userIndex === -1) return null;
  const source = messages[userIndex];
  return typeof source.content === 'string' && source.content.trim() ? source : null;
}

/** The text Copy puts on the clipboard: the message as written. */
export function copyText(message) {
  if (!message) return '';
  if (typeof message.content === 'string' && message.content) return message.content;
  return (message.contentParts || []).filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n');
}

/** Actions a host can enable beyond Copy and Edit. */
export const BRANCH_ACTIONS = Object.freeze(['regenerate', 'fork', 'delete']);

const ACTION_META = Object.freeze({
  copy: { icon: 'fas fa-copy', label: 'Copy' },
  edit: { icon: 'fas fa-pen', label: 'Edit' },
  regenerate: { icon: 'fas fa-redo', label: 'Regenerate' },
  fork: { icon: 'fas fa-code-branch', label: 'Fork from here' },
  delete: { icon: 'fas fa-trash', label: 'Delete from here' },
});

/**
 * The actions one message offers, in display order.
 *
 * @param {object} args
 * @param {string}   args.role     'user' | 'assistant'
 * @param {boolean}  args.canEdit  the existing Edit rule (user message, or the editable latest reply)
 * @param {string[]} args.enabled  the host's BRANCH_ACTIONS (none by default: a surface that
 *                                 does not handle an action must never show it)
 * @param {boolean}  args.busy     the message is still being written
 * @param {string}   [args.editLabel]
 * @returns {Array<{id: string, icon: string, label: string}>}
 */
export function messageActions({ role, canEdit = false, enabled = [], busy = false, editLabel } = {}) {
  if (busy || (role !== 'user' && role !== 'assistant')) return [];
  const on = new Set(enabled);
  const ids = ['copy'];
  if (canEdit) ids.push('edit');
  if (role === 'assistant' && on.has('regenerate')) ids.push('regenerate');
  if (on.has('fork')) ids.push('fork');
  if (on.has('delete')) ids.push('delete');
  return ids.map((id) => ({ id, ...ACTION_META[id], ...(id === 'edit' && editLabel ? { label: editLabel } : {}) }));
}

// One frozen array per subset, so a message's prop keeps its identity across
// recomputes and Vue does not re-render every message on every change.
const SUBSETS = new Map();
function canonical(ids) {
  const key = BRANCH_ACTIONS.filter((id) => ids.includes(id)).join(',');
  if (!SUBSETS.has(key)) SUBSETS.set(key, Object.freeze(key ? key.split(',') : []));
  return SUBSETS.get(key);
}

/** The empty set, for messages a host has no plan for. */
export const NO_BRANCH_ACTIONS = canonical([]);

/**
 * Which branch actions each message of a transcript may offer, and how many
 * messages a delete there removes. Hosts compute this once per transcript
 * change and look messages up by id.
 *
 *   - delete: only where a message worth saving would remain. Deleting from
 *     the first one would empty the conversation — that is Clear, which has its
 *     own server path, so it is not offered here.
 *   - regenerate: replies that have a user message to resend.
 *   - fork: any user or assistant message.
 *
 * @param {Array<object>} messages
 * @param {string[]} enabled the host's BRANCH_ACTIONS
 * @returns {Map<string, {actions: readonly string[], deleteCount: number}>}
 */
export function branchPlan(messages, enabled = []) {
  const plan = new Map();
  if (!Array.isArray(messages)) return plan;
  const on = new Set(enabled);
  let lastUserIndex = -1;
  let meaningfulBefore = false;
  messages.forEach((message, index) => {
    if (message?.id && (message.role === 'user' || message.role === 'assistant')) {
      const ids = [];
      if (on.has('regenerate') && message.role === 'assistant' && lastUserIndex !== -1) {
        const source = messages[lastUserIndex];
        if (typeof source.content === 'string' && source.content.trim()) ids.push('regenerate');
      }
      if (on.has('fork')) ids.push('fork');
      if (on.has('delete') && meaningfulBefore) ids.push('delete');
      plan.set(message.id, { actions: canonical(ids), deleteCount: messages.length - index });
    }
    if (isUser(message)) lastUserIndex = index;
    if (isMeaningful(message)) meaningfulBefore = true;
  });
  return plan;
}

export default { deleteCut, forkCut, regenerateSource, copyText, messageActions, branchPlan, BRANCH_ACTIONS, NO_BRANCH_ACTIONS };
