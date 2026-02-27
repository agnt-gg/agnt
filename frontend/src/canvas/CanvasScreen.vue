<template>
  <div class="cv-root">
    <!-- ── TOOLBAR (top bar + titlebar) ── -->
    <div v-if="isAuthenticated" class="cv-toolbar">
      <img class="cv-brand-logo" src="/images/agnt-logo-mark.svg" alt="AGNT" />

      <!-- Contextual sub-tabs for the active section, or custom page name -->
      <div class="cv-nav-panels">
        <template v-if="onCustomPage && activePage">
          <span class="cv-page-title">{{ activePage.name }}</span>
        </template>
        <template v-else>
          <button
            v-for="tab in activeSectionTabs"
            :key="tab.screen"
            class="cv-pbtn"
            :class="{ on: screenName === tab.screen }"
            @click="$emit('screen-change', tab.screen)"
          >
            {{ tab.label }}
          </button>
        </template>
      </div>

      <!-- Right side controls -->
      <div class="cv-right">
        <span class="cv-clock" id="cvClock">{{ clock }}</span>
        <button v-if="onCustomPage" class="cv-btn" @click="showCatalog = true" title="Add widget">+</button>
        <button v-if="onCustomPage" class="cv-btn" @click="resetCurrentPage" title="Reset layout">&#8635;</button>

        <!-- macOS traffic lights (right side) -->
        <template v-if="isElectron && isMac">
          <div class="cv-mac-controls">
            <button class="cv-mac-btn cv-mac-close" @click="closeWindow" title="Close"></button>
            <button class="cv-mac-btn cv-mac-minimize" @click="minimizeWindow" title="Minimize"></button>
            <button class="cv-mac-btn cv-mac-maximize" @click="maximizeWindow" title="Maximize"></button>
          </div>
        </template>

        <!-- Windows/Linux window controls (right side) -->
        <template v-if="isElectron && !isMac">
          <span class="cv-sep">|</span>
          <button class="cv-btn cv-win-ctrl" @click="minimizeWindow" title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button class="cv-btn cv-win-ctrl" @click="maximizeWindow" title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" fill="none" />
            </svg>
          </button>
          <button class="cv-btn cv-win-ctrl cv-win-close" @click="closeWindow" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </button>
        </template>
      </div>
    </div>

    <!-- ── MAIN AREA (sidebar + dashboard) ── -->
    <div class="cv-main-area">
      <!-- Sidebar: section icons -->
      <div v-if="isAuthenticated" class="cv-sidebar">
        <!-- Main sections (top) -->
        <div class="cv-sb-pages">
          <Tooltip v-for="section in mainSections" :key="section.id" :text="section.label" position="right" width="auto">
            <button
              class="cv-sb-page"
              :class="{ active: !onCustomPage && activeSection && activeSection.id === section.id }"
              @click="navigateToSection(section)"
            >
              <i :class="section.icon"></i>
            </button>
          </Tooltip>
        </div>

        <!-- Custom pages -->
        <div class="cv-sb-custom" v-if="customPages.length > 0">
          <Tooltip v-for="page in customPages" :key="page.id" :text="page.name" position="right" width="auto">
            <button
              class="cv-sb-page"
              :class="{ active: onCustomPage && page.id === activePageId }"
              @click="switchToPage(page.id)"
              @contextmenu.prevent="openContextMenu($event, page)"
            >
              <i :class="page.icon || 'fas fa-th'"></i>
            </button>
          </Tooltip>
        </div>

        <!-- Add page button -->
        <Tooltip text="Add page" position="right" width="auto">
          <button class="cv-sb-add" @click="startAddPage">+</button>
        </Tooltip>

        <!-- Separator -->
        <div class="cv-sb-sep" v-if="settingsSections.length > 0"></div>

        <!-- Settings sections (bottom) -->
        <div class="cv-sb-bottom">
          <Tooltip v-for="section in settingsSections" :key="section.id" :text="section.label" position="right" width="auto">
            <button
              class="cv-sb-page"
              :class="{ active: !onCustomPage && activeSection && activeSection.id === section.id }"
              @click="navigateToSection(section)"
            >
              <i :class="section.icon"></i>
            </button>
          </Tooltip>
        </div>
      </div>

      <!-- Main content area -->
      <div class="cv-dashboard">
        <!-- Custom pages: full widget canvas system -->
        <WidgetCanvas
          v-if="onCustomPage && activePageId"
          :pageId="activePageId"
          :isCustomPage="true"
          @open-catalog="showCatalog = true"
          @screen-change="(screen, opts) => $emit('screen-change', screen, opts)"
        />

        <!-- Section screens: render directly via slot (fast, no widget overhead) -->
        <slot v-else />
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="cv-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <div class="cv-ctx-item" @click="startRename">Rename</div>
        <div class="cv-ctx-item" @click="doResetPage">Reset Layout</div>
        <div v-if="allPages.length > 1" class="cv-ctx-item cv-ctx-danger" @click="doDelete">Delete</div>
      </div>
    </Teleport>

    <!-- Inline input modal (replaces prompt/confirm) -->
    <Teleport to="body">
      <div v-if="modal.show" class="cv-modal-overlay" @click.self="cancelModal">
        <div class="cv-modal">
          <div class="cv-modal-title">{{ modal.title }}</div>
          <input
            v-if="modal.type === 'input'"
            ref="modalInputRef"
            class="cv-modal-input"
            v-model="modal.value"
            placeholder="Page name"
            @keydown.enter="submitModal"
            @keydown.escape="cancelModal"
          />
          <!-- Icon picker -->
          <div v-if="modal.showIconPicker" class="cv-icon-picker">
            <div class="cv-icon-label">Icon</div>
            <div class="cv-icon-grid">
              <button
                v-for="ico in PAGE_ICONS"
                :key="ico"
                class="cv-icon-btn"
                :class="{ active: modal.icon === ico }"
                @click="modal.icon = ico"
                type="button"
              >
                <i :class="ico"></i>
              </button>
            </div>
          </div>
          <p v-if="modal.type === 'confirm'" class="cv-modal-msg">{{ modal.message }}</p>
          <div class="cv-modal-actions">
            <button class="cv-modal-btn cv-modal-cancel" @click="cancelModal">Cancel</button>
            <button class="cv-modal-btn cv-modal-ok" :class="{ 'cv-modal-danger': modal.danger }" @click="submitModal">
              {{ modal.okLabel || 'OK' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Widget Catalog Modal -->
    <WidgetCatalog :isOpen="showCatalog" :pageId="activePageId || ''" @close="showCatalog = false" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import WidgetCanvas from './WidgetCanvas.vue';
import WidgetCatalog from './WidgetCatalog.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { getDefaultLayout } from './defaultLayouts.js';
import { useElectron, electronUtils } from '@/composables/useElectron';

// ── Section definitions ──
// Each section has one sidebar icon and one or more sub-tabs in the toolbar.
const MAIN_SECTIONS = [
  { id: 'chat', icon: 'fas fa-comments', label: 'Chat', screens: [{ screen: 'ChatScreen', label: 'CHAT' }] },
  { id: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard', screens: [{ screen: 'DashboardScreen', label: 'DASHBOARD' }] },
  { id: 'runs', icon: 'fas fa-play-circle', label: 'Runs', screens: [{ screen: 'RunsScreen', label: 'RUNS' }] },
  { id: 'goals', icon: 'fas fa-bullseye', label: 'Goals', screens: [{ screen: 'GoalsScreen', label: 'GOALS' }] },
  {
    id: 'agents',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'MY AGENTS' },
      { screen: 'AgentForgeScreen', label: 'AGENT FORGE' },
    ],
  },
  {
    id: 'workflows',
    icon: 'fas fa-project-diagram',
    label: 'Workflows',
    screens: [
      { screen: 'WorkflowsScreen', label: 'MY WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE' },
    ],
  },
  {
    id: 'tools',
    icon: 'fas fa-wrench',
    label: 'Tools',
    screens: [
      { screen: 'ToolsScreen', label: 'MY TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE' },
    ],
  },
  {
    id: 'widgets',
    icon: 'fas fa-puzzle-piece',
    label: 'Widgets',
    screens: [
      { screen: 'WidgetManagerScreen', label: 'MY WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE' },
    ],
  },
];

const SETTINGS_SECTIONS = [
  { id: 'marketplace', icon: 'fas fa-store', label: 'Marketplace', screens: [{ screen: 'MarketplaceScreen', label: 'MARKETPLACE' }] },
  { id: 'connect', icon: 'fas fa-key', label: 'Connect', screens: [{ screen: 'SecretsScreen', label: 'CONNECT' }] },
  { id: 'settings', icon: 'fas fa-cog', label: 'Settings', screens: [{ screen: 'SettingsScreen', label: 'SETTINGS' }] },
];

const ALL_SECTIONS = [...MAIN_SECTIONS, ...SETTINGS_SECTIONS];

// Set of all screen names that belong to a section (used to identify custom pages)
const SECTION_ROUTES = new Set(ALL_SECTIONS.flatMap((s) => s.screens.map((t) => t.screen)));

export default {
  name: 'CanvasScreen',
  components: { WidgetCanvas, WidgetCatalog, Tooltip },
  props: {
    screenName: { type: String, default: 'ChatScreen' },
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const { isElectron } = useElectron();
    const showCatalog = ref(false);
    const clock = ref('00:00:00');
    const modalInputRef = ref(null);
    let clockTimer = null;

    // Window controls
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    function minimizeWindow() {
      electronUtils.window.minimize();
    }
    function maximizeWindow() {
      electronUtils.window.maximize();
    }
    function closeWindow() {
      electronUtils.window.close();
    }

    const isAuthenticated = computed(() => store.getters['userAuth/isAuthenticated']);

    const activePageId = computed(() => store.getters['widgetLayout/activePageId']);
    const activePage = computed(() => store.getters['widgetLayout/activePage']);
    const allPages = computed(() => store.getters['widgetLayout/allPages']);

    // Track when user has navigated to a custom page (no section)
    const onCustomPage = ref(false);

    // Section data (static)
    const mainSections = MAIN_SECTIONS;
    const settingsSections = SETTINGS_SECTIONS;

    // Custom pages = pages that don't belong to any section
    const customPages = computed(() => allPages.value.filter((p) => !SECTION_ROUTES.has(p.route)));

    // Is the active page a custom (user-created) page?
    const isCustomPage = computed(() => onCustomPage.value);

    // Find the active section based on current screenName
    const activeSection = computed(() => {
      return ALL_SECTIONS.find((s) => s.screens.some((t) => t.screen === props.screenName)) || null;
    });

    // Sub-tabs shown in toolbar = screens of the active section
    const activeSectionTabs = computed(() => {
      return activeSection.value ? activeSection.value.screens : [];
    });

    // ── Clock ──
    function updateClock() {
      const now = new Date();
      clock.value = now.toLocaleTimeString('en-US', { hour12: false });
    }

    // ── Context menu ──
    const ctxMenu = ref({ show: false, x: 0, y: 0, page: null });

    function openContextMenu(e, page) {
      ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, page };
    }

    function closeCtx() {
      ctxMenu.value.show = false;
    }

    // ── Modal (replaces prompt/confirm) ──
    const PAGE_ICONS = [
      'fas fa-th', 'fas fa-home', 'fas fa-star', 'fas fa-heart', 'fas fa-bolt',
      'fas fa-rocket', 'fas fa-globe', 'fas fa-chart-bar', 'fas fa-code', 'fas fa-database',
      'fas fa-server', 'fas fa-shield-alt', 'fas fa-cube', 'fas fa-palette', 'fas fa-terminal',
      'fas fa-brain', 'fas fa-atom', 'fas fa-fire', 'fas fa-gem', 'fas fa-crown',
      'fas fa-flask', 'fas fa-leaf', 'fas fa-moon', 'fas fa-sun', 'fas fa-cloud',
    ];

    const modal = ref({ show: false, type: 'input', title: '', value: '', icon: 'fas fa-th', showIconPicker: false, message: '', okLabel: 'OK', danger: false });
    let modalResolve = null;

    function showModal(opts) {
      return new Promise((resolve) => {
        modalResolve = resolve;
        modal.value = { show: true, ...opts };
        if (opts.type === 'input') {
          nextTick(() => modalInputRef.value?.focus());
        }
      });
    }

    function submitModal() {
      let result;
      if (modal.value.type === 'input') {
        result = modal.value.showIconPicker
          ? { value: modal.value.value, icon: modal.value.icon }
          : modal.value.value;
      } else {
        result = true;
      }
      modal.value.show = false;
      if (modalResolve) modalResolve(result);
      modalResolve = null;
    }

    function cancelModal() {
      modal.value.show = false;
      if (modalResolve) modalResolve(null);
      modalResolve = null;
    }

    // ── Context menu actions ──
    async function startRename() {
      const page = ctxMenu.value.page;
      closeCtx();
      if (!page) return;
      const result = await showModal({ type: 'input', title: 'Rename Page', value: page.name, icon: page.icon || 'fas fa-th', showIconPicker: true, okLabel: 'Rename' });
      if (result && result.value && result.value.trim()) {
        store.dispatch('widgetLayout/renamePage', { pageId: page.id, name: result.value.trim(), icon: result.icon });
      }
    }

    async function doResetPage() {
      const page = ctxMenu.value.page;
      closeCtx();
      if (!page) return;
      const ok = await showModal({
        type: 'confirm',
        title: 'Reset Layout',
        message: `Reset "${page.name}" to its default layout? All widget positions will be lost.`,
        okLabel: 'Reset',
        danger: true,
      });
      if (ok) {
        const dw = page.route ? getDefaultLayout(page.route) : [];
        store.dispatch('widgetLayout/resetPageToDefault', { pageId: page.id, defaultWidgets: dw });
      }
    }

    async function doDelete() {
      const page = ctxMenu.value.page;
      closeCtx();
      if (!page) return;
      const ok = await showModal({
        type: 'confirm',
        title: 'Delete Page',
        message: `Delete "${page.name}"? This cannot be undone.`,
        okLabel: 'Delete',
        danger: true,
      });
      if (ok) {
        store.dispatch('widgetLayout/deletePage', page.id);
      }
    }

    async function startAddPage() {
      const result = await showModal({ type: 'input', title: 'New Page', value: '', icon: 'fas fa-th', showIconPicker: true, okLabel: 'Create' });
      if (result && result.value && result.value.trim()) {
        store.dispatch('widgetLayout/addPage', { name: result.value.trim(), icon: result.icon || 'fas fa-th' });
      }
    }

    function switchToPage(pageId) {
      onCustomPage.value = true;
      store.dispatch('widgetLayout/setActivePage', pageId);
    }

    function navigateToSection(section) {
      onCustomPage.value = false;
      // Navigate to the first screen in the section
      emit('screen-change', section.screens[0].screen);
    }

    function resetCurrentPage() {
      if (!activePage.value) return;
      const dw = activePage.value.route ? getDefaultLayout(activePage.value.route) : [];
      store.dispatch('widgetLayout/resetPageToDefault', { pageId: activePage.value.id, defaultWidgets: dw });
    }

    // Ensure a page exists for the current screen (synchronous for instant render)
    function ensurePageForScreen(screenName) {
      // Route-driven navigation → we're on a section page, not a custom page
      onCustomPage.value = false;
      const existingPage = store.getters['widgetLayout/pageForRoute'](screenName);
      if (existingPage) {
        store.dispatch('widgetLayout/setActivePage', existingPage.id);
      } else {
        const defaultWidgets = getDefaultLayout(screenName);
        // Don't await - commits happen synchronously, API save is background
        store.dispatch('widgetLayout/createPageFromDefault', { screenName, defaultWidgets });
      }
    }

    // When screenName changes (route change), switch to the correct page
    // Skip until layouts are loaded to avoid creating duplicate pages
    watch(
      () => props.screenName,
      (screenName) => {
        if (screenName && store.getters['widgetLayout/isLoaded']) {
          ensurePageForScreen(screenName);
        }
      },
    );

    onMounted(() => {
      updateClock();
      clockTimer = setInterval(updateClock, 1000);

      document.addEventListener('click', closeCtx);

      if (!store.getters['widgetLayout/isLoaded']) {
        // Fire and forget - don't block render. Store already has localStorage data.
        store.dispatch('widgetLayout/fetchLayouts');
      }
      // Synchronous - commits happen immediately, API calls are background
      ensurePageForScreen(props.screenName);
    });

    onBeforeUnmount(() => {
      if (clockTimer) clearInterval(clockTimer);
      document.removeEventListener('click', closeCtx);
    });

    return {
      isAuthenticated,
      showCatalog,
      clock,
      activePageId,
      activePage,
      allPages,
      mainSections,
      settingsSections,
      customPages,
      isCustomPage,
      onCustomPage,
      activeSection,
      activeSectionTabs,
      ctxMenu,
      openContextMenu,
      modal,
      modalInputRef,
      PAGE_ICONS,
      submitModal,
      cancelModal,
      startRename,
      doResetPage,
      doDelete,
      startAddPage,
      switchToPage,
      navigateToSection,
      resetCurrentPage,
      isElectron,
      isMac,
      minimizeWindow,
      maximizeWindow,
      closeWindow,
    };
  },
};
</script>

<style scoped>
.cv-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ═══════════════════ TOOLBAR ═══════════════════ */
.cv-toolbar {
  height: 32px;
  min-height: 32px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-dull-navy);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 8px;
  user-select: none;
  z-index: 100;
  -webkit-app-region: drag;
}

/* Only interactive elements opt out of drag — empty space remains draggable */
.cv-toolbar button,
.cv-toolbar .cv-pbtn,
.cv-toolbar .cv-clock {
  -webkit-app-region: no-drag;
}

.cv-brand-logo {
  height: 16px;
  width: auto;
  flex-shrink: 0;
  opacity: 0.8;
}

.cv-nav-panels {
  display: flex;
  gap: 2px;
  width: max-content;
  padding: 0 8px;
  scrollbar-width: none;
}
.cv-nav-panels::-webkit-scrollbar {
  display: none;
}

.cv-pbtn {
  font-size: 10px;
  letter-spacing: 1.5px;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--color-text-muted, #445);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all 0.12s;
}

.cv-pbtn:hover {
  color: var(--color-light-0, #889);
  border-color: var(--color-dull-navy);
}

.cv-pbtn.on {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.15);
  background: rgba(var(--green-rgb), 0.04);
}

.cv-page-title {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--color-green);
  white-space: nowrap;
  text-transform: uppercase;
}

.cv-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.cv-sep {
  color: var(--terminal-border-color);
  font-size: 14px;
}

.cv-clock {
  font-size: 12px;
  color: var(--color-text-muted, #445);
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
}

.cv-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted, #445);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: inherit;
  transition: all 0.12s;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cv-btn:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
}

.cv-win-ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
}

.cv-win-close:hover {
  color: var(--color-dull-white);
  background: var(--color-red);
  border-color: var(--color-red);
}

/* ── macOS traffic light buttons ── */
.cv-mac-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-right: 4px;
  -webkit-app-region: no-drag;
}

.cv-mac-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.12s;
  position: relative;
}

.cv-mac-btn:active {
  opacity: 0.6;
}

.cv-mac-close {
  background: var(--color-red);
}

.cv-mac-minimize {
  background: var(--color-yellow);
}

.cv-mac-maximize {
  background: var(--color-green);
}

/* Show icons on hover */
.cv-mac-controls:hover .cv-mac-close::after {
  content: '×';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
  color: rgba(0, 0, 0, 0.5);
}

.cv-mac-controls:hover .cv-mac-minimize::after {
  content: '−';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
  color: rgba(0, 0, 0, 0.5);
}

.cv-mac-controls:hover .cv-mac-maximize::after {
  content: '+';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
  color: rgba(0, 0, 0, 0.5);
}

/* ═══════════════════ MAIN AREA ═══════════════════ */
.cv-main-area {
  display: flex;
  flex: 1;
  min-height: 0;
  /* padding-right: 4px; */
}

/* ═══════════════════ SIDEBAR ═══════════════════ */
.cv-sidebar {
  width: 44px;
  min-width: 44px;
  background: var(--color-background);
  border-right: 1px solid var(--color-dull-navy);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
  gap: 2px;
  user-select: none;
}

.cv-sb-pages {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  width: 100%;
  align-items: center;
  scrollbar-width: none;
}
.cv-sb-pages::-webkit-scrollbar {
  display: none;
}

.cv-sb-custom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  align-items: center;
  margin-top: 2px;
}

.cv-sb-sep {
  width: 24px;
  height: 1px;
  background: var(--terminal-border-color);
  margin: 4px 0;
  flex-shrink: 0;
}

.cv-sb-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  align-items: center;
  flex-shrink: 0;
}

.cv-sb-page {
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #445);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  flex-shrink: 0;
}

.cv-sb-page:hover {
  color: var(--color-text);
  border-color: var(--color-dull-navy);
  background: var(--color-darker-0);
}

.cv-sb-page.active {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.25);
  background: rgba(var(--primary-rgb), 0.06);
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.1);
}

.cv-sb-add {
  width: 32px;
  height: 32px;
  border: 1px dashed var(--color-dull-navy);
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #334);
  cursor: pointer;
  font-size: 14px;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  flex-shrink: 0;
  margin-top: 2px;
}

.cv-sb-add:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}

/* ═══════════════════ DASHBOARD ═══════════════════ */
.cv-dashboard {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-bottom-right-radius: var(--terminal-screen-border-radius, 0);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.cv-dashboard > * {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Gap for direct screen content (slot) - WidgetCanvas has its own GRID_GAP */
.cv-dashboard > :not(.widget-canvas) {
  margin: 0px;
}

.custom-bg .cv-dashboard > :not(.widget-canvas) {
  margin: 4px;
}

/* ═══════════════════ CONTEXT MENU ═══════════════════ */
.cv-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: var(--color-darker-0, #0a0a14);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 3px 0;
  min-width: 110px;
}

.cv-ctx-item {
  padding: 5px 12px;
  font-size: 11px;
  color: var(--color-light-0, #aab);
  cursor: pointer;
  letter-spacing: 0.5px;
}

.cv-ctx-item:hover {
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
}

.cv-ctx-item.cv-ctx-danger:hover {
  background: rgba(var(--red-rgb), 0.08);
  color: var(--color-red);
}

/* ═══════════════════ MODAL ═══════════════════ */
.cv-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cv-modal {
  background: var(--color-background);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 16px 20px;
  min-width: 280px;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.cv-modal-title {
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-green);
  margin-bottom: 12px;
  font-weight: 600;
}

.cv-modal-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-light-0, #ccd);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.cv-modal-input:focus {
  border-color: rgba(var(--green-rgb), 0.4);
}

.cv-modal-msg {
  font-size: 13px;
  color: var(--color-light-0, #99a);
  margin: 0 0 4px;
  line-height: 1.4;
}

.cv-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.cv-modal-btn {
  padding: 5px 14px;
  border-radius: 4px;
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--terminal-border-color);
  transition: all 0.12s;
}

.cv-modal-cancel {
  background: none;
  color: var(--color-text-muted, #667);
}

.cv-modal-cancel:hover {
  color: var(--color-light-0, #aab);
  border-color: var(--color-duller-navy);
}

.cv-modal-ok {
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
}

.cv-modal-ok:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.4);
}

/* ── Icon Picker ── */
.cv-icon-picker {
  margin-top: 12px;
}

.cv-icon-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
  margin-bottom: 8px;
  font-weight: 600;
}

.cv-icon-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}

.cv-icon-btn {
  width: 100%;
  aspect-ratio: 1;
  background: none;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text-muted, #556);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}

.cv-icon-btn:hover {
  color: var(--color-light-0, #aab);
  border-color: rgba(255, 255, 255, 0.1);
}

.cv-icon-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.08);
}

.cv-modal-ok.cv-modal-danger {
  background: rgba(var(--red-rgb), 0.08);
  color: var(--color-red);
  border-color: rgba(var(--red-rgb), 0.2);
}

.cv-modal-ok.cv-modal-danger:hover {
  background: rgba(var(--red-rgb), 0.15);
  border-color: rgba(var(--red-rgb), 0.4);
}
</style>

<style>
/* ═══════════════════ CUSTOM BACKGROUND MODE ═══════════════════ */
body.custom-bg .cv-dashboard {
  background: transparent !important;
}
</style>
