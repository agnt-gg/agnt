<template>
  <div
    class="widget-frame"
    :class="{
      'is-dragging': isDragging,
      'is-collapsed': widget.collapsed,
      'is-maximized': isMaximized,
      'is-hidden': !widget.visible,
      'is-screen-widget': isScreenWidget,
    }"
    :style="frameStyle"
    @mousedown="bringToFront"
    ref="frameRef"
  >
    <!-- Body / content -->
    <div class="wf-body">
      <slot></slot>
    </div>

    <!-- Resize handle (hidden for full-screen widgets) -->
    <div
      v-if="!widget.collapsed && !isMaximized && !isScreenWidget"
      class="wf-resize"
      @mousedown.prevent.stop="onResizeStart"
    ></div>
  </div>
</template>

<script>
import { ref, computed, onBeforeUnmount } from 'vue';
import { gridToPixel, snapToGrid, snapSizeToGrid, clampToGrid, GRID_COLS, GRID_ROWS, GRID_GAP } from './gridUtils.js';
import { getWidget } from './widgetRegistry.js';

export default {
  name: 'WidgetFrame',
  props: {
    widget: { type: Object, required: true },
    cellWidth: { type: Number, required: true },
    cellHeight: { type: Number, required: true },
  },
  emits: ['drag-start', 'drag-end', 'resize-start', 'resize-end', 'close', 'bring-to-front'],
  setup(props, { emit }) {
    const frameRef = ref(null);
    const isDragging = ref(false);
    const isMaximized = ref(false);
    let dragState = null;
    let resizeState = null;

    const widgetDef = computed(() => getWidget(props.widget.widgetId));
    const isScreenWidget = computed(() => widgetDef.value?.isScreenWidget === true);

    const frameStyle = computed(() => {
      if (isMaximized.value) {
        return {
          left: GRID_GAP + 'px',
          top: GRID_GAP + 'px',
          width: GRID_COLS * props.cellWidth - GRID_GAP + 'px',
          height: GRID_ROWS * props.cellHeight - GRID_GAP + 'px',
          zIndex: props.widget.zIndex || 1,
        };
      }
      const px = gridToPixel(
        props.widget.col,
        props.widget.row,
        props.widget.cols,
        props.widget.rows,
        props.cellWidth,
        props.cellHeight,
      );
      return {
        left: px.x + 'px',
        top: px.y + 'px',
        width: px.width + 'px',
        height: props.widget.collapsed ? '28px' : px.height + 'px',
        zIndex: props.widget.zIndex || 1,
      };
    });

    function bringToFront() {
      emit('bring-to-front', props.widget.instanceId);
    }

    // ── Drag ──
    function onDragStart(e) {
      if (isMaximized.value) return;

      isDragging.value = true;
      const el = frameRef.value;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origCol: props.widget.col,
        origRow: props.widget.row,
      };

      emit('drag-start', props.widget.instanceId);
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    }

    function onDragMove(e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      const newPixelX = dragState.origCol * props.cellWidth + GRID_GAP + dx;
      const newPixelY = dragState.origRow * props.cellHeight + GRID_GAP + dy;

      const snapped = snapToGrid(newPixelX, newPixelY, props.cellWidth, props.cellHeight);
      const clamped = clampToGrid(snapped.col, snapped.row, props.widget.cols, props.widget.rows);

      // Live preview: move the element directly
      const el = frameRef.value;
      if (el) {
        const px = gridToPixel(clamped.col, clamped.row, props.widget.cols, props.widget.rows, props.cellWidth, props.cellHeight);
        el.style.left = px.x + 'px';
        el.style.top = px.y + 'px';
      }

      dragState._lastCol = clamped.col;
      dragState._lastRow = clamped.row;
    }

    function onDragEnd() {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      isDragging.value = false;

      if (dragState && dragState._lastCol !== undefined) {
        emit('drag-end', {
          instanceId: props.widget.instanceId,
          col: dragState._lastCol,
          row: dragState._lastRow,
        });
      }

      emit('drag-start', null); // signal drag complete for grid overlay
      dragState = null;
    }

    // ── Resize ──
    function onResizeStart(e) {
      resizeState = {
        startX: e.clientX,
        startY: e.clientY,
        origCols: props.widget.cols,
        origRows: props.widget.rows,
      };

      emit('resize-start', props.widget.instanceId);
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
    }

    function onResizeMove(e) {
      if (!resizeState) return;
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;

      const newPixelW = resizeState.origCols * props.cellWidth + dx;
      const newPixelH = resizeState.origRows * props.cellHeight + dy;

      const snapped = snapSizeToGrid(newPixelW, newPixelH, props.cellWidth, props.cellHeight);

      // Enforce min size from widget definition
      const def = widgetDef.value;
      const minCols = def?.minSize?.cols || 1;
      const minRows = def?.minSize?.rows || 1;
      const cols = Math.max(minCols, Math.min(snapped.cols, GRID_COLS - props.widget.col));
      const rows = Math.max(minRows, Math.min(snapped.rows, GRID_ROWS - props.widget.row));

      // Live preview
      const el = frameRef.value;
      if (el) {
        const px = gridToPixel(props.widget.col, props.widget.row, cols, rows, props.cellWidth, props.cellHeight);
        el.style.width = px.width + 'px';
        el.style.height = px.height + 'px';
      }

      resizeState._lastCols = cols;
      resizeState._lastRows = rows;
    }

    function onResizeEnd() {
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);

      if (resizeState && resizeState._lastCols !== undefined) {
        emit('resize-end', {
          instanceId: props.widget.instanceId,
          cols: resizeState._lastCols,
          rows: resizeState._lastRows,
        });
      }

      emit('resize-start', null); // signal resize complete for grid overlay
      resizeState = null;
    }

    onBeforeUnmount(() => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
    });

    return {
      frameRef,
      isDragging,
      isMaximized,
      isScreenWidget,
      frameStyle,
      bringToFront,
      onDragStart,
      onResizeStart,
    };
  },
};
</script>

<style scoped>
.widget-frame {
  position: absolute;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.15s;
}

.widget-frame:hover {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.widget-frame.is-dragging {
  box-shadow: 0 8px 40px rgba(100, 80, 220, 0.12);
  z-index: 999 !important;
  opacity: 0.92;
  cursor: grabbing;
}

.widget-frame.is-hidden {
  display: none;
}

.widget-frame.is-maximized {
  z-index: 998 !important;
  border-radius: 6px;
}

.widget-frame.is-screen-widget {
  border: none;
  border-radius: 0;
  border-bottom-right-radius: var(--terminal-screen-border-radius, 0);
  box-shadow: none;
}

.widget-frame.is-screen-widget:hover {
  box-shadow: none;
}

/* ── Body ── */
.wf-body {
  flex: 1;
  overflow: auto;
  position: relative;
  min-height: 0;
}

/* ── Resize handle ── */
.wf-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  z-index: 2;
}

.wf-resize::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 6px;
  height: 6px;
  border-right: 2px solid rgba(255, 255, 255, 0.08);
  border-bottom: 2px solid rgba(255, 255, 255, 0.08);
}

.wf-resize:hover::after {
  border-color: rgba(25, 239, 131, 0.3);
}
</style>
