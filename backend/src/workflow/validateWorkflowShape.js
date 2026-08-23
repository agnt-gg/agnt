/**
 * The workflow shape WorkflowEngine actually reads.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS GUARDS
 * ---------------------------------------------------------------------------
 * The engine reads exactly one node/edge shape. It is produced by the workflow
 * designer (WorkflowDesigner.vue `createNode` / `createEdge`) and by nothing
 * else. Every other producer — the marketplace installer, `/workflows/import`,
 * agent tooling that POSTs to `/workflows/save` — invents its own.
 *
 * Nothing checked. `saveWorkflow` validated only that the body was an object,
 * then `JSON.stringify`'d it into the row. The mismatch surfaced later, once,
 * at activation:
 *
 *     TypeError: Cannot read properties of undefined (reading 'toLowerCase')
 *         at WorkflowEngine._initializeNodeNameMapping (WorkflowEngine.js:518)
 *
 * and reached the caller as `{ status: 'error' }` — WorkflowProcessBridge
 * returns that for ANY caught IPC exception, so the message naming the real
 * cause never left the workflow process. A save reported success, the workflow
 * sat in the list looking fine, and activation failed with a string that named
 * neither the node nor the field.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE RULES AND NOT MORE
 * ---------------------------------------------------------------------------
 * Every rule below corresponds to a property the engine DEREFERENCES. Nothing
 * here encodes taste. If the engine stops reading a field, the rule for it
 * should go too. Sites are named by method rather than line number, which
 * drifts on the first edit above them:
 *
 *   node.text     WorkflowEngine#_initializeNodeNameMapping —
 *                 node.text.toLowerCase(), the display name lowercased into
 *                 the {{Node Name.output}} lookup table
 *   node.id       WorkflowEngine#executeWorkflow — new Map(nodes.map(n => [n.id, n]))
 *   node.type     WorkflowEngine#setupTriggers —
 *                 import(`../tools/library/triggers/${node.type}.js`)
 *   edge.start.id WorkflowEngine#executeWorkflow — edgeMap keyed by start.id
 *   edge.end.id   WorkflowEngine#executeWorkflow (execution queue) and
 *                 #_findStartNodes (nodes with no incoming edge)
 *
 * Absent `nodes` / `edges` are treated as empty rather than rejected: a blank
 * draft is a legitimate thing to save, and WorkflowImportService already
 * coerces both the same way. Contents, not presence, are what break.
 *
 * @module validateWorkflowShape
 */

/** Field is usable as an identifier or a display name. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Describe what a caller sent, without dumping their payload back at them.
 * Keeps error messages useful when the value is an object or an array.
 */
function describe(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return value.trim() === '' ? 'an empty string' : `"${value}"`;
  const type = typeof value;
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
}

/** Label a node in an error message: prefer its id, fall back to position. */
function nodeLabel(node, index) {
  return isNonEmptyString(node?.id) ? `node "${node.id}"` : `node at index ${index}`;
}

/**
 * Check a workflow against the shape WorkflowEngine can execute.
 *
 * Pure: reads `workflow`, mutates nothing, touches no I/O.
 *
 * @param {unknown} workflow - the object about to be persisted or executed
 * @returns {{ valid: boolean, errors: string[] }} `errors` is empty iff valid.
 *   Every entry names the offending node/edge and the field that is wrong, so
 *   the message can be handed to the caller verbatim.
 */
export function validateWorkflowShape(workflow) {
  const errors = [];

  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return { valid: false, errors: ['Workflow must be an object.'] };
  }

  const { nodes, edges } = workflow;

  // Absent is a blank draft. Present-but-not-an-array is a caller bug: the
  // engine calls .forEach/.map on both unconditionally.
  if (nodes !== undefined && nodes !== null && !Array.isArray(nodes)) {
    errors.push(`Workflow "nodes" must be an array, got ${describe(nodes)}.`);
  }
  if (edges !== undefined && edges !== null && !Array.isArray(edges)) {
    errors.push(`Workflow "edges" must be an array, got ${describe(edges)}.`);
  }
  if (errors.length) return { valid: false, errors };

  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  const declaredIds = new Set();
  const duplicateIds = new Set();

  nodeList.forEach((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`Node at index ${index} must be an object, got ${describe(node)}.`);
      return;
    }

    if (!isNonEmptyString(node.id)) {
      errors.push(`Node at index ${index} is missing "id" (got ${describe(node.id)}).`);
    } else if (declaredIds.has(node.id)) {
      // Two nodes sharing an id silently shadow each other in the engine's
      // id→node Map, so the second one can never execute.
      duplicateIds.add(node.id);
    } else {
      declaredIds.add(node.id);
    }

    if (!isNonEmptyString(node.text)) {
      errors.push(
        `${nodeLabel(node, index)} is missing "text" (got ${describe(node.text)}). ` +
          '"text" is the node\'s display name; the engine lowercases it to resolve ' +
          '{{Node Name.output}} references.'
      );
    }

    if (!isNonEmptyString(node.type)) {
      errors.push(
        `${nodeLabel(node, index)} is missing "type" (got ${describe(node.type)}). ` +
          '"type" selects the tool or trigger implementation to run.'
      );
    }
  });

  for (const id of duplicateIds) {
    errors.push(`Duplicate node id "${id}" — node ids must be unique.`);
  }

  edgeList.forEach((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      errors.push(`Edge at index ${index} must be an object, got ${describe(edge)}.`);
      return;
    }

    const label = isNonEmptyString(edge.id) ? `edge "${edge.id}"` : `edge at index ${index}`;

    for (const end of ['start', 'end']) {
      const endpoint = edge[end];

      if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
        errors.push(
          `${label} is missing "${end}" (got ${describe(endpoint)}). ` +
            `Edges connect nodes as { ${end}: { id, type } }.`
        );
        continue;
      }

      if (!isNonEmptyString(endpoint.id)) {
        errors.push(`${label} has "${end}" without an "id" (got ${describe(endpoint.id)}).`);
        continue;
      }

      // An edge pointing at a node that was never declared silently drops that
      // branch of execution. Checked even when `nodes` is empty: edges without
      // any nodes at all is not a blank draft, it is a broken workflow — a
      // blank draft has no edges either.
      if (!declaredIds.has(endpoint.id)) {
        errors.push(`${label} "${end}" references unknown node id "${endpoint.id}".`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Same check, phrased for a caller that wants to fail hard.
 *
 * @param {unknown} workflow
 * @param {string} [context] - prefix for the thrown message, e.g. a workflow id
 * @throws {Error} listing every problem found, one per line
 */
export function assertWorkflowShape(workflow, context = 'Workflow') {
  const { valid, errors } = validateWorkflowShape(workflow);
  if (!valid) {
    throw new Error(`${context} cannot be executed:\n  - ${errors.join('\n  - ')}`);
  }
}

export default validateWorkflowShape;
