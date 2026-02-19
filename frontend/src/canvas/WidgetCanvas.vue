<template>
  <div class="widget-canvas" ref="canvasRef" @dblclick="onDoubleClick">
    <!-- Grid overlay shown during drag/resize -->
    <div class="grid-overlay" :class="{ visible: showGrid }">
      <div
        v-for="c in gridCols - 1"
        :key="'col-' + c"
        class="grid-line-v"
        :style="{ left: c * cellWidth + GRID_GAP + 'px' }"
      ></div>
      <div
        v-for="r in gridRows - 1"
        :key="'row-' + r"
        class="grid-line-h"
        :style="{ top: r * cellHeight + GRID_GAP + 'px' }"
      ></div>
    </div>

    <!-- Widget frames -->
    <WidgetFrame
      v-for="instance in visibleWidgets"
      :key="instance.instanceId"
      :widget="instance"
      :cellWidth="cellWidth"
      :cellHeight="cellHeight"
      @drag-start="onDragStart"
      @drag-end="onDragEnd"
      @resize-start="onResizeStart"
      @resize-end="onResizeEnd"
      @close="onWidgetClose"
      @bring-to-front="onBringToFront"
    >
      <component
        :is="getWidgetComponent(instance.widgetId)"
        v-if="getWidgetComponent(instance.widgetId)"
        :widgetInstanceId="instance.instanceId"
        @screen-change="(screen, opts) => widgetBus.navigate(screen, opts)"
        @navigate="(screen, opts) => widgetBus.navigate(screen, opts)"
      />
    </WidgetFrame>

    <!-- Empty state -->
    <div v-if="visibleWidgets.length === 0" class="canvas-empty">
      <div class="empty-icon"><i class="fas fa-th-large"></i></div>
      <div class="empty-text">Empty canvas</div>
      <div class="empty-hint">Double-click or press the <strong>+</strong> button to add widgets</div>
    </div>

  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, provide, watch } from 'vue';
import { useStore } from 'vuex';
import { calculateCellDimensions, GRID_COLS, GRID_ROWS, GRID_GAP } from './gridUtils.js';
import { getWidget } from './widgetRegistry.js';
import WidgetFrame from './WidgetFrame.vue';

export default {
  name: 'WidgetCanvas',
  components: { WidgetFrame },
  props: {
    pageId: { type: String, required: true },
  },
  emits: ['open-catalog', 'screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const canvasRef = ref(null);
    const cellWidth = ref(100);
    const cellHeight = ref(80);
    const showGrid = ref(false);
    const gridCols = GRID_COLS;
    const gridRows = GRID_ROWS;
    let topZ = 10;
    let resizeObserver = null;

    // Get widgets for active page from store
    const visibleWidgets = computed(() => {
      const layout = store.getters['widgetLayout/pageLayout'](props.pageId);
      if (!layout) return [];
      return layout.filter((w) => w.visible !== false);
    });

    function getWidgetComponent(widgetId) {
      const def = getWidget(widgetId);
      return def?.component || null;
    }

    // Recalculate cell dimensions on container resize
    function updateCellDimensions() {
      const el = canvasRef.value;
      if (!el) return;
      const { cellWidth: cw, cellHeight: ch } = calculateCellDimensions(el.offsetWidth, el.offsetHeight);
      cellWidth.value = cw;
      cellHeight.value = ch;
    }

    onMounted(() => {
      updateCellDimensions();
      resizeObserver = new ResizeObserver(updateCellDimensions);
      if (canvasRef.value) {
        resizeObserver.observe(canvasRef.value);
      }
    });

    onBeforeUnmount(() => {
      if (resizeObserver) resizeObserver.disconnect();
    });

    // ── Event handlers ──
    function onDragStart(instanceId) {
      showGrid.value = !!instanceId;
    }

    function onDragEnd({ instanceId, col, row }) {
      showGrid.value = false;
      store.dispatch('widgetLayout/updateWidgetPosition', {
        pageId: props.pageId,
        instanceId,
        col,
        row,
      });
    }

    function onResizeStart(instanceId) {
      showGrid.value = !!instanceId;
    }

    function onResizeEnd({ instanceId, cols, rows, col, row }) {
      showGrid.value = false;
      if (col !== undefined && row !== undefined) {
        // Restore from maximize
        store.dispatch('widgetLayout/updateWidgetPosition', {
          pageId: props.pageId,
          instanceId,
          col,
          row,
        });
        store.dispatch('widgetLayout/updateWidgetSize', {
          pageId: props.pageId,
          instanceId,
          cols,
          rows,
        });
      } else {
        store.dispatch('widgetLayout/updateWidgetSize', {
          pageId: props.pageId,
          instanceId,
          cols,
          rows,
        });
      }
    }

    function onWidgetClose(instanceId) {
      store.dispatch('widgetLayout/removeWidget', {
        pageId: props.pageId,
        instanceId,
      });
    }

    function onBringToFront(instanceId) {
      topZ++;
      store.dispatch('widgetLayout/updateWidgetZIndex', {
        pageId: props.pageId,
        instanceId,
        zIndex: topZ,
      });
    }

    function onDoubleClick(e) {
      // Only open catalog when clicking empty canvas area
      if (e.target === canvasRef.value || e.target.classList.contains('grid-overlay')) {
        emit('open-catalog');
      }
    }

    // ── Widget bus for inter-widget communication ──
    const widgetBus = {
      navigate(screenName, options) {
        // Bubble up to CanvasScreen → Terminal.vue which handles routing + options
        emit('screen-change', screenName, options);
      },
      openCatalog() {
        emit('open-catalog');
      },
    };

    provide('widgetBus', widgetBus);
    provide('isInsideWidgetCanvas', true);

    return {
      canvasRef,
      cellWidth,
      cellHeight,
      showGrid,
      gridCols,
      gridRows,
      GRID_GAP,
      visibleWidgets,
      getWidgetComponent,
      widgetBus,
      onDragStart,
      onDragEnd,
      onResizeStart,
      onResizeEnd,
      onWidgetClose,
      onBringToFront,
      onDoubleClick,
    };
  },
};
</script>

<style scoped>
.widget-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

/* ── Grid overlay ── */
.grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.grid-overlay.visible {
  opacity: 1;
}

.grid-line-v {
  position: absolute;
  top: 0;
  bottom: 0;
  border-right: 1px solid rgba(25, 239, 131, 0.06);
}

.grid-line-h {
  position: absolute;
  left: 0;
  right: 0;
  border-bottom: 1px solid rgba(25, 239, 131, 0.06);
}

/* ── Empty state ── */
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}

.empty-icon {
  font-size: 36px;
  color: var(--color-text-muted, #334);
  opacity: 0.3;
}

.empty-text {
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-muted, #445);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.empty-hint {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted, #334);
}

</style>
