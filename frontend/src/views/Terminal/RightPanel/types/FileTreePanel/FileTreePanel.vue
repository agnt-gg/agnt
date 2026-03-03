<template>
  <div class="file-tree-panel">
    <div class="panel-header">
      <h2 class="title" @click="setActiveDir('')" :class="{ clickable: activeDir }">
        <span v-if="activeDir" class="title-back"><i class="fas fa-chevron-left"></i></span>
        / {{ activeDir || 'Projects' }}
      </h2>
      <div class="right-tabs">
        <Tooltip :text="activeDir ? `New File in ${activeDir}` : 'New File'" width="auto" position="bottom">
          <button class="tab-button new-file-btn" @click="showNewFileInput(activeDir)">
            <i class="fas fa-plus"></i>
            <i class="fas fa-file"></i>
          </button>
        </Tooltip>
        <Tooltip :text="activeDir ? `New Folder in ${activeDir}` : 'New Folder'" width="auto" position="bottom">
          <button class="tab-button" @click="showNewFolderInput(activeDir)">
            <i class="fas fa-plus"></i>
            <i class="fas fa-folder"></i>
          </button>
        </Tooltip>
        <Tooltip text="Refresh" width="auto" position="bottom">
          <button class="tab-button" @click="refreshTree">
            <i class="fas fa-sync-alt"></i>
          </button>
        </Tooltip>
        <Tooltip text="Workspace Settings" width="auto" position="bottom">
          <button class="tab-button" @click="openSettings">
            <i class="fas fa-cog"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- New item input -->
    <div v-if="newItemInput.show" class="new-item-input">
      <span v-if="newItemInput.parentDir" class="new-item-prefix">{{ newItemInput.parentDir }}/</span>
      <input
        ref="newItemInputRef"
        v-model="newItemInput.name"
        :placeholder="newItemInput.type === 'file' ? 'filename.ext' : 'folder-name'"
        @keyup.enter="createNewItem"
        @keyup.escape="cancelNewItem"
        class="item-name-input"
      />
      <button class="item-create-btn" @click="createNewItem"><i class="fas fa-check"></i></button>
      <button class="item-cancel-btn" @click="cancelNewItem"><i class="fas fa-times"></i></button>
    </div>

    <div class="tree-content" v-if="!loading">
      <div v-if="treeItems.length === 0" class="empty-state">
        <i class="fas fa-folder-open"></i>
        <p>No files yet. Create a file or ask Annie to generate code!</p>
      </div>

      <TreeNode
        v-for="item in treeItems"
        :key="item.path"
        :item="item"
        :expanded-dirs="expandedDirs"
        :children-map="childrenMap"
        :active-dir="activeDir"
        @toggle-dir="handleDirClick"
        @select-file="handleFileClick"
        @rename-item="renameItem"
        @delete-item="deleteItem"
        @move-item="moveItem"
        @new-file-in-dir="showNewFileInput"
        @new-folder-in-dir="showNewFolderInput"
      />
    </div>
    <div v-else class="loading-state">
      <i class="fas fa-spinner fa-spin"></i>
      <span>Loading files...</span>
    </div>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div v-if="deleteConfirm.show" class="delete-overlay" @click.self="cancelDelete">
        <div class="delete-dialog">
          <p>Delete <strong>{{ deleteConfirm.name }}</strong>?</p>
          <p class="delete-warning" v-if="deleteConfirm.type === 'directory'">This will delete the folder and all its contents.</p>
          <div class="delete-actions">
            <button class="delete-cancel-btn" @click="cancelDelete">Cancel</button>
            <button class="delete-confirm-btn" @click="confirmDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Settings dialog -->
    <Teleport to="body">
      <div v-if="settingsDialog.show" class="delete-overlay" @click.self="cancelSettings">
        <div class="settings-dialog">
          <h3 class="settings-title"><i class="fas fa-cog"></i> Workspace Settings</h3>
          <label class="settings-label">Root Directory</label>
          <input
            ref="settingsInputRef"
            v-model="settingsDialog.workspaceRoot"
            class="settings-input"
            placeholder="/path/to/workspace"
            @keyup.enter="saveSettings"
            @keyup.escape="cancelSettings"
          />
          <p class="settings-hint">Default: {{ settingsDialog.defaultRoot }}</p>
          <div v-if="settingsDialog.error" class="settings-error">{{ settingsDialog.error }}</div>
          <div class="delete-actions">
            <button class="delete-cancel-btn" @click="resetToDefault">Reset Default</button>
            <button class="delete-cancel-btn" @click="cancelSettings">Cancel</button>
            <button class="settings-save-btn" @click="saveSettings" :disabled="settingsDialog.saving">
              {{ settingsDialog.saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { getTree, saveFile, createDirectory, deleteFile, renameFile, getSettings, updateSettings } from '@/services/fileSystemService.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import TreeNode from './TreeNode.vue';

export default {
  name: 'FileTreePanel',
  components: { Tooltip, TreeNode },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const treeItems = ref([]);
    const loading = ref(true);
    const expandedDirs = reactive({});
    const childrenMap = reactive({});
    const newItemInputRef = ref(null);
    const settingsInputRef = ref(null);
    const activeDir = ref('');

    const newItemInput = reactive({
      show: false,
      type: 'file',
      name: '',
      parentDir: '',
    });

    const deleteConfirm = reactive({
      show: false,
      path: '',
      name: '',
      type: '',
    });

    const settingsDialog = reactive({
      show: false,
      workspaceRoot: '',
      defaultRoot: '',
      error: '',
      saving: false,
    });

    const fetchRootTree = async () => {
      loading.value = true;
      try {
        const data = await getTree('');
        treeItems.value = data.items;
      } catch (err) {
        console.error('Error fetching file tree:', err);
        treeItems.value = [];
      } finally {
        loading.value = false;
      }
    };

    const refreshDirAndAncestors = async (dirPath) => {
      // Refresh the specific directory's children
      if (dirPath && childrenMap[dirPath]) {
        try {
          const data = await getTree(dirPath);
          childrenMap[dirPath] = data.items;
        } catch (err) {
          console.error('Error refreshing directory:', err);
        }
      }
      // Always refresh root too
      try {
        const data = await getTree('');
        treeItems.value = data.items;
      } catch (err) {
        console.error('Error refreshing root tree:', err);
      }
    };

    const toggleDir = async (dirPath) => {
      if (expandedDirs[dirPath]) {
        delete expandedDirs[dirPath];
        return;
      }

      expandedDirs[dirPath] = true;

      if (!childrenMap[dirPath]) {
        try {
          const data = await getTree(dirPath);
          childrenMap[dirPath] = data.items;
        } catch (err) {
          console.error('Error fetching directory:', err);
          childrenMap[dirPath] = [];
        }
      }
    };

    const selectFile = (filePath) => {
      emit('panel-action', 'open-file', { path: filePath });
    };

    const setActiveDir = (dir) => {
      activeDir.value = dir;
    };

    const handleDirClick = (dirPath) => {
      activeDir.value = dirPath;
      toggleDir(dirPath);
    };

    const handleFileClick = (filePath) => {
      // Set active dir to file's parent folder
      const parent = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
      activeDir.value = parent;
      selectFile(filePath);
    };

    // ── New File / Folder ──
    const showNewFileInput = (parentDir) => {
      newItemInput.show = true;
      newItemInput.type = 'file';
      newItemInput.name = '';
      newItemInput.parentDir = parentDir || '';
      nextTick(() => newItemInputRef.value?.focus());
    };

    const showNewFolderInput = (parentDir) => {
      newItemInput.show = true;
      newItemInput.type = 'folder';
      newItemInput.name = '';
      newItemInput.parentDir = parentDir || '';
      nextTick(() => newItemInputRef.value?.focus());
    };

    const createNewItem = async () => {
      if (!newItemInput.name.trim()) return;

      const fullPath = newItemInput.parentDir
        ? `${newItemInput.parentDir}/${newItemInput.name.trim()}`
        : newItemInput.name.trim();

      try {
        if (newItemInput.type === 'file') {
          await saveFile(fullPath, '');
          emit('panel-action', 'open-file', { path: fullPath });
        } else {
          await createDirectory(fullPath);
        }
        const parentDir = newItemInput.parentDir;
        cancelNewItem();
        await refreshDirAndAncestors(parentDir);
      } catch (err) {
        console.error('Error creating item:', err);
      }
    };

    const cancelNewItem = () => {
      newItemInput.show = false;
      newItemInput.name = '';
      newItemInput.parentDir = '';
    };

    // ── Rename ──
    const renameItem = async ({ oldPath, newPath }) => {
      try {
        await renameFile(oldPath, newPath);
        emit('panel-action', 'file-renamed', { oldPath, newPath });

        // Refresh affected directories
        const oldParent = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
        const newParent = newPath.includes('/') ? newPath.substring(0, newPath.lastIndexOf('/')) : '';

        // Clear cached children for affected dirs
        if (oldParent && childrenMap[oldParent]) delete childrenMap[oldParent];
        if (newParent && childrenMap[newParent]) delete childrenMap[newParent];

        await refreshDirAndAncestors(oldParent);
        if (newParent !== oldParent) await refreshDirAndAncestors(newParent);

        // Re-fetch expanded dirs that were cleared
        for (const dirPath of Object.keys(expandedDirs)) {
          if (!childrenMap[dirPath]) {
            try {
              const data = await getTree(dirPath);
              childrenMap[dirPath] = data.items;
            } catch { /* dir may no longer exist */ }
          }
        }
      } catch (err) {
        console.error('Error renaming item:', err);
      }
    };

    // ── Delete ──
    const deleteItem = ({ path, name, type }) => {
      deleteConfirm.show = true;
      deleteConfirm.path = path;
      deleteConfirm.name = name;
      deleteConfirm.type = type;
    };

    const confirmDelete = async () => {
      const { path, type } = deleteConfirm;
      cancelDelete();
      try {
        await deleteFile(path);
        emit('panel-action', 'file-deleted', { path, type });

        const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
        if (parentDir && childrenMap[parentDir]) delete childrenMap[parentDir];

        await refreshDirAndAncestors(parentDir);

        // Re-fetch expanded dirs
        for (const dirPath of Object.keys(expandedDirs)) {
          if (!childrenMap[dirPath]) {
            try {
              const data = await getTree(dirPath);
              childrenMap[dirPath] = data.items;
            } catch {
              // Dir was deleted, collapse it
              delete expandedDirs[dirPath];
            }
          }
        }
      } catch (err) {
        console.error('Error deleting item:', err);
      }
    };

    const cancelDelete = () => {
      deleteConfirm.show = false;
      deleteConfirm.path = '';
      deleteConfirm.name = '';
      deleteConfirm.type = '';
    };

    // ── Move (drag & drop) ──
    const moveItem = async ({ sourcePath, targetDir }) => {
      const fileName = sourcePath.split('/').pop();
      const newPath = `${targetDir}/${fileName}`;

      try {
        await renameFile(sourcePath, newPath);
        emit('panel-action', 'file-renamed', { oldPath: sourcePath, newPath });

        const oldParent = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';

        // Clear cached children
        if (oldParent && childrenMap[oldParent]) delete childrenMap[oldParent];
        if (childrenMap[targetDir]) delete childrenMap[targetDir];

        // Expand target folder so user sees the moved item
        expandedDirs[targetDir] = true;

        await refreshDirAndAncestors(oldParent);
        await refreshDirAndAncestors(targetDir);

        // Fetch children for the target dir (now expanded)
        try {
          const data = await getTree(targetDir);
          childrenMap[targetDir] = data.items;
        } catch { /* ignore */ }

        // Re-fetch other expanded dirs
        for (const dirPath of Object.keys(expandedDirs)) {
          if (dirPath !== targetDir && !childrenMap[dirPath]) {
            try {
              const data = await getTree(dirPath);
              childrenMap[dirPath] = data.items;
            } catch { /* dir may no longer exist */ }
          }
        }
      } catch (err) {
        console.error('Error moving item:', err);
      }
    };

    // ── Settings ──
    const openSettings = async () => {
      try {
        const data = await getSettings();
        settingsDialog.workspaceRoot = data.workspaceRoot;
        settingsDialog.defaultRoot = data.defaultRoot;
      } catch {
        settingsDialog.workspaceRoot = '';
        settingsDialog.defaultRoot = '';
      }
      settingsDialog.error = '';
      settingsDialog.saving = false;
      settingsDialog.show = true;
      nextTick(() => settingsInputRef.value?.focus());
    };

    const saveSettings = async () => {
      if (!settingsDialog.workspaceRoot.trim()) {
        settingsDialog.error = 'Path cannot be empty';
        return;
      }
      settingsDialog.saving = true;
      settingsDialog.error = '';
      try {
        await updateSettings(settingsDialog.workspaceRoot.trim());
        settingsDialog.show = false;
        // Clear tree cache and reload from new root
        Object.keys(childrenMap).forEach((key) => delete childrenMap[key]);
        Object.keys(expandedDirs).forEach((key) => delete expandedDirs[key]);
        await fetchRootTree();
      } catch (err) {
        settingsDialog.error = err.message || 'Failed to save settings';
      } finally {
        settingsDialog.saving = false;
      }
    };

    const resetToDefault = async () => {
      settingsDialog.workspaceRoot = settingsDialog.defaultRoot;
    };

    const cancelSettings = () => {
      settingsDialog.show = false;
      settingsDialog.error = '';
    };

    const refreshTree = async () => {
      Object.keys(childrenMap).forEach((key) => delete childrenMap[key]);
      await fetchRootTree();
    };

    const handleFileWritten = () => {
      refreshTree();
    };

    onMounted(() => {
      fetchRootTree();
      window.addEventListener('code-file-written', handleFileWritten);
    });

    onUnmounted(() => {
      window.removeEventListener('code-file-written', handleFileWritten);
    });

    return {
      treeItems,
      loading,
      expandedDirs,
      childrenMap,
      activeDir,
      newItemInput,
      newItemInputRef,
      settingsInputRef,
      deleteConfirm,
      settingsDialog,
      toggleDir,
      selectFile,
      setActiveDir,
      handleDirClick,
      handleFileClick,
      showNewFileInput,
      showNewFolderInput,
      createNewItem,
      cancelNewItem,
      renameItem,
      deleteItem,
      confirmDelete,
      cancelDelete,
      moveItem,
      openSettings,
      saveSettings,
      resetToDefault,
      cancelSettings,
      refreshTree,
    };
  },
};
</script>

<style scoped>
.file-tree-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  gap: 12px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.panel-header .title.clickable {
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.panel-header .title.clickable:hover {
  opacity: 1;
}

.title-back {
  font-size: 11px;
  margin-right: 4px;
  opacity: 0.6;
}

.right-tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tab-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  opacity: 0.5;
  transition: opacity 0.3s ease;
  color: var(--color-primary);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.tab-button .fa-plus {
  font-size: 8px;
}

.tab-button:hover {
  opacity: 1;
}

.new-item-input {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 0 4px;
}

.new-item-prefix {
  font-size: 11px;
  color: var(--color-text-muted);
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.item-name-input {
  flex: 1;
  padding: 5px 8px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.item-name-input:focus {
  border-color: rgba(var(--primary-rgb), 0.4);
}

.item-create-btn,
.item-cancel-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 4px;
}

.item-create-btn:hover {
  color: var(--color-primary);
}

.item-cancel-btn:hover {
  color: var(--color-red);
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
}

.tree-content::-webkit-scrollbar {
  display: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-grey);
  gap: 12px;
  text-align: center;
}

.empty-state i {
  font-size: 2em;
  opacity: 0.5;
  color: var(--color-primary);
}

.empty-state p {
  color: var(--color-text-muted);
  max-width: 250px;
  line-height: 1.4;
  font-size: 12px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

/* Delete confirmation dialog */
.delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-dialog {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 280px;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.delete-dialog p {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--color-text);
}

.delete-warning {
  color: var(--color-text-muted) !important;
  font-size: 12px !important;
}

.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.delete-cancel-btn,
.delete-confirm-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}

.delete-cancel-btn {
  background: none;
  color: var(--color-text-muted);
}

.delete-cancel-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.delete-confirm-btn {
  background: rgba(255, 80, 80, 0.15);
  color: var(--color-red);
  border-color: rgba(255, 80, 80, 0.3);
}

.delete-confirm-btn:hover {
  background: rgba(255, 80, 80, 0.25);
}

/* Settings dialog */
.settings-dialog {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.settings-title {
  margin: 0 0 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-title i {
  font-size: 13px;
}

.settings-label {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.settings-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 12px;
  font-family: var(--font-family-mono, monospace);
  outline: none;
  box-sizing: border-box;
}

.settings-input:focus {
  border-color: rgba(var(--primary-rgb), 0.4);
}

.settings-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
  opacity: 0.6;
}

.settings-error {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-red);
}

.settings-save-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}

.settings-save-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.25);
}

.settings-save-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
