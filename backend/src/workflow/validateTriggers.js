/**
 * Check a workflow's trigger nodes against each trigger's own schema before it is switched on.
 *
 * A trigger with a parameter its schema does not allow (a timer "schedule: every 2 hours", a misspelled
 * "scheduleType") used to arm "successfully" and then never fire, with no error anywhere. Each problem
 * names the node and the field, and the values that are allowed.
 *
 * Only what the schema states is checked: a select's value must be one of its options, and a required
 * parameter must be present, both only when the parameter applies (its `conditional` matches). A trigger
 * with no schema file (a plugin trigger) is not checked here; its own setup reports its errors.
 */
const isMissing = (value) => value === undefined || value === null || value === '';

function applies(definition, parameters) {
  const condition = definition?.conditional;
  if (!condition?.field) return true;
  const actual = parameters?.[condition.field];
  return Array.isArray(condition.value) ? condition.value.includes(actual) : actual === condition.value;
}

export function triggerProblems(node, schema) {
  const problems = [];
  const parameters = node?.parameters || {};
  const definitions = schema?.parameters || {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (!applies(definition, parameters)) continue;
    const value = parameters[name] ?? definition.default;
    if (definition.required && isMissing(value)) {
      problems.push(`trigger "${node.text || node.id}": "${name}" is required`);
      continue;
    }
    if (isMissing(value) || !Array.isArray(definition.options) || !definition.options.length) continue;
    // A multi-select holds an array: every chosen value must be an option.
    const bad = (Array.isArray(value) ? value : [value]).filter((item) => !definition.options.includes(item));
    if (bad.length) {
      problems.push(`trigger "${node.text || node.id}": "${name}" is ${JSON.stringify(Array.isArray(value) ? value : String(value))}, but must be one of ${definition.options.map((option) => JSON.stringify(option)).join(', ')}`);
    }
  }
  return problems;
}

/** Every problem in this workflow's triggers, loading each trigger's schema by type. */
export async function workflowTriggerProblems(workflow, loadSchema = defaultSchema) {
  const problems = [];
  for (const node of workflow?.nodes || []) {
    if (node?.category !== 'trigger') continue;
    const schema = await loadSchema(node.type);
    if (schema) problems.push(...triggerProblems(node, schema));
  }
  return problems;
}

async function defaultSchema(type) {
  if (typeof type !== 'string' || !/^[a-z0-9-]+$/.test(type)) return null;
  try {
    const trigger = (await import(`../tools/library/triggers/${type}.js`)).default;
    return trigger?.schema || trigger?.constructor?.schema || null;
  } catch { return null; }
}
