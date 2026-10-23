import { randomUUID } from 'crypto';

/**
 * Workflow Manipulation Service
 * Helper utilities for workflow node operations
 */

/**
 * Calculate auto-layout position for a new node
 * @param {Array} existingNodes - Current workflow nodes
 * @param {string} insertAfterNodeId - Optional node ID to insert after
 * @returns {object} - {x, y} coordinates
 */
export function calculateAutoLayout(existingNodes, insertAfterNodeId = null) {
  const GRID_SPACING_Y = TOP_DOWN.rowGap;
  const START_X = 100;
  const START_Y = 100;

  // If no existing nodes, start at origin
  if (!existingNodes || existingNodes.length === 0) {
    return { x: START_X, y: START_Y };
  }

  // If inserting after a specific node, position below it
  if (insertAfterNodeId) {
    const afterNode = existingNodes.find((n) => n.id === insertAfterNodeId);
    if (afterNode) {
      // Support both x/y and position.x/position.y
      const nodeX = afterNode.x !== undefined ? afterNode.x : afterNode.position?.x;
      const nodeY = afterNode.y !== undefined ? afterNode.y : afterNode.position?.y;
      if (nodeX !== undefined && nodeY !== undefined) {
        return {
          x: nodeX,
          y: nodeY + GRID_SPACING_Y,
        };
      }
    }
  }

  // Otherwise below the lowest step: workflows read top-down (2026-10-23;
  // they used to grow to the right).
  const lowest = existingNodes.reduce(
    (max, node) => {
      const nodeX = node.x !== undefined ? node.x : node.position?.x;
      const nodeY = node.y !== undefined ? node.y : node.position?.y;
      if (nodeY === undefined) return max;
      return nodeY > max.y ? { x: nodeX ?? START_X, y: nodeY } : max;
    },
    { x: START_X, y: START_Y - GRID_SPACING_Y }
  );

  return {
    x: lowest.x,
    y: lowest.y + GRID_SPACING_Y,
  };
}

/** Spacing of the top-down layout. Steps are ~272px wide and up to ~150 tall. */
export const TOP_DOWN = Object.freeze({ startX: 100, startY: 100, rowGap: 200, columnGap: 340 });

/**
 * Positions for a whole graph, top-down: each step one row below the deepest
 * step that leads to it, steps of a row side by side. Pure; returns a Map of
 * id -> {x, y}. Cycles are cut at the first revisit.
 */
export function layoutTopDown(nodes = [], edges = []) {
  const ids = nodes.map((n) => n.id);
  const incoming = new Map(ids.map((id) => [id, []]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    const from = e?.start?.id ?? e?.source;
    const to = e?.end?.id ?? e?.target;
    if (incoming.has(to) && outgoing.has(from) && from !== to) {
      incoming.get(to).push(from);
      outgoing.get(from).push(to);
    }
  }
  // Longest path from a root, so a step always sits below everything feeding it.
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = incoming.get(id).length ? Math.max(...incoming.get(id).map((p) => depthOf(p) + 1)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  ids.forEach(depthOf);
  const rows = new Map();
  for (const id of ids) {
    const d = depth.get(id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(id);
  }
  const positions = new Map();
  for (const [d, row] of rows) {
    row.forEach((id, i) => positions.set(id, { x: TOP_DOWN.startX + i * TOP_DOWN.columnGap, y: TOP_DOWN.startY + d * TOP_DOWN.rowGap }));
  }
  return positions;
}

/**
 * Validate that a node type exists in the tool library
 * @param {string} nodeType - Node type to validate
 * @returns {Promise<boolean>}
 */
export async function validateNodeType(nodeType) {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const toolLibraryPath = path.join(__dirname, '../tools/toolLibrary.json');

    const rawToolLibrary = await fs.readFile(toolLibraryPath, 'utf-8');
    const toolLibraryData = JSON.parse(rawToolLibrary);

    // Check all categories
    const allTools = [
      ...(toolLibraryData.triggers || []),
      ...(toolLibraryData.actions || []),
      ...(toolLibraryData.utilities || []),
      ...(toolLibraryData.widgets || []),
      ...(toolLibraryData.controls || []),
      ...(toolLibraryData.custom || []),
    ];

    const isValid = allTools.some((tool) => tool.type === nodeType);

    // Warn about unknown node types but don't fail validation
    // The frontend will handle displaying unknown node types gracefully
    if (!isValid) {
      console.warn(`[WorkflowManipulation] Unknown node type: ${nodeType} (will be allowed, frontend will handle)`);
    }

    // Always return true - let frontend handle unknown types gracefully
    return true;
  } catch (error) {
    console.error('[WorkflowManipulation] Error validating node type:', error);
    // On error, allow the node type through
    return true;
  }
}

/**
 * Validate node connections
 * @param {string} fromNodeId - Source node ID
 * @param {string} toNodeId - Target node ID
 * @param {Array} nodes - All workflow nodes
 * @returns {object} - {valid: boolean, error: string}
 */
export function validateNodeConnections(fromNodeId, toNodeId, nodes) {
  const fromNode = nodes.find((n) => n.id === fromNodeId);
  const toNode = nodes.find((n) => n.id === toNodeId);

  if (!fromNode) {
    return { valid: false, error: `Source node ${fromNodeId} not found` };
  }

  if (!toNode) {
    return { valid: false, error: `Target node ${toNodeId} not found` };
  }

  // Check for self-connection
  if (fromNodeId === toNodeId) {
    return { valid: false, error: 'Cannot connect a node to itself' };
  }

  return { valid: true };
}

/**
 * Clean up orphaned edges when a node is deleted
 * @param {string} nodeId - Node ID being deleted
 * @param {Array} edges - Current workflow edges
 * @returns {Array} - Cleaned edges array
 */
export function cleanupOrphanedEdges(nodeId, edges) {
  return edges.filter((edge) => {
    // Support both old format (start.id/end.id) and new format (source/target)
    const edgeSource = edge.start?.id || edge.source;
    const edgeTarget = edge.end?.id || edge.target;
    return edgeSource !== nodeId && edgeTarget !== nodeId;
  });
}

/**
 * Generate a unique node ID
 * @returns {string}
 */
export function generateNodeId() {
  return `node_${randomUUID()}`;
}

/**
 * Generate a unique edge ID
 * @param {string} sourceId - Source node ID
 * @param {string} targetId - Target node ID
 * @param {string} sourceHandle - Source handle (optional)
 * @returns {string}
 */
export function generateEdgeId(sourceId, targetId, sourceHandle = '') {
  const handleSuffix = sourceHandle ? `_${sourceHandle}` : '';
  return `${sourceId}${handleSuffix}_to_${targetId}`;
}

/**
 * Diff two workflow states
 * @param {object} oldWorkflow - Previous workflow state
 * @param {object} newWorkflow - New workflow state
 * @returns {object} - Diff object with added, removed, modified
 */
export function diffWorkflows(oldWorkflow, newWorkflow) {
  const nodesAdded = newWorkflow.nodes.filter((nb) => !oldWorkflow.nodes.some((na) => na.id === nb.id));

  const nodesRemoved = oldWorkflow.nodes.filter((na) => !newWorkflow.nodes.some((nb) => nb.id === na.id));

  const nodesModified = newWorkflow.nodes.filter((nb) => {
    const matchingNode = oldWorkflow.nodes.find((na) => na.id === nb.id);
    return matchingNode && JSON.stringify(matchingNode) !== JSON.stringify(nb);
  });

  const edgesAdded = newWorkflow.edges.filter((eb) => !oldWorkflow.edges.some((ea) => ea.id === eb.id));

  const edgesRemoved = oldWorkflow.edges.filter((ea) => !newWorkflow.edges.some((eb) => eb.id === ea.id));

  return {
    nodesAdded,
    nodesRemoved,
    nodesModified,
    edgesAdded,
    edgesRemoved,
    summary: {
      totalChanges: nodesAdded.length + nodesRemoved.length + nodesModified.length + edgesAdded.length + edgesRemoved.length,
      nodesAddedCount: nodesAdded.length,
      nodesRemovedCount: nodesRemoved.length,
      nodesModifiedCount: nodesModified.length,
      edgesAddedCount: edgesAdded.length,
      edgesRemovedCount: edgesRemoved.length,
    },
  };
}

/**
 * Find node by ID or label
 * @param {Array} nodes - Workflow nodes
 * @param {string} identifier - Node ID or label
 * @returns {object|null} - Found node or null
 */
export function findNodeByIdentifier(nodes, identifier) {
  // Try exact ID match first
  let node = nodes.find((n) => n.id === identifier);
  if (node) return node;

  // Try label match (case-insensitive) - check both "text" and "data.label" for backwards compatibility
  node = nodes.find((n) => {
    const label = n.text || n.data?.label;
    return label && label.toLowerCase() === identifier.toLowerCase();
  });
  if (node) return node;

  // Try partial label match
  node = nodes.find((n) => {
    const label = n.text || n.data?.label;
    return label && label.toLowerCase().includes(identifier.toLowerCase());
  });
  return node || null;
}

/**
 * Get node reference map for LLM context
 * @param {Array} nodes - Workflow nodes
 * @returns {string} - Formatted reference map
 */
export function buildNodeReferenceMap(nodes) {
  return nodes
    .map((node, idx) => {
      const label = node.text || node.data?.label || node.type || 'Untitled';
      const type = node.type || 'unknown';
      return `[${idx + 1}] "${label}" (id: ${node.id}, type: ${type})`;
    })
    .join('\n');
}

export default {
  calculateAutoLayout,
  validateNodeType,
  validateNodeConnections,
  cleanupOrphanedEdges,
  generateNodeId,
  generateEdgeId,
  diffWorkflows,
  findNodeByIdentifier,
  buildNodeReferenceMap,
};
