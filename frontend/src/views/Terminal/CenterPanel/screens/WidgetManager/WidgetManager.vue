<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="WidgetManagerPanel"
    activeRightPanel="WidgetManagerPanel"
    screenId="WidgetManagerScreen"
    :showInput="false"
    @screen-change="(screenName) => $emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
  >
    <template #default>
      <div class="wm-root">
        <!-- Header bar -->
        <ScreenToolbar
          title="WIDGET MANAGER"
          :count="filteredWidgets.length"
          countLabel="widgets"
          searchPlaceholder="Search widgets..."
          :searchQuery="searchQuery"
          :currentLayout="currentLayout"
          :layoutOptions="['grid', 'list']"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :sortOrder="sortOrder"
          createLabel="New Widget"
          @update:searchQuery="(v) => searchQuery = v"
          @update:layout="setLayout"
          @update:sortOrder="(v) => sortOrder = v"
          @create="createNewWidget"
        >
          <template #extra-buttons>
            <button class="wm-btn wm-btn-import" @click="showImportModal = true" title="Import widget">
              <i class="fas fa-file-import"></i>
              <span>Import</span>
            </button>
          </template>
        </ScreenToolbar>

        <!-- Category tabs -->
        <div class="wm-tabs">
          <button
            v-for="cat in categoryTabs"
            :key="cat.id"
            class="wm-tab"
            :class="{ active: activeCategory === cat.id }"
            @click="activeCategory = cat.id"
          >
            <i :class="cat.icon"></i>
            {{ cat.label }}
          </button>
        </div>

        <!-- Widget grid -->
        <div class="wm-content">
          <main class="wm-main-content">
          <!-- Grid View -->
          <div v-if="currentLayout === 'grid'" class="wm-grid">
            <div
              v-for="widget in filteredWidgets"
              :key="widget.id"
              class="wm-card"
              :class="{ 'wm-custom': widget._isCustom }"
              @click="widget._isCustom ? openEditor(widget) : null"
            >
              <!-- Preview area (custom widgets only) -->
              <div v-if="widget._isCustom && widget._definition && hasPreview(widget)" class="wm-card-preview">
                <!-- iframe-type: load external URL (needs scripts to render) -->
                <iframe
                  v-if="widget._definition.widget_type === 'iframe' && widget._definition.config?.url"
                  class="wm-card-preview-iframe"
                  :src="widget._definition.config.url"
                  sandbox="allow-scripts allow-same-origin"
                  frameborder="0"
                  tabindex="-1"
                  scrolling="no"
                ></iframe>
                <!-- html/markdown: static srcdoc preview -->
                <iframe
                  v-else
                  class="wm-card-preview-iframe"
                  :srcdoc="getPreviewHtml(widget)"
                  sandbox=""
                  frameborder="0"
                  tabindex="-1"
                  scrolling="no"
                ></iframe>
              </div>
              <!-- Info area -->
              <div class="wm-card-info">
                <div class="wm-card-header">
                  <div class="wm-card-icon"><i :class="widget.icon"></i></div>
                  <div class="wm-card-name">{{ widget.name }}</div>
                  <div class="wm-card-badges">
                    <span v-if="widget._isCustom" class="wm-badge wm-badge-custom">CUSTOM</span>
                    <span v-else class="wm-badge wm-badge-builtin">BUILT-IN</span>
                    <span v-if="widget.is_shared" class="wm-badge wm-badge-shared">SHARED</span>
                  </div>
                </div>
                <div class="wm-card-desc">{{ widget.description }}</div>
                <div class="wm-card-meta">
                  <span class="wm-card-type">{{ widget.widget_type || widget.category }}</span>
                  <span class="wm-card-size">{{ formatSize(widget) }}</span>
                </div>
              </div>
              <!-- Actions for custom widgets -->
              <div v-if="widget._isCustom" class="wm-card-actions" @click.stop>
                <button @click="openEditor(widget)" title="Edit"><i class="fas fa-pen"></i></button>
                <button @click="duplicateWidget(widget)" title="Duplicate"><i class="fas fa-copy"></i></button>
                <button @click="exportWidget(widget)" title="Export"><i class="fas fa-file-export"></i></button>
                <button class="wm-card-delete" @click="confirmDelete(widget)" title="Delete"><i class="fas fa-trash"></i></button>
              </div>
            </div>

            <!-- Empty state -->
            <div v-if="filteredWidgets.length === 0" class="wm-empty">
              <div class="wm-empty-icon"><i class="fas fa-puzzle-piece"></i></div>
              <div class="wm-empty-text">No widgets found</div>
              <div class="wm-empty-hint">
                <span v-if="searchQuery">Try a different search term</span>
                <span v-else>Create your first custom widget!</span>
              </div>
            </div>
          </div>

          <!-- List View -->
          <div v-else class="wm-list">
            <div
              v-for="widget in filteredWidgets"
              :key="widget.id"
              class="wm-list-row"
              :class="{ 'wm-custom': widget._isCustom }"
              @click="widget._isCustom ? openEditor(widget) : null"
            >
              <div class="wm-list-icon"><i :class="widget.icon"></i></div>
              <div class="wm-list-name">{{ widget.name }}</div>
              <div class="wm-list-desc">{{ widget.description }}</div>
              <div class="wm-list-badges">
                <span v-if="widget._isCustom" class="wm-badge wm-badge-custom">CUSTOM</span>
                <span v-else class="wm-badge wm-badge-builtin">BUILT-IN</span>
                <span v-if="widget.is_shared" class="wm-badge wm-badge-shared">SHARED</span>
              </div>
              <span class="wm-list-type">{{ widget.widget_type || widget.category }}</span>
              <span class="wm-list-size">{{ formatSize(widget) }}</span>
              <div v-if="widget._isCustom" class="wm-list-actions" @click.stop>
                <button @click="openEditor(widget)" title="Edit"><i class="fas fa-pen"></i></button>
                <button @click="duplicateWidget(widget)" title="Duplicate"><i class="fas fa-copy"></i></button>
                <button @click="exportWidget(widget)" title="Export"><i class="fas fa-file-export"></i></button>
                <button class="wm-card-delete" @click="confirmDelete(widget)" title="Delete"><i class="fas fa-trash"></i></button>
              </div>
            </div>

            <!-- Empty state -->
            <div v-if="filteredWidgets.length === 0" class="wm-empty">
              <div class="wm-empty-icon"><i class="fas fa-puzzle-piece"></i></div>
              <div class="wm-empty-text">No widgets found</div>
              <div class="wm-empty-hint">
                <span v-if="searchQuery">Try a different search term</span>
                <span v-else>Create your first custom widget!</span>
              </div>
            </div>
          </div>
          </main>
        </div>

        <!-- Import Modal -->
        <Teleport to="body">
          <div v-if="showImportModal" class="wm-modal-overlay" @click.self="closeImportModal">
            <div class="wm-modal">
              <div class="wm-modal-header">
                <span class="wm-modal-title">IMPORT WIDGET</span>
                <button @click="closeImportModal"><i class="fas fa-times"></i></button>
              </div>
              <div class="wm-modal-body">
                <div
                  class="wm-import-dropzone"
                  :class="{ 'wm-dropzone-active': isDragOver, 'wm-dropzone-has-file': importFile }"
                  @dragover.prevent="isDragOver = true"
                  @dragleave.prevent="isDragOver = false"
                  @drop.prevent="handleFileDrop"
                  @click="$refs.fileInput.click()"
                >
                  <input ref="fileInput" type="file" accept=".json,.agnt-widget.json" style="display: none" @change="handleFileSelect" />
                  <template v-if="importFile">
                    <i class="fas fa-file-code wm-dropzone-icon wm-dropzone-icon-ready"></i>
                    <span class="wm-dropzone-filename">{{ importFile.name }}</span>
                    <span class="wm-dropzone-hint">Click or drop to replace</span>
                  </template>
                  <template v-else>
                    <i class="fas fa-cloud-upload-alt wm-dropzone-icon"></i>
                    <span class="wm-dropzone-text">Drop .agnt-widget.json file here</span>
                    <span class="wm-dropzone-hint">or click to browse</span>
                  </template>
                </div>
                <p v-if="importError" class="wm-import-error">{{ importError }}</p>
              </div>
              <div class="wm-modal-footer">
                <button class="wm-btn" @click="closeImportModal">Cancel</button>
                <button class="wm-btn wm-btn-create" :disabled="!importFile" @click="doImport">Import</button>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- Delete Confirm Modal -->
        <Teleport to="body">
          <div v-if="deleteTarget" class="wm-modal-overlay" @click.self="deleteTarget = null">
            <div class="wm-modal">
              <div class="wm-modal-header">
                <span class="wm-modal-title wm-danger-title">DELETE WIDGET</span>
                <button @click="deleteTarget = null"><i class="fas fa-times"></i></button>
              </div>
              <div class="wm-modal-body">
                <p class="wm-modal-text">
                  Are you sure you want to delete <strong>"{{ deleteTarget.name }}"</strong>? This action cannot be undone.
                </p>
              </div>
              <div class="wm-modal-footer">
                <button class="wm-btn" @click="deleteTarget = null">Cancel</button>
                <button class="wm-btn wm-btn-danger" @click="doDelete">Delete</button>
              </div>
            </div>
          </div>
        </Teleport>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { getAllWidgets } from '@/canvas/widgetRegistry.js';
import BaseScreen from '../../BaseScreen.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';

export default {
  name: 'WidgetManagerScreen',
  components: { BaseScreen, Tooltip, ScreenToolbar },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const searchQuery = ref('');
    const activeCategory = ref('all');
    const showImportModal = ref(false);
    const importFile = ref(null);
    const importError = ref('');
    const isDragOver = ref(false);
    const deleteTarget = ref(null);
    const currentLayout = ref('grid');
    const sortOrder = ref('az');

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    onMounted(async () => {
      // Definitions are fetched at startup (store initializeStore Phase 2).
      // If somehow not yet loaded (e.g. race condition), fetch now as fallback.
      if (!store.getters['widgetDefinitions/isLoaded']) {
        await store.dispatch('widgetDefinitions/fetchDefinitions');
      }

      document.body.setAttribute('data-page', 'terminal-widget-manager');
    });

    const customDefinitions = computed(() => store.getters['widgetDefinitions/allDefinitions']);

    // Combine built-in widgets with custom definitions
    // getAllWidgets() includes custom widgets registered in the registry,
    // so we split them out to avoid duplicates and enrich custom ones with _definition
    const allWidgets = computed(() => {
      const customIds = new Set(customDefinitions.value.map((d) => d.id));

      const builtIn = getAllWidgets()
        .filter((w) => !w.isCustomWidget)
        .map((w) => ({
          ...w,
          _isCustom: false,
          widget_type: w.isScreenWidget ? 'screen' : 'dashboard',
        }));

      const custom = customDefinitions.value.map((d) => ({
        id: d.id,
        name: d.name,
        icon: d.icon || 'fas fa-puzzle-piece',
        category: d.category || 'custom',
        description: d.description || '',
        defaultSize: d.default_size || { cols: 4, rows: 3 },
        minSize: d.min_size || { cols: 2, rows: 2 },
        widget_type: d.widget_type,
        is_shared: d.is_shared,
        _isCustom: true,
        _definition: d,
      }));

      return [...custom, ...builtIn];
    });

    const categoryTabs = computed(() => {
      const cats = [
        { id: 'all', label: 'All', icon: 'fas fa-th' },
        { id: 'custom', label: 'Custom', icon: 'fas fa-puzzle-piece' },
      ];
      const seen = new Set(['all', 'custom']);
      for (const w of allWidgets.value) {
        const cat = w.category;
        if (!seen.has(cat)) {
          seen.add(cat);
          cats.push({
            id: cat,
            label: cat.charAt(0).toUpperCase() + cat.slice(1),
            icon: getCategoryIcon(cat),
          });
        }
      }
      return cats;
    });

    const filteredWidgets = computed(() => {
      let widgets = allWidgets.value;

      if (activeCategory.value !== 'all') {
        if (activeCategory.value === 'custom') {
          widgets = widgets.filter((w) => w._isCustom);
        } else {
          widgets = widgets.filter((w) => w.category === activeCategory.value);
        }
      }

      if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase();
        widgets = widgets.filter(
          (w) =>
            w.name.toLowerCase().includes(q) || (w.description && w.description.toLowerCase().includes(q)) || w.category.toLowerCase().includes(q),
        );
      }

      // Sort: preview widgets first, then by name
      widgets = [...widgets].sort((a, b) => {
        const aHas = a._isCustom && a._definition && hasPreview(a) ? 0 : 1;
        const bHas = b._isCustom && b._definition && hasPreview(b) ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return sortOrder.value === 'az' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      });

      return widgets;
    });

    function getCategoryIcon(cat) {
      const map = {
        home: 'fas fa-home',
        assets: 'fas fa-cubes',
        forge: 'fas fa-hammer',
        system: 'fas fa-cog',
        dashboard: 'fas fa-tachometer-alt',
      };
      return map[cat] || 'fas fa-folder';
    }

    function hasPreview(widget) {
      const def = widget._definition;
      if (!def) return false;
      const type = def.widget_type || '';
      if (type === 'iframe') return !!def.config?.url;
      if (type === 'html' || type === 'markdown') return !!def.source_code;
      return false;
    }

    function formatSize(widget) {
      const size = widget.defaultSize || widget.default_size;
      if (!size) return '';
      return `${size.cols}×${size.rows}`;
    }

    function getPreviewHtml(widget) {
      const def = widget._definition;
      if (!def) return '';
      const type = def.widget_type || '';
      const source = def.source_code || '';
      if (!source) return '';

      // Strip all <script> tags and their contents for a static preview
      const stripped = source.replace(/<script[\s\S]*?<\/script>/gi, '');

      if (type === 'html') {
        const themeVars = `<style>
          :root {
            --color-green: #19ef83; --color-red: #ff4757; --color-yellow: #ffd700;
            --color-blue: #12e0ff; --color-purple: #7d3de5; --color-pink: #e53d8f;
            --color-background: #0c0c18; --color-text: #c8c8d4; --color-text-muted: #556;
            --color-border: #1a1a2e;
            --font-family: 'JetBrains Mono', 'Fira Code', monospace;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-family);
            background: var(--color-background);
            color: var(--color-text);
            overflow: hidden;
          }
        </style>`;
        if (stripped.trim().toLowerCase().startsWith('<!doctype') || stripped.trim().toLowerCase().startsWith('<html')) {
          // Strip scripts from full HTML documents too
          return stripped;
        }
        return `<!DOCTYPE html><html><head><meta charset="utf-8">${themeVars}</head><body>${stripped}</body></html>`;
      }

      if (type === 'markdown') {
        const rendered = source
          .replace(/^### (.+)$/gm, '<h3>$1</h3>')
          .replace(/^## (.+)$/gm, '<h2>$1</h2>')
          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/^- (.+)$/gm, '<li>$1</li>')
          .replace(/\n/g, '<br/>');
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'JetBrains Mono', monospace; background: #0c0c18; color: #c8c8d4; padding: 12px; overflow: hidden; font-size: 13px; line-height: 1.5; }
          h1, h2, h3 { color: #19ef83; margin-bottom: 4px; }
          h1 { font-size: 18px; } h2 { font-size: 15px; } h3 { font-size: 13px; }
          code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 3px; }
          strong { color: #eee; }
        </style></head><body>${rendered}</body></html>`;
      }

      return '';
    }

    function createNewWidget() {
      store.dispatch('widgetDefinitions/setActiveDefinition', null);
      emit('screen-change', 'WidgetForgeScreen');
    }

    function openEditor(widget) {
      if (widget._isCustom && widget._definition) {
        store.dispatch('widgetDefinitions/setActiveDefinition', widget.id);
      }
      emit('screen-change', 'WidgetForgeScreen');
    }

    async function duplicateWidget(widget) {
      if (widget._isCustom) {
        await store.dispatch('widgetDefinitions/duplicateDefinition', widget.id);
      }
    }

    async function exportWidget(widget) {
      if (!widget._isCustom) return;
      const data = await store.dispatch('widgetDefinitions/exportDefinition', widget.id);
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${widget.name.replace(/\s+/g, '-').toLowerCase()}.agnt-widget.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }

    function confirmDelete(widget) {
      deleteTarget.value = widget;
    }

    async function doDelete() {
      if (deleteTarget.value) {
        await store.dispatch('widgetDefinitions/deleteDefinition', deleteTarget.value.id);
        deleteTarget.value = null;
      }
    }

    function handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        importFile.value = file;
        importError.value = '';
      }
    }

    function handleFileDrop(event) {
      isDragOver.value = false;
      const file = event.dataTransfer.files[0];
      if (file) {
        importFile.value = file;
        importError.value = '';
      }
    }

    function closeImportModal() {
      showImportModal.value = false;
      importFile.value = null;
      importError.value = '';
    }

    async function doImport() {
      if (!importFile.value) return;
      try {
        const text = await importFile.value.text();
        const parsed = JSON.parse(text);
        const success = await store.dispatch('widgetDefinitions/importDefinition', parsed);
        if (success) {
          closeImportModal();
        }
      } catch {
        importError.value = 'Invalid JSON file. Please select a valid .agnt-widget.json file.';
      }
    }

    function handlePanelAction(action, payload) {
      if (action === 'navigate') {
        if (payload === 'WidgetForgeScreen') {
          store.dispatch('widgetDefinitions/setActiveDefinition', null);
        }
        emit('screen-change', payload);
      } else if (action === 'category-filter-changed' && payload) {
        activeCategory.value = payload.selectedCategory || 'all';
      } else if (action === 'select-widget' && payload) {
        if (payload._isCustom || payload._definition) {
          openEditor(payload);
        }
      } else if (action === 'import-widget') {
        showImportModal.value = true;
      }
    }

    return {
      searchQuery,
      sortOrder,
      activeCategory,
      showImportModal,
      importFile,
      importError,
      isDragOver,
      deleteTarget,
      currentLayout,
      setLayout,
      categoryTabs,
      filteredWidgets,
      formatSize,
      hasPreview,
      getPreviewHtml,
      createNewWidget,
      openEditor,
      duplicateWidget,
      exportWidget,
      confirmDelete,
      doDelete,
      handleFileSelect,
      handleFileDrop,
      closeImportModal,
      doImport,
      handlePanelAction,
    };
  },
};
</script>

<style scoped>
.wm-root {
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Local button styles (modals + import) ── */
.wm-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.5px;
}

.wm-btn:hover {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
}

.wm-btn-create {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-btn-create:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}

.wm-btn-danger {
  color: var(--color-red);
  border-color: rgba(var(--red-rgb), 0.2);
  background: rgba(var(--red-rgb), 0.04);
}

.wm-btn-danger:hover {
  background: rgba(var(--red-rgb), 0.1);
  border-color: rgba(var(--red-rgb), 0.3);
}

/* ── Category tabs ── */
.wm-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
  flex-shrink: 0;
  width: calc(100% - 32px);
  justify-content: center;
}

.wm-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
  font-family: inherit;
}

.wm-tab:hover {
  color: var(--color-text);
  border-color: var(--color-darker-1);
}

.wm-tab.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-tab i {
  font-size: 10px;
}

/* ── Content wrapper ── */
.wm-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.wm-main-content {
  flex: 1;
  min-height: 0;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  padding: 0 16px 16px;
}

.wm-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.wm-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.wm-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px !important;
}

/*
 * Grid with dense packing.
 * Row height = 72px. Non-preview cards = 1 row. Preview cards = 3 rows.
 * 3 rows + 2 gaps = 3×72 + 2×12 = 240px total for a preview card.
 * dense auto-flow lets non-preview cards backfill gaps beside preview cards.
 */
.wm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  grid-auto-rows: 72px;
  grid-auto-flow: dense;
  gap: 12px;
  width: 100%;
}

/* Preview cards span 3 rows */
.wm-card:has(.wm-card-preview) {
  grid-row: span 3;
}

/* Non-preview cards clamp to 1 row */
.wm-card:not(:has(.wm-card-preview)) {
  grid-row: span 1;
  overflow: hidden;
}

/* ── List View ── */
.wm-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}

.wm-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.15s;
}

.wm-list-row.wm-custom {
  cursor: pointer;
  border-left: 3px solid var(--color-green);
}

.wm-list-row:not(.wm-custom) {
  border-left: 3px solid var(--color-blue);
}

.wm-list-row:hover {
  background: rgba(var(--green-rgb), 0.06);
  border-color: rgba(var(--green-rgb), 0.2);
}

.wm-list-icon {
  font-size: 14px;
  color: var(--color-text-muted);
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.wm-list-row.wm-custom .wm-list-icon {
  color: var(--color-green);
}

.wm-list-name {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
  min-width: 140px;
}

.wm-list-desc {
  flex: 1;
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.wm-list-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.wm-list-type,
.wm-list-size {
  font-size: 9px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
  flex-shrink: 0;
  min-width: 50px;
  text-align: right;
}

.wm-list-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.wm-list-actions button {
  background: none;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 3px;
  transition: all 0.12s;
}

.wm-list-actions button:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.15);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-list-actions .wm-card-delete:hover {
  color: var(--color-red);
  border-color: rgba(var(--red-rgb), 0.15);
  background: rgba(var(--red-rgb), 0.04);
}

.wm-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.wm-card.wm-custom {
  cursor: pointer;
}

.wm-card:hover {
  border-color: rgba(var(--green-rgb), 0.25);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.wm-card:hover .wm-card-preview {
  border-bottom-color: rgba(var(--green-rgb), 0.15);
}

/* ── Preview area ── */
/* Total preview card = 3 small cards + 2 gaps = ~240px
 * Info (84px) + actions (37px) + borders (3px) = 124px overhead
 * Preview height = 240 - 124 = 116px */
.wm-card-preview {
  position: relative;
  width: 100%;
  height: 116px;
  overflow: hidden;
  background: #0c0c18;
  border-bottom: 1px solid var(--terminal-border-color);
}

.wm-card-preview-iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 500%;
  height: 500%;
  transform: scale(0.2);
  transform-origin: 0 0;
  border: none;
  pointer-events: none;
  display: block;
}

/* ── Info area ── */
.wm-card-info {
  padding: 10px 14px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wm-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wm-card-icon {
  font-size: 14px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.wm-card.wm-custom .wm-card-icon {
  color: var(--color-green);
}

.wm-card-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.wm-badge {
  font-size: 8px;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
}

.wm-badge-custom {
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
}

.wm-badge-builtin {
  background: rgba(100, 100, 200, 0.1);
  color: var(--color-text-muted);
}

.wm-badge-shared {
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-primary);
}

.wm-card-name {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.wm-card-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wm-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.wm-card-type,
.wm-card-size {
  font-size: 9px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
}

.wm-card-actions {
  display: flex;
  gap: 2px;
  padding: 6px 14px 10px;
  border-top: 1px solid var(--color-darker-1);
}

.wm-card-actions button {
  flex: 1;
  background: none;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px;
  border-radius: 3px;
  transition: all 0.12s;
}

.wm-card-actions button:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.15);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-card-delete:hover {
  color: var(--color-red) !important;
  border-color: rgba(var(--red-rgb), 0.15) !important;
  background: rgba(var(--red-rgb), 0.04) !important;
}

/* ── Empty state ── */
.wm-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  gap: 8px;
}

.wm-empty-icon {
  font-size: 32px;
  color: var(--color-text-muted);
  opacity: 0.3;
}
.wm-empty-text {
  font-size: 12px;
  color: var(--color-text-muted);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.wm-empty-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* ── Modal ── */
.wm-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wm-modal {
  background: var(--color-background);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 460px;
  max-width: 90vw;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}

.wm-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.wm-modal-title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
}

.wm-danger-title {
  color: var(--color-red);
}

.wm-modal-header button {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
}

.wm-modal-header button:hover {
  color: var(--color-red);
}

.wm-modal-body {
  padding: 16px;
}

.wm-modal-text {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.5;
}

.wm-modal-text strong {
  color: var(--color-text);
}

.wm-import-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  background: var(--color-darker-1);
  border: 2px dashed var(--terminal-border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.wm-import-dropzone:hover,
.wm-dropzone-active {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.03);
}

.wm-dropzone-has-file {
  border-style: solid;
  border-color: rgba(var(--green-rgb), 0.25);
}

.wm-dropzone-icon {
  font-size: 24px;
  color: var(--color-text-muted);
}

.wm-dropzone-icon-ready {
  color: var(--color-green);
}

.wm-dropzone-text {
  font-size: 12px;
  color: var(--color-text);
  letter-spacing: 0.5px;
}

.wm-dropzone-filename {
  font-size: 12px;
  color: var(--color-green);
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.5px;
}

.wm-dropzone-hint {
  font-size: 10px;
  color: var(--color-text-muted);
}

.wm-import-error {
  margin-top: 8px;
  margin-bottom: 0;
  font-size: 11px;
  color: var(--color-red);
}

.wm-modal-footer .wm-btn-create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.wm-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--terminal-border-color);
}
</style>
