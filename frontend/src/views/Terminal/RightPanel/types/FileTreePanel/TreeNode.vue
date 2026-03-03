<template>
  <div class="tree-node">
    <div
      class="tree-item"
      :class="{
        'is-dir': item.type === 'directory',
        'drag-over': isDragOver,
      }"
      draggable="true"
      @click="handleClick"
      @contextmenu.prevent="showContextMenu"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <i v-if="item.type === 'directory'" :class="isExpanded ? 'fas fa-folder-open' : 'fas fa-folder'" class="item-icon dir-icon"></i>
      <i v-else :class="fileIcon" class="item-icon file-icon"></i>

      <!-- Inline rename input -->
      <input
        v-if="isRenaming"
        ref="renameInputRef"
        v-model="renameValue"
        class="rename-input"
        @keyup.enter="commitRename"
        @keyup.escape="cancelRename"
        @blur="commitRename"
        @click.stop
      />
      <span v-else class="item-name">{{ item.name }}</span>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        class="tree-context-menu"
        :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
      >
        <div class="ctx-item" @click="startRename"><i class="fas fa-pen"></i> Rename</div>
        <div class="ctx-item ctx-danger" @click="requestDelete"><i class="fas fa-trash"></i> Delete</div>
        <template v-if="item.type === 'directory'">
          <div class="ctx-divider"></div>
          <div class="ctx-item" @click="newFileInDir"><i class="fas fa-file"></i> New File</div>
          <div class="ctx-item" @click="newFolderInDir"><i class="fas fa-folder"></i> New Folder</div>
        </template>
      </div>
    </Teleport>

    <!-- Recursive children for expanded directories -->
    <div v-if="item.type === 'directory' && isExpanded" class="tree-children">
      <div v-if="!children || children.length === 0" class="empty-dir">
        <span>Empty</span>
      </div>
      <TreeNode
        v-for="child in children"
        :key="child.path"
        :item="child"
        :expanded-dirs="expandedDirs"
        :children-map="childrenMap"
        @toggle-dir="$emit('toggle-dir', $event)"
        @select-file="$emit('select-file', $event)"
        @rename-item="$emit('rename-item', $event)"
        @delete-item="$emit('delete-item', $event)"
        @move-item="$emit('move-item', $event)"
        @new-file-in-dir="$emit('new-file-in-dir', $event)"
        @new-folder-in-dir="$emit('new-folder-in-dir', $event)"
      />
    </div>
  </div>
</template>

<script>
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';

const EXTENSION_ICONS = {
  js: 'fab fa-js-square',
  jsx: 'fab fa-react',
  ts: 'fab fa-js-square',
  tsx: 'fab fa-react',
  py: 'fab fa-python',
  html: 'fab fa-html5',
  css: 'fab fa-css3-alt',
  json: 'fas fa-brackets-curly',
  md: 'fas fa-file-alt',
  vue: 'fab fa-vuejs',
  svg: 'fas fa-image',
  png: 'fas fa-image',
  jpg: 'fas fa-image',
  gif: 'fas fa-image',
  sh: 'fas fa-terminal',
  yml: 'fas fa-file-code',
  yaml: 'fas fa-file-code',
  env: 'fas fa-lock',
  txt: 'fas fa-file-alt',
};

export default {
  name: 'TreeNode',
  props: {
    item: { type: Object, required: true },
    expandedDirs: { type: Object, required: true },
    childrenMap: { type: Object, required: true },
  },
  emits: ['toggle-dir', 'select-file', 'rename-item', 'delete-item', 'move-item', 'new-file-in-dir', 'new-folder-in-dir'],
  setup(props, { emit }) {
    const isExpanded = computed(() => !!props.expandedDirs[props.item.path]);
    const children = computed(() => props.childrenMap[props.item.path] || []);
    const fileIcon = computed(() => {
      const ext = props.item.name.split('.').pop()?.toLowerCase();
      return EXTENSION_ICONS[ext] || 'fas fa-file';
    });

    // ── Context Menu ──
    const contextMenuVisible = ref(false);
    const contextMenuX = ref(0);
    const contextMenuY = ref(0);

    const showContextMenu = (e) => {
      contextMenuX.value = e.clientX;
      contextMenuY.value = e.clientY;
      contextMenuVisible.value = true;
    };

    const hideContextMenu = () => {
      contextMenuVisible.value = false;
    };

    const onDocumentClick = () => hideContextMenu();
    onMounted(() => document.addEventListener('click', onDocumentClick));
    onUnmounted(() => document.removeEventListener('click', onDocumentClick));

    // ── Inline Rename ──
    const isRenaming = ref(false);
    const renameValue = ref('');
    const renameInputRef = ref(null);

    const startRename = () => {
      hideContextMenu();
      renameValue.value = props.item.name;
      isRenaming.value = true;
      nextTick(() => {
        const input = renameInputRef.value;
        if (input) {
          input.focus();
          // Select name without extension for files
          if (props.item.type !== 'directory') {
            const dotIdx = renameValue.value.lastIndexOf('.');
            input.setSelectionRange(0, dotIdx > 0 ? dotIdx : renameValue.value.length);
          } else {
            input.select();
          }
        }
      });
    };

    const commitRename = () => {
      if (!isRenaming.value) return;
      const newName = renameValue.value.trim();
      isRenaming.value = false;
      if (!newName || newName === props.item.name) return;

      const parentDir = props.item.path.includes('/')
        ? props.item.path.substring(0, props.item.path.lastIndexOf('/'))
        : '';
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;

      emit('rename-item', { oldPath: props.item.path, newPath });
    };

    const cancelRename = () => {
      isRenaming.value = false;
    };

    // ── Delete ──
    const requestDelete = () => {
      hideContextMenu();
      emit('delete-item', { path: props.item.path, name: props.item.name, type: props.item.type });
    };

    // ── New File/Folder in Directory ──
    const newFileInDir = () => {
      hideContextMenu();
      emit('new-file-in-dir', props.item.path);
    };

    const newFolderInDir = () => {
      hideContextMenu();
      emit('new-folder-in-dir', props.item.path);
    };

    // ── Drag & Drop ──
    const isDragOver = ref(false);

    const onDragStart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', props.item.path);
    };

    const onDragOver = (e) => {
      if (props.item.type !== 'directory') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      isDragOver.value = true;
    };

    const onDragLeave = () => {
      isDragOver.value = false;
    };

    const onDrop = (e) => {
      isDragOver.value = false;
      if (props.item.type !== 'directory') return;
      e.preventDefault();
      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath || sourcePath === props.item.path) return;
      // Don't allow dropping a folder into itself
      if (props.item.path.startsWith(sourcePath + '/')) return;
      emit('move-item', { sourcePath, targetDir: props.item.path });
    };

    // ── Click ──
    const handleClick = () => {
      if (isRenaming.value) return;
      if (props.item.type === 'directory') {
        emit('toggle-dir', props.item.path);
      } else {
        emit('select-file', props.item.path);
      }
    };

    return {
      isExpanded,
      children,
      fileIcon,
      handleClick,
      // Context menu
      contextMenuVisible,
      contextMenuX,
      contextMenuY,
      showContextMenu,
      // Rename
      isRenaming,
      renameValue,
      renameInputRef,
      startRename,
      commitRename,
      cancelRename,
      // Delete
      requestDelete,
      // New in dir
      newFileInDir,
      newFolderInDir,
      // Drag & drop
      isDragOver,
      onDragStart,
      onDragOver,
      onDragLeave,
      onDrop,
    };
  },
};
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 3px;
  font-size: 12px;
  color: var(--color-text-muted);
  transition: all 0.12s;
}

.tree-item:hover {
  background: rgba(var(--primary-rgb), 0.06);
  color: var(--color-text);
}

.tree-item.drag-over {
  background: rgba(var(--primary-rgb), 0.15);
  outline: 1px dashed var(--color-primary);
  outline-offset: -1px;
}

.item-icon {
  width: 14px;
  text-align: center;
  font-size: 12px;
  flex-shrink: 0;
}

.dir-icon {
  color: var(--color-primary);
}

.file-icon {
  opacity: 0.6;
}

.item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-input {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  background: var(--color-darker-1);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  border-radius: 2px;
  color: var(--color-text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.tree-children {
  padding-left: 16px;
}

.empty-dir {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  opacity: 0.5;
  font-style: italic;
}
</style>

<!-- Context menu styles (unscoped so Teleport works) -->
<style>
.tree-context-menu {
  position: fixed;
  z-index: 9999;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 150px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: 12px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.1s;
}

.ctx-item:hover {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-text);
}

.ctx-item.ctx-danger:hover {
  background: rgba(255, 80, 80, 0.12);
  color: var(--color-red);
}

.ctx-item i {
  width: 14px;
  text-align: center;
  font-size: 11px;
}

.ctx-divider {
  height: 1px;
  background: var(--terminal-border-color);
  margin: 4px 0;
}
</style>
