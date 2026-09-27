// Section labels are written in capitals for the desktop toolbar ("WIDGET FORGE").
// Phone headers and chips read as sentences, so they need "Widget Forge" — while
// acronyms stay acronyms and labels already in mixed case are left alone.
const ACRONYMS = new Set(['AI', 'API', 'MCP', 'OAUTH', 'URL', 'UI', 'AGNT']);
const ACRONYM_SPELLING = { OAUTH: 'OAuth' };

export function titleCase(label) {
  if (typeof label !== 'string' || !label) return label ?? '';
  if (label !== label.toUpperCase()) return label;
  return label
    .split(/(\s+|\/|-)/)
    .map((part) => {
      if (!/[A-Z]/.test(part)) return part;
      if (ACRONYMS.has(part)) return ACRONYM_SPELLING[part] || part;
      return part.charAt(0) + part.slice(1).toLowerCase();
    })
    .join('');
}
