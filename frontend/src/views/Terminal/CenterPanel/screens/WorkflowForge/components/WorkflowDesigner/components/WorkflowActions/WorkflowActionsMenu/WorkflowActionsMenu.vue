<template>
  <div class="workflow-actions-menu">
    <Tooltip text="More Actions" width="auto" position="bottom">
      <button ref="menuButton" class="menu-trigger" @click="toggleMenu" :class="{ active: isOpen }">
        <i class="fas fa-ellipsis-v"></i>
      </button>
    </Tooltip>

    <transition name="menu-fade">
      <div v-if="isOpen" class="menu-dropdown" ref="menuDropdown">
        <!-- Share Workflow -->
        <button class="menu-item" @click="handleShare">
          <i :class="['fas', isShareable ? 'fa-lock-open' : 'fa-lock']"></i>
          <span>{{ isShareable ? 'Make Private' : 'Share Workflow' }}</span>
        </button>

        <!-- Copy Workflow ID (only shown when shared) -->
        <button v-if="isShareable" class="menu-item" @click="handleCopyUrl">
          <i class="fas fa-hashtag"></i>
          <span>Copy Workflow ID</span>
        </button>

        <!-- <div class="menu-divider"></div> -->

        <!-- Import Workflow ID -->
        <button class="menu-item" @click="handleImportId">
          <i class="fas fa-hashtag"></i>
          <span>Import Workflow ID</span>
        </button>

        <!-- Import Workflow JSON -->
        <button class="menu-item" @click="handleImportJson">
          <i class="fas fa-code"></i>
          <span>Import Workflow JSON</span>
        </button>

        <!-- Export Workflow JSON -->
        <button class="menu-item" @click="handleExportJson">
          <i class="fas fa-file-export"></i>
          <span>Export Workflow JSON</span>
        </button>

        <!-- <div class="menu-divider"></div> -->

        <button class="menu-item" @click="handleCloudSync">
          <i class="fas fa-sync"></i>
          <span>{{ isShareable ? 'Disable Cloud Sync' : 'Enable Cloud Sync' }}</span>
        </button>

        <!-- Delete Workflow -->
        <button class="menu-item danger" @click="handleDelete">
          <i class="fas fa-trash"></i>
          <span>Delete Workflow</span>
        </button>
      </div>
    </transition>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowActionsMenu',
  components: {
    Tooltip,
  },
  props: {
    isShareable: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      isOpen: false,
      showImportSubmenu: false,
      showExportSubmenu: false,
    };
  },
  methods: {
    toggleMenu() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) {
        this.$nextTick(() => {
          document.addEventListener('click', this.handleClickOutside);
        });
      } else {
        document.removeEventListener('click', this.handleClickOutside);
      }
    },
    toggleImportSubmenu() {
      this.showImportSubmenu = !this.showImportSubmenu;
      this.showExportSubmenu = false;
    },
    toggleExportSubmenu() {
      this.showExportSubmenu = !this.showExportSubmenu;
      this.showImportSubmenu = false;
    },
    closeMenu() {
      this.isOpen = false;
      this.showImportSubmenu = false;
      this.showExportSubmenu = false;
      document.removeEventListener('click', this.handleClickOutside);
    },
    handleClickOutside(event) {
      const menuButton = this.$refs.menuButton;
      const menuDropdown = this.$refs.menuDropdown;

      if (menuButton && menuDropdown) {
        if (!menuButton.contains(event.target) && !menuDropdown.contains(event.target)) {
          this.closeMenu();
        }
      }
    },
    handleShare() {
      this.$emit('toggle-shareable');
      this.closeMenu();
    },
    handleCopyUrl() {
      this.$emit('copy-url');
      this.closeMenu();
    },
    handleImportId() {
      this.$emit('import-workflow-id');
      this.closeMenu();
    },
    handleCloudSync() {
      this.$emit('cloud-sync');
      this.closeMenu();
    },
    handleImportJson() {
      this.$emit('import-workflow-json');
      this.closeMenu();
    },
    handleExportJson() {
      this.$emit('export-workflow-json');
      this.closeMenu();
    },
    handleDelete() {
      this.$emit('delete-workflow');
      this.closeMenu();
    },
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
  },
};
</script>

<style scoped>
.workflow-actions-menu {
  position: relative;
}

.menu-trigger {
  padding: 10px;
  border: 1px solid rgba(17, 27, 117, 0.25);
  background: transparent;
  color: var(--Dark-Navy, #01052a);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  cursor: pointer;
  opacity: 0.85;
}

.menu-trigger:hover,
.menu-trigger.active {
  opacity: 0.6;
}

.menu-trigger i {
  font-size: 16px;
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  /* padding: 8px 0; */
  z-index: 1000;
}

body.dark .menu-dropdown {
  background: var(--color-popup);
  border-color: var(--terminal-border-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.menu-item {
  width: 100%;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  color: var(--Dark-Navy, #01052a);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  text-align: left;
  position: relative;
}

body.dark .menu-item {
  color: #e0e0e0;
}

.menu-item:hover {
  background-color: rgba(17, 27, 117, 0.05);
}

body.dark .menu-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.menu-item i {
  width: 16px;
  font-size: 14px;
  opacity: 0.7;
}

.menu-item span {
  flex: 1;
}

.menu-item.danger {
  color: #dc3545;
}

.menu-item.danger:hover {
  background-color: rgba(220, 53, 69, 0.1);
}

.menu-divider {
  height: 1px;
  background-color: rgba(17, 27, 117, 0.1);
  margin: 8px 0;
}

body.dark .menu-divider {
  background-color: rgba(255, 255, 255, 0.1);
}

/* Submenu styles */
.menu-item.submenu {
  cursor: default;
}

.submenu-arrow {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.5;
  transition: transform 0.2s ease;
}

.submenu-arrow.rotated {
  transform: rotate(90deg);
}

.submenu-dropdown {
  position: relative;
  width: 100%;
  background: rgba(17, 27, 117, 0.03);
  border-radius: 4px;
  padding: 4px 0;
  margin-top: 4px;
}

body.dark .submenu-dropdown {
  background: #1a1a2e;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.submenu-item {
  width: 100%;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  color: var(--Dark-Navy, #01052a);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  text-align: left;
}

body.dark .submenu-item {
  color: #e0e0e0;
}

.submenu-item:hover {
  background-color: rgba(17, 27, 117, 0.05);
}

body.dark .submenu-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.submenu-item i {
  width: 16px;
  font-size: 14px;
  opacity: 0.7;
}

/* Transitions */
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.submenu-fade-enter-active,
.submenu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.submenu-fade-enter-from,
.submenu-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
