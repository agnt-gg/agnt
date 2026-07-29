<!-- Workspace.vue — the Workspaces page. v2.

     ONE page. ONE chat input. The system arranges itself around the work.

     v2 renders the canvas area with AGNT's EXISTING widget system — the same
     WidgetFrame windows, widgetRegistry components and CustomWidgetRenderer
     that power custom pages. Nothing about how a window looks, drags,
     resizes, closes or collapses is defined here; this file only decides
     WHICH widget instances exist per workspace and keeps the Annie chat rail
     beside them. (v1 shipped a bespoke pane component. That was a mistake:
     it duplicated a system that already existed one directory over.) -->
<template>
  <div class="ws-root">
    <!-- ══ workspace tabs ══ -->
    <div class="ws-tabbar">
      <div ref="tabStripRef" class="ws-tabs" :class="{ 'more-left': tabsMoreLeft, 'more-right': tabsMoreRight }" @scroll="updateTabOverflow">
        <div
          v-for="ws in workspaces"
          :ref="(el) => setTabRef(ws.id, el)"
          :key="ws.id"
          class="ws-tab"
          :class="{ on: ws.id === activeId }"
          @click="setActive(ws.id)"
          @dblclick="beginRename(ws)"
        >
          <span class="ws-dot"></span>
          <input
            v-if="renamingId === ws.id"
            ref="renameInput"
            v-model="renameDraft"
            class="ws-rename"
            @click.stop
            @keydown.enter="commitRename"
            @keydown.esc="renamingId = ''"
            @blur="commitRename"
          />
          <span v-else class="ws-tab-name">{{ ws.name }}</span>
          <span class="ws-count">{{ ws.widgets.length }}</span>
          <button v-if="workspaces.length > 1" class="ws-tab-x" v-tooltip="'Close workspace'" @click.stop="closeWorkspace(ws.id)">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Trailing the row, inside the strip: the button creates the NEXT
             tab, so it belongs where the next tab would appear. -->
        <button class="ws-tab-add" v-tooltip="'New workspace'" @click="createWorkspace()">
          <i class="fas fa-plus"></i>
        </button>
      </div>

      <div class="ws-tabbar-right">
        <button
          class="ws-pill"
          :class="{ on: autoOpen }"
          v-tooltip="
            autoOpen
              ? 'Annie places the matching widget when she touches a domain — click to disable'
              : 'Auto-open is off — widgets only appear when you add them'
          "
          @click="setAutoOpen(!autoOpen)"
        >
          <i class="fas fa-magic"></i>
          auto
        </button>

        <button class="ws-pill ws-pill-primary" v-tooltip="'Add a widget to this workspace'" @click="togglePalette">
          <i class="fas fa-plus"></i>
          widget
        </button>
      </div>
    </div>

    <!-- ══ canvas — a pure widget grid, chat included ══ -->
    <div class="ws-canvas">
      <div
        ref="gridRef"
        class="ws-surfaces"
        :class="{ 'is-drop-target': !!dropPreview }"
        @pointerdown.capture="onCanvasPointerDownCapture"
        @dblclick="onCanvasDblClick"
        @dragover="onCanvasDragOver"
        @dragleave="onCanvasDragLeave"
        @drop="onCanvasDrop"
      >
        <!-- Grid guides. Shown while dragging/resizing AND, more faintly,
             whenever the canvas still has room — so the grid persists until
             every space is filled. It needs no clipping to the empty areas:
             the overlay sits at z-index 0, behind every frame, so it can only
             ever be seen THROUGH the gaps. -->
        <div class="ws-grid-overlay" :class="{ visible: canvasBusy || !!emptyRegion, idle: !canvasBusy }">
          <div v-for="c in GRID_COLS - 1" :key="'c' + c" class="ws-grid-v" :style="{ left: c * cellWidth - GRID_GAP / 2 + 'px' }"></div>
          <div v-for="r in GRID_ROWS - 1" :key="'r' + r" class="ws-grid-h" :style="{ top: r * cellHeight - GRID_GAP / 2 + 'px' }"></div>
        </div>

        <WidgetFrame
          v-for="instance in activeWidgets"
          :key="instance.instanceId"
          :widget="instance"
          :cellWidth="cellWidth"
          :cellHeight="cellHeight"
          :isCustomPage="true"
          @drag-start="onFrameGestureStart"
          @drag-end="onFrameDragEnd"
          @resize-start="onFrameGestureStart"
          @resize-end="onFrameResizeEnd"
          @close="removeWidget"
          @collapse="toggleCollapse"
          @bring-to-front="bringToFront"
          @edit="onWidgetEdit"
        >
          <!-- Per-window back/forward. Only rendered once a window has
               actually navigated, so an untouched window's title bar is
               byte-identical to what shipped. -->
          <template v-if="hasHistory(instance)" #header-lead>
            <span class="ws-nav">
              <button
                class="ws-nav-btn"
                :disabled="!canBack(instance)"
                v-tooltip="'Back'"
                @mousedown.stop
                @click.stop="historyGo(instance.instanceId, -1)"
              >
                <i class="fas fa-chevron-left"></i>
              </button>
              <button
                class="ws-nav-btn"
                :disabled="!canForward(instance)"
                v-tooltip="'Forward'"
                @mousedown.stop
                @click.stop="historyGo(instance.instanceId, 1)"
              >
                <i class="fas fa-chevron-right"></i>
              </button>
            </span>
          </template>

          <EmbedScope :scope="panelScopeFor(instance.instanceId)">
            <div class="ws-embed">
              <component
                :is="componentFor(instance.widgetId)"
                v-if="componentFor(instance.widgetId)"
                :widgetInstanceId="instance.instanceId"
                v-bind="customDefFor(instance.widgetId) ? { definition: customDefFor(instance.widgetId) } : {}"
                @screen-change="(s, o) => onEmbedScreenChange(s, o, instance.instanceId)"
                @navigate="(s, o) => onEmbedScreenChange(s, o, instance.instanceId)"
              />
              <CustomWidgetRenderer
                v-else-if="storedDefFor(instance.widgetId)"
                :definition="storedDefFor(instance.widgetId)"
                :widgetInstanceId="instance.instanceId"
              />
              <div v-else class="ws-embed-empty">
                <i class="fas fa-shapes"></i>
                <p>
                  Unknown widget <code>{{ instance.widgetId }}</code>
                </p>
              </div>
            </div>
          </EmbedScope>
        </WidgetFrame>

        <!-- Live landing zone while dragging a widget in from the palette -->
        <div v-if="dropPreview" class="ws-drop-preview" :style="dropPreviewStyle">
          <i :class="dropPreview.icon"></i>
          <span>{{ dropPreview.name }}</span>
        </div>

        <!-- Empty-space prompt — occupies the largest GAP, not the whole
             canvas, so it stays centred in whatever room is actually left.
             Hidden mid-gesture: the drop preview and the bright grid are the
             feedback then, and the region under the dragged widget is stale
             until the move commits. -->
        <div v-if="emptyRegion && !canvasBusy" class="ws-empty" :class="'is-' + emptyRegion.tier" :style="emptyRegion.style">
          <div class="ws-empty-icon"><i class="fas fa-th-large"></i></div>
          <div v-if="emptyRegion.tier !== 'mark'" class="ws-empty-text">
            {{ emptyRegion.whole ? 'Empty canvas' : 'Empty space' }}
          </div>
          <div v-if="emptyRegion.tier === 'full'" class="ws-empty-hint">
            <template v-if="emptyRegion.whole">Double-click or press the <strong>+ widget</strong> button to add widgets</template>
            <template v-else>Double-click here to fill it</template>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ widget palette ══ -->
    <div v-if="paletteOpen" class="ws-palette-backdrop" @click="paletteOpen = false"></div>
    <div v-if="paletteOpen" class="ws-palette" @click.stop>
      <input ref="paletteInput" v-model="paletteQuery" class="ws-palette-search" placeholder="Search widgets, workflows…" spellcheck="false" />
      <div class="ws-palette-list">
        <template v-for="group in paletteGroups" :key="group.label">
          <div v-if="group.items.length" class="ws-palette-group">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.key"
            class="ws-palette-item"
            :class="{ open: isOpen(item.widgetId) }"
            draggable="true"
            @click="pick(item)"
            @dragstart="onPaletteDragStart(item, $event)"
            @dragend="onPaletteDragEnd"
          >
            <i class="ws-palette-grip fas fa-grip-vertical"></i>
            <i :class="item.icon"></i>
            <span class="ws-palette-name">{{ item.name }}</span>
            <span v-if="isOpen(item.widgetId)" class="ws-palette-tag">open</span>
          </button>
        </template>
        <div v-if="paletteGroups.every((g) => !g.items.length)" class="ws-palette-empty">No match for “{{ paletteQuery }}”</div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, provide, onMounted, onActivated, onBeforeUnmount, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import WidgetFrame from '@/canvas/WidgetFrame.vue';
import CustomWidgetRenderer from '@/canvas/CustomWidgetRenderer.vue';
import EmbedScope from './EmbedScope.vue';
import { getWidget, getAllWidgets } from '@/canvas/widgetRegistry.js';
import { calculateCellDimensions, gridToPixel, GRID_COLS, GRID_ROWS, GRID_GAP } from '@/canvas/gridUtils.js';
import { useWorkspaces, chatChannelFor, canGoBack, canGoForward, largestFreeRect, emptyTierFor } from './useWorkspaces.js';
import { widgetForToolCall, SCREEN_WIDGET_MAP } from './surfaceRegistry.js';

export default {
  name: 'WorkspaceScreen',
  components: { WidgetFrame, CustomWidgetRenderer, EmbedScope },
  setup() {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();

    const {
      workspaces,
      activeId,
      active,
      activeWidgets,
      autoOpen,
      chatChannelKey,
      setActive,
      createWorkspace,
      closeWorkspace,
      renameWorkspace,
      addWidget,
      removeWidget,
      navigateWidget,
      historyGo,
      panelScopeFor,
      updateWidgetGeometry,
      toggleCollapse,
      bringToFront,
      setAutoOpen,
      save,
    } = useWorkspaces();

    // Window navigation state, surfaced to the template.
    const hasHistory = (instance) => Array.isArray(instance?.history) && instance.history.length > 1;
    const canBack = (instance) => canGoBack(instance);
    const canForward = (instance) => canGoForward(instance);

    // ── widget resolution — identical logic to WidgetCanvas ─────────
    const componentFor = (widgetId) => getWidget(widgetId)?.component || null;
    const customDefFor = (widgetId) => getWidget(widgetId)?.customDefinition || null;
    // Fallback when the registry hasn't synced a custom widget yet: render it
    // straight from the store definition, which is what the registry entry
    // wraps anyway.
    const storedDefFor = (widgetId) => store.getters['widgetDefinitions/getDefinitionById']?.(widgetId) || null;

    const isOpen = (widgetId) => active.value.widgets.some((w) => w.widgetId === widgetId);

    // ── grid canvas cell sizing (same derivation as WidgetCanvas) ───
    const gridRef = ref(null);
    const cellWidth = ref(100);
    const cellHeight = ref(80);
    const showGrid = ref(false);
    let gridObserver = null;

    const updateCellDimensions = () => {
      const el = gridRef.value;
      if (!el) return;
      const { cellWidth: cw, cellHeight: ch } = calculateCellDimensions(el.offsetWidth, el.offsetHeight);
      cellWidth.value = cw;
      cellHeight.value = ch;
    };

    // ── WidgetFrame gesture contract (mirrors WidgetCanvas exactly) ──
    //
    // The frame previews a drag/resize by writing to its own element style,
    // then emits the resulting GRID geometry and expects its parent to apply
    // it. It never mutates the instance itself. `*-start` fires with the
    // instanceId when a gesture begins and with null when it completes —
    // hence `!!instanceId` rather than a plain `true`.
    // NOTE the `Frame` prefix. This file has TWO unrelated resize concepts —
    // the widget windows, and the chat rail's divider (startResize /
    // onResizeEnd, further down). They were briefly given the same names,
    // which is a compile error at best and silently wires the wrong handler at
    // worst. Prefix anything that belongs to a window.
    const onFrameGestureStart = (instanceId) => {
      showGrid.value = !!instanceId;
    };

    const onFrameDragEnd = ({ instanceId, col, row }) => {
      showGrid.value = false;
      updateWidgetGeometry(instanceId, { col, row });
    };

    const onFrameResizeEnd = ({ instanceId, cols, rows, col, row }) => {
      showGrid.value = false;
      // Restoring from maximised also returns a position; apply both so the
      // window lands where it was rather than at the maximised origin.
      const updates = { cols, rows };
      if (col !== undefined && row !== undefined) {
        updates.col = col;
        updates.row = row;
      }
      updateWidgetGeometry(instanceId, updates);
    };

    const onWidgetEdit = (widget) => {
      // The pencil on a custom widget opens the Forge — as a navigation, the
      // way custom pages do it, not as a pane.
      store.dispatch('widgetDefinitions/setActiveDefinition', widget.widgetId).catch(() => {});
      router.push('/widget-forge').catch(() => {});
    };

    // ── chat rail width ──────────────────────────────────────────────

    // ── opening widgets (user or Annie) ──────────────────────────────
    const open = (widgetId, { objectId = '', routeParam = '', custom = false, at = null } = {}) => {
      if (custom) {
        // Make sure the definition is loadable before the renderer asks for it.
        store.dispatch('widgetDefinitions/ensureDefinitionLoaded', widgetId).catch(() => {});
        if (!getWidget(widgetId) && !storedDefFor(widgetId)) {
          store.dispatch('widgetDefinitions/fetchDefinitions').catch(() => {});
        }
      } else if (!getWidget(widgetId)) {
        return; // unknown registry widget — nothing sane to place
      }
      // Point the target screen at the object the same way it is pointed
      // today: Workflow/Tool Forge read a route query param.
      applyRouteParam(routeParam, objectId);
      addWidget(widgetId, at);
    };

    // ── embedded screen-change → canvas action ──────────────────────
    //
    // Screens inside widget windows emit screen-change exactly as they do
    // standalone (Workflows panel row → 'WorkflowForgeScreen' + {workflowId}).
    // Standalone, Terminal.changeScreen navigates the whole app; here that
    // would blow away the canvas — and the previous binding, `() => {}`,
    // swallowed the event entirely, so panel clicks LOOKED dead. The right
    // move is translation: open/focus the mapped widget and bind the object
    // through the same route query param the target screen already reads.
    // Screens emit screen-change with no DOM event attached, so a ctrl/middle
    // click is not observable at the point the event arrives. It IS
    // observable on the canvas, in the capture phase, immediately before the
    // screen's own handler runs — and the emission is synchronous within that
    // same click, so a short validity window is sufficient. Far less invasive
    // than threading a modifier through every screen's panel-action chain.
    const NEW_WINDOW_INTENT_MS = 1000;
    let newWindowIntentAt = 0;
    const onCanvasPointerDownCapture = (e) => {
      if (e.ctrlKey || e.metaKey || e.button === 1) newWindowIntentAt = Date.now();
    };
    const consumeNewWindowIntent = () => {
      const wanted = newWindowIntentAt > 0 && Date.now() - newWindowIntentAt < NEW_WINDOW_INTENT_MS;
      newWindowIntentAt = 0;
      return wanted;
    };

    /** Bind the object the way the target screen already reads it: route query. */
    const applyRouteParam = (param, objectId) => {
      if (!param || !objectId || route.query[param] === objectId) return;
      router.replace({ path: route.path, query: { ...route.query, [param]: objectId } }).catch(() => {});
    };

    const onEmbedScreenChange = (screenName, options = {}, sourceInstanceId = '') => {
      const entry = SCREEN_WIDGET_MAP[screenName];
      if (!entry) {
        console.warn(`[Workspace] No canvas widget maps to "${screenName}" — staying on the canvas.`);
        return;
      }
      const objectId = (entry.optionKey ? options?.[entry.optionKey] : '') || '';
      // Bind first: the target screen reads the object from the route query
      // whether it is being navigated to, focused, or freshly opened.
      applyRouteParam(entry.param, objectId);

      // 1. Already on the canvas? Focus it. Two windows showing the same
      //    screen would also fight over that single route query param, so
      //    this is a correctness rule, not just a courtesy.
      const existing = active.value.widgets.find((w) => w.widgetId === entry.widgetId && w.visible !== false);
      if (existing) {
        bringToFront(existing.instanceId);
        return;
      }

      // 2. Chat is a conversation, not a view. Never navigate a window away
      //    from one — open a chat window instead.
      if (entry.focusOnly) {
        open(entry.widgetId, { objectId, routeParam: entry.param || '' });
        return;
      }

      // 3. Default: navigate the window the click came from, in place. This
      //    is the whole point — a window is a tab. Clicking five workflows
      //    used to leave five windows behind.
      if (!consumeNewWindowIntent() && sourceInstanceId && navigateWidget(sourceInstanceId, entry.widgetId)) return;

      // 4. No source (the widget bus, auto-open) or an explicit ctrl/middle
      //    click: a new window.
      open(entry.widgetId, { objectId, routeParam: entry.param || '' });
    };

    // Screens and custom widgets that inject the widget bus (the mechanism
    // WidgetCanvas provides on custom pages) get the same translation — and
    // openCatalog maps to this page's palette.
    provide('widgetBus', {
      navigate: (screen, opts) => onEmbedScreenChange(screen, opts),
      openCatalog: () => {
        paletteOpen.value = true;
        paletteQuery.value = '';
        nextTick(() => paletteInput.value?.focus());
      },
    });
    provide('isInsideWidgetCanvas', true);

    // ── auto-open: frontend stand-in for a `surface_open` SSE event ──
    const seenToolCalls = new Set();
    const runningMap = computed(() => store.state.chatUnified.runningToolCalls[chatChannelKey.value] || {});
    const isStreaming = computed(() => store.getters['chatUnified/isStreaming'](chatChannelKey.value));

    const scanForWidgets = () => {
      if (!autoOpen.value) return;
      const messages = store.getters['chatUnified/getMessages'](chatChannelKey.value) || [];
      for (const m of messages.slice(-6)) {
        if (!Array.isArray(m.toolCalls)) continue;
        for (const tc of m.toolCalls) {
          if (tc.result === undefined && tc.error === undefined) continue;
          const uid = `${m.id}:${tc.id || tc.name}`;
          if (seenToolCalls.has(uid)) continue;
          seenToolCalls.add(uid);
          if (tc.error) continue;
          const hit = widgetForToolCall(tc);
          if (hit) open(hit.widgetId, hit);
        }
      }
    };

    watch(runningMap, scanForWidgets, { deep: true });
    watch(isStreaming, (now, before) => {
      if (before && !now) scanForWidgets();
    });
    watch(chatChannelKey, () => seenToolCalls.clear());

    const handleFrontendEvent = (eventType, eventData) => {
      if (!autoOpen.value || !eventType) return;
      if (eventType.startsWith('widget-') && eventData?.id) {
        open(eventData.id, { objectId: eventData.id, custom: true });
      } else if (eventType === 'file_written') {
        open('artifacts');
      }
    };

    const workspacePageState = computed(() => ({
      workspaceState: {
        id: active.value.id,
        name: active.value.name,
        openWidgets: active.value.widgets.map((w) => w.widgetId),
        layout: 'grid',
      },
    }));

    // ── tab rename ───────────────────────────────────────────────────
    /* ── tab strip overflow ──
     * The strip has always scrolled, but with scrollbar-width:none there was
     * nothing to say so: past ~7 workspaces the rest were present, reachable
     * by wheel, and completely invisible. Measured at 1664px: scrollWidth 2377
     * vs clientWidth 1361, five tabs past the right edge. Edge fades make the
     * overflow legible; following the active tab means selecting a workspace
     * (or restoring one) never leaves you staring at a strip that does not
     * contain it.
     */
    const tabStripRef = ref(null);
    const tabEls = new Map();
    const tabsMoreLeft = ref(false);
    const tabsMoreRight = ref(false);
    let tabObserver = null;

    const setTabRef = (id, el) => {
      if (el) tabEls.set(id, el);
      else tabEls.delete(id);
    };

    const updateTabOverflow = () => {
      const el = tabStripRef.value;
      if (!el) return;
      tabsMoreLeft.value = el.scrollLeft > 1;
      tabsMoreRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    };

    const scrollActiveTabIntoView = () => {
      const el = tabEls.get(activeId.value);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      updateTabOverflow();
    };

    watch(activeId, () => nextTick(scrollActiveTabIntoView));

    const renamingId = ref('');
    const renameDraft = ref('');
    const renameInput = ref(null);
    const beginRename = (ws) => {
      renamingId.value = ws.id;
      renameDraft.value = ws.name;
      nextTick(() => {
        const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
        el?.focus();
        el?.select();
      });
    };
    const commitRename = () => {
      if (!renamingId.value) return;
      const name = renameDraft.value.trim();
      if (name) renameWorkspace(renamingId.value, name);
      renamingId.value = '';
    };

    // ── drag a widget from the palette onto the canvas ──────────────────
    //
    // Uses native HTML5 drag-and-drop rather than a pointer-event
    // reimplementation: the drag survives the palette closing underneath it,
    // the OS supplies the drag image, and Escape cancels for free.
    const dragItem = ref(null);      // the palette entry being dragged
    const dropPreview = ref(null);   // { col, row, cols, rows, name, icon }

    const dropPreviewStyle = computed(() => {
      if (!dropPreview.value) return null;
      const p = gridToPixel(
        dropPreview.value.col, dropPreview.value.row,
        dropPreview.value.cols, dropPreview.value.rows,
        cellWidth.value, cellHeight.value,
      );
      return { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` };
    });

    /* ═══════════ empty space ═══════════ */

    /** Any gesture that makes the canvas its own feedback surface. */
    const canvasBusy = computed(() => showGrid.value || !!dropPreview.value);

    /**
     * The largest gap on the canvas, in pixels, plus how much prompt it can
     * carry. Deliberately the SAME largestFreeRect that placement uses — one
     * definition of "where is the empty space", so the prompt can never point
     * at a gap a new widget wouldn't land in.
     */
    const emptyRegion = computed(() => {
      const free = largestFreeRect(activeWidgets.value);
      if (!free.area) return null;
      const p = gridToPixel(free.col, free.row, free.cols, free.rows, cellWidth.value, cellHeight.value);
      const tier = emptyTierFor(p.width, p.height);
      if (!tier) return null;
      return {
        tier,
        whole: activeWidgets.value.length === 0,
        col: free.col,
        row: free.row,
        style: { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` },
      };
    });

    const onPaletteDragStart = (item, e) => {
      dragItem.value = item;
      // Get the palette out of the way immediately — it overlays the canvas,
      // and its backdrop would otherwise swallow the drop. The drag continues
      // regardless, because HTML5 DnD is not tied to the source element.
      paletteOpen.value = false;
      try {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', item.widgetId);
      } catch { /* older browsers */ }
    };

    const onPaletteDragEnd = () => {
      dragItem.value = null;
      dropPreview.value = null;
    };

    /** Grid cell under the pointer, clamped so the footprint stays on-grid. */
    const cellUnderPointer = (e, cols, rows) => {
      const el = gridRef.value;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const col = Math.floor((e.clientX - r.left) / Math.max(cellWidth.value, 1));
      const row = Math.floor((e.clientY - r.top) / Math.max(cellHeight.value, 1));
      return {
        col: Math.max(0, Math.min(col, GRID_COLS - cols)),
        row: Math.max(0, Math.min(row, GRID_ROWS - rows)),
      };
    };

    const onCanvasDragOver = (e) => {
      if (!dragItem.value) return;
      e.preventDefault();                      // required to allow the drop
      e.dataTransfer.dropEffect = 'copy';

      const def = getWidget(dragItem.value.widgetId);
      const cols = Math.min(def?.defaultSize?.cols || 4, GRID_COLS);
      const rows = Math.min(def?.defaultSize?.rows || 3, GRID_ROWS);
      const at = cellUnderPointer(e, cols, rows);
      if (!at) return;
      dropPreview.value = {
        ...at, cols, rows,
        name: dragItem.value.name,
        icon: dragItem.value.icon,
      };
    };

    const onCanvasDragLeave = (e) => {
      // dragleave also fires when crossing onto a child element; only clear
      // when the pointer has genuinely left the canvas.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      dropPreview.value = null;
    };

    const onCanvasDrop = (e) => {
      if (!dragItem.value) return;
      e.preventDefault();
      const at = dropPreview.value ? { col: dropPreview.value.col, row: dropPreview.value.row } : null;
      const item = dragItem.value;
      dropPreview.value = null;
      dragItem.value = null;
      open(item.widgetId, {
        objectId: item.objectId || '',
        routeParam: item.routeParam || '',
        custom: !!item.custom,
        at,
      });
    };

    // ── canvas interactions ───────────────────────────────────────────
    // Where a palette pick should land, when the palette was opened by
    // double-clicking a specific spot. Without this the prompt sitting in a
    // gap saying "double-click here to fill it" would be a lie — the widget
    // would be packed wherever the placer preferred. placeInstance already
    // falls through to normal packing if the footprint doesn't fit here, so a
    // stale or awkward target degrades instead of failing.
    const pendingAt = ref(null);

    const onCanvasDblClick = (e) => {
      // Open the palette when double-clicking the empty canvas area or grid
      if (
        e.target === gridRef.value ||
        e.target.classList.contains('ws-grid-overlay') ||
        e.target.classList.contains('ws-empty') ||
        e.target.closest('.ws-empty')
      ) {
        pendingAt.value = cellUnderPointer(e, 1, 1);
        paletteOpen.value = true;
        paletteQuery.value = '';
        nextTick(() => paletteInput.value?.focus());
      }
    };

    // ── palette ──────────────────────────────────────────────────────
    const paletteOpen = ref(false);
    const paletteQuery = ref('');
    const paletteInput = ref(null);

    const togglePalette = () => {
      paletteOpen.value = !paletteOpen.value;
      // Opened from the toolbar, not from a spot on the canvas — no target.
      pendingAt.value = null;
      if (!paletteOpen.value) return;
      paletteQuery.value = '';
      // Only fetch what we don't already have. Re-fetching the widget catalog
      // while widgets are on the canvas used to blank every one of them (the
      // list response omits source_code — see the SET_DEFINITIONS comment in
      // store/features/widgetDefinitions.js). That is fixed at the source now,
      // but there is still no reason to spend a round trip re-listing data the
      // store already holds.
      if (!store.getters['workflows/allWorkflows']?.length) {
        store.dispatch('workflows/fetchWorkflows').catch(() => {});
      }
      if (!store.getters['widgetDefinitions/isLoaded']) {
        store.dispatch('widgetDefinitions/fetchDefinitions').catch(() => {});
      }
      nextTick(() => paletteInput.value?.focus());
    };

    const match = (text) => {
      const q = paletteQuery.value.trim().toLowerCase();
      return (
        !q ||
        String(text || '')
          .toLowerCase()
          .includes(q)
      );
    };

    const paletteGroups = computed(() => {
      // The registry is the catalog — every widget a custom page can host,
      // this canvas can host. Custom widgets registered there carry
      // isCustomWidget and are listed under their own group.
      const all = getAllWidgets();
      const builtIn = all
        // 'chat' is the FULL Chat screen — it binds the main orchestrator
        // conversation (so it appears pre-filled with existing history) and
        // duplicates 'workspace-chat' under the identical display name
        // "Chat". On this canvas, chat means a workspace conversation.
        .filter((w) => !w.isCustomWidget && w.id !== 'chat' && match(w.name))
        .slice(0, 40)
        .map((w) => ({ key: w.id, widgetId: w.id, name: w.name, icon: w.icon || 'fas fa-square' }));

      const registryCustom = all
        .filter((w) => w.isCustomWidget && match(w.name))
        .map((w) => ({ key: w.id, widgetId: w.id, name: w.name, icon: w.icon || 'fas fa-shapes', custom: true }));

      // Store definitions the registry hasn't synced yet
      const knownIds = new Set(all.map((w) => w.id));
      const storeCustom = (store.getters['widgetDefinitions/allDefinitions'] || [])
        .filter((d) => !knownIds.has(d.id) && match(d.name))
        .slice(0, 20)
        .map((d) => ({ key: d.id, widgetId: d.id, name: d.name || d.id, icon: 'fas fa-shapes', custom: true }));

      const workflows = (store.getters['workflows/allWorkflows'] || [])
        .filter((w) => match(w.name))
        .slice(0, 12)
        .map((w) => ({
          key: `wf:${w.id}`,
          widgetId: 'workflow-forge',
          name: w.name || w.id,
          icon: 'fas fa-project-diagram',
          objectId: w.id,
          routeParam: 'id',
        }));

      return [
        { label: 'Widgets', items: builtIn },
        { label: 'Your widgets', items: [...registryCustom, ...storeCustom] },
        { label: 'Your workflows', items: workflows },
      ];
    });

    const pick = (item) => {
      open(item.widgetId, {
        objectId: item.objectId || '',
        routeParam: item.routeParam || '',
        custom: !!item.custom,
        at: pendingAt.value,
      });
      pendingAt.value = null;
      paletteOpen.value = false;
    };

    // QuickActions renders suggestion.icon + suggestion.text and keys on
    // suggestion.id — plain strings render as blank chips.
    const suggestions = [
      { id: 'ws-1', icon: '🔁', text: 'Build a workflow that checks a site hourly and emails me' },
      { id: 'ws-2', icon: '📊', text: 'Make a dashboard widget for this week’s runs' },
      { id: 'ws-3', icon: '🔍', text: 'Show me what I worked on last week' },
    ];

    // Provide workspace context so the WorkspaceChatWidget (a regular grid
    // widget) can bind to this workspace's conversation channel.
    provide('workspaceChatChannel', chatChannelKey);
    // Per-INSTANCE channel resolution: each chat widget on the canvas owns an
    // independent conversation (see chatChannelFor). The single-channel
    // provide above stays as the legacy fallback.
    provide('workspaceChatChannelFor', (instanceId) => {
      const ws = active.value;
      const inst = ws.widgets.find((w) => w.instanceId === instanceId);
      return chatChannelFor(ws.id, inst);
    });
    provide('workspacePageState', workspacePageState);
    provide('workspaceFrontendEvent', handleFrontendEvent);
    provide('workspaceSuggestions', suggestions);

    // ── lifecycle ────────────────────────────────────────────────────
    const onKeydown = (e) => {
      if (e.key === 'Escape' && paletteOpen.value) paletteOpen.value = false;
    };

    // The page's CSS identifier, exactly what BaseScreen would derive for
    // 'WorkspaceScreen'. Workspace doesn't use BaseScreen at its root, so it
    // has to claim data-page itself — and embedded BaseScreens are barred
    // from stomping it (they check isInsideWidgetCanvas before writing).
    // Set on mount AND on KeepAlive re-activation, mirroring BaseScreen.
    const WORKSPACE_DATA_PAGE = 'terminal-workspace';
    const setDataPage = () => document.body.setAttribute('data-page', WORKSPACE_DATA_PAGE);
    onActivated(setDataPage);

    onMounted(() => {
      setDataPage();
      window.addEventListener('keydown', onKeydown);
      updateCellDimensions();
      if (typeof ResizeObserver !== 'undefined') {
        gridObserver = new ResizeObserver(updateCellDimensions);
        if (gridRef.value) gridObserver.observe(gridRef.value);
        // Overflow depends on the strip's width as much as its content, so a
        // window/panel resize has to re-evaluate it too.
        tabObserver = new ResizeObserver(updateTabOverflow);
        if (tabStripRef.value) tabObserver.observe(tabStripRef.value);
      }
      nextTick(scrollActiveTabIntoView);
    });

    // The grid element only exists in split mode — re-observe when it appears.
    watch(gridRef, (el) => {
      if (!gridObserver) return;
      gridObserver.disconnect();
      if (el) {
        gridObserver.observe(el);
        nextTick(updateCellDimensions);
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      if (gridObserver) gridObserver.disconnect();
      if (tabObserver) tabObserver.disconnect();
    });

    return {
      // workspace state
      workspaces,
      activeId,
      active,
      activeWidgets,
      autoOpen,
      setActive,
      createWorkspace,
      closeWorkspace,
      // tab strip overflow
      tabStripRef,
      setTabRef,
      tabsMoreLeft,
      tabsMoreRight,
      updateTabOverflow,
      removeWidget,
      toggleCollapse,
      bringToFront,
      setAutoOpen,
      // widget resolution
      componentFor,
      customDefFor,
      storedDefFor,
      isOpen,
      onWidgetEdit,
      // frame gestures
      onFrameGestureStart,
      onFrameDragEnd,
      onFrameResizeEnd,
      // canvas
      onCanvasDblClick, onEmbedScreenChange, onCanvasPointerDownCapture,
      emptyRegion, canvasBusy,
      // window navigation
      hasHistory, canBack, canForward, historyGo, panelScopeFor,
      // palette drag-and-drop
      dropPreview, dropPreviewStyle, onPaletteDragStart, onPaletteDragEnd,
      onCanvasDragOver, onCanvasDragLeave, onCanvasDrop,
      // grid
      gridRef,
      cellWidth,
      cellHeight,
      showGrid,
      GRID_COLS,
      GRID_ROWS,
      GRID_GAP,
      // rename
      renamingId,
      renameDraft,
      renameInput,
      beginRename,
      commitRename,
      // palette
      paletteOpen,
      paletteQuery,
      paletteInput,
      paletteGroups,
      togglePalette,
      pick,
    };
  },
};
</script>

<style scoped>
.ws-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  /* No explicit width. .cv-dashboard is a column flex container, so the
     default `align-items: stretch` sizes this to the host minus whatever
     margin it has — self-correcting either way. The previous
     `calc(100% - 8px)` hardcoded the custom-background gutter into the width,
     so with no background (margin 0) the canvas fell 8px short of its host
     and left dead space down the right edge. */
  overflow: hidden;
  background: var(--color-background);
  position: relative;
}

/* Flush against the toolbar above, in BOTH background modes.
 *
 * The tab bar is drawn to hang off the top edge — `border-top: none` and a
 * `0 0 16px 16px` radius — so any top gutter visibly detaches it. The
 * dashboard's gutter rule is about the canvas's OUTER FRAME; this one edge
 * belongs to the child, so the child declares it. That keeps the parent rule a
 * contract instead of re-growing the page-keyed special case it replaced, and
 * "only the workspace page" is structural — `.ws-root` exists nowhere else.
 *
 * Both selectors are needed to outrank the gutter deterministically without
 * !important: scoped, `.cv-dashboard > *` resolves to (0,2,0) and its
 * `.custom-bg` variant to (0,3,0), so `body .ws-root` (0,2,1) wins the first
 * and `body.custom-bg .ws-root` (0,3,1) wins the second. A bare `.ws-root`
 * (0,2,0) would only TIE the base rule and lose the custom-background one. */
body .ws-root,
body.custom-bg .ws-root {
  margin-top: 0;
}

/* Over a custom background the canvas is a WINDOW, not a surface: the
   wallpaper shows through and the widget frames become the glass (see
   `body.custom-bg .widget-frame` in WidgetFrame.vue). The custom-page canvas
   already behaves this way — .cv-dashboard is forced transparent — and an
   opaque root here painted straight over it.
   Scoped CSS appends the scope attribute to the LAST compound selector, so
   this resolves to (0,3,1) and outranks the base rule's (0,2,0). */
body.custom-bg .ws-root {
  background: transparent;
}

/* ═══════════ tab bar ═══════════ */
.ws-tabbar {
  flex: 0 0 34px;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  border: 1px solid var(--terminal-border-color, rgba(255, 255, 255, 0.09));
  border-top: none;
  border-radius: 0 0 16px 16px;
  background: rgba(var(--color-background-rgb, 0, 0, 0), var(--bg-opacity, 0.9)) !important;
}

.ws-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
}
.ws-tabs::-webkit-scrollbar {
  display: none;
}

/* The scrollbar is hidden by design, so overflow needs its own signal: a tab
 * that is simply absent from view is indistinguishable from one that does not
 * exist. The mask fades whichever edge has more tabs behind it.
 *
 * 56px, not a hairline: the fade has to swallow the PARTIAL tab sitting on the
 * boundary. A short fade leaves a hard-cut sliver — a stray status dot with no
 * label — which reads as a rendering artifact rather than as "there is more
 * this way". Roughly a third of the narrowest tab (measured 133px). */
.ws-tabs.more-right {
  mask-image: linear-gradient(to right, #000 calc(100% - 56px), transparent 100%);
}
.ws-tabs.more-left {
  mask-image: linear-gradient(to left, #000 calc(100% - 56px), transparent 100%);
}
.ws-tabs.more-left.more-right {
  mask-image: linear-gradient(to right, transparent 0, #000 56px, #000 calc(100% - 56px), transparent 100%);
}

.ws-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 22px;
  padding: 0 8px 0 9px;
  border-radius: 16px;
  border: 1px solid transparent;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
  /* Never shrink a tab into an unreadable sliver — the strip scrolls instead. */
  flex: 0 0 auto;
}

.ws-tab:hover {
  color: var(--color-text, #fff);
  background: rgba(255, 255, 255, 0.04);
}

.ws-tab.on {
  color: var(--color-text, #fff);
  background: var(--color-background);
  border-color: var(--terminal-border-color, rgba(255, 255, 255, 0.14));
}

.ws-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex: 0 0 auto;
}

.ws-tab.on .ws-dot {
  background: var(--color-green, #19ef83);
  box-shadow: 0 0 7px var(--color-green, #19ef83);
}

.ws-tab-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: -4px;
}

.ws-rename {
  width: 120px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--color-cyan, #12e0ff);
  color: var(--color-text, #fff);
  font-size: 11.5px;
  outline: none;
  padding: 0;
}

.ws-count {
  font-family: var(--font-family-mono, monospace);
  font-size: 9px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 99px;
  border: 1px solid var(--terminal-border-color, rgba(255, 255, 255, 0.14));
  color: rgba(255, 255, 255, 0.35);
}

.ws-tab.on .ws-count {
  color: var(--color-cyan, #12e0ff);
  border-color: rgba(18, 224, 255, 0.3);
}

.ws-tab-x {
  background: transparent;
  border: 0;
  color: rgba(255, 255, 255, 0.25);
  font-size: 9px;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
}
.ws-tab-x:hover {
  color: var(--color-pink, #e53d8f);
}

.ws-tab-add {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 10px;
  cursor: pointer;
}
.ws-tab-add:hover {
  color: var(--color-text, #fff);
  background: rgba(255, 255, 255, 0.05);
}

.ws-tabbar-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ws-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 10px;
  border-radius: 16px;
  border: 1px solid var(--terminal-border-color, rgba(255, 255, 255, 0.14));
  background: transparent;
  color: rgba(255, 255, 255, 0.42);
  font-family: var(--font-family-mono, monospace);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ws-pill:hover {
  color: var(--color-text, #fff);
  border-color: rgba(255, 255, 255, 0.3);
}

.ws-pill.on {
  color: var(--color-green, #19ef83);
  border-color: rgba(25, 239, 131, 0.4);
  background: rgba(25, 239, 131, 0.08);
}

.ws-pill-primary {
  color: var(--color-pink, #e53d8f);
  border-color: rgba(var(--primary-rgb, 229, 61, 143), 0.4);
  background: rgba(var(--primary-rgb, 229, 61, 143), 0.08);
}
.ws-pill-primary:hover {
  color: #fff;
  background: rgba(var(--primary-rgb, 229, 61, 143), 0.22);
  border-color: rgba(var(--primary-rgb, 229, 61, 143), 0.6);
}

/* ═══════════ canvas ═══════════ */
/* NO PADDING — deliberately, and this is load-bearing.
 *
 * On a custom page the widget area is flush: both .cv-dashboard and
 * .widget-canvas declare zero padding, and 100% of the spacing comes from
 * GRID_GAP inside gridToPixel:
 *
 *     x = col * cellWidth + 4          width = cols * cellWidth - 4
 *
 * which puts adjacent widget edges 4px apart AND lands the last widget
 * exactly 4px from the container edge (because cellWidth is derived as
 * (containerWidth - 4) / 12). Measured result: 4px outer on all four sides,
 * 4px between widgets — uniform.
 *
 * Any padding here stacks on top of that and breaks the match: the 8px this
 * used to carry produced a 12px outer inset against a 4px inner gap, which
 * reads as the canvas being "off" even though the grid itself was correct.
 * The rail gets its own margin below instead. */
.ws-canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  padding: 0;
  overflow: hidden;
  margin-top: 4px;
}

/* ═══════════ palette drag-and-drop ═══════════ */
/* NOTE: the cursor lives on the .ws-palette-item rule further down, not here.
   An identical-specificity rule declared earlier loses the cascade to it, so
   duplicating it at this point silently does nothing. */

/* The affordance that says "this row is liftable". Reserved at all times so
   the row doesn't reflow on hover. */
.ws-palette-grip {
  width: 8px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.18);
  transition: color 0.12s ease;
}

.ws-palette-item:hover .ws-palette-grip {
  color: rgba(255, 255, 255, 0.45);
}

/* Landing zone: the exact cells the widget will occupy on release. */
.ws-drop-preview {
  position: absolute;
  z-index: 900;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 2px dashed rgba(var(--primary-rgb, 229, 61, 143), 0.85);
  background: rgba(var(--primary-rgb, 229, 61, 143), 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  transition: left 0.08s ease, top 0.08s ease, width 0.08s ease, height 0.08s ease;
}

.ws-drop-preview i {
  font-size: 18px;
  opacity: 0.8;
}

.ws-surfaces.is-drop-target {
  outline: 1px solid rgba(var(--primary-rgb, 229, 61, 143), 0.35);
  outline-offset: -1px;
}

/* ═══════════ empty canvas prompt ═══════════ */
/* Positioned over the largest gap (inline left/top/width/height), never
   `inset: 0` — an inset-0 prompt is centred on the CANVAS, which puts it
   behind the widgets as soon as there is more than empty space. */
.ws-empty {
  position: absolute;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
  text-align: center;
  pointer-events: none;
  transition: left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease;
}

.ws-empty-icon {
  font-size: 36px;
  line-height: 1;
  color: var(--color-text-muted, #334);
  opacity: 0.3;
}

.ws-empty-text {
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-muted, #445);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.ws-empty-hint {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted, #334);
}

/* Smaller gaps carry less, and carry it smaller. A gap is an incidental
   space, so its prompt should read as a hint, never as a second heading
   competing with the widgets around it. */
.ws-empty.is-compact {
  gap: 6px;
}
.ws-empty.is-compact .ws-empty-icon {
  font-size: 22px;
}
.ws-empty.is-compact .ws-empty-text {
  font-size: var(--font-size-xs, 11px);
  letter-spacing: 1.5px;
}

.ws-empty.is-mark {
  gap: 0;
}
.ws-empty.is-mark .ws-empty-icon {
  font-size: 16px;
  opacity: 0.22;
}

/* ═══════════ widget canvas area ═══════════
   The frames inside are the REAL WidgetFrame — nothing here styles them. */
.ws-surfaces {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* grid guides, shown only while dragging or resizing (same look as
   WidgetCanvas's overlay) */
.ws-grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 0;
}
.ws-grid-overlay.visible {
  opacity: 1;
}

/* Idle — "there is still room here" rather than "you are placing something".
   The guides are already rgba(primary, 0.16); half of that is a whisper,
   which is the point: present enough to read as an unfilled canvas, quiet
   enough to never compete with widget content. */
.ws-grid-overlay.visible.idle {
  opacity: 0.5;
}

.ws-grid-v,
.ws-grid-h {
  position: absolute;
  background: rgba(var(--primary-rgb, 229, 61, 143), 0.16);
}
.ws-grid-v {
  top: 0;
  bottom: 0;
  width: 1px;
}
.ws-grid-h {
  left: 0;
  right: 0;
  height: 1px;
}

/* ═══════════ embedded content containment ═══════════
   The FRAME is the widget system's; what goes INSIDE the slot is ours. Full
   screens mounted as widgets bring their own left/right panels, composer and
   viewport-stepped padding — inside a window those are redundant (the
   workspace owns one chat and one input) or wrong (a pane is not a viewport).

   --ws-pad steps AGNT's spacing scale (BaseScreen's own 16 → 12 → 8 sequence)
   against the WINDOW's width via a container query, because the @media
   step-downs the screens rely on never fire inside a pane. */
.ws-embed {
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  container-type: inline-size;
  container-name: surface;
  --ws-pad: var(--spacing-md, 16px);
}

@container surface (max-width: 900px) {
  .ws-embed {
    --ws-pad: 12px;
  }
}

@container surface (max-width: 560px) {
  .ws-embed {
    --ws-pad: var(--spacing-sm, 8px);
  }
}

.ws-embed > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.ws-embed :deep(.input-container),
.ws-embed :deep(.mobile-panel-toggle) {
  display: none !important;
}

/* ═══ the screen's OWN panels, unmodified ═══
 *
 * There is deliberately no rule here sizing, hiding or capping
 * .left-panel-component / .right-panel-component / .resize-handle.
 *
 * The previous version hid the drag handles and forced both panels to
 * container-query widths, which produced panels that looked roughly right
 * and behaved nothing like the app's: no 384px default, no 16px collapse
 * notch, no 280px floor, no snap, no drag. The real system — all of that
 * behaviour — already lives in BaseScreen; it was only ever broken in here
 * because BaseScreen sized itself against window.innerWidth and persisted to
 * a single global width. Both of those are fixed at the source (a measured
 * container + an injectable panelWidthScope, see EmbedScope.vue), so the
 * correct amount of CSS for this is none.
 *
 * Anything re-added below this line is almost certainly a symptom fix. */

.ws-embed :deep(.main-panel) {
  min-width: 0 !important;
  padding: var(--ws-pad) !important;
}

.ws-embed :deep(.scrollable-content) {
  padding: var(--ws-pad);
  gap: var(--ws-pad);
  min-width: 0 !important;
  overflow-x: auto;
}

.ws-embed :deep(.terminal-content),
.ws-embed :deep(.three-panel-container) {
  height: 100%;
  min-height: 0;
  width: 100%;
  min-width: 0 !important;
}

.ws-embed-empty {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.32);
  font-size: 12px;
}
.ws-embed-empty i {
  font-size: 22px;
  opacity: 0.5;
}
.ws-embed-empty code {
  font-family: var(--font-family-mono, monospace);
  color: var(--color-cyan, #12e0ff);
}

/* ═══════════ per-window navigation ═══════════
   Sits in WidgetFrame's header-lead slot, so it must read as part of the
   SAME control strip as the frame's own buttons — not a second, dimmer one.
   Every value below is taken from WidgetFrame's header rules rather than
   picked — they are .wf-ctrl button's own values: gap 2px, padding 0 4px,
   font-size 14px, transparent background, --color-text-muted, hover to
   --color-text-primary. These are CONTROLS, so they take the control scale,
   not .wf-icon's 12px label scale.

   Measured, because a downscaled screenshot cannot settle optical parity:
   colour resolves to rgb(127,129,147) for the chevrons, the frame buttons
   and the icon alike, and centre-to-centre pitch is 21px on both clusters.
   An earlier pass at 12px / padding 0 3px measured 15px pitch against the
   frame's 21px and read as a separate, tighter control group.

   Horizontal inset is deliberately absent: .wf-hdr already supplies its own
   8px padding and 4px child gap. */
.ws-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.ws-nav-btn {
  display: grid;
  place-items: center;
  padding: 0 4px;
  background: none;
  border: none;
  line-height: 1;
  font-size: 14px;
  color: var(--color-text-muted, #556);
  cursor: pointer;
  transition: color 0.15s;
}

.ws-nav-btn:hover:not(:disabled) {
  color: var(--color-text-primary, #eee);
}

/* Unreachable direction: same hue, clearly recessed. Opacity rather than a
   second colour token so the enabled/disabled pair stays related. */
.ws-nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* ═══════════ palette ═══════════ */
.ws-palette-backdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
}

.ws-palette {
  position: absolute;
  top: 40px;
  right: 0px;
  z-index: 41;
  width: 340px;
  max-height: 460px;
  display: flex;
  flex-direction: column;
  /* Fully opaque, not var(--color-popup) — that token is translucent in the
     shipped themes, and this panel floats directly over live widget content,
     which then reads through it as garbled text. */
  background: rgb(var(--color-background-rgb, 21, 21, 31));
  border: 1px solid var(--terminal-border-color, rgba(255, 255, 255, 0.16));
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.ws-palette-search {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--terminal-border-color, rgba(255, 255, 255, 0.1));
  color: var(--color-text, #fff);
  font-size: 12.5px;
  outline: none;
}

.ws-palette-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}

.ws-palette-group {
  font-family: var(--font-family-mono, monospace);
  font-size: 8.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
  padding: 10px 8px 4px;
}

.ws-palette-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  text-align: left;
  /* Rows are draggable onto the canvas, so they advertise lift, not click.
     Clicking still works and still adds the widget. */
  cursor: grab;
  transition: background 0.12s ease;
}
.ws-palette-item:active { cursor: grabbing; }
.ws-palette-item:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
.ws-palette-item i {
  width: 14px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
.ws-palette-item.open i {
  color: var(--color-green, #19ef83);
}

.ws-palette-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-palette-tag {
  font-family: var(--font-family-mono, monospace);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-green, #19ef83);
}

.ws-palette-empty {
  padding: 22px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}
</style>
