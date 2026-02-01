/**
 * Custom assertion helpers for provider tests.
 *
 * Every helper returns { passed, message } so callers can collect
 * results without throwing on first failure.
 */

export function ok(condition, message) {
  return { passed: !!condition, message };
}

export function eq(actual, expected, message) {
  const passed = actual === expected;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

export function typeOf(value, expectedType, message) {
  const actual = typeof value;
  const passed = actual === expectedType;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected type "${expectedType}", got "${actual}"`,
  };
}

export function isArray(value, message) {
  const passed = Array.isArray(value);
  return {
    passed,
    message: passed ? message : `${message} — expected array, got ${typeof value}`,
  };
}

export function nonEmptyString(value, message) {
  const passed = typeof value === 'string' && value.length > 0;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected non-empty string, got ${JSON.stringify(value)}`,
  };
}

export function includes(haystack, needle, message) {
  const passed =
    typeof haystack === 'string'
      ? haystack.includes(needle)
      : Array.isArray(haystack)
        ? haystack.includes(needle)
        : false;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected to include ${JSON.stringify(needle)}`,
  };
}

export function greaterThan(actual, threshold, message) {
  const passed = actual > threshold;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected > ${threshold}, got ${actual}`,
  };
}

export function instanceOf(value, ctor, message) {
  const passed = value instanceof ctor;
  return {
    passed,
    message: passed
      ? message
      : `${message} — expected instance of ${ctor.name}`,
  };
}

export function hasProperty(obj, prop, message) {
  const passed = obj != null && prop in obj;
  return {
    passed,
    message: passed ? message : `${message} — missing property "${prop}"`,
  };
}

export function isValidToolCall(toolCall, message) {
  const checks = [];
  checks.push(ok(toolCall != null, `${message}: toolCall is not null`));
  if (!toolCall) return checks[0];

  checks.push(nonEmptyString(toolCall.id, `${message}: has id`));
  checks.push(hasProperty(toolCall, 'function', `${message}: has function`));
  if (toolCall.function) {
    checks.push(nonEmptyString(toolCall.function.name, `${message}: has function.name`));
    checks.push(typeOf(toolCall.function.arguments, 'string', `${message}: arguments is string`));
    // Verify JSON-parseable arguments
    let parsed = false;
    try { JSON.parse(toolCall.function.arguments); parsed = true; } catch { /* */ }
    checks.push(ok(parsed, `${message}: arguments is valid JSON`));
  }
  // Aggregate: fail if any sub-check failed
  const allPassed = checks.every((c) => c.passed);
  return {
    passed: allPassed,
    message: allPassed
      ? message
      : checks.filter((c) => !c.passed).map((c) => c.message).join('; '),
  };
}

/**
 * Validate a streaming chunk has the expected shape.
 */
export function isValidStreamChunk(chunk, message) {
  const checks = [];
  checks.push(ok(chunk != null, `${message}: chunk is not null`));
  if (!chunk) return checks[0];

  checks.push(hasProperty(chunk, 'type', `${message}: has type`));
  if (chunk.type === 'content') {
    checks.push(typeOf(chunk.delta, 'string', `${message}: delta is string`));
    checks.push(typeOf(chunk.accumulated, 'string', `${message}: accumulated is string`));
  } else if (chunk.type === 'tool_call_delta') {
    checks.push(hasProperty(chunk, 'index', `${message}: has index`));
    checks.push(hasProperty(chunk, 'toolCall', `${message}: has toolCall`));
  }
  const allPassed = checks.every((c) => c.passed);
  return {
    passed: allPassed,
    message: allPassed
      ? message
      : checks.filter((c) => !c.passed).map((c) => c.message).join('; '),
  };
}
