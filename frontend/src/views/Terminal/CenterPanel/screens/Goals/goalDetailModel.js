// Display-only normalisation. Do not turn absent scores or costs into zero.
export function reviewPercent(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number)) * 10) / 10 : null;
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
