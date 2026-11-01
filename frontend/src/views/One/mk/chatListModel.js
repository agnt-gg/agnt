/**
 * The One chat list's three views, as pure functions over the store's own data
 * (conversation rows, the server-derived unread set, the group tree). No state
 * of its own: unread comes from contentOutputs, groups from the groups store.
 */
export const CHAT_VIEWS = Object.freeze(['all', 'unread', 'groups']);

/** Rows matching the search, case-insensitively, by title. */
export function searchRows(rows = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  return q ? rows.filter((r) => String(r.title || '').toLowerCase().includes(q)) : rows;
}

/** Unread, newest first. The chat on screen and a chat still being written are never "unread". */
export function unreadRows(rows = [], unreadIds = new Set(), activeId = null) {
  return rows.filter((r) => unreadIds.has(r.id) && r.id !== activeId && !r.working);
}

/**
 * Groups as visible sections: each group (sub-groups indented, a collapsed group hides its
 * children and its chats) with its chats, then "No group". `groupOf(id)` gives a chat's group id.
 * `count` is the group's own chats; a group with nothing in it still shows, so it can be dropped on.
 */
export function groupSections(rows = [], tree = [], groupOf = () => null, expanded = new Set()) {
  const byGroup = new Map();
  for (const row of rows) {
    const key = groupOf(row.id) || null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }
  const known = new Set();
  const sections = [];
  const walk = (nodes, depth) => {
    for (const node of nodes || []) {
      known.add(node.id);
      const open = expanded.has(node.id);
      const chats = byGroup.get(node.id) || [];
      sections.push({ id: node.id, name: node.name, depth, open, count: chats.length, hasChildren: Boolean(node.children?.length), chats: open ? chats : [] });
      if (open) walk(node.children, depth + 1);
      else (function markHidden(children) { for (const c of children || []) { known.add(c.id); markHidden(c.children); } })(node.children);
    }
  };
  walk(tree, 0);
  // A chat whose group no longer exists is shown ungrouped rather than lost.
  const loose = rows.filter((r) => { const g = groupOf(r.id); return !g || !known.has(g); });
  sections.push({ id: null, name: 'No group', depth: 0, open: true, count: loose.length, hasChildren: false, chats: loose });
  return sections;
}
