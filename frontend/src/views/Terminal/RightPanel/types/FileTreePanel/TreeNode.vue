<template>
  <div class="tree-node">
    <div
      class="tree-item"
      :class="{
        'is-dir': item.type === 'directory',
        'is-active-dir': item.type === 'directory' && activeDir === item.path,
        'drag-over': isDragOver,
      }"
      draggable="true"
      @click="handleClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragstart="onDragStart"
      @dragenter="onDragEnter"
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
        :active-dir="activeDir"
        :workspace-root="workspaceRoot"
        :rename-request="renameRequest"
        @toggle-dir="$emit('toggle-dir', $event)"
        @select-file="$emit('select-file', $event)"
        @rename-item="$emit('rename-item', $event)"
        @move-item="$emit('move-item', $event)"
        @open-context-menu="$emit('open-context-menu', $event)"
      />
    </div>
  </div>
</template>

<script>
import { computed, ref, nextTick, watch } from 'vue';

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
    activeDir: { type: String, default: '' },
    workspaceRoot: { type: String, default: '' },
    // Rename signal from the parent's lifted context menu. Shape: { path, ts }.
    // When path matches this node's item.path, the node enters inline rename
    // mode. The `ts` field ensures the same path can be retriggered.
    renameRequest: { type: Object, default: null },
  },
  emits: ['toggle-dir', 'select-file', 'rename-item', 'move-item', 'open-context-menu'],
  setup(props, { emit }) {
    const isExpanded = computed(() => !!props.expandedDirs[props.item.path]);
    const children = computed(() => props.childrenMap[props.item.path] || []);
    const fileIcon = computed(() => {
      const ext = props.item.name.split('.').pop()?.toLowerCase();
      return EXTENSION_ICONS[ext] || 'fas fa-file';
    });

    // ── Context Menu (just forwards the request — the menu UI lives in the parent) ──
    const handleContextMenu = (e) => {
      emit('open-context-menu', { item: props.item, x: e.clientX, y: e.clientY });
    };

    // ── Inline Rename ──
    const isRenaming = ref(false);
    const renameValue = ref('');
    const renameInputRef = ref(null);

    const startRename = () => {
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

    // React to rename signals from the lifted menu. Each new `renameRequest`
    // object is a fresh reference, so the watcher fires even for the same path
    // being retriggered.
    watch(
      () => props.renameRequest,
      (req) => {
        if (!req || req.path !== props.item.path) return;
        if (!isRenaming.value) startRename();
      },
    );

    const commitRename = () => {
      if (!isRenaming.value) return;
      const newName = renameValue.value.trim();
      isRenaming.value = false;
      if (!newName || newName === props.item.name) return;

      const parentDir = props.item.path.includes('/') ? props.item.path.substring(0, props.item.path.lastIndexOf('/')) : '';
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;

      emit('rename-item', { oldPath: props.item.path, newPath });
    };

    const cancelRename = () => {
      isRenaming.value = false;
    };

    // ── Drag & Drop ──
    const isDragOver = ref(false);
    let dragEnterCount = 0;

    const onDragStart = (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', props.item.path);
    };

    const onDragOver = (e) => {
      if (props.item.type !== 'directory') return;
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    };

    const onDragEnter = (e) => {
      if (props.item.type !== 'directory') return;
      e.stopPropagation();
      e.preventDefault();
      dragEnterCount++;
      isDragOver.value = true;
    };

    const onDragLeave = (e) => {
      if (props.item.type !== 'directory') return;
      e.stopPropagation();
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        isDragOver.value = false;
      }
    };

    const onDrop = (e) => {
      dragEnterCount = 0;
      isDragOver.value = false;
      if (props.item.type !== 'directory') return;
      e.stopPropagation();
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
      handleContextMenu,
      // Rename
      isRenaming,
      renameValue,
      renameInputRef,
      commitRename,
      cancelRename,
      // Drag & drop
      isDragOver,
      onDragStart,
      onDragEnter,
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

.tree-item.is-active-dir {
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--color-primary);
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
  border: 1px solid rgba(var(--primary-rgb), 0.4);
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
