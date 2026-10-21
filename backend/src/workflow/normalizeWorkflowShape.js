/**
 * The one workflow shape, whatever wrote it.
 *
 * The Workflow Forge canvas and the engine read a node as
 *   { id, type, text, x, y, parameters, category, icon, description }
 * and an edge as
 *   { id, start: { id, type: 'output' }, end: { id, type: 'input' } }.
 * (workflow-chat.js documents it for the Forge's own chat.)
 *
 * Models that build a workflow anywhere else reach for the React Flow shape
 * instead: { position: { x, y }, data: { label, parameters } }, with edge ends
 * typed by the NODE type. The save route accepted it (it checks only what the
 * engine dereferences), so the row stored fine and then:
 *   - the canvas had no x/y: every node stacked in one corner, pan, zoom and
 *     select stopped responding (reported 2026-10-21, AGNT One, "Daily AI
 *     Briefing" built by the main chat);
 *   - the engine found no node.parameters: every node would run unconfigured.
 *
 * normalizeWorkflowShape lifts those fields to where they are read. It only
 * moves values (position.x -> x, data.parameters -> parameters, data.label ->
 * text, ...) and only into fields that are missing; a field already present
 * wins. Nodes with no position at all are laid out left to right in edge
 * order, so the canvas always opens usable. Pure and idempotent: a canonical
 * workflow comes back unchanged with changed=false.
 *
 * @module normalizeWorkflowShape
 */

/** The Forge's grid and node metrics (workflow-chat.js: x and y on 16px, node width 288). */
const GRID = 16;
const LAYOUT_ORIGIN = { x: 96, y: 240 };
const COLUMN_STEP = 352; // node width 288 + 64 gap
const ROW_STEP = 160;

/** Fields a React-Flow-style node keeps under `data` that the Forge reads at the top level. */
const LIFTED_FROM_DATA = [
  ['label', 'text'],
  ['text', 'text'],
  ['type', 'type'],
  ['parameters', 'parameters'],
  ['category', 'category'],
  ['icon', 'icon'],
  ['description', 'description'],
];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMissing = (value) => value === undefined || value === null || value === '';
const isCoordinate = (value) => typeof value === 'number' && Number.isFinite(value);
const snap = (value) => Math.round(value / GRID) * GRID;

function liftNode(node) {
  let changed = false;
  const out = { ...node };

  if (isPlainObject(out.position)) {
    for (const axis of ['x', 'y']) {
      if (!isCoordinate(out[axis]) && isCoordinate(out.position[axis])) {
        out[axis] = out.position[axis];
      }
    }
    // x/y are what the canvas moves and saves; a kept `position` would go stale.
    delete out.position;
    changed = true;
  }

  if (isPlainObject(out.data)) {
    const rest = { ...out.data };
    for (const [from, to] of LIFTED_FROM_DATA) {
      if (!(from in rest)) continue;
      if (isMissing(out[to]) && !isMissing(rest[from])) out[to] = rest[from];
      delete rest[from];
    }
    if (Object.keys(rest).length) out.data = rest;
    else delete out.data;
    changed = true;
  }

  if (changed && !isPlainObject(out.parameters)) out.parameters = {};
  return { node: out, changed };
}

/** Column per node: its longest path from a node with no incoming edge. Cycle-safe. */
function layoutColumns(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const column = new Map(nodes.map((n) => [n.id, 0]));
  const links = edges
    .map((e) => [e?.start?.id, e?.end?.id])
    .filter(([from, to]) => ids.has(from) && ids.has(to) && from !== to);
  // Bellman-Ford style relaxation, capped at |nodes| passes: a cycle cannot
  // push a column past the node count.
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const [from, to] of links) {
      const next = column.get(from) + 1;
      if (next > column.get(to) && next < nodes.length) {
        column.set(to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return column;
}

function placeUnpositioned(nodes, edges) {
  const unplaced = nodes.filter((n) => !isCoordinate(n.x) || !isCoordinate(n.y));
  if (!unplaced.length) return false;
  const column = layoutColumns(nodes, edges);
  const rowsUsed = new Map();
  for (const node of nodes) {
    if (isCoordinate(node.x) && isCoordinate(node.y)) continue;
    const col = column.get(node.id) ?? 0;
    const row = rowsUsed.get(col) ?? 0;
    rowsUsed.set(col, row + 1);
    if (!isCoordinate(node.x)) node.x = snap(LAYOUT_ORIGIN.x + col * COLUMN_STEP);
    if (!isCoordinate(node.y)) node.y = snap(LAYOUT_ORIGIN.y + row * ROW_STEP);
  }
  return true;
}

/** An edge end typed with its node's TYPE ("trigger-timer") or untyped is the plain connector. */
function fixEdgeEnds(edges, typeOf) {
  let changed = false;
  const out = edges.map((edge) => {
    if (!isPlainObject(edge)) return edge;
    const next = { ...edge };
    for (const [end, connector] of [['start', 'output'], ['end', 'input']]) {
      const terminal = next[end];
      if (!isPlainObject(terminal) || isMissing(terminal.id)) continue;
      if (isMissing(terminal.type) || terminal.type === typeOf.get(terminal.id)) {
        next[end] = { ...terminal, type: connector };
        changed = true;
      }
    }
    return next;
  });
  return { edges: out, changed };
}

/**
 * @param {object} workflow - any workflow object (not mutated)
 * @returns {{ workflow: object, changed: boolean }}
 */
export function normalizeWorkflowShape(workflow) {
  if (!isPlainObject(workflow) || !Array.isArray(workflow.nodes)) return { workflow, changed: false };

  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    if (!isPlainObject(node)) return node;
    const lifted = liftNode(node);
    changed = changed || lifted.changed;
    return lifted.node;
  });
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const objectNodes = nodes.filter(isPlainObject);
  if (placeUnpositioned(objectNodes, edges)) changed = true;

  const typeOf = new Map(objectNodes.map((n) => [n.id, n.type]));
  const fixed = fixEdgeEnds(edges, typeOf);
  if (fixed.changed) changed = true;

  if (!changed) return { workflow, changed: false };
  return { workflow: { ...workflow, nodes, ...(Array.isArray(workflow.edges) ? { edges: fixed.edges } : {}) }, changed: true };
}

/**
 * The same, for a stored JSON string. Returns the input string untouched when
 * there is nothing to change (or it is not JSON: the caller's own handling of
 * bad JSON stays exactly as it was).
 */
export function normalizeWorkflowJson(workflowData) {
  if (typeof workflowData !== 'string') return workflowData;
  let parsed;
  try {
    parsed = JSON.parse(workflowData);
  } catch {
    return workflowData;
  }
  const { workflow, changed } = normalizeWorkflowShape(parsed);
  return changed ? JSON.stringify(workflow) : workflowData;
}
