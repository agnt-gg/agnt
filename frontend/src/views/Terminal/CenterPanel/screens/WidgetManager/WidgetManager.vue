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
        <div class="wm-header">
          <div class="wm-header-left">
            <span class="wm-title">WIDGET MANAGER</span>
            <span class="wm-count">{{ filteredWidgets.length }} widgets</span>
          </div>
          <div class="wm-header-right">
            <input v-model="searchQuery" type="text" class="wm-search-input" placeholder="Search widgets..." />
            <button class="wm-btn wm-btn-import" @click="showImportModal = true" title="Import widget">
              <i class="fas fa-file-import"></i>
              <span>Import</span>
            </button>
            <button class="wm-btn wm-btn-create" @click="createNewWidget" title="Create new widget">
              <i class="fas fa-plus"></i>
              <span>New Widget</span>
            </button>
          </div>
        </div>

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
        <div class="wm-body">
          <div class="wm-grid">
            <!-- Built-in widgets -->
            <div
              v-for="widget in filteredWidgets"
              :key="widget.id"
              class="wm-card"
              :class="{ 'wm-custom': widget._isCustom }"
              @click="widget._isCustom ? openEditor(widget) : null"
            >
              <div class="wm-card-header">
                <div class="wm-card-icon"><i :class="widget.icon"></i></div>
                <div class="wm-card-badges">
                  <span v-if="widget._isCustom" class="wm-badge wm-badge-custom">CUSTOM</span>
                  <span v-else class="wm-badge wm-badge-builtin">BUILT-IN</span>
                  <span v-if="widget.is_shared" class="wm-badge wm-badge-shared">SHARED</span>
                </div>
              </div>
              <div class="wm-card-name">{{ widget.name }}</div>
              <div class="wm-card-desc">{{ widget.description }}</div>
              <div class="wm-card-meta">
                <span class="wm-card-type">{{ widget.widget_type || widget.category }}</span>
                <span class="wm-card-size">{{ formatSize(widget) }}</span>
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
                  <input
                    ref="fileInput"
                    type="file"
                    accept=".json,.agnt-widget.json"
                    style="display: none"
                    @change="handleFileSelect"
                  />
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

export default {
  name: 'WidgetManagerScreen',
  components: { BaseScreen },
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

    function formatSize(widget) {
      const size = widget.defaultSize || widget.default_size;
      if (!size) return '';
      return `${size.cols}×${size.rows}`;
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
      activeCategory,
      showImportModal,
      importFile,
      importError,
      isDragOver,
      deleteTarget,
      categoryTabs,
      filteredWidgets,
      formatSize,
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
  align-items: center;
  gap: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Header ── */
.wm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  width: 100%;
}

.wm-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wm-title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
}

.wm-count {
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 1px 6px;
  background: var(--color-darker-0);
  border-radius: 3px;
}

.wm-header-right {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.wm-search-input {
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
  font-family: inherit;
  outline: none;
  width: 200px;
}

.wm-search-input:focus {
  border-color: var(--color-green);
}

.wm-search-input::placeholder {
  color: var(--color-text-muted);
}

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

/* ── Body / Grid ── */
.wm-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
  width: 100%;
  max-width: 1048px;
}

.wm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.wm-card {
  padding: 14px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-blue);
  border-radius: 6px;
  transition: all 0.2s ease;
  position: relative;
}

.wm-card.wm-custom {
  border-left: 3px solid var(--color-green);
  cursor: pointer;
}

.wm-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.wm-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.wm-card-icon {
  font-size: 18px;
  color: var(--color-text-muted);
}

.wm-card.wm-custom .wm-card-icon {
  color: var(--color-primary);
}

.wm-card-badges {
  display: flex;
  gap: 4px;
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
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text);
  font-weight: 600;
  margin-bottom: 4px;
}

.wm-card-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
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
  margin-top: 8px;
  padding-top: 8px;
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
