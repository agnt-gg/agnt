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
        <template v-else-if="untabbedScreenLabel">
          <span class="cv-page-title">{{ untabbedScreenLabel }}</span>
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
            <span v-if="tab.screen === 'ChatScreen' && hasUnreadChats" class="cv-unread-dot"></span>
          </button>
        </template>
      </div>

      <!-- Right side controls -->
      <div class="cv-right">
        <span class="cv-clock" id="cvClock">{{ clock }}</span>
        <Tooltip v-if="globalModelLabel" text="Click to change model" width="auto" position="bottom">
          <span class="cv-global-model cv-global-model-clickable" @click="toggleGlobalProviderSelector">
            {{ globalProviderLabel }}/{{ globalModelLabel }}
            <i class="fas fa-caret-down"></i>
          </span>
        </Tooltip>
        <Tooltip v-if="onCustomPage" text="Add widget">
          <button class="cv-btn" @click="showCatalog = true">+</button>
        </Tooltip>
        <Tooltip v-if="onCustomPage" text="Reset layout">
          <button class="cv-btn" @click="resetCurrentPage">&#8635;</button>
        </Tooltip>

        <!-- macOS traffic lights (right side) -->
        <template v-if="isElectron && isMac">
          <div class="cv-mac-controls">
            <button class="cv-mac-btn cv-mac-close" @click="closeWindow"></button>
            <button class="cv-mac-btn cv-mac-minimize" @click="minimizeWindow"></button>
            <button class="cv-mac-btn cv-mac-maximize" @click="maximizeWindow"></button>
          </div>
        </template>

        <!-- Windows/Linux window controls (right side) -->
        <template v-if="isElectron && !isMac">
          <span class="cv-sep">|</span>
          <button class="cv-btn cv-win-ctrl" @click="minimizeWindow">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button class="cv-btn cv-win-ctrl" @click="maximizeWindow">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" fill="none" />
            </svg>
          </button>
          <button class="cv-btn cv-win-ctrl cv-win-close" @click="closeWindow">
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
      <div v-if="isAuthenticated" class="cv-sidebar" :class="{ expanded: isSidebarExpanded }">
        <!-- Main sections (top), grouped under captions -->
        <div class="cv-sb-pages">
          <template v-for="(row, i) in mainRail" :key="row.section.id">
            <!-- Caption doubles as the group divider; collapsed, only the rule survives. -->
            <div v-if="row.caption" class="cv-sb-cap" :class="{ 'is-first': i === 0 }">
              <span class="cv-sb-cap-text">{{ row.caption }}</span>
            </div>
            <Tooltip :text="row.section.label" position="right" width="auto" :disabled="railLabelsVisible">
              <button
                class="cv-sb-page"
                :class="{ active: !onCustomPage && activeSection && activeSection.id === row.section.id }"
                :data-tour-id="`sidebar.${row.section.id}`"
                @click="navigateToSection(row.section)"
              >
                <i :class="row.section.icon"></i>
                <span v-if="row.section.id === 'chat' && hasUnreadChats" class="cv-unread-dot cv-unread-dot-sb"></span>
                <span class="cv-sb-label" v-marquee>
                  <span class="cv-sb-label-inner">{{ row.section.label }}</span>
                </span>
              </button>
            </Tooltip>
          </template>
        </div>

        <!-- Custom pages -->
        <div class="cv-sb-custom" v-if="customPages.length > 0">
          <Tooltip v-for="page in customPages" :key="page.id" :text="page.name" position="right" width="auto" :disabled="railLabelsVisible">
            <button
              class="cv-sb-page"
              :class="{ active: onCustomPage && page.id === activePageId }"
              @click="switchToPage(page.id)"
              @contextmenu.prevent="openContextMenu($event, page)"
            >
              <i :class="page.icon || 'fas fa-th'"></i>
              <span class="cv-sb-label" v-marquee>
                <span class="cv-sb-label-inner">{{ page.name }}</span>
              </span>
            </button>
          </Tooltip>
        </div>

        <!-- Add page button -->
        <Tooltip text="Add page" position="right" width="auto" :disabled="railLabelsVisible">
          <button class="cv-sb-add" data-tour-id="sidebar.add-page" @click="startAddPage">
            <span class="cv-sb-add-icon">+</span>
            <span class="cv-sb-label" v-marquee>
              <span class="cv-sb-label-inner">New page</span>
            </span>
          </button>
        </Tooltip>

        <!-- Separator -->
        <div class="cv-sb-sep" v-if="bottomSections.length > 0"></div>

        <!-- Foot of the rail: Connect, then Settings. No caption — each is a
             single row whose screen carries its own left-panel nav. -->
        <div class="cv-sb-bottom">
          <Tooltip v-for="section in bottomSections" :key="section.id" :text="section.label" position="right" width="auto" :disabled="railLabelsVisible">
            <button
              class="cv-sb-page"
              :class="{ active: !onCustomPage && activeSection && activeSection.id === section.id }"
              :data-tour-id="`sidebar.${section.id}`"
              @click="navigateToSection(section)"
            >
              <i :class="section.icon"></i>
              <span class="cv-sb-label" v-marquee>
                <span class="cv-sb-label-inner">{{ section.label }}</span>
              </span>
            </button>
          </Tooltip>
        </div>

        <!-- Collapse / expand toggle -->
        <!-- Only reachable while collapsed, so the expanded wording would be
             dead text here. The aria-label below still carries both. -->
        <Tooltip text="Expand sidebar" position="right" width="auto" :disabled="railLabelsVisible">
          <button
            class="cv-sb-toggle"
            data-tour-id="sidebar.toggle"
            @click="toggleSidebar"
            :aria-label="isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
          >
            <i class="fas" :class="isSidebarExpanded ? 'fa-angle-double-left' : 'fa-angle-double-right'"></i>
            <span class="cv-sb-label" v-marquee>
              <span class="cv-sb-label-inner">Collapse</span>
            </span>
          </button>
        </Tooltip>
      </div>

      <!-- Main content area -->
      <div class="cv-dashboard">
        <!-- Custom pages: full widget canvas system -->
        <WidgetCanvas
          v-if="onCustomPage && activePageId"
          :pageId="activePageId"
          :isCustomPage="true"
          @open-catalog="showCatalog = true"
          @screen-change="
            (screen, opts) => {
              onCustomPage = false;
              $emit('screen-change', screen, opts);
            }
          "
        />

        <!-- Section screens: render directly via slot (fast, no widget overhead) -->
        <slot v-else />
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="cv-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
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

    <!-- Global Provider Selector (toolbar dropdown) -->
    <Teleport to="body">
      <ChatProviderSelector
        v-if="isGlobalProviderSelectorOpen"
        :is-open="isGlobalProviderSelectorOpen"
        :style="globalSelectorStyle"
        class="cv-toolbar-selector"
        @close="isGlobalProviderSelectorOpen = false"
      />
    </Teleport>

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import WidgetCanvas from './WidgetCanvas.vue';
import WidgetCatalog from './WidgetCatalog.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import ChatProviderSelector from '@/views/Terminal/CenterPanel/screens/Chat/components/ChatProviderSelector.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { getDefaultLayout } from './defaultLayouts.js';
import { useElectron, electronUtils } from '@/composables/useElectron';
// ── Section definitions ──
// Sidebar icons + toolbar sub-tabs both derive from this registry.
// Lives in sections.js so sections.spec.js can hold it to the same screen
// list Terminal.vue and the router maintain by hand.
import { MAIN_SECTIONS, BOTTOM_SECTIONS, ALL_SECTIONS, SECTION_ROUTES, withGroupHeadings } from './sections.js';
import { notifiableUnreadIds } from '@/utils/conversationAttention.js';

// Directive: when the label text overflows its container, expose the
// overflow amount via a CSS variable so a hover animation can scroll it.
const marqueeDirective = {
  mounted(el) {
    const recalc = () => {
      const inner = el.querySelector('.cv-sb-label-inner');
      if (!inner) return;
      const containerWidth = el.clientWidth;
      if (containerWidth === 0) return; // hidden (sidebar collapsed)
      const contentWidth = inner.scrollWidth;
      const overflow = contentWidth - containerWidth;
      if (overflow > 0) {
        el.style.setProperty('--marquee-distance', `-${overflow + 8}px`);
        el.classList.add('cv-sb-overflow');
      } else {
        el.classList.remove('cv-sb-overflow');
        el.style.removeProperty('--marquee-distance');
      }
    };
    el._marqueeRecalc = recalc;
    el._marqueeRO = new ResizeObserver(() => requestAnimationFrame(recalc));
    el._marqueeRO.observe(el);
    requestAnimationFrame(recalc);
  },
  updated(el) {
    if (el._marqueeRecalc) requestAnimationFrame(el._marqueeRecalc);
  },
  beforeUnmount(el) {
    if (el._marqueeRO) {
      el._marqueeRO.disconnect();
      el._marqueeRO = null;
    }
  },
};

export default {
  name: 'CanvasScreen',
  components: { WidgetCanvas, WidgetCatalog, Tooltip, ChatProviderSelector, SimpleModal },
  directives: { marquee: marqueeDirective },
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
    const simpleModal = ref(null);
    let clockTimer = null;

    // Sidebar collapse/expand state (persisted to localStorage, expanded by default)
    const SIDEBAR_STORAGE_KEY = 'agnt:canvasSidebar:expanded';
    const isSidebarExpanded = ref(true);
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) isSidebarExpanded.value = stored === 'true';
    } catch (e) {
      isSidebarExpanded.value = true;
    }
    function toggleSidebar() {
      isSidebarExpanded.value = !isSidebarExpanded.value;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarExpanded.value));
      } catch (e) {
        // ignore storage failures
      }
    }

    // The rail force-collapses to its 44px icon strip below this width no
    // matter what isSidebarExpanded says (see the NARROW VIEWPORTS block in the
    // stylesheet), so the flag alone does not tell you whether a label is on
    // screen. Keep this in sync with that @media rule.
    const NARROW_RAIL_QUERY = '(max-width: 800px)';
    const isNarrowViewport = ref(false);
    let narrowRailQuery = null;
    const syncNarrowViewport = (event) => {
      isNarrowViewport.value = event.matches;
    };

    // Whether the rail is currently showing its text labels.
    //
    // Every tooltip in the rail is suppressed exactly when it is: repeating a
    // label that is already on screen, one gap to its right, is noise. When a
    // label is too long for the rail the marquee directive above scrolls it on
    // hover, so nothing becomes unreadable by losing the tooltip.
    //
    // Keyed off the LABEL being visible rather than off isSidebarExpanded,
    // because those differ: a narrow desktop window renders the icon strip
    // with the flag still true, and that is precisely the case that needs its
    // tooltips back.
    const railLabelsVisible = computed(() => isSidebarExpanded.value && !isNarrowViewport.value);

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

    // Global model display
    const globalModelLabel = computed(() => {
      const model = store.state.aiProvider?.selectedModel;
      return model || '';
    });

    const globalProviderLabel = computed(() => {
      const provider = store.state.aiProvider?.selectedProvider;
      if (!provider) return '';
      // Custom providers store a UUID in selectedProvider — resolve to the friendly name.
      const customProviders = store.state.aiProvider?.customProviders || [];
      const custom = customProviders.find((cp) => cp.id === provider);
      if (custom) return custom.provider_name || provider;
      return provider.replace(/\./g, '-').toLowerCase(); // fixes BS for z-ai
    });

    // Global provider selector dropdown
    const isGlobalProviderSelectorOpen = ref(false);
    const globalSelectorStyle = ref({});

    const toggleGlobalProviderSelector = (event) => {
      if (isGlobalProviderSelectorOpen.value) {
        isGlobalProviderSelectorOpen.value = false;
        return;
      }
      globalSelectorStyle.value = {
        right: '5px',
        top: '38px',
      };
      isGlobalProviderSelectorOpen.value = true;
    };

    const activePageId = computed(() => store.getters['widgetLayout/activePageId']);
    const activePage = computed(() => store.getters['widgetLayout/activePage']);
    const allPages = computed(() => store.getters['widgetLayout/allPages']);

    // Track when user has navigated to a custom page (no section)
    const onCustomPage = ref(false);

    // Section data (static)
    const mainSections = MAIN_SECTIONS;
    const bottomSections = BOTTOM_SECTIONS;
    // Precomputed once: the registry is static, so group boundaries are too.
    const mainRail = withGroupHeadings(MAIN_SECTIONS);

    // Green dot on the Chat nav: "a conversation finished changing and you
    // haven't seen it". EXACTLY the set that rings the chime — unread minus
    // still-streaming (notifiableUnreadIds) — so the dot lights when the ding
    // fires and clears when the last unread is opened. Deliberately does NOT
    // exclude the selected conversation: selection is not attention (the
    // whole email-model rule), and this dot exists precisely to be seen from
    // OTHER screens.
    const hasUnreadChats = computed(() => {
      const unread = store.getters['contentOutputs/unreadOutputIdSet'];
      const streaming = store.getters['chat/streamingOutputIds'];
      return notifiableUnreadIds(unread, { streamingIds: streaming }).size > 0;
    });

    // Custom pages = pages that don't belong to any section.
    // Also exclude workspace:* rows (owned by /api/workspaces) so tab names
    // like General/Coding never appear as left-sidebar custom pages.
    const customPages = computed(() =>
      allPages.value.filter(
        (p) => !SECTION_ROUTES.has(p.route) && !(typeof p.route === 'string' && p.route.startsWith('workspace:')),
      ),
    );

    // Is the active page a custom (user-created) page?
    const isCustomPage = computed(() => onCustomPage.value);

    // Find the active section based on current screenName. Every screen has
    // exactly one owning row — sections.spec.js enforces it — so the screen
    // name alone decides which row is lit.
    const activeSection = computed(() => {
      return ALL_SECTIONS.find((s) => s.screens.some((t) => t.screen === props.screenName)) || null;
    });

    // Sub-tabs shown in toolbar = the active section's screens, minus any
    // marked `tab: false` — those are routed and owned by the section but
    // navigated from the screen's own left panel instead.
    const activeSectionTabs = computed(() => {
      return activeSection.value ? activeSection.value.screens.filter((t) => t.tab !== false) : [];
    });

    // A screen hidden from its own tab strip has nothing in that strip to
    // highlight, so the toolbar would show a row of tabs with none of them
    // selected — which reads as a bug. Name the screen instead, the same way a
    // custom page is named.
    const untabbedScreenLabel = computed(() => {
      const owned = activeSection.value?.screens.find((t) => t.screen === props.screenName);
      return owned?.tab === false ? owned.label : '';
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
      'fas fa-th',
      'fas fa-home',
      'fas fa-star',
      'fas fa-heart',
      'fas fa-bolt',
      'fas fa-rocket',
      'fas fa-globe',
      'fas fa-chart-bar',
      'fas fa-code',
      'fas fa-database',
      'fas fa-server',
      'fas fa-shield-alt',
      'fas fa-cube',
      'fas fa-palette',
      'fas fa-terminal',
      'fas fa-brain',
      'fas fa-atom',
      'fas fa-fire',
      'fas fa-gem',
      'fas fa-crown',
      'fas fa-flask',
      'fas fa-leaf',
      'fas fa-moon',
      'fas fa-sun',
      'fas fa-cloud',
    ];

    const modal = ref({
      show: false,
      type: 'input',
      title: '',
      value: '',
      icon: 'fas fa-th',
      showIconPicker: false,
      message: '',
      okLabel: 'OK',
      danger: false,
    });
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
        result = modal.value.showIconPicker ? { value: modal.value.value, icon: modal.value.icon } : modal.value.value;
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
      const result = await showModal({
        type: 'input',
        title: 'Rename Page',
        value: page.name,
        icon: page.icon || 'fas fa-th',
        showIconPicker: true,
        okLabel: 'Rename',
      });
      if (result && result.value && result.value.trim()) {
        store.dispatch('widgetLayout/renamePage', { pageId: page.id, name: result.value.trim(), icon: result.icon });
      }
    }

    async function doResetPage() {
      const page = ctxMenu.value.page;
      closeCtx();
      if (!page) return;
      const ok = await simpleModal.value?.showModal({
        title: 'Reset Layout?',
        message: `Reset "${page.name}" to its default layout? All widget positions will be lost.`,
        confirmText: 'Reset',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
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
      const ok = await simpleModal.value?.showModal({
        title: 'Delete Page?',
        message: `Delete "${page.name}"? This cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (ok) {
        store.dispatch('widgetLayout/deletePage', page.id);
        onCustomPage.value = false;
        emit('screen-change', 'ChatScreen');
      }
    }

    async function startAddPage() {
      const result = await showModal({ type: 'input', title: 'New Page', value: '', icon: 'fas fa-th', showIconPicker: true, okLabel: 'Create' });
      if (result && result.value && result.value.trim()) {
        // Set onCustomPage immediately so the template switches to WidgetCanvas
        // before the async fetch in addPage completes
        onCustomPage.value = true;
        store.dispatch('widgetLayout/addPage', { name: result.value.trim(), icon: result.icon || 'fas fa-th' });
      }
    }

    function switchToPage(pageId) {
      onCustomPage.value = true;
      store.dispatch('widgetLayout/setActivePage', pageId);
    }

    function navigateToSection(section) {
      onCustomPage.value = false;
      emit('screen-change', section.screens[0].screen);
    }

    async function resetCurrentPage() {
      const page = activePage.value;
      if (!page) return;
      const ok = await simpleModal.value?.showModal({
        title: 'Reset Layout?',
        message: `Reset "${page.name}" to its default layout? All widget positions will be lost.`,
        confirmText: 'Reset',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (!ok) return;
      const dw = page.route ? getDefaultLayout(page.route) : [];
      store.dispatch('widgetLayout/resetPageToDefault', { pageId: page.id, defaultWidgets: dw });
    }

    // Ensure a page exists for the current screen (synchronous for instant render).
    //
    // `allowCreate` is what keeps this from minting duplicate pages. Until
    // fetchLayouts() resolves, the store's `pages` array is EMPTY, so
    // `pageForRoute` cannot tell "no page exists" from "pages aren't loaded
    // yet" — it answers null either way. Creating on that answer wrote a new
    // row + POST /api/layouts on every cold start, which the subsequent
    // SET_PAGES then discarded: one orphaned row per launch.
    //
    // ACTIVATING an already-known page is safe at any time; only CREATION has
    // to wait for the truth. Deferring it costs nothing visually, because
    // section screens render through the <slot/> below, not through
    // WidgetCanvas — the page row only backs the toolbar title and the page
    // switcher entry.
    function ensurePageForScreen(screenName, { allowCreate = true } = {}) {
      // Route-driven navigation → we're on a section page, not a custom page
      onCustomPage.value = false;
      const existingPage = store.getters['widgetLayout/pageForRoute'](screenName);
      if (existingPage) {
        store.dispatch('widgetLayout/setActivePage', existingPage.id);
        return;
      }
      // Not loaded yet — the post-fetch pass below will create it if it's
      // genuinely missing.
      if (!allowCreate) return;
      const defaultWidgets = getDefaultLayout(screenName);
      // Don't await - commits happen synchronously, API save is background
      store.dispatch('widgetLayout/createPageFromDefault', { screenName, defaultWidgets });
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

      if (window.matchMedia) {
        narrowRailQuery = window.matchMedia(NARROW_RAIL_QUERY);
        isNarrowViewport.value = narrowRailQuery.matches;
        narrowRailQuery.addEventListener('change', syncNarrowViewport);
      }

      const layoutsLoaded = store.getters['widgetLayout/isLoaded'];
      if (!layoutsLoaded) {
        // Fire and forget - don't block render. Once layouts finish loading we
        // know the truth, so this pass is the one allowed to create.
        store.dispatch('widgetLayout/fetchLayouts').then(() => {
          ensurePageForScreen(props.screenName);
        });
      }
      // Synchronous pass for instant render: activate what we already know,
      // but never create before the fetch above has told us what exists.
      ensurePageForScreen(props.screenName, { allowCreate: layoutsLoaded });
    });

    onBeforeUnmount(() => {
      if (clockTimer) clearInterval(clockTimer);
      document.removeEventListener('click', closeCtx);
      narrowRailQuery?.removeEventListener('change', syncNarrowViewport);
    });

    return {
      isAuthenticated,
      globalModelLabel,
      globalProviderLabel,
      showCatalog,
      clock,
      activePageId,
      activePage,
      allPages,
      mainSections,
      bottomSections,
      mainRail,
      railLabelsVisible,
      hasUnreadChats,
      customPages,
      isCustomPage,
      onCustomPage,
      activeSection,
      activeSectionTabs,
      untabbedScreenLabel,
      ctxMenu,
      openContextMenu,
      modal,
      modalInputRef,
      simpleModal,
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
      isGlobalProviderSelectorOpen,
      globalSelectorStyle,
      toggleGlobalProviderSelector,
      isSidebarExpanded,
      toggleSidebar,
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
  border-bottom: 1px solid var(--terminal-border-color);
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
  color: var(--color-text);
  border-color: var(--color-dull-navy);
}

.cv-pbtn.on {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.15);
  background: rgba(var(--primary-rgb), 0.04);
}

/* Unread-chats indicator — same green as the sidebar rows' unread dot
   (--color-green), same meaning: a conversation finished changing and you
   haven't opened it. Sits inline after the CHAT tab label… */
.cv-unread-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-green);
  margin-left: 5px;
  vertical-align: middle;
  flex-shrink: 0;
}

/* …and badge-cornered on the sidebar's Chat icon so it is visible from any
   section, collapsed or expanded. */
.cv-unread-dot-sb {
  position: absolute;
  top: 4px;
  right: 4px;
  margin-left: 0;
}

.cv-page-title {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--color-primary);
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

.cv-global-model {
  font-size: 11px;
  color: var(--color-primary);
  letter-spacing: 0.5px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.7;
}
.cv-global-model i {
  font-size: 10px;
}

.cv-global-model-clickable {
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: opacity 0.15s;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
}

.cv-global-model-clickable:hover {
  opacity: 1;
  border-color: rgba(var(--primary-rgb), 0.2);
  background: rgba(var(--primary-rgb), 0.04);
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
  border-right: 1px solid var(--terminal-border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
  gap: 2px;
  user-select: none;
  transition:
    width 0.18s ease,
    min-width 0.18s ease,
    padding 0.18s ease;
}

.cv-sidebar.expanded {
  width: 110px;
  min-width: 110px;
  align-items: stretch;
  padding: 6px 6px;
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

/* ── Group captions ──
   Expanded, the caption names the group. Collapsed the rail is 44px wide, so
   the text is dropped and the caption survives as the divider rule it already
   carries — the grouping stays legible at both widths instead of vanishing
   with the labels. */
.cv-sb-cap {
  width: 100%;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 9px 7px 3px;
  margin-top: 4px;
  border-top: 1px solid var(--terminal-border-color);
}

.cv-sb-cap.is-first {
  border-top: none;
  margin-top: 0;
  padding-top: 2px;
}

.cv-sb-cap-text {
  display: none;
  font-size: 7px;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--color-text-muted, #445);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
}

.cv-sidebar.expanded .cv-sb-cap-text {
  display: inline-block;
}

/* Collapsed: caption reduces to its rule, matching .cv-sb-sep's width so the
   in-list dividers and the settings divider read as the same element. */
.cv-sidebar:not(.expanded) .cv-sb-cap {
  width: 24px;
  height: 1px;
  padding: 0;
  margin: 5px 0;
}

.cv-sidebar:not(.expanded) .cv-sb-cap.is-first {
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
  height: 30px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #445);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  flex-shrink: 0;
  /* Anchor for the .cv-unread-dot-sb badge on the Chat icon. */
  position: relative;
}

.cv-sb-page i {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

/* Label hidden by default - shown when sidebar is expanded */
.cv-sb-label {
  display: none;
  font-size: 10px;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  margin-left: 10px;
  text-align: left;
  flex: 1;
  min-width: 0;
  --marquee-distance: 0px;
}

.cv-sidebar.expanded .cv-sb-label {
  display: inline-block;
}

.cv-sb-label-inner {
  display: inline-block;
  white-space: nowrap;
  will-change: transform;
}

/* Marquee animation - only runs when label overflows AND the row is hovered */
.cv-sb-page:hover .cv-sb-label.cv-sb-overflow .cv-sb-label-inner,
.cv-sb-add:hover .cv-sb-label.cv-sb-overflow .cv-sb-label-inner,
.cv-sb-toggle:hover .cv-sb-label.cv-sb-overflow .cv-sb-label-inner {
  animation: cv-sb-marquee 4s linear infinite;
}

@keyframes cv-sb-marquee {
  0%,
  15% {
    transform: translateX(0);
  }
  55%,
  70% {
    transform: translateX(var(--marquee-distance, 0px));
  }
  100% {
    transform: translateX(0);
  }
}

.cv-sidebar.expanded .cv-sb-page,
.cv-sidebar.expanded .cv-sb-add,
.cv-sidebar.expanded .cv-sb-toggle {
  width: 100%;
  justify-content: flex-start;
  padding: 0 10px;
}

/* When expanded, make tooltip-container span full width so the row is clickable end-to-end */
.cv-sidebar.expanded :deep(.tooltip-container) {
  width: 100%;
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
  box-shadow: var(--glow-accent);
}

.cv-sb-add {
  width: 32px;
  height: 30px;
  border: 1px dashed var(--color-dull-navy);
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #334);
  cursor: pointer;
  font-size: 12px;
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

.cv-sb-add-icon {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  line-height: 1;
}

/* Collapse / expand toggle button */
.cv-sb-toggle {
  width: 32px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted, #445);
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  flex-shrink: 0;
  margin-top: 6px;
}

.cv-sb-toggle:hover {
  color: var(--color-text);
  border-color: var(--color-dull-navy);
  background: var(--color-darker-0);
}

.cv-sb-toggle i {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
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
  background: var(--color-background);
}

.cv-dashboard > * {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Outer gutter for dashboard content — the mode-conditional BASELINE.
 *
 * No background: 0. A section screen is the surface, so it runs edge to
 * edge; any inset would just be dead app-coloured space.
 *
 * Custom background: 4px. The canvas becomes a WINDOW — .cv-dashboard goes
 * transparent and the widget frames become the glass — so the wallpaper needs
 * a margin to actually be visible. Without it the widgets tile flush to every
 * edge and cover the image completely.
 *
 * The two WIDGET SURFACES are not baseline children: custom pages
 * (.widget-canvas) and the workspace (.ws-root) keep the 4px gutter in BOTH
 * modes — frames floating on a canvas want breathing room regardless of the
 * wallpaper. Each declares its own edges in its own file with body-anchored
 * selectors that deterministically outrank these (see WidgetCanvas.vue and
 * Workspace.vue), so this rule stays a contract, not an exception list.
 *
 * This rule used to read `:not(.widget-canvas)`, exempting the canvas from
 * the custom-bg gutter. That was correct while gridToPixel added an outer
 * GRID_GAP inset — the canvas supplied its own. The uniform-4px pass removed
 * that inset (see gridUtils.js: "the origin is the container edge") and the
 * exemption outlived its reason. GRID_GAP is now strictly a gutter BETWEEN
 * widgets; the outer one belongs here, where it can be conditional on the
 * background mode. */
.cv-dashboard > * {
  margin: 0px;
}

.custom-bg .cv-dashboard > * {
  margin: 4px;
}

/* ═══════════════════ CONTEXT MENU ═══════════════════ */
.cv-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 3px 0;
  min-width: 110px;
}

.cv-ctx-item {
  padding: 5px 12px;
  font-size: 11px;
  color: var(--color-text);
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
  background: var(--color-background);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cv-modal {
  background: var(--color-popup);
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
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
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
  color: var(--color-text);
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
  color: var(--color-text);
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
  color: var(--color-text);
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

/* ═══════════════════ NARROW VIEWPORTS ═══════════════════
   Measured on a 390x844 phone viewport: the sidebar's expanded state is
   persisted, so a desktop session that left it expanded hands the phone a
   full rail (measured at 120px, 133px with padding and border) out of 390px
   — a third of the screen — and pushed the entire three-panel container off
   to x=133 with a 257px width, which in turn overflowed the composer and put
   the send button at x=427, past the right edge and unclickable. The rail is
   110px now; the ratio that caused this is unchanged.

   The rail stays (navigation must remain reachable), but collapses to the
   44px icon strip regardless of the persisted expanded state.

   These rules MUST live in the scoped block: Vue appends [data-v-*] to scoped
   selectors, so the same selector written in the global block below scores one
   less specificity point than .cv-sidebar.expanded[data-v-*] and silently
   loses. */
@media (max-width: 800px) {
  .cv-sidebar,
  .cv-sidebar.expanded {
    width: 44px;
    min-width: 44px;
    align-items: center;
    padding: 6px 0;
  }

  .cv-sidebar.expanded .cv-sb-label {
    display: none;
  }

  /* width:100% (not auto) so the tap target spans the whole 44px rail. With
     `auto` the button shrinks to its 20px icon and you get a 20x44 target —
     technically present, practically a miss on a moving thumb. */
  .cv-sidebar.expanded .cv-sb-page,
  .cv-sidebar.expanded .cv-sb-add,
  .cv-sidebar.expanded .cv-sb-toggle {
    width: 100%;
    justify-content: center;
    padding: 0;
  }

  .cv-sidebar :deep(.tooltip-container) {
    width: 100%;
  }

  /* Touch targets: 44px is the Apple HIG / Material minimum. */
  .cv-sb-page,
  .cv-sb-add,
  .cv-sb-toggle {
    min-height: 44px;
    min-width: 44px;
  }

  /* The page-tab strip is 33px tall with 17px tabs — both below any usable
     touch size, and once the global 40px floor applies to its buttons they
     overflow the strip and clip. ~11px of vertical space buys tabs that can
     actually be hit.

     The TOOLBAR has to grow too, not just the strip: a 44px strip centred
     inside a 33px toolbar resolves to top:-6px and pushes the tab above the
     viewport, which is how this first went wrong. */
  .cv-toolbar {
    min-height: 44px;
    align-items: center;
  }

  .cv-nav-panels {
    align-items: center;
    min-height: 44px;
    padding: 0 6px;
  }

  .cv-pbtn {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
  }
}
</style>

<style>
/* ═══════════════════ CUSTOM BACKGROUND MODE ═══════════════════ */
body.custom-bg .cv-dashboard {
  background: transparent !important;
}

/* (The workspace root used to take a page-keyed margin override here. Both
   canvases now share the one gutter rule above — flush with no background,
   4px over a custom one — so no page needs a special case.) */

/* ═══════════════════ TOOLBAR PROVIDER SELECTOR ═══════════════════ */
.cv-toolbar-selector .provider-dropdown {
  margin-top: 0 !important;
  margin-left: 0 !important;
}
</style>
