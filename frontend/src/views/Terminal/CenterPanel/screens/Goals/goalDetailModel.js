// The overview is an excerpt of recorded work, never a generated success claim.
// Full task text and files remain available on demand.
export function briefText(value, limit = 280) {
  const text = String(value || '').slice(0, OUTPUT_LIMIT)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const boundary = clipped.lastIndexOf(' ');
  return (boundary > limit * .6 ? clipped.slice(0, boundary) : clipped) + '…';
}

export function goalResultText(tasks = []) {
  for (let index = tasks.length - 1; index >= 0; index--) {
    if (tasks[index]?.status !== 'completed') continue;
    const text = taskOutputText(tasks[index].output);
    if (text.trim()) return text;
  }
  return '';
}

export const OUTPUT_LIMIT = 50_000;
export function taskOutputText(output) {
  let parsed = output;
  if (typeof output === 'string') {
    // Huge payloads remain available through BoundedJson without parsing a
    // multi-megabyte tree just to show a small preview.
    if (output.length > 200_000) return output.slice(0, OUTPUT_LIMIT);
    try { parsed = JSON.parse(output); } catch { return output.slice(0, OUTPUT_LIMIT); }
  }
  let remaining = OUTPUT_LIMIT;
  const parts = [];
  function visit(value, depth = 0) {
    if (depth > 12 || remaining <= 0) return;
    if (typeof value === 'string') {
      const text = value.slice(0, remaining); parts.push(text); remaining -= text.length;
    } else if (Array.isArray(value)) {
      for (const child of value) { visit(child, depth + 1); if (!remaining) break; }
    } else if (value && typeof value === 'object') {
      if (['thinking', 'redacted_thinking', 'tool_use', 'tool_result'].includes(value.type)) return;
      const text = value.content ?? value.text ?? value.response ?? value.result;
      if (text !== value) visit(text, depth + 1);
    }
  }
  visit(parsed);
  return parts.join('\n\n').slice(0, OUTPUT_LIMIT);
}
