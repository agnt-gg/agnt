// outputSources — group content outputs by the thing that produced them.
//
// A file can come from a conversation, a workflow run, a tool run, or from
// nowhere in particular (dropped in, imported). `content_outputs` already
// carries the provenance: conversation_id, workflow_id, tool_id. This module
// turns that into the groups the Outputs screen's left panel draws, and the
// per-run / per-goal slices the Runs and Goals inspectors show.
//
// Pure: arrays in, arrays out. No store, no DOM.

import { parseServerTime } from '@/utils/serverTime.js';

const at = (o) => parseServerTime(o?.updated_at || o?.created_at);
const newestFirst = (a, b) => at(b) - at(a);

/**
 * @param {Array} outputs           content outputs (non-archived)
 * @param {object} names            { workflows: Map<id,name>, tools: Map<id,name>, conversations: Map<id,title> }
 * @param {object} [opts]
 * @param {string} [opts.activeConversationId]  the chat currently open, if any
 * @returns {Array<{ id, kind, label, count, items }>}  groups with items, newest first, empty groups omitted
 */
export function groupOutputsBySource(outputs, names = {}, opts = {}) {
  const wf = names.workflows || new Map();
  const tl = names.tools || new Map();
  const cv = names.conversations || new Map();
  const groups = new Map();
  const push = (key, kind, label, item) => {
    if (!groups.has(key)) groups.set(key, { id: key, kind, label, count: 0, items: [] });
    const g = groups.get(key);
    g.items.push(item);
    g.count++;
  };
  for (const o of outputs || []) {
    if (!o || o.archived_at) continue;
    if (opts.activeConversationId && o.conversation_id && String(o.conversation_id) === String(opts.activeConversationId)) {
      push('conv:active', 'conversation', 'This chat', o);
    } else if (o.workflow_id) {
      push(`wf:${o.workflow_id}`, 'workflow', wf.get(String(o.workflow_id)) || wf.get(o.workflow_id) || 'Workflow', o);
    } else if (o.tool_id) {
      push(`tool:${o.tool_id}`, 'tool', tl.get(String(o.tool_id)) || tl.get(o.tool_id) || 'Tool', o);
    } else if (o.conversation_id) {
      push(`conv:${o.conversation_id}`, 'conversation', cv.get(String(o.conversation_id)) || cv.get(o.conversation_id) || 'Chat', o);
    } else {
      push('loose', 'loose', 'Loose', o);
    }
  }
  const order = { conversation: 0, workflow: 1, tool: 2, loose: 3 };
  const list = [...groups.values()];
  for (const g of list) g.items.sort(newestFirst);
  // "This chat" first, then by kind, then by the newest item in the group.
  list.sort((a, b) => {
    if (a.id === 'conv:active') return -1;
    if (b.id === 'conv:active') return 1;
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    return at(b.items[0]) - at(a.items[0]);
  });
  return list;
}

/** Outputs a given workflow produced, newest first. */
export function outputsForWorkflow(outputs, workflowId) {
  if (workflowId == null) return [];
  return (outputs || []).filter((o) => o && !o.archived_at && String(o.workflow_id) === String(workflowId)).sort(newestFirst);
}

/** Outputs a given conversation produced, newest first. */
export function outputsForConversation(outputs, conversationId) {
  if (conversationId == null) return [];
  return (outputs || []).filter((o) => o && !o.archived_at && String(o.conversation_id) === String(conversationId)).sort(newestFirst);
}

/**
 * Outputs a goal produced. A goal has no column of its own on content_outputs;
 * its work lands in the conversation(s) its tasks ran in and the workflows it
 * triggered, so we union those. `goal` is the store object.
 */
export function outputsForGoal(outputs, goal) {
  if (!goal) return [];
  const convIds = new Set([goal.conversation_id, goal.conversationId, ...(goal.tasks || []).map((t) => t.conversation_id || t.conversationId)].filter(Boolean).map(String));
  const wfIds = new Set([goal.workflow_id, goal.workflowId, ...(goal.tasks || []).map((t) => t.workflow_id || t.workflowId)].filter(Boolean).map(String));
  return (outputs || [])
    .filter((o) => o && !o.archived_at && ((o.conversation_id && convIds.has(String(o.conversation_id))) || (o.workflow_id && wfIds.has(String(o.workflow_id)))))
    .sort(newestFirst);
}

/** The newest N outputs across every source — the morning sweep. */
export function recentOutputs(outputs, n = 8) {
  return (outputs || []).filter((o) => o && !o.archived_at).sort(newestFirst).slice(0, n);
}

/** A display name for an output row. */
export function outputLabel(o) {
  if (!o) return '';
  if (o.title) return o.title;
  const p = o.file_path || o.path || o.filePath;
  if (p) return String(p).split(/[\\/]/).pop();
  const c = typeof o.content === 'string' ? o.content.trim() : '';
  return c ? c.slice(0, 48) : `output ${String(o.id || '').slice(0, 8)}`;
}
