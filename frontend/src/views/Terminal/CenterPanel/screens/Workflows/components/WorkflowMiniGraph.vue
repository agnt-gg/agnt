<template>
  <div class="workflow-mini-graph-container">
    <div class="workflow-mini-graph">
      <svg :width="graphWidth" :height="graphHeight" :viewBox="`0 0 ${graphWidth} ${graphHeight}`" class="mini-graph-svg">
        <!-- Edges/connections -->
        <g class="edges">
          <path v-for="edge in processedEdges" :key="edge.id" :d="edge.path" class="mini-edge" stroke="#3b406d60" stroke-width="0.8" fill="none" />
        </g>

        <!-- Nodes -->
        <g class="nodes">
          <g v-for="node in processedNodes" :key="node.id" :transform="`translate(${node.x}, ${node.y})`" class="mini-node">
            <!-- SVG tooltip -->
            <title>{{ getNodeDisplayName(node) }}</title>

            <!-- Node circle -->
            <circle :r="nodeRadius" :class="['node-circle', node.category]" :fill="getNodeColor(node)" stroke="#01052a25" stroke-width="1" />

            <!-- Node icon (actual from workflow using SvgIcon) -->
            <foreignObject :x="-nodeRadius * 0.6" :y="-nodeRadius * 0.6" :width="nodeRadius * 1.2" :height="nodeRadius * 1.2">
              <div class="node-icon-container">
                <SvgIcon :name="getActualNodeIcon(node)" class="mini-node-icon" />
              </div>
            </foreignObject>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<script>
import SvgIcon from '@/views/_components/common/SvgIcon.vue';

export default {
  name: 'WorkflowMiniGraph',
  components: {
    SvgIcon,
  },
  props: {
    workflow: {
      type: Object,
      required: true,
    },
    width: {
      type: Number,
      default: 300,
    },
    height: {
      type: Number,
      default: 60,
    },
  },
  data() {
    return {
      nodeRadius: 14, // Increased from 10 to make nodes bigger
      padding: 20, // Increased from 16 for more breathing room
      minNodeGap: 36, // Increased from 26 for better spacing between nodes
      maxSmallWorkflowWidth: 220, // Increased from 180 to accommodate larger nodes
      maxSmallWorkflowHeight: 80, // Increased from 60 to accommodate larger nodes
      smallWorkflowThreshold: 4, // Consider workflows with <= 4 nodes as "small"
    };
  },
  computed: {
    nodes() {
      // Filter out label nodes from the mini graph display
      return (this.workflow.nodes || []).filter((node) => node.type !== 'label');
    },
    edges() {
      return this.workflow.edges || [];
    },

    // Calculate dynamic dimensions based on content
    graphWidth() {
      if (!this.nodes.length) return this.width;

      const levels = this.getLevels();
      const levelWidth = 60; // Adjusted to accommodate larger nodes
      const calculatedWidth = this.padding * 2 + levels.length * levelWidth;

      // Apply maximum width constraint for small workflows
      if (this.nodes.length <= this.smallWorkflowThreshold) {
        return Math.min(calculatedWidth, this.maxSmallWorkflowWidth);
      }

      return calculatedWidth;
    },

    graphHeight() {
      if (!this.nodes.length) return 60; // minimum height

      const levels = this.getLevels();
      const maxNodesInLevel = Math.max(...levels.map((level) => level.length));
      const calculatedHeight = this.padding * 2 + maxNodesInLevel * this.minNodeGap;

      // Apply maximum height constraint for small workflows
      if (this.nodes.length <= this.smallWorkflowThreshold) {
        return Math.min(calculatedHeight, this.maxSmallWorkflowHeight);
      }

      return calculatedHeight;
    },
    processedNodes() {
      if (!this.nodes.length) return [];

      // Get levels for positioning
      const levels = this.getLevels();
      const positioned = [];

      // Calculate dynamic dimensions
      const maxNodesInLevel = Math.max(...levels.map((level) => level.length));
      const isSmallWorkflow = this.nodes.length <= this.smallWorkflowThreshold;

      // Adjust spacing for small workflows to fit within constraints
      let levelWidth = 60; // Reduced from 80 to bring nodes closer together horizontally
      let nodeGap = this.minNodeGap;

      if (isSmallWorkflow) {
        // For small workflows, calculate optimal spacing to fit within max dimensions
        const availableWidth = this.graphWidth - this.padding * 2;
        const availableHeight = this.graphHeight - this.padding * 2;

        if (levels.length > 1) {
          levelWidth = Math.min(levelWidth, availableWidth / (levels.length - 1));
        }

        if (maxNodesInLevel > 1) {
          nodeGap = Math.min(nodeGap, availableHeight / (maxNodesInLevel - 1));
        }
      }

      // Center the entire graph vertically in the container
      const graphCenterY = this.graphHeight / 2;

      // Calculate horizontal centering
      const totalGraphWidth = (levels.length - 1) * levelWidth;
      const graphCenterX = this.graphWidth / 2;
      const graphStartX = graphCenterX - totalGraphWidth / 2;

      levels.forEach((levelNodes, levelIndex) => {
        const x = graphStartX + levelIndex * levelWidth;

        if (levelNodes.length === 1) {
          // Single node in level - center it in the graph
          positioned.push({
            ...levelNodes[0],
            x,
            y: graphCenterY,
          });
        } else {
          // Multiple nodes in level - distribute vertically centered around the graph center
          const levelHeight = (levelNodes.length - 1) * nodeGap;
          const levelStartY = graphCenterY - levelHeight / 2;

          levelNodes.forEach((node, nodeIndex) => {
            const y = levelStartY + nodeIndex * nodeGap;
            positioned.push({
              ...node,
              x,
              y,
            });
          });
        }
      });

      return positioned;
    },
    processedEdges() {
      if (!this.edges.length || !this.processedNodes.length) return [];

      // Group edges by their target node to handle multiple incoming edges
      const edgesByTarget = new Map();
      this.edges.forEach((edge, index) => {
        if (edge.end?.id) {
          if (!edgesByTarget.has(edge.end.id)) {
            edgesByTarget.set(edge.end.id, []);
          }
          edgesByTarget.get(edge.end.id).push({ ...edge, originalIndex: index });
        }
      });

      return this.edges
        .map((edge, originalIndex) => {
          const startNode = this.processedNodes.find((n) => n.id === edge.start?.id);
          const endNode = this.processedNodes.find((n) => n.id === edge.end?.id);

          if (!startNode || !endNode) return null;

          // Create a simple straight line between nodes
          // Only add gap for edges coming from trigger nodes (initial trigger)
          const isTriggerStart = startNode.category === 'trigger' || startNode.type === 'trigger' || startNode.isTrigger;
          const gap = isTriggerStart ? 4 : 0; // Gap only for trigger nodes
          let startX = startNode.x + this.nodeRadius + gap;
          let startY = startNode.y;
          let endX = endNode.x - this.nodeRadius;
          let endY = endNode.y;

          // Handle multiple edges to the same target node
          const targetEdges = edgesByTarget.get(edge.end.id) || [];
          if (targetEdges.length > 1) {
            // Find this edge's position among edges to the same target
            const edgeIndex = targetEdges.findIndex((e) => e.originalIndex === originalIndex);
            const totalEdges = targetEdges.length;

            // Spread edges vertically around the target node
            const spreadRange = Math.min(20, totalEdges * 6); // Max spread of 20px
            const offsetPerEdge = spreadRange / Math.max(1, totalEdges - 1);
            const baseOffset = -spreadRange / 2;
            const yOffset = baseOffset + edgeIndex * offsetPerEdge;

            // Apply offset to both start and end points for visual consistency
            startY += yOffset;
            endY += yOffset;
          }

          const path = `M ${startX} ${startY} L ${endX} ${endY}`;

          return {
            ...edge,
            path,
          };
        })
        .filter(Boolean);
    },
  },
  methods: {
    getLevels() {
      if (!this.nodes.length) return [];

      const outgoing = new Map();
      const incoming = new Map();

      this.nodes.forEach((node) => {
        outgoing.set(node.id, []);
        incoming.set(node.id, []);
      });

      this.edges.forEach((edge) => {
        if (edge.start?.id && edge.end?.id) {
          outgoing.get(edge.start.id)?.push(edge.end.id);
          incoming.get(edge.end.id)?.push(edge.start.id);
        }
      });

      return this.createLevels(outgoing, incoming);
    },

    calculateNodePositions(nodes) {
      // If we have edges, try to create a flow-based layout
      if (this.edges.length > 0) {
        return this.createFlowLayout(nodes);
      }

      // Otherwise, just use the sorted nodes
      return nodes;
    },

    createFlowLayout(nodes) {
      // Create a simple topological sort based on edges
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const inDegree = new Map(nodes.map((node) => [node.id, 0]));
      const outEdges = new Map(nodes.map((node) => [node.id, []]));

      // Build the graph
      this.edges.forEach((edge) => {
        if (edge.start?.id && edge.end?.id) {
          const startId = edge.start.id;
          const endId = edge.end.id;

          if (nodeMap.has(startId) && nodeMap.has(endId)) {
            outEdges.get(startId).push(endId);
            inDegree.set(endId, inDegree.get(endId) + 1);
          }
        }
      });

      // Find starting nodes (no incoming edges)
      const startNodes = nodes.filter((node) => inDegree.get(node.id) === 0);

      if (startNodes.length === 0) {
        // No clear start, just return sorted by x position
        return nodes;
      }

      // Simple BFS to create layers
      const result = [];
      const visited = new Set();
      const queue = [...startNodes];

      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current.id)) continue;

        visited.add(current.id);
        result.push(current);

        // Add connected nodes
        const connections = outEdges.get(current.id) || [];
        connections.forEach((connectedId) => {
          const connectedNode = nodeMap.get(connectedId);
          if (connectedNode && !visited.has(connectedId)) {
            queue.push(connectedNode);
          }
        });
      }

      // Add any remaining nodes
      nodes.forEach((node) => {
        if (!visited.has(node.id)) {
          result.push(node);
        }
      });

      return result;
    },

    getNodeColor(node) {
      // Color nodes based on their category or type
      const colorMap = {
        trigger: 'var(--color-green)',
        action: 'var(--color-blue)',
        condition: 'var(--color-yellow)',
        output: 'var(--color-green)',
        custom: 'var(--color-pink)',
      };

      return colorMap[node.category] || colorMap[node.type] || 'var(--color-lighter-2)';
    },

    createLevels(outgoing, incoming) {
      if (!this.edges.length) {
        // No edges, single level with all nodes
        return [this.nodes];
      }

      const nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
      const levels = [];
      const visited = new Set();
      const nodeToLevel = new Map();

      // Find start nodes (no incoming edges)
      let currentLevel = this.nodes.filter((node) => incoming.get(node.id).length === 0);
      if (currentLevel.length === 0) {
        currentLevel = [this.nodes[0]]; // fallback
      }

      let levelIndex = 0;

      // First pass: assign basic levels
      while (currentLevel.length > 0) {
        const levelNodes = [];
        const nextLevel = [];

        currentLevel.forEach((node) => {
          if (!visited.has(node.id)) {
            visited.add(node.id);
            nodeToLevel.set(node.id, levelIndex);
            levelNodes.push(node);

            // Add all children to next level
            const children = outgoing.get(node.id) || [];
            children.forEach((childId) => {
              const childNode = nodeMap.get(childId);
              if (childNode && !visited.has(childId)) {
                nextLevel.push(childNode);
              }
            });
          }
        });

        if (levelNodes.length > 0) {
          levels.push(levelNodes);
        }

        currentLevel = nextLevel;
        levelIndex++;
      }

      // Add any remaining unvisited nodes to final level
      const remaining = this.nodes.filter((node) => !visited.has(node.id));
      if (remaining.length > 0) {
        levels.push(remaining);
      }

      // Second pass: detect backward edges and separate nodes that are loop targets
      const backwardTargets = new Set();
      this.edges.forEach((edge) => {
        if (edge.start?.id && edge.end?.id) {
          const startLevel = nodeToLevel.get(edge.start.id);
          const endLevel = nodeToLevel.get(edge.end.id);

          // If edge goes backward (to same or earlier level), mark the target as needing separation
          if (startLevel !== undefined && endLevel !== undefined && startLevel >= endLevel) {
            backwardTargets.add(edge.end.id);
          }
        }
      });

      // Third pass: separate backward target nodes onto their own rows
      if (backwardTargets.size > 0) {
        const newLevels = [];
        levels.forEach((levelNodes) => {
          const regularNodes = levelNodes.filter((node) => !backwardTargets.has(node.id));
          const targetNodes = levelNodes.filter((node) => backwardTargets.has(node.id));

          if (regularNodes.length > 0) {
            newLevels.push(regularNodes);
          }
          if (targetNodes.length > 0) {
            newLevels.push(targetNodes);
          }
        });
        return newLevels;
      }

      return levels;
    },

    getActualNodeIcon(node) {
      // Use the actual icon from the node data if available
      if (node.icon) {
        return node.icon;
      }

      // Fallback to data.icon if available
      if (node.data && node.data.icon) {
        return node.data.icon;
      }

      // Final fallback to type-based icons
      return this.getNodeIconByType(node);
    },

    getNodeIconByType(node) {
      // Icon mapping for different node types (fallback)
      const iconMap = {
        trigger: 'play',
        action: 'bolt',
        condition: 'question',
        output: 'share',
        input: 'download',
        custom: 'cog',
        label: 'text',
      };

      // Check if it's a trigger node (could be marked as isTrigger or category/type)
      if (node.isTrigger || node.category === 'trigger' || node.type === 'trigger') {
        return 'play';
      }

      // Try category first, then type, then default
      return iconMap[node.category] || iconMap[node.type] || 'cog';
    },

    getNodeDisplayName(node) {
      // Get the best available name for the node to display in tooltip
      if (node.data && node.data.label) {
        return node.data.label;
      }

      if (node.label) {
        return node.label;
      }

      if (node.name) {
        return node.name;
      }

      if (node.title) {
        return node.title;
      }

      // Fallback to type or category with proper formatting
      if (node.type) {
        return node.type.charAt(0).toUpperCase() + node.type.slice(1);
      }

      if (node.category) {
        return node.category.charAt(0).toUpperCase() + node.category.slice(1);
      }

      // Final fallback
      return 'Node';
    },
  },
};
</script>

<style scoped>
.workflow-mini-graph-container {
  width: 100% !important;
  height: 100%;
  min-width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 8px 0 0;
  box-sizing: border-box;
}

.workflow-mini-graph {
  width: 100%;
  height: 100%;
  min-height: 60px;
  border-radius: 4px;
  background: var(--color-darker-0) !important;
  border: 1px solid var(--terminal-border-color);
  overflow: visible;
  display: flex;
  justify-content: center;
  align-items: center;
}

.mini-graph-svg {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
}

.mini-edge {
  opacity: 0.4 !important;
  stroke: #9ca3af !important;
  stroke-width: 1 !important;
  stroke-dasharray: 8, 8 !important;
  pointer-events: none !important;
  cursor: default !important;
}

.mini-node {
  cursor: pointer;
}

.node-circle {
  transition: all 0.2s ease;
  opacity: 0.25;
}

.mini-node:hover .node-circle {
  stroke-width: 2;
  stroke: var(--color-green);
}

.node-icon-text {
  fill: var(--color-dull-navy);
  font-family: monospace;
  font-weight: bold;
  pointer-events: none;
}

/* Category-specific colors */
.node-circle.trigger {
  fill: var(--color-green);
}

.node-circle.action {
  fill: var(--color-blue);
}

.node-circle.condition {
  fill: var(--color-yellow);
}

.node-circle.output {
  fill: var(--color-green);
}

.node-circle.custom {
  fill: var(--color-pink);
}

/* Node icon styling for SvgIcon within foreignObject */
.node-icon-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.mini-node-icon {
  width: 14px !important;
  height: 14px !important;
  color: var(--color-dull-navy) !important;
  fill: var(--color-dull-navy) !important;
  pointer-events: none;
}

/* Ensure SVG icons scale properly */
.mini-node-icon svg {
  width: 100% !important;
  height: 100% !important;
  fill: currentColor !important;
}
</style>
