const REDACTED = '[REDACTED]';
const SECRET_FIELD = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|client[_-]?secret|jwt[_-]?secret|session[_-]?secret|encryption[_-]?key|agnt[_-](?:auth[_-]token|instance[_-]key))$/i;
const FIELD_TEXT = /((?:"|')?(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|jwt[_-]?secret|session[_-]?secret|encryption[_-]?key|AGNT_AUTH_TOKEN|AGNT_INSTANCE_KEY)(?:"|')?\s*[:=]\s*)(["'])([^"'\r\n]+)\2/gi;
const TOKENS = /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|agnt-tool\.[A-Za-z0-9_.-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,})\b/g;

// Applied before output limits and persistence. Both nested objects and JSON
// embedded in stdout are covered; camelCase and snake_case are equivalent.
export function redactToolSecrets(value, seen = new WeakMap()) {
  if (typeof value === 'string') return value.replace(TOKENS, REDACTED).replace(FIELD_TEXT, (_all, lead, quote) => lead + quote + REDACTED + quote);
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return redactToolSecrets(value.toString('utf8'));
  if (seen.has(value)) return '[Circular]';
  const result = Array.isArray(value) ? [] : Object.create(null);
  seen.set(value, result);
  for (const [key, child] of Object.entries(value)) {
    result[key] = SECRET_FIELD.test(key) && typeof child === 'string' && child.length ? REDACTED : redactToolSecrets(child, seen);
  }
  return result;
}
