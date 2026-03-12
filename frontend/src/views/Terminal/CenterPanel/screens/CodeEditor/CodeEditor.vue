<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="CodeEditorPanel"
    activeRightPanel="FileTreePanel"
    screenId="CodeEditorScreen"
    :showInput="false"
    @screen-change="(screenName) => $emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
  >
    <template #default>
      <div class="ce-root">
        <!-- Tab bar (full width) -->
        <div class="ce-tabs" v-if="openTabs.length > 0">
          <div
            v-for="tab in openTabs"
            :key="tab.path"
            class="ce-tab"
            :class="{ active: activeTabPath === tab.path }"
            @click="switchTab(tab.path)"
          >
            <span class="ce-tab-name">{{ tab.name }}{{ tab.isDirty ? ' *' : '' }}</span>
            <Tooltip text="Close">
              <button class="ce-tab-close" @click.stop="closeTab(tab.path)">
                <i class="fas fa-times"></i>
              </button>
            </Tooltip>
          </div>
        </div>

        <!-- Body: editor + divider + preview -->
        <div class="ce-body" ref="bodyRef" :class="{ 'is-resizing': isResizing }">
          <!-- Editor half -->
          <div class="ce-editor-half" :style="{ width: editorWidth + '%' }">
            <!-- Info bar -->
            <div class="ce-info" v-if="activeTab">
              <span class="ce-filepath">{{ activeTab.path }}</span>
              <button class="ce-save-btn" :disabled="!activeTab.isDirty || isSaving" @click="saveActiveFile">
                <i :class="isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'"></i>
                {{ isSaving ? 'Saving...' : 'Save' }}
              </button>
            </div>

            <!-- Editor -->
            <div class="ce-editor" v-if="activeTab">
              <Codemirror
                :key="activeTab.path"
                :model-value="activeTab.content"
                :style="{ height: '100%', width: '100%' }"
                :indent-with-tab="true"
                :tab-size="2"
                :extensions="editorExtensions"
                @update:model-value="handleEditorChange"
              />
            </div>

            <!-- Empty state -->
            <div class="ce-empty" v-else>
              <i class="fas fa-code"></i>
              <p>Open a file from the file tree or ask Annie to create one</p>
              <span class="ce-shortcut">Files are stored in ~/.agnt/projects/</span>
            </div>
          </div>

          <!-- Draggable divider -->
          <div
            class="ce-divider"
            :class="{ active: isResizing }"
            @mousedown="startResize"
          ></div>

          <!-- Preview half -->
          <div class="ce-preview-half">
            <div class="ce-preview-header">
              <span class="ce-preview-label">
                <i class="fas fa-eye"></i>
                Preview
              </span>
              <div class="ce-preview-actions">
                <Tooltip text="Refresh preview">
                  <button class="ce-preview-btn" @click="refreshPreview">
                    <i class="fas fa-sync-alt"></i>
                  </button>
                </Tooltip>
              </div>
            </div>
            <div class="ce-preview-content">
              <Tooltip v-if="isHtmlFile && activeTab" text="Preview">
                <iframe
                  ref="previewFrame"
                  class="ce-preview-iframe"
                  sandbox="allow-scripts allow-same-origin"
                ></iframe>
              </Tooltip>
              <div v-else-if="activeTab" class="ce-preview-empty">
                <i class="fas fa-eye-slash"></i>
                <p>No preview for .{{ activeTab.path.split('.').pop() }} files</p>
              </div>
              <div v-else class="ce-preview-empty">
                <i class="fas fa-eye"></i>
                <p>Open a file to see preview</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import BaseScreen from '../../BaseScreen.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { getFile, saveFile } from '@/services/fileSystemService.js';

const LANG_MAP = {
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  jsx: javascript,
  ts: javascript,
  tsx: javascript,
  json: javascript,
  py: python,
  html: html,
  htm: html,
  vue: html,
  xml: html,
  svg: html,
};

const HTML_PREVIEW_EXTS = new Set(['html', 'htm', 'svg']);

export default {
  name: 'CodeEditorScreen',
  components: { BaseScreen, Codemirror, Tooltip },
  emits: ['screen-change'],
  setup() {
    const baseScreenRef = ref(null);
    const bodyRef = ref(null);
    const previewFrame = ref(null);
    const openTabs = ref([]);
    const activeTabPath = ref(null);
    const isSaving = ref(false);
    const editorWidth = ref(50);
    const isResizing = ref(false);

    const activeTab = computed(() => openTabs.value.find((t) => t.path === activeTabPath.value) || null);

    const isHtmlFile = computed(() => {
      if (!activeTab.value) return false;
      const ext = activeTab.value.path.split('.').pop()?.toLowerCase();
      return HTML_PREVIEW_EXTS.has(ext);
    });

    const getLanguageExt = (filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase();
      return LANG_MAP[ext] || null;
    };

    const editorExtensions = computed(() => {
      if (!activeTab.value) return [oneDark];
      const langFn = getLanguageExt(activeTab.value.path);
      return langFn ? [langFn(), oneDark] : [oneDark];
    });

    // ── Preview ──────────────────────────────────────────────
    const updatePreview = () => {
      if (!previewFrame.value || !activeTab.value || !isHtmlFile.value) return;
      previewFrame.value.srcdoc = activeTab.value.content;
    };

    const refreshPreview = () => updatePreview();

    let previewTimer = null;
    const schedulePreviewUpdate = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 400);
    };

    watch(activeTabPath, () => nextTick(updatePreview));

    // ── Resize ───────────────────────────────────────────────
    let resizeStartX = 0;
    let resizeStartWidth = 0;

    const startResize = (e) => {
      isResizing.value = true;
      resizeStartX = e.clientX;
      resizeStartWidth = editorWidth.value;
      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', stopResize);
    };

    const onResize = (e) => {
      if (!bodyRef.value) return;
      const containerWidth = bodyRef.value.getBoundingClientRect().width;
      const delta = ((e.clientX - resizeStartX) / containerWidth) * 100;
      editorWidth.value = Math.max(20, Math.min(80, resizeStartWidth + delta));
    };

    const stopResize = () => {
      isResizing.value = false;
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
    };

    // ── File operations ───────────────────────────────────────
    const broadcastOpenFile = (tab) => {
      window.dispatchEvent(
        new CustomEvent('code-editor-open-file', {
          detail: { path: tab.path, content: tab.content },
        })
      );
    };

    const openFile = async (filePath) => {
      const existing = openTabs.value.find((t) => t.path === filePath);
      if (existing) {
        activeTabPath.value = filePath;
        broadcastOpenFile(existing);
        return;
      }

      try {
        const data = await getFile(filePath);
        const name = filePath.split('/').pop();
        const tab = {
          path: filePath,
          name,
          content: data.content,
          savedContent: data.content,
          isDirty: false,
        };
        openTabs.value.push(tab);
        activeTabPath.value = filePath;
        broadcastOpenFile(tab);
      } catch (err) {
        console.error('Error opening file:', err);
      }
    };

    const switchTab = (path) => {
      activeTabPath.value = path;
      const tab = openTabs.value.find((t) => t.path === path);
      if (tab) broadcastOpenFile(tab);
    };

    const closeTab = (path) => {
      const idx = openTabs.value.findIndex((t) => t.path === path);
      if (idx === -1) return;
      openTabs.value.splice(idx, 1);

      if (activeTabPath.value === path) {
        if (openTabs.value.length > 0) {
          const newIdx = Math.min(idx, openTabs.value.length - 1);
          activeTabPath.value = openTabs.value[newIdx].path;
          broadcastOpenFile(openTabs.value[newIdx]);
        } else {
          activeTabPath.value = null;
          broadcastOpenFile({ path: null, content: null });
        }
      }
    };

    const handleEditorChange = (value) => {
      if (activeTab.value) {
        activeTab.value.content = value;
        activeTab.value.isDirty = value !== activeTab.value.savedContent;
        schedulePreviewUpdate();
      }
    };

    const saveActiveFile = async () => {
      if (!activeTab.value || !activeTab.value.isDirty) return;
      isSaving.value = true;
      try {
        await saveFile(activeTab.value.path, activeTab.value.content);
        activeTab.value.savedContent = activeTab.value.content;
        activeTab.value.isDirty = false;
      } catch (err) {
        console.error('Error saving file:', err);
      } finally {
        isSaving.value = false;
      }
    };

    const handlePanelAction = (action, data) => {
      if (action === 'open-file' && data?.path) {
        openFile(data.path);
      } else if (action === 'file-renamed' && data?.oldPath && data?.newPath) {
        const tab = openTabs.value.find((t) => t.path === data.oldPath);
        if (tab) {
          tab.path = data.newPath;
          tab.name = data.newPath.split('/').pop();
          if (activeTabPath.value === data.oldPath) {
            activeTabPath.value = data.newPath;
          }
        }
      } else if (action === 'file-deleted' && data?.path) {
        // Close the deleted file's tab if open
        const idx = openTabs.value.findIndex((t) => t.path === data.path);
        if (idx !== -1) {
          closeTab(data.path);
        }
        // Also close any tabs inside a deleted directory
        if (data.type === 'directory') {
          const prefix = data.path + '/';
          const toClose = openTabs.value.filter((t) => t.path.startsWith(prefix)).map((t) => t.path);
          toClose.forEach((p) => closeTab(p));
        }
      }
    };

    // Keyboard shortcut: Ctrl+S
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    };

    // Listen for file_written events from Annie chat
    const handleFileWritten = (e) => {
      const { path, content } = e.detail;
      const existingTab = openTabs.value.find((t) => t.path === path);
      if (existingTab) {
        existingTab.content = content;
        existingTab.savedContent = content;
        existingTab.isDirty = false;
        if (activeTabPath.value === path) schedulePreviewUpdate();
      } else {
        const name = path.split('/').pop();
        openTabs.value.push({ path, name, content, savedContent: content, isDirty: false });
        activeTabPath.value = path;
        broadcastOpenFile({ path, content });
      }
    };

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('code-file-written', handleFileWritten);
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('code-file-written', handleFileWritten);
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
      clearTimeout(previewTimer);
    });

    return {
      baseScreenRef,
      bodyRef,
      previewFrame,
      openTabs,
      activeTabPath,
      activeTab,
      isSaving,
      editorWidth,
      isResizing,
      isHtmlFile,
      editorExtensions,
      switchTab,
      closeTab,
      handleEditorChange,
      saveActiveFile,
      handlePanelAction,
      startResize,
      refreshPreview,
    };
  },
};
</script>

<style scoped>
.ce-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-background);
}

/* ── Tab bar ── */
.ce-tabs {
  display: flex;
  gap: 0;
  background: var(--color-darker-0);
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}

.ce-tabs::-webkit-scrollbar {
  display: none;
}

.ce-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  border-right: 1px solid var(--terminal-border-color);
  white-space: nowrap;
  transition: all 0.12s;
  user-select: none;
}

.ce-tab:hover {
  background: rgba(var(--primary-rgb), 0.04);
  color: var(--color-text);
}

.ce-tab.active {
  background: var(--color-background);
  color: var(--color-primary);
  border-bottom: 1px solid var(--color-primary);
  margin-bottom: -1px;
}

.ce-tab-name {
  font-family: inherit;
}

.ce-tab-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 10px;
  padding: 2px;
  opacity: 0.4;
  transition: opacity 0.12s;
  line-height: 1;
}

.ce-tab-close:hover {
  opacity: 1;
  color: var(--color-red);
}

/* ── Body (editor + divider + preview) ── */
.ce-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}

.ce-body.is-resizing {
  user-select: none;
}

.ce-body.is-resizing .ce-preview-iframe {
  pointer-events: none;
}

/* ── Editor half ── */
.ce-editor-half {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  flex-shrink: 0;
}

/* ── Info bar ── */
.ce-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  flex-shrink: 0;
}

.ce-filepath {
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ce-save-btn {
  padding: 3px 10px;
  border-radius: 3px;
  border: 1px solid var(--terminal-border-color);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s;
  white-space: nowrap;
}

.ce-save-btn:hover:not(:disabled) {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}

.ce-save-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ── Editor ── */
.ce-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Empty state ── */
.ce-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
}

.ce-empty i {
  font-size: 3em;
  opacity: 0.3;
  color: var(--color-primary);
}

.ce-empty p {
  font-size: 14px;
  color: var(--color-text-muted);
}

.ce-shortcut {
  font-size: 11px;
  opacity: 0.5;
  font-family: var(--font-family-mono);
}

/* ── Divider ── */
.ce-divider {
  width: 5px;
  flex-shrink: 0;
  background: var(--terminal-border-color);
  cursor: col-resize;
  transition: background 0.15s;
  position: relative;
}

.ce-divider:hover,
.ce-divider.active {
  background: var(--color-primary);
}

/* ── Preview half ── */
.ce-preview-half {
  flex: 1 1 0%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 0;
  overflow: hidden;
}

.ce-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--color-darker-0);
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
}

.ce-preview-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ce-preview-actions {
  display: flex;
  gap: 6px;
}

.ce-preview-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.12s;
}

.ce-preview-btn:hover {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.ce-preview-content {
  flex: 1 1 0%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ce-preview-iframe {
  flex: 1 1 0%;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.ce-preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--color-darker-1);
  color: var(--color-text-muted);
}

.ce-preview-empty i {
  font-size: 2.5em;
  opacity: 0.25;
  color: var(--color-primary);
}

.ce-preview-empty p {
  font-size: 12px;
  opacity: 0.6;
}
</style>

<style>
/* CodeMirror overrides for the code editor screen */
.ce-editor .cm-editor {
  height: 100% !important;
  background: var(--color-darker-1) !important;
}

.ce-editor .cm-scroller {
  overflow: auto;
}
</style>
