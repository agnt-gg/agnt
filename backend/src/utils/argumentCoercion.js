/**
 * Lossless argument-type coercion for tool calls.
 *
 * LLMs routinely emit JSON-stringified scalars — "440" for 440, "true" for
 * true — and strict schema validation that rejects them wastes an entire
 * model round-trip on an error the runtime can repair deterministically.
 * (Observed live 2026-07-27: query_data slice failed twice in a row because
 * the model sent startLine/endLine as strings.)
 *
 * This module repairs ONLY provably lossless mismatches BEFORE validation:
 *   - "440"  -> 440        (expected number/integer, string parses to a finite
 *                           number; integer additionally requires an integral value)
 *   - "true" -> true       (expected boolean, string is exactly true/false,
 *                           case-insensitive)
 *   - 440    -> "440"      (expected string, got number/boolean)
 *   - "[1,2]" -> [1,2]     (expected array/object, string is valid JSON of
 *                           exactly that type)
 *
 * Anything ambiguous ("2.5" for an integer, "yes" for a boolean, non-JSON
 * strings for arrays) is left untouched so validateToolArguments still
 * reports it honestly. The function is pure: it returns the ORIGINAL args
 * object by reference when nothing needed coercing, and a shallow copy with
 * only the coerced keys replaced otherwise.
 */

/**
 * @param {object} args   Raw arguments as parsed from the model's tool call.
 * @param {object} schema Tool schema shaped { function: { parameters: { properties } } }
 *                        (the exact shape validateToolArguments already reads).
 * @returns {object} args (by reference) when unchanged, else a coerced copy.
 */
export function coerceArgumentTypes(args, schema) {
  const properties = schema?.function?.parameters?.properties;
  if (!args || typeof args !== 'object' || Array.isArray(args) || !properties) {
    return args;
  }

  let changed = false;
  const out = { ...args };

  for (const [name, value] of Object.entries(args)) {
    const expectedType = properties[name]?.type;
    // JSON Schema allows `type` to be an array of types; a union already
    // accepts multiple shapes, so we only coerce single, unambiguous types.
    if (typeof expectedType !== 'string') continue;

    const coerced = coerceValue(value, expectedType);
    if (coerced !== undefined) {
      out[name] = coerced;
      changed = true;
    }
  }

  return changed ? out : args;
}

/**
 * Returns the coerced value, or undefined when no (lossless) coercion applies.
 * undefined is a safe sentinel: an arg whose VALUE is undefined never needs
 * coercion in the first place.
 */
function coerceValue(value, expectedType) {
  if (value === null || value === undefined) return undefined;

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType === expectedType) return undefined;
  // integer-vs-number for actual JS numbers is already accepted by the
  // validator (JS has one numeric type); nothing to repair.
  if (expectedType === 'integer' && actualType === 'number') return undefined;

  if ((expectedType === 'number' || expectedType === 'integer') && actualType === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    if (expectedType === 'integer' && !Number.isInteger(num)) return undefined;
    return num;
  }

  if (expectedType === 'boolean' && actualType === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
  }

  if (expectedType === 'string' && (actualType === 'number' || actualType === 'boolean')) {
    return String(value);
  }

  if ((expectedType === 'array' || expectedType === 'object') && actualType === 'string') {
    const trimmed = value.trim();
    // Cheap shape gate before paying for JSON.parse on arbitrary prose.
    if (expectedType === 'array' && !trimmed.startsWith('[')) return undefined;
    if (expectedType === 'object' && !trimmed.startsWith('{')) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      const parsedType = Array.isArray(parsed) ? 'array' : typeof parsed;
      if (parsedType === expectedType && parsed !== null) return parsed;
    } catch {
      // Not JSON — leave it for the validator to report.
    }
    return undefined;
  }

  return undefined;
}

export default coerceArgumentTypes;
