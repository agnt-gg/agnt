<template>
  <div
    class="widget-frame"
    :class="{
      'is-dragging': isDragging,
      'is-collapsed': widget.collapsed,
      'is-maximized': isMaximized,
      'is-hidden': !widget.visible,
      'is-screen-widget': isScreenWidget && !isCustomPage,
    }"
    :style="frameStyle"
    @mousedown="bringToFront"
    ref="frameRef"
  >
    <!-- Drag header: always on custom pages, hidden for screen widgets on default pages -->
    <div v-if="showControls" class="wf-hdr" @mousedown="onDragStart">
      <span class="wf-icon"><i :class="widgetDef?.icon"></i></span>
      <span class="wf-title">{{ widgetDef?.name }}</span>
      <div class="wf-ctrl">
        <button @mousedown.stop @click="$emit('collapse', widget.instanceId)">&#9472;</button>
        <button @mousedown.stop @click="$emit('close', widget.instanceId)">&#10005;</button>
      </div>
    </div>

    <!-- Body / content -->
    <div class="wf-body">
      <slot></slot>
    </div>

    <!-- Resize handle (hidden for full-screen widgets) -->
    <div
      v-if="!widget.collapsed && !isMaximized && showControls"
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
    isCustomPage: { type: Boolean, default: false },
  },
  emits: ['drag-start', 'drag-end', 'resize-start', 'resize-end', 'close', 'collapse', 'bring-to-front'],
  setup(props, { emit }) {
    const frameRef = ref(null);
    const isDragging = ref(false);
    const isMaximized = ref(false);
    let dragState = null;
    let resizeState = null;

    const widgetDef = computed(() => getWidget(props.widget.widgetId));
    const isScreenWidget = computed(() => widgetDef.value?.isScreenWidget === true);
    // On custom pages, all widgets get header + resize. On default pages, screen widgets are fixed.
    const showControls = computed(() => props.isCustomPage || !isScreenWidget.value);

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
      showControls,
      widgetDef,
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
  background: var(--color-ultra-dark-navy);
  border: 1px solid var(--terminal-border-color, var(--color-dull-navy));
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.15s;
}

.widget-frame:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
}

.widget-frame.is-dragging {
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.2);
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
  background: transparent;
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

/* ── Resize handle (diagonal grip lines) ── */
.wf-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  z-index: 2;
  background: linear-gradient(
    135deg,
    transparent 50%,
    var(--color-text-muted, #556) 50%,
    transparent 52%,
    transparent 60%,
    var(--color-text-muted, #556) 60%,
    transparent 62%,
    transparent 70%,
    var(--color-text-muted, #556) 70%,
    transparent 72%
  );
  opacity: 0.4;
}

.wf-resize:hover {
  opacity: 0.7;
}

/* ── Header / drag handle ── */
.wf-hdr {
  height: 24px;
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid var(--color-text-muted, #556);
}

.wf-hdr:active {
  cursor: grabbing;
}

.wf-icon {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted, #556);
}

.wf-title {
  flex: 1;
  font-size: var(--font-size-xs, 11px);
  letter-spacing: 2px;
  color: var(--color-text-muted, #667);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-ctrl {
  display: flex;
  gap: 2px;
}

.wf-ctrl button {
  background: none;
  border: none;
  color: var(--color-text-muted, #556);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}

.wf-ctrl button:hover {
  color: var(--color-text-primary, #eee);
}

/* ── Collapsed state ── */
.widget-frame.is-collapsed .wf-body,
.widget-frame.is-collapsed .wf-resize {
  display: none;
}
</style>

<style>
/* Custom background mode - dark translucent glass for widget frames */
body.custom-bg .widget-frame:not(.is-screen-widget) {
  background: rgba(0, 0, 0, var(--bg-opacity, 0.9)) !important;
  backdrop-filter: blur(var(--bg-blur, 0px));
  -webkit-backdrop-filter: blur(var(--bg-blur, 0px));
  border-color: rgba(255, 255, 255, 0.06);
}
</style>
