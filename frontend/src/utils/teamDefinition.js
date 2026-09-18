/** Prepare a reviewable snapshot without copying stored provider credentials or identity. */
const PRIVATE_KEY = /(password|passwd|secret|token|api_?key|authorization|credential|private_?key)/i;
export function teamDefinition(resource) {
  const keys = resource.kind === 'agent' ?
    ['name', 'description', 'systemPrompt', 'system_prompt', 'assignedTools', 'assignedSkills'] :
    resource.kind === 'workflow' ? ['name', 'description', 'nodes', 'edges'] : ['name', 'description', 'content', 'instructions'];

  function redact(value, depth = 0) {
    if (depth > 40) throw Error('Definition nesting is too deep to share safely.');
    if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEY.test(key)).map(([key, val]) => [key, redact(val, depth + 1)]));
  }
  return JSON.stringify(redact(Object.fromEntries(keys.filter(key => resource.item[key] !== undefined).map(key => [key, resource.item[key]]))), null, 2);
}
