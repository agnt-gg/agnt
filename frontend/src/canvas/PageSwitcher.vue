<template>
  <div class="page-switcher">
    <div class="ps-pages">
      <Tooltip v-for="page in customPages" :key="page.id" :text="page.name">
        <button
          class="ps-page"
          :class="{ active: page.id === activePageId }"
          @click="switchPage(page.id)"
          @contextmenu.prevent="openContextMenu($event, page)"
        >
          <i :class="page.icon || 'fas fa-th'"></i>
          <span class="ps-page-name">{{ page.name }}</span>
        </button>
      </Tooltip>
    </div>

    <Tooltip text="Add page">
      <button class="ps-add" @click="promptAddPage">
        <i class="fas fa-plus"></i>
        <span class="ps-add-label">New Page</span>
      </button>
    </Tooltip>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.show"
        class="ps-ctx-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div class="ctx-item" @click="promptRename">Rename</div>
        <div class="ctx-item" @click="promptResetLayout">Reset Layout</div>
        <div
          v-if="customPages.length > 0"
          class="ctx-item ctx-danger"
          @click="confirmDelete"
        >
          Delete
        </div>
      </div>
    </Teleport>

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { getDefaultLayout } from './defaultLayouts.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'PageSwitcher',
  components: { Tooltip, SimpleModal },
  emits: ['page-changed'],
  setup(props, { emit }) {
    const store = useStore();

    const allPages = computed(() => store.getters['widgetLayout/allPages']);
    const activePageId = computed(() => store.getters['widgetLayout/activePageId']);

    // Only show custom pages (pages without a route, or pages the user created manually)
    // Route-based pages are handled by navigation buttons
    const customPages = computed(() => {
      return allPages.value.filter((p) => !p.route);
    });

    const contextMenu = ref({ show: false, x: 0, y: 0, page: null });
    const simpleModal = ref(null);

    function switchPage(pageId) {
      store.dispatch('widgetLayout/setActivePage', pageId);
      emit('page-changed', pageId);
    }

    async function promptAddPage() {
      const name = await simpleModal.value?.showModal({
        isPrompt: true,
        title: 'New Page',
        placeholder: 'Page name',
        confirmText: 'Create',
      });
      if (name && name.trim()) {
        store.dispatch('widgetLayout/addPage', {
          name: name.trim(),
          icon: 'fas fa-th',
        });
      }
    }

    function openContextMenu(e, page) {
      contextMenu.value = { show: true, x: e.clientX, y: e.clientY, page };
    }

    function closeContextMenu() {
      contextMenu.value.show = false;
    }

    async function promptRename() {
      const page = contextMenu.value.page;
      closeContextMenu();
      if (!page) return;
      const name = await simpleModal.value?.showModal({
        isPrompt: true,
        title: 'Rename Page',
        placeholder: 'Page name',
        defaultValue: page.name,
        confirmText: 'Rename',
      });
      if (name && name.trim()) {
        store.dispatch('widgetLayout/renamePage', { pageId: page.id, name: name.trim() });
      }
    }

    async function promptResetLayout() {
      const page = contextMenu.value.page;
      closeContextMenu();
      if (!page) return;
      const confirmed = await simpleModal.value?.showModal({
        title: 'Reset Layout?',
        message: 'Reset this page to its default layout?',
        confirmText: 'Reset',
        cancelText: 'Cancel',
        showCancel: true,
      });
      if (confirmed) {
        const defaultWidgets = page.route ? getDefaultLayout(page.route) : [];
        store.dispatch('widgetLayout/resetPageToDefault', { pageId: page.id, defaultWidgets });
      }
    }

    async function confirmDelete() {
      const page = contextMenu.value.page;
      closeContextMenu();
      if (!page) return;
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Page?',
        message: `Delete page "${page.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (confirmed) {
        store.dispatch('widgetLayout/deletePage', page.id);
      }
    }

    function onDocClick() {
      closeContextMenu();
    }

    onMounted(() => document.addEventListener('click', onDocClick));
    onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

    return {
      customPages,
      activePageId,
      contextMenu,
      simpleModal,
      switchPage,
      promptAddPage,
      openContextMenu,
      promptRename,
      promptResetLayout,
      confirmDelete,
    };
  },
};
</script>

<style scoped>
.page-switcher {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ps-pages {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ps-page {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #556);
  cursor: pointer;
  font-size: var(--font-size-xs, 11px);
  transition: all 0.12s;
  text-align: left;
  width: 100%;
}

.ps-page i {
  width: 14px;
  text-align: center;
  font-size: 11px;
  flex-shrink: 0;
}

.ps-page-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ps-page:hover {
  color: var(--color-light-0, #aab);
  background: rgba(255, 255, 255, 0.03);
}

.ps-page.active {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.06);
  box-shadow: inset 2px 0 0 var(--color-green);
}

.ps-add {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px dashed rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #334);
  cursor: pointer;
  font-size: var(--font-size-xs, 11px);
  transition: all 0.15s;
  text-align: left;
  width: 100%;
  margin-top: 4px;
}

.ps-add i {
  width: 14px;
  text-align: center;
  font-size: 10px;
  flex-shrink: 0;
}

.ps-add-label {
  opacity: 0.7;
}

.ps-add:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}

/* ── Context menu ── */
.ps-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: var(--color-darker-0, #0a0a14);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  min-width: 120px;
}

.ctx-item {
  padding: 6px 14px;
  font-size: var(--font-size-xs, 11px);
  color: var(--color-light-0, #aab);
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: all 0.1s;
}

.ctx-item:hover {
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
}

.ctx-item.ctx-danger:hover {
  background: rgba(var(--red-rgb), 0.08);
  color: var(--color-red);
}
</style>
