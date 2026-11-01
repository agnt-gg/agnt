/**
 * A teamspace chat message, in the shape the main chat's MessageItem renders.
 *
 * Every author is drawn the same way (the teamspace shows names and avatars itself), so the message
 * body is rendered as a reply: markdown, code, tables, images and tool cards. A reply that came from
 * a chat turn (Annie) carries its full message (contentParts, toolCalls); a person's message is text.
 * Results are memoized per message so MessageItem keeps a stable object and only re-renders on change.
 */
const cache = new WeakMap();

export function chatMessageOf(m) {
  const key = m.message || m;
  const signature = `${m.id}|${m.body}|${m.message ? m.message.content?.length + ':' + (m.message.toolCalls || []).map((t) => t.status).join(',') : ''}`;
  const hit = cache.get(key);
  if (hit && hit.signature === signature) return hit.value;
  const full = m.message && typeof m.message === 'object' ? m.message : null;
  const content = full ? String(full.content || '') : String(m.body || '');
  const value = {
    id: `team-${m.id}`,
    role: 'assistant',
    content,
    contentParts: full && Array.isArray(full.contentParts) && full.contentParts.length ? full.contentParts : [{ type: 'text', text: content }],
    toolCalls: full && Array.isArray(full.toolCalls) ? full.toolCalls : [],
    reasoning: full?.reasoning || '',
    timestamp: Date.parse(m.createdAt) || Date.now(),
    isStreaming: Boolean(m.live),
  };
  cache.set(key, { signature, value });
  return value;
}
