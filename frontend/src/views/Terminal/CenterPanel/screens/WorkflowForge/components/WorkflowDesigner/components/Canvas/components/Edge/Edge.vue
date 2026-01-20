<template>
  <g>
    <!-- Invisible, wider path for easier clicking -->
    <path
      class="invisible-hitarea"
      :d="pathData"
      fill="none"
      stroke="transparent"
      stroke-width="24"
      stroke-linecap="round"
      stroke-linejoin="round"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
      @click.stop="selectEdge"
    />
    <!-- Visible edge path -->
    <path
      :id="edge.id"
      :d="pathData"
      :class="{
        active: edge.isActive,
        animated: isAnimating,
        selected: isSelected,
        hovered: isHovered,
      }"
      :data-start="dataStart"
      :data-end="dataEnd"
      fill="none"
      :stroke="getStrokeColor()"
      stroke-width="3"
      stroke-linecap="butt"
      stroke-linejoin="butt"
      style="pointer-events: none"
    />
  </g>
</template>

<script>
import { inject } from 'vue';

export default {
  name: 'Edge',
  setup() {
    const playSound = inject('playSound', () => {});
    return { playSound };
  },
  props: {
    edge: {
      type: Object,
      required: true,
    },
    isAnimating: {
      type: Boolean,
      default: false,
    },
    // nodeWidth: {
    //   type: Number,
    //   default: 288, // CHANGE THIS TO 48 IF TINY NODE ENABLED, 288 IF REGULAR
    // },
    nodeWidth: {
      type: Number,
      required: true,
    },
    nodeHeight: {
      type: Number,
      default: 48,
    },
    isTemp: {
      type: Boolean,
      default: false,
    },
    isSelected: {
      type: Boolean,
      default: false,
    },
    isStartTrigger: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      isHovered: false,
    };
  },
  computed: {
    pathData() {
      return this.isTemp ? this.getTempEdgePath() : this.getEdgePath(this.edge);
    },
    dataStart() {
      return this.edge.start ? `${this.edge.start.index}-${this.edge.start.type}` : '';
    },
    dataEnd() {
      return this.edge.end ? `${this.edge.end.index}-${this.edge.end.type}` : '';
    },
  },
  methods: {
    getEdgePath(edge) {
      return this.createOrthogonalPath(edge.startX, edge.startY, edge.endX, edge.endY);
    },
    getTempEdgePath() {
      if (!this.edge) return '';
      const startX = this.edge.startX;
      const startY = this.edge.startY;
      const endX = this.edge.endX;
      const endY = this.edge.endY;
      return this.createOrthogonalPath(startX, startY, endX, endY);
    },
    createOrthogonalPath(x1, y1, x2, y2) {
      const padding = 8;
      const maxRadius = 14;
      const triggerRadius = 30; // Radius for trigger node output
      const minLeftDistance = 16;
      const nodePadding = 8;
      const goingRight = x1 < x2;
      const goingDown = y1 < y2;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const verticalDistance = Math.abs(y2 - y1);
      const horizontalDistance = Math.abs(x2 - x1);

      if (!goingRight && horizontalDistance >= minLeftDistance) {
        x1 = x1 + nodePadding;
        x2 = x2 - nodePadding;
      }

      // Use triggerRadius for start (output), maxRadius for end (input)
      const startRadius = this.isStartTrigger ? triggerRadius : Math.min(maxRadius, verticalDistance / 2);
      const endRadius = Math.min(maxRadius, verticalDistance / 2);

      let path = `M${x1},${y1} `;

      if (verticalDistance === 0) {
        path += `H${x2}`;
      } else if (verticalDistance <= padding * 2) {
        const controlX = goingRight ? Math.max(x1, x2) - verticalDistance : Math.min(x1, x2) + verticalDistance;
        path += `Q${controlX},${midY} ${x2},${y2}`;
      } else {
        if (goingRight) {
          path += `H${midX - startRadius} `;
          if (goingDown) {
            path += `A${startRadius},${startRadius} 0 0 1 ${midX},${y1 + startRadius} `;
            path += `V${y2 - endRadius} `;
            path += `A${endRadius},${endRadius} 0 0 0 ${midX + endRadius},${y2} `;
          } else {
            path += `A${startRadius},${startRadius} 0 0 0 ${midX},${y1 - startRadius} `;
            path += `V${y2 + endRadius} `;
            path += `A${endRadius},${endRadius} 0 0 1 ${midX + endRadius},${y2} `;
          }
          path += `H${x2}`;
        } else {
          if (horizontalDistance < minLeftDistance) {
            path += `V${midY} H${x2} V${y2}`;
          } else {
            if (goingDown) {
              path += `V${midY - startRadius} `;
              path += `A${startRadius},${startRadius} 0 0 1 ${x1 - startRadius},${midY} `;
              path += `H${x2 + endRadius} `;
              path += `A${endRadius},${endRadius} 0 0 0 ${x2},${midY + endRadius} `;
            } else {
              path += `V${midY + startRadius} `;
              path += `A${startRadius},${startRadius} 0 0 0 ${x1 - startRadius},${midY} `;
              path += `H${x2 + endRadius} `;
              path += `A${endRadius},${endRadius} 0 0 1 ${x2},${midY - endRadius} `;
            }
            path += `V${y2}`;
          }
        }
      }

      return path;
    },
    getStrokeColor() {
      if (this.isTemp) return '#e53d8f';
      if (this.isSelected) return '#e53d8f';
      if (this.isHovered) return '#3b406dcc';
      return '#3b406d50';
    },
    selectEdge() {
      this.playSound('buttonClick');
      this.$emit('select-edge', this.edge);
    },
  },
};
</script>

<style>
/* KEEP THIS UNSCOPED TO ENSURE EDGES AND ANIMATION WORKS ACROSS CANVAS */
.edges,
.temp-edge {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000%;
  height: 10000%;
  pointer-events: all;
  z-index: 1;
  overflow: visible;
  cursor: grab;
}

.animated {
  animation: dashOffset 25s linear infinite;
}

.edges path {
  stroke-dasharray: 16, 16;
  transition: stroke 0.2s ease;
  will-change: stroke, d;
  stroke-width: 2.25;
}

.edges path.selected {
  transition: none;
}

.temp-edge path {
  stroke-dasharray: 12, 10;
  transition: none;
}

.edges path.animated {
  animation: dashOffset 25s linear infinite;
  stroke-width: 2.25;
}

.edges .selected {
  stroke-width: 3;
}

.edges path.active {
  stroke: #19ef83 !important;
}

.edges path.active.selected {
  stroke: var(--color-pink) !important;
  stroke-width: 3;
}

.edges .hovered {
  stroke-width: 3.25;
}

.edges path:hover {
  cursor: pointer;
  stroke-width: 3.5 !important;
}

/* Ensure invisible hit area works properly */
.edges path.invisible-hitarea {
  cursor: pointer !important;
  pointer-events: all !important;
  fill: none !important;
  stroke: transparent !important;
  stroke-dasharray: none !important;
  stroke-dashoffset: 0 !important;
  stroke-width: 24px !important;
}

#canvas-container.grabbed .edges {
  cursor: grabbing;
}

#canvas-container.grabbed .edges path.invisible-hitarea {
  cursor: grabbing !important;
}

@keyframes dashOffset {
  0% {
    stroke-dashoffset: 1000;
  }

  100% {
    stroke-dashoffset: 0;
  }
}
</style>
