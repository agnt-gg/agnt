<template>
  <div class="cv-root" :class="{ 'cv-compact': compactLayout }">
    <!-- ── TOOLBAR (top bar + titlebar) ── -->
    <div v-if="isAuthenticated" class="cv-toolbar">
      <button v-if="compactLayout" type="button" class="cv-mobile-menu" aria-label="Open navigation" :aria-expanded="!!navigationOpen" @click="openMobileNavigation"><i class="fas fa-bars"></i></button>
      <div v-if="compactLayout" class="cv-mobile-identity"><h1>{{ mobileTitle }}</h1></div>
      <button v-if="compactLayout && mobilePanels.left" class="cv-mobile-icon cv-mobile-browse" type="button" data-mobile-panel="left" :aria-label="screenName === 'ChatScreen' ? 'Saved chats' : 'Browse ' + mobileTitle" @click="requestMobilePanel('left')"><i :class="screenName === 'ChatScreen' ? 'fas fa-history' : 'fas fa-columns'" aria-hidden="true"></i></button>
      <button v-if="compactLayout && screenName === 'ChatScreen' && !showLibrary && !onCustomPage" class="cv-mobile-icon cv-mobile-new-chat" type="button" aria-label="New chat" @click="requestMobileNewChat"><i class="fas fa-edit" aria-hidden="true"></i></button>
      <button v-if="compactLayout && mobilePanels.right" class="cv-mobile-icon cv-mobile-inspector" type="button" data-mobile-panel="right" :aria-label="screenName === 'ChatScreen' ? 'This chat' : 'Inspector'" @click="requestMobilePanel('right')"><i class="fas fa-info-circle" aria-hidden="true"></i></button>
      <img class="cv-brand-logo" src="/images/agnt-logo-mark.svg" alt="AGNT" />

      <!-- Contextual sub-tabs for the active section, or custom page name -->
      <div class="cv-nav-panels" :class="{ 'cv-single-tab': activeSectionTabs.length < 2 && !untabbedScreenLabel }">
        <template v-if="showLibrary"><span class="cv-page-title">Library</span></template>
        <template v-else-if="onCustomPage && activePage">
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
            :class="{ on: screenName === tab.screen, ctx: tab.ctx }"
            @click="$emit('screen-change', tab.screen)"
          >
            {{ compactLayout ? titleCase(tab.label) : tab.label }}
            <span v-if="tab.screen === 'ChatScreen' && hasUnreadChats" class="cv-unread-dot"></span>
          </button>
        </template>
      </div>

      <!-- Jump (⌘K): the router when you do not know which row owns a thing.
           Centred so it reads as the one global control on the bar. -->
      <button class="cv-jump" data-tour-id="toolbar.jump" @click="openJump" v-tooltip="jumpHint">
        <i class="fas fa-search"></i>
        <span class="cv-jump-text">Jump to anything…</span>
        <kbd class="cv-kbd">{{ jumpKey }}</kbd>
      </button>

      <!-- Right side controls -->
      <div class="cv-right">
        <!-- Live pills: each is a click into the thing it counts. Only the
             provider pill is always drawn; the others appear when non-zero.
             Approvals deliberately have NO pill here: the header is for
             system state, and approvals live on the Goals board. -->
        <button v-if="pills.running" class="cv-pill" @click="goRunning" v-tooltip="'Running now — open Runs'">
          <span class="cv-pill-dot is-live"></span>{{ pills.running }} running
        </button>
        <button v-if="updateAvailable" class="cv-pill is-update" @click="goAbout" v-tooltip="'An update is ready — Settings › About'">
          <i class="fas fa-arrow-circle-up"></i> update
        </button>
        <button v-if="!globalProviderLabel" class="cv-pill is-red" @click="goProviders" v-tooltip="'Connect an AI provider'">
          <span class="cv-pill-dot is-red"></span>no provider
        </button>
        <span class="cv-clock" id="cvClock">{{ clock }}</span>
        <Tooltip text="Click to change model" width="auto" position="bottom">
          <button
            type="button"
            class="cv-global-model cv-global-model-clickable"
            aria-label="Change default AI model"
            :aria-expanded="isGlobalProviderSelectorOpen"
            @click="toggleGlobalProviderSelector"
          >
            <template v-if="globalModelLabel">{{ globalProviderLabel }}/{{ globalModelLabel }}</template>
            <template v-else>Select model</template>
            <i class="fas fa-caret-down" aria-hidden="true"></i>
          </button>
        </Tooltip>
        <!-- The space everything on screen belongs to (Personal or a team),
             right of the model: the two app-wide "which" controls, side by
             side. On a phone this bar is hidden, so it lives in the
             navigation drawer there instead (below). -->
        <WorkspaceSwitcher
          v-if="!compactLayout"
          toolbar
          :model-value="activeTeamId" :teams="workspaceTeams"
          :error="workspaceError" :unread="spaceUnread" :account="accountEmail" :personal-hint="personalHint"
          @select="selectWorkspace" @refresh="loadWorkspaceTeams"
        />
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
      <button v-if="compactLayout && navigationOpen" class="cv-nav-scrim" aria-label="Close navigation" @click="closeMobileNavigation()"></button>
      <div v-if="isAuthenticated" ref="navigationElement" class="cv-sidebar" :class="{ expanded: isSidebarExpanded, 'cv-navigation-open': navigationOpen }"
        :role="compactLayout ? 'dialog' : undefined" :aria-modal="compactLayout && navigationOpen ? 'true' : undefined"
        :aria-label="compactLayout ? 'Navigation' : undefined" :inert="compactLayout && !navigationOpen ? true : undefined"
        :aria-hidden="compactLayout && !navigationOpen ? 'true' : undefined" tabindex="-1">
        <!-- Phones only: the top bar's controls are hidden there. -->
        <WorkspaceSwitcher
          v-if="compactLayout"
          :model-value="activeTeamId" :teams="workspaceTeams" :compact="!railLabelsVisible"
          :error="workspaceError" :unread="spaceUnread" :account="accountEmail" :personal-hint="personalHint"
          @select="selectWorkspace" @refresh="loadWorkspaceTeams"
        />
        <!-- No Search row here on purpose. The rail lists DESTINATIONS, and
             search is an action, not a page — it is reached from the jump bar
             above the canvas and by its keyboard shortcut. Every row below
             comes from the navigation registry. -->
        <button v-if="compactLayout" type="button" class="cv-mobile-nav-close" @click="closeMobileNavigation()">Close navigation <i class="fas fa-times"></i></button>
        <!-- User-managed navigation: built-in and custom pages share one ordered, grouped rail. -->
        <div class="cv-sb-pages">
          <template v-for="(group, groupIndex) in navigationGroups" :key="group.name">
            <div class="cv-sb-cap" :class="{ 'is-first': groupIndex === 0 }">
              <span class="cv-sb-cap-text">{{ group.name }}</span>
            </div>
            <Tooltip v-for="item in group.items" :key="item.key" :text="item.label" position="right" width="auto" :disabled="railLabelsVisible">
              <button
                class="cv-sb-page"
                :class="{ active: isNavigationItemActive(item) }"
                :data-tour-id="item.type === 'page' ? undefined : `sidebar.${item.id}`"
                :aria-label="item.label"
                :aria-current="isNavigationItemActive(item) ? 'page' : undefined"
                @click="openMobileNavigationItem(item)"
                @contextmenu.prevent="item.type === 'page' && openContextMenu($event, item.page)"
              >
                <i :class="item.icon"></i>
                <span v-if="item.id === 'chat' && hasUnreadChats" class="cv-unread-dot cv-unread-dot-sb"></span>
                <span class="cv-sb-label" v-marquee>
                  <span class="cv-sb-label-inner">{{ item.label }}</span>
                </span>
                <!-- Badge lookup stays keyed by the registry section id; the preference layer only changes presentation. -->
                <span v-if="railBadges[item.id]" class="cv-sb-badge" :class="{ 'is-warn': item.id === 'apps' }">{{ railBadges[item.id] }}</span>
                <!-- Just unlocked and not yet visited. A live count outranks it. -->
                <span v-else-if="item.fresh" class="cv-sb-badge is-new" role="img" aria-label="New"></span>
              </button>
            </Tooltip>
          </template>
        </div>

        <!-- Add page button -->
        <Tooltip text="Add page" position="right" width="auto" :disabled="railLabelsVisible">
          <button class="cv-sb-add" data-tour-id="sidebar.add-page" @click="startMobileAddPage">
            <span class="cv-sb-add-icon">+</span>
            <span class="cv-sb-label" v-marquee>
              <span class="cv-sb-label-inner">New page</span>
            </span>
          </button>
        </Tooltip>

        <!-- Separator -->
        <div class="cv-sb-sep" v-if="bottomSections.length > 0"></div>

        <!-- Foot of the rail: Settings. No caption — a single row whose
             screen carries its own left-panel nav. -->
        <div class="cv-sb-bottom">
          <Tooltip v-for="section in bottomSections" :key="section.id" :text="section.label" position="right" width="auto" :disabled="railLabelsVisible">
            <button
              class="cv-sb-page"
              :class="{ active: !showLibrary && !onCustomPage && activeSection && activeSection.id === section.id }"
              :data-tour-id="`sidebar.${section.id}`"
              @click="navigateMobileSection(section)"
            >
              <i :class="section.icon"></i>
              <span class="cv-sb-label" v-marquee>
                <span class="cv-sb-label-inner">{{ section.label }}</span>
              </span>
              <span v-if="railBadges[section.id]" class="cv-sb-badge" :class="{ 'is-warn': section.id === 'apps' }">{{ railBadges[section.id] }}</span>
            </button>
          </Tooltip>

          <!-- Shown only to a plan that can actually upgrade. A paid account
               being sold what it already owns reads as a billing error, so
               enterprise and pro never see this. -->
          <Tooltip v-if="canUpgrade" text="Upgrade" position="right" width="auto" :disabled="railLabelsVisible">
            <button class="cv-sb-page cv-sb-upgrade" data-tour-id="sidebar.upgrade" @click="openUpgrade">
              <i class="fas fa-bolt"></i>
              <span class="cv-sb-label" v-marquee>
                <span class="cv-sb-label-inner">Upgrade</span>
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
      <div class="cv-dashboard" :inert="compactLayout && navigationOpen ? true : undefined">
        <!-- Persistent panel surfaces under the swapping screen: the frame
             each screen mounts is torn down on navigation, and for a frame or
             two nothing opaque covers this box (transparent under custom-bg).
             See PanelBackdrop.vue. -->
        <LibraryHome v-if="showLibrary" @navigate="onJumpNavigate" @teams="openPrimary('teams')" />
        <PanelBackdrop v-if="showPanelBackdrop" :screen-name="screenName" />

        <!-- Custom pages: full widget canvas system -->
        <WidgetCanvas
          v-if="!showLibrary && onCustomPage && activePageId"
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
        <!-- data-fullscreen-host: the one box a screen's "fullscreen" may fill.
             It is below the top bar and beside the sidebar by construction, so
             nothing expanded inside a screen can cover the app's own chrome. -->
        <div v-else v-show="!showLibrary" class="cv-personal-content" data-fullscreen-host><slot /></div>
      </div>
    </div>

    <nav v-if="isAuthenticated && compactLayout" class="mobile-destinations" aria-label="Primary navigation" :inert="navigationOpen ? true : undefined">
      <button v-for="destination in mobileDestinations" :key="destination.screen" type="button"
        :aria-current="!showLibrary && !onCustomPage && screenName === destination.screen ? 'page' : undefined"
        @click="openMobileDestination(destination.screen)">
        <i :class="destination.icon" aria-hidden="true"></i><span>{{ destination.label }}</span>
      </button>
      <button type="button" :aria-expanded="!!navigationOpen" :aria-current="onMobileDestination ? undefined : 'page'" @click="openMobileNavigation"><i class="fas fa-th-large" aria-hidden="true"></i><span>All pages</span></button>
    </nav>

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

    <!-- ⌘K -->
    <JumpPalette @navigate="onJumpNavigate" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import { titleCase } from './titleCase.js';
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
import { BOTTOM_SECTIONS, ALL_SECTIONS, visibleTabs } from './sections.js';
import { notifiableUnreadIds } from '@/utils/conversationAttention.js';
import { RAIL_BADGE_READERS, badgeLabel } from './railBadges.js';
import JumpPalette from './JumpPalette.vue';
import { currentTeamScope, homeOrigin, onTeamInstance, openPersonal, openTeam } from '@/composables/useSpaces.js';
import { rememberInstanceTeam } from '@/utils/teamScopeTransport.js';
import { teamRequest } from '@/utils/teamClient.js';
import LibraryHome from './LibraryHome.vue';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';
import { API_CONFIG } from '@/tt.config.js';
import { useMobileOverlay } from '@/composables/useMobileOverlay.js';
import PanelBackdrop from './PanelBackdrop.vue';
import { screenHasFrame } from '@/views/Terminal/CenterPanel/screenRegistry.js';
import { customNavigationPages, groupedNavigation, NAVIGATION_CHANGED_EVENT } from '@/services/navigationPreferences.js';
import { useNavigationOnion } from '@/composables/useNavigationOnion.js';

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
  components: { WidgetCanvas, WidgetCatalog, Tooltip, ChatProviderSelector, SimpleModal, JumpPalette, PanelBackdrop, LibraryHome, WorkspaceSwitcher },
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
    const isNarrowViewport = ref(window.matchMedia?.('(max-width: 800px)').matches ?? false);
    const compactLayout = computed(() => isNarrowViewport.value);
    const navigationElement = ref(null);
    const { active: navigationOpen, open: openNavigation, close: closeMobileNavigation } = useMobileOverlay(compactLayout, () => navigationElement.value);
    const openMobileNavigation = () => openNavigation('navigation');
    // Visiting a row is what makes it no longer new.
    function openMobileNavigationItem(item) { navigationOnion.seen(item.id); closeMobileNavigation({ restoreFocus: false }); openNavigationItem(item); }
    function navigateMobileSection(section) { closeMobileNavigation({ restoreFocus: false }); navigateToSection(section); }
    function startMobileAddPage() { closeMobileNavigation({ restoreFocus: false }); startAddPage(); }
    function openMobilePrimary(id) { closeMobileNavigation({ restoreFocus: false }); openPrimary(id); }
    watch(() => props.screenName, () => closeMobileNavigation({ restoreFocus: false }));
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
    const railLabelsVisible = computed(() => compactLayout.value ? !!navigationOpen.value : isSidebarExpanded.value && !isNarrowViewport.value);

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

    // The space this page RUNS in is fixed for its lifetime: a team page is a
    // different session (desktop) or a different page load (browser), never a
    // relabelled personal page. Membership management lives in Settings.
    const activeTeamId = ref(currentTeamScope()?.teamId || '');
    const workspaceTeams = ref([]);
    const workspaceError = ref('');
    // Teams is an onion fact too; it is only known once this canvas' own team
    // request has succeeded (a failed load is "unknown", never "none").
    const teamsLoaded = ref(false);
    // The rail grows with the account: see services/navigationOnion.js. An
    // unlock is announced only where the new row can actually be pointed at —
    // never over onboarding, never into a closed mobile drawer.
    const navigationOnion = useNavigationOnion(store, {
      teams: workspaceTeams,
      teamsKnown: teamsLoaded,
      canAnnounce: computed(() => !compactLayout.value && !store.getters['userAuth/shouldShowOnboarding']),
    });
    // Who is signed in HERE: each instance is its own site, so a mismatch is otherwise invisible.
    const accountEmail = computed(() => store.state.userAuth?.userEmail || '');
    // Where Personal leads from a workspace: the instance this tab came from, by name.
    const personalHint = computed(() => { if(!activeTeamId.value)return ''; const home=homeOrigin(); try{return home?new URL(home).hostname.split('.')[0]:''}catch{return ''} });
    const NO_PERSONAL_SPACE='This is a shared workspace. Your personal space is the AGNT desktop app, or a Personal Cloud instance.';
    let workspaceGeneration = 0;
    let workspaceRequest = null;
    const showLibrary = ref(false);
    watch(() => props.screenName, () => { showLibrary.value=false; });
    const activePageId = computed(() => store.getters['widgetLayout/activePageId']);
    const activePage = computed(() => store.getters['widgetLayout/activePage']);
    const allPages = computed(() => store.getters['widgetLayout/allPages']);

    // Track when user has navigated to a custom page (no section)
    const onCustomPage = ref(false);

    // Settings can hide, move, and regroup both built-in and custom pages.
    const bottomSections = BOTTOM_SECTIONS;

    // Only a plan that can actually buy something is offered the upgrade.
    // Anything already paid for (pro, enterprise, and the founder tiers) is
    // excluded by allow-listing the plans that CAN upgrade rather than
    // blocklisting the ones that cannot — a new paid tier added later must not
    // start advertising Pro to the people who outrank it.
    const UPGRADEABLE_PLANS = ['free', 'community', 'trial', ''];
    const canUpgrade = computed(() =>
      UPGRADEABLE_PLANS.includes(String(store.getters['userAuth/planType'] || '').toLowerCase())
    );
    const openUpgrade = () => {
      closeMobileNavigation({ restoreFocus: false });
      emit('screen-change', 'SettingsScreen', { section: 'billing' });
    };
    const navigationRevision = ref(0);
    const refreshNavigation = () => { navigationRevision.value += 1; };

    // Green dot on the Chat nav: "a conversation finished changing and you
    // haven't seen it". EXACTLY the set that rings the chime — unread minus
    // still-streaming (notifiableUnreadIds) — so the dot lights when the ding
    // fires and clears when the last unread is opened. Deliberately does NOT
    // exclude the selected conversation: selection is not attention (the
    // whole email-model rule), and this dot exists precisely to be seen from
    // OTHER screens.
    const unreadChatCount = computed(() => {
      const unread = store.getters['contentOutputs/unreadOutputIdSet'];
      const streaming = store.getters['chat/streamingOutputIds'];
      return notifiableUnreadIds(unread, { streamingIds: streaming }).size;
    });
    const hasUnreadChats = computed(() => unreadChatCount.value > 0);
    // One inbox across spaces: this space reports its own count; the space picker shows the others'.
    watch(unreadChatCount, count => window.electron?.spaces?.reportUnread?.(count), { immediate: true });
    const spaceUnread = ref({});
    let stopSpaceUpdates = null;
    const applySpaceState = state => {
      spaceUnread.value = Object.fromEntries((state?.spaces || []).map(space => [space.kind === 'team' ? space.teamId : '', space.unread || 0]));
    };
    onMounted(() => {
      const host = window.electron?.spaces;
      if (!host) return;
      stopSpaceUpdates = host.onChanged?.(applySpaceState) || null;
      host.list?.().then(applySpaceState).catch(error => console.warn('[spaces] list:', error.message));
    });
    onBeforeUnmount(() => stopSpaceUpdates?.());

    // Shared with Settings → Navigation so both arrange the same page list.
    const customPages = computed(() => customNavigationPages(allPages.value));
    const navigationGroups = computed(() => {
      navigationRevision.value;
      // Verbatim: whatever Settings → Navigation says is visible, in its order,
      // in its groups. No id is filtered here — a rail that quietly drops rows
      // makes the settings screen a description of a sidebar nobody has.
      return groupedNavigation(customPages.value);
    });

    // Is the active page a custom (user-created) page?
    const isCustomPage = computed(() => onCustomPage.value);
    // Library is a panel laid over the screen, so its state determines whether
    // it is active. Every other row is a real
    // destination and lights itself from activeSection / activePageId.
    const primaryActive = computed(() => {
      if(showLibrary.value)return 'library';
      return '';
    });
    function isNavigationItemActive(item) {
      if (item.type === 'virtual') return primaryActive.value === item.id;
      if (showLibrary.value) return false;
      if (item.type === 'page') return onCustomPage.value && item.id === activePageId.value;
      return !onCustomPage.value && activeSection.value?.id === item.id;
    }
    // Asked once per page: the owner's first visit creates the team's default
    // project, which every team-scoped request needs (ScopeApiMiddleware).
    let projectEnsured=false;
    function ensureTeamProject(team){
      if(projectEnsured)return;projectEnsured=true;
      teamRequest('/'+encodeURIComponent(team.id)+'/workspaces/default').catch(error=>{
        if(error.code==='no_default_project')workspaceError.value='The owner of '+team.name+' has not opened it yet.';
        else console.warn('[spaces] default project:',error.message);
      });
    }
    /**
     * Is this page a team's own instance? Learned from the team list: the team
     * whose instance address IS this page's origin. Such a page is only ever that
     * team (the backend enforces it: routes/TeamInstanceScope.js); remembering it
     * makes the next load the team from first paint instead of "Personal".
     */
    function adoptInstanceTeam(teams){
      const own=teams.find(t=>{try{return Boolean(t.tenantUrl)&&new URL(t.tenantUrl).origin===window.location.origin}catch{return false}});
      if(own){
        rememberInstanceTeam(own);
        if(activeTeamId.value!==own.id)activeTeamId.value=own.id;
      } else if(onTeamInstance()){
        // No longer on that team: stop labelling this page as it. The server refuses its data anyway.
        rememberInstanceTeam(null);
      }
      const active=teams.find(t=>t.id===activeTeamId.value);
      if(active)ensureTeamProject(active);
    }
    function syncWorkspaceTeams(teams) {
      workspaceTeams.value=teams;workspaceError.value='';teamsLoaded.value=true;
      adoptInstanceTeam(teams);
      // The desktop keeps one space per team; this list is the full membership, so a removed team's space closes.
      window.electron?.spaces?.syncTeams(teams.filter(t=>t.tenantUrl).map(t=>({id:t.id,name:t.name,tenantUrl:t.tenantUrl})),{replace:true})
        .catch(error=>console.warn('[spaces] sync:',error.message));
    }
    async function loadWorkspaceTeams() {
      if(!isAuthenticated.value)return;
      const generation=workspaceGeneration;
      if(workspaceRequest)return workspaceRequest;
      const request=(async()=>{
        try {
          const response=await fetch(API_CONFIG.BASE_URL+'/teams',{headers:{Authorization:'Bearer '+(localStorage.getItem('token')||'')}});
          if(!response.ok)throw Error('Teams unavailable ('+response.status+').');
          const teams=await response.json();if(!Array.isArray(teams))throw Error('Invalid team list.');
          if(generation===workspaceGeneration)syncWorkspaceTeams(teams);
        }catch(error){if(generation===workspaceGeneration){workspaceError.value='Cannot load teams.';console.warn('[WorkspaceSwitcher]',error.message)}}
      })();
      workspaceRequest=request;
      try{await request}finally{if(workspaceRequest===request)workspaceRequest=null}
    }
    /**
     * Switch the WHOLE app to a space. Nothing here relabels the current page:
     * the desktop swaps to that space's own isolated view, a browser navigates
     * to that space. '__manage' opens team management instead.
     */
    async function selectWorkspace(id) {
      if(id==='__manage'){openPrimary('teams');return;}
      if(id===activeTeamId.value){showLibrary.value=false;return;}
      try {
        if(!id){if(!(await openPersonal()))workspaceError.value=NO_PERSONAL_SPACE;return;}
        const team=workspaceTeams.value.find(t=>t.id===id);if(!team)return;
        if(!(await openTeam(team)))workspaceError.value=team.name+' has no instance address yet.';
      } catch(error){workspaceError.value='Cannot open that space.';console.warn('[spaces]',error.message);}
    }
    // The rail rows that are not screens: Search opens the palette, Teams and
    // Library open a panel over whatever is mounted (which is how a draft in
    // the screen underneath survives a trip through them).
    const mobileDestinations = [
      { screen: 'ChatScreen', label: 'Chat', icon: 'fas fa-comment' },
      { screen: 'DashboardScreen', label: 'Dashboard', icon: 'fas fa-chart-line' },
      { screen: 'GoalsScreen', label: 'Goals', icon: 'fas fa-bullseye' },
      { screen: 'TracesScreen', label: 'Activity', icon: 'fas fa-bolt' },
    ];
    const onMobileDestination = computed(() => !showLibrary.value && !onCustomPage.value
      && mobileDestinations.some((destination) => destination.screen === props.screenName));
    // The phone header names the page you are on (the approved atlas: Skills,
    // not Agents, while the Skills tab is open). The section's sibling pages
    // sit beneath it as chips; pages render no second title of their own.
    const mobileTitle = computed(() => {
      if (showLibrary.value) return 'Library';
      if (onCustomPage.value && activePage.value?.name) return activePage.value.name;
      if (untabbedScreenLabel.value) return untabbedScreenLabel.value;
      return titleCase(activeSectionTabs.value.find((tab) => tab.screen === props.screenName)?.label || activeSection.value?.label || 'AGNT');
    });
    const mobilePanels = computed(() => {
      const panels = store.getters['shell/screenPanels'] || {};
      const onScreen = !showLibrary.value && !onCustomPage.value && panels.screenId === props.screenName;
      return { left: onScreen && panels.left, right: onScreen && panels.right };
    });
    const requestMobilePanel = (side) => window.dispatchEvent(new CustomEvent(side === 'left' ? 'agnt:toggle-left-panel' : 'agnt:toggle-right-panel'));
    const requestMobileNewChat = () => window.dispatchEvent(new CustomEvent('agnt:mobile-new-chat'));
    function openMobileDestination(screen) {
      closeMobileNavigation({ restoreFocus: false });
      showLibrary.value = false;
      onCustomPage.value = false;
      emit('screen-change', screen, {});
    }
    function openPrimary(id) {
      if(id==='teams'){
        showLibrary.value=false;onCustomPage.value=false;
        closeMobileNavigation({ restoreFocus: false });
        emit('screen-change','SettingsScreen',{section:'members'});
        return;
      }
      // Library is always this space's library: every API it calls is already scoped to the space.
      if(id==='library'){onCustomPage.value=false;showLibrary.value=true;return}
      showLibrary.value=false;onCustomPage.value=false;
      emit('screen-change','ChatScreen',{});
    }
    watch(() => [isAuthenticated.value,store.state.userAuth?.token], () => {
      workspaceGeneration++;workspaceRequest=null;workspaceTeams.value=[];workspaceError.value='';
      if(isAuthenticated.value)loadWorkspaceTeams();
    }, {immediate:true});

    // Find the active section based on current screenName. Every screen has
    // exactly one owning row — sections.spec.js enforces it — so the screen
    // name alone decides which row is lit.
    const activeSection = computed(() => {
      return ALL_SECTIONS.find((s) => s.screens.some((t) => t.screen === props.screenName)) || null;
    });

    // Sub-tabs shown in toolbar = the active section's screens, minus any
    // marked `tab: false` (routed and owned by the section but navigated from
    // the screen's own left panel) and minus `ctx: true` entries that are not
    // the active screen (editors appear only while you are inside them).
    const activeSectionTabs = computed(() => visibleTabs(activeSection.value, props.screenName));

    // ── Rail badges ── the small live count on a row that has something
    // happening. Readers live in railBadges.js so the number here and the
    // number on the screen it leads to come from one getter.
    const railBadges = computed(() => {
      const out = {};
      for (const section of ALL_SECTIONS) {
        if (!section.badge) continue;
        const reader = RAIL_BADGE_READERS[section.badge];
        out[section.id] = reader ? badgeLabel(reader(store)) : '';
      }
      return out;
    });

    // ── Toolbar pills ──
    const pills = computed(() => ({
      running: badgeLabel(RAIL_BADGE_READERS.traces(store)),
    }));
    const updateAvailable = computed(() => store.getters['shell/updateAvailable']);
    function goRunning() {
      store.dispatch('shell/inspect', { kind: 'running', screen: 'TracesScreen' });
      onCustomPage.value = false;
      emit('screen-change', 'TracesScreen', { status: 'running' });
    }
    // AI models are Settings › AI Models, not an app. Settings re-reads
    // ?section= on every activation (initializeScreen), so this lands on the
    // right view even when Settings is already mounted, and the link survives
    // a reload.
    function goProviders() {
      onCustomPage.value = false;
      emit('screen-change', 'SettingsScreen', { section: 'providers' });
    }
    function goAbout() {
      onCustomPage.value = false;
      emit('screen-change', 'SettingsScreen', { section: 'about' });
    }

    // The backdrop exists only where the three-panel frame does. Custom pages
    // (widget canvas) and frameless screens (Workspace) draw their own gutters
    // and MUST show the wallpaper between widgets — a backdrop there filled
    // the gaps in. One predicate drives both the component and the body class
    // that makes the frame's panels transparent, so they can never disagree.
    const showPanelBackdrop = computed(() => !showLibrary.value && !onCustomPage.value && screenHasFrame(props.screenName));
    function syncBackdropClass() {
      document.body.classList.toggle('has-panel-backdrop', showPanelBackdrop.value);
    }
    watch(showPanelBackdrop, syncBackdropClass);

    // ── Jump (⌘K) ──
    const isMacKeys = navigator.platform.toUpperCase().includes('MAC');
    const jumpKey = isMacKeys ? '⌘K' : 'Ctrl K';
    const jumpHint = `Jump to anything (${jumpKey})`;
    function openJump() {
      store.dispatch('shell/openJump');
    }
    function onJumpNavigate(screen, opts) {
      showLibrary.value=false;

      onCustomPage.value = false;
      emit('screen-change', screen, opts || {});
    }
    // Global shortcuts. ⌘K / Ctrl-K toggles Jump; ⌘\\ and ⌘⇧\\ toggle the side
    // panels (BaseScreen owns the flags and listens for these events). Typing
    // in an input never intercepts ⌘K — it is a chord, not a character.
    function onGlobalKeydown(e) {
      // Esc pops one layer: Jump (handled by the palette itself) → inspector
      // selection → nothing. Never while typing in a field.
      if (e.key === 'Escape' && compactLayout.value) return;
      if (e.key === 'Escape' && !store.getters['shell/jumpOpen'] && store.getters['shell/inspect']) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (!['input', 'textarea', 'select'].includes(tag) && !e.target?.isContentEditable) {
          store.dispatch('shell/clearInspect');
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'k' && !e.altKey) {
        e.preventDefault();
        store.dispatch('shell/toggleJump');
      } else if (e.key === '\\') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(e.shiftKey ? 'agnt:toggle-right-panel' : 'agnt:toggle-left-panel'));
      }
    }

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
      showLibrary.value=false;

      onCustomPage.value = true;
      store.dispatch('widgetLayout/setActivePage', pageId);
    }
    // Panels (Dashboard's left) ask the canvas to switch pages by event: the
    // custom-page flag lives here and nowhere else.
    const onOpenTeamWorkspace = () => { openPrimary('teams'); };
    function onOpenPageEvent(e) {
      const id = e.detail?.pageId;
      if (id) switchToPage(id);
    }

    function navigateToSection(section) {
      showLibrary.value=false;

      onCustomPage.value = false;
      emit('screen-change', section.screens[0].screen);
    }
    function openNavigationItem(item) {
      if (item.type === 'page') switchToPage(item.id);
      else if (item.type === 'virtual') openPrimary(item.id);
      else navigateToSection(item.section);
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
      document.addEventListener('keydown', onGlobalKeydown);
      // The backdrop is the panel surface while it is mounted; the frame's own
      // panels go transparent under it (see _core.css). Custom pages have no
      // backdrop, so the class follows onCustomPage.
      syncBackdropClass();
      window.addEventListener('agnt:open-page', onOpenPageEvent);
      window.addEventListener('agnt:open-team-workspace',onOpenTeamWorkspace);
      window.addEventListener('agnt:team-membership-changed',loadWorkspaceTeams);
      window.addEventListener('agnt:new-page', startAddPage);
      window.addEventListener(NAVIGATION_CHANGED_EVENT, refreshNavigation);

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
      workspaceGeneration++;
      if (clockTimer) clearInterval(clockTimer);
      document.removeEventListener('click', closeCtx);
      document.removeEventListener('keydown', onGlobalKeydown);
      document.body.classList.remove('has-panel-backdrop');
      window.removeEventListener('agnt:open-page', onOpenPageEvent);
      window.removeEventListener('agnt:open-team-workspace',onOpenTeamWorkspace);
      window.removeEventListener('agnt:team-membership-changed',loadWorkspaceTeams);
      window.removeEventListener('agnt:new-page', startAddPage);
      window.removeEventListener(NAVIGATION_CHANGED_EVENT, refreshNavigation);
      narrowRailQuery?.removeEventListener('change', syncNarrowViewport);
    });

    return {
      compactLayout, navigationElement, navigationOpen, openMobileNavigation, closeMobileNavigation,
      openMobileNavigationItem, navigateMobileSection, startMobileAddPage, openMobilePrimary,
      isAuthenticated,
      primaryActive, openPrimary, isNavigationItemActive, mobileDestinations, openMobileDestination, onMobileDestination, mobileTitle, mobilePanels, requestMobilePanel, requestMobileNewChat, titleCase,
      activeTeamId,spaceUnread,workspaceTeams,workspaceError,accountEmail,personalHint,selectWorkspace,syncWorkspaceTeams,loadWorkspaceTeams,
      globalModelLabel,
      globalProviderLabel,
      showCatalog,
      clock,
      activePageId,
      activePage,
      allPages,
      bottomSections,
      canUpgrade,
      openUpgrade,
      navigationGroups,
      railLabelsVisible,
      hasUnreadChats,
      customPages,
      isCustomPage,
      onCustomPage,
      showPanelBackdrop,
      activeSection,
      activeSectionTabs,
      untabbedScreenLabel,
      railBadges,
      pills,
      updateAvailable,
      goRunning,
      goProviders,
      goAbout,
      jumpKey,
      jumpHint,
      openJump,
      showLibrary,
      onJumpNavigate,
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
      openNavigationItem,
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

/* Reference sidebar: scope first, then the destinations from the registry. */

.cv-personal-content{position:relative;height:100%;min-height:0;display:flex;flex-direction:column}.cv-personal-content>*{flex:1;min-height:0}

.cv-mobile-menu, .cv-mobile-nav-close { border: 0; background: transparent; color: var(--color-text); min-width: 44px; min-height: 44px; cursor: pointer; -webkit-app-region: no-drag; }
.cv-mobile-nav-close { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; width: 100%; border-bottom: 1px solid var(--terminal-border-color); }
.cv-nav-scrim { position: fixed; inset: 0; height: var(--app-height); border: 0; background: rgba(0,0,0,.5); z-index: 1200; }
.cv-root.cv-compact .cv-sidebar { box-sizing: border-box; align-items: stretch; position: fixed; top: 0; left: 0; width: min(340px, 100%); min-width: 0; height: var(--app-height); z-index: 1201; background: var(--color-background); transform: translateX(-100%); visibility: hidden; }
.cv-root.cv-compact .cv-sidebar.cv-navigation-open { transform: none; visibility: visible; }
.cv-root.cv-compact .cv-sidebar.expanded .cv-sb-label, .cv-root.cv-compact .cv-sidebar .cv-sb-label, .cv-root.cv-compact .cv-sb-cap-text { display: block; opacity: 1; width: auto; }
.cv-root.cv-compact .cv-sidebar.expanded .cv-sb-page, .cv-root.cv-compact .cv-sidebar.expanded .cv-sb-add { justify-content: flex-start; gap: 12px; min-height: 48px; padding: 8px 16px; }
.cv-root.cv-compact .cv-sidebar .cv-sb-pages { align-items: stretch; min-height: 0; }
/* Compact drawers always show full captions, independent of the saved rail
   collapse state. border-box prevents 100% + padding from spilling left. */
.cv-root.cv-compact .cv-sidebar .cv-sb-cap {
  display: block; box-sizing: border-box; width: 100%; height: auto;
  margin: 8px 0 0; padding: 16px 16px 8px; min-height: 36px;
}
.cv-root.cv-compact .cv-sidebar .cv-sb-cap.is-first { display: block; margin-top: 0; padding-top: 12px; }
.cv-root.cv-compact .cv-sidebar .cv-sb-cap-text { display: block; opacity: 1; font-size: 10px; }
.cv-root.cv-compact .cv-sidebar .cv-sb-page,
.cv-root.cv-compact .cv-sidebar .cv-sb-add { box-sizing: border-box; width: 100%; min-height: 48px; justify-content: flex-start; padding: 8px 16px; gap: 12px; }
.cv-root.cv-compact .cv-sidebar .cv-sb-label { margin-left: 0; font-size: 12px; }
.cv-root.cv-compact .cv-sidebar .cv-sb-badge { position: static; margin-left: 4px; }
.cv-root.cv-compact .cv-sb-toggle { display: none; }
.cv-root.cv-compact .cv-toolbar { height: auto; min-height: 52px; flex-wrap: wrap; padding: 0 6px; }
.cv-root.cv-compact .cv-brand-logo { display: none; }
.cv-root.cv-compact .cv-nav-panels { flex: 1; min-width: 0; overflow-x: auto; }
.cv-root.cv-compact .cv-jump { position: static; transform: none; width: 44px; min-width: 44px; height: 44px; margin: 0; display: flex; justify-content: center; }
.cv-root.cv-compact .cv-jump-text, .cv-root.cv-compact .cv-kbd, .cv-root.cv-compact .cv-clock { display: none; }
.cv-root.cv-compact .cv-right { width: 100%; justify-content: flex-end; min-width: 0; flex-wrap: wrap; gap: 4px; }
.cv-root.cv-compact .cv-global-model { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-root.cv-compact .cv-dashboard { min-width: 0; width: 100%; }
/* Custom-page stacks are the one direct canvas child that scrolls. The
   desktop frame's general > * overflow:hidden rule must not clip them. */
.cv-root.cv-compact .cv-dashboard > .widget-canvas {
  overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain;
  padding: 12px; box-sizing: border-box;
}
.cv-root.cv-compact .cv-navigation-open {
  background: var(--color-popup) !important;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
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
  position: relative; /* anchors the centred Jump field */
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

/* Contextual tab: an editor you are inside right now. Amber so it reads as
   "where you are", not "where you can go". */
.cv-pbtn.ctx.on {
  color: var(--color-yellow, #ffd700);
  border-color: rgba(255, 215, 0, 0.22);
  background: rgba(255, 215, 0, 0.05);
}

/* ── Jump (⌘K) ── */
.cv-jump {
  -webkit-app-region: no-drag;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, 34vw);
  height: 22px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-dull, #767888);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.cv-jump:hover {
  border-color: rgba(var(--primary-rgb), 0.35);
  color: var(--color-text-muted);
}
.cv-jump i {
  font-size: 10px;
}
.cv-jump-text {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-kbd {
  font-family: inherit;
  font-size: 9px;
  padding: 0 4px;
  border: 1px solid var(--terminal-border-color);
  border-bottom-width: 2px;
  border-radius: 3px;
  color: var(--color-text-muted);
  line-height: 13px;
}
@media (max-width: 900px) {
  .cv-jump-text,
  .cv-kbd {
    display: none;
  }
  .cv-jump {
    width: 28px;
    justify-content: center;
  }
}

/* ── Live pills ── */
.cv-pill {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--terminal-border-color);
  background: rgba(255, 255, 255, 0.02);
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.3px;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.cv-pill:hover {
  border-color: rgba(var(--primary-rgb), 0.4);
  color: var(--color-text);
}
.cv-pill.is-red {
  color: var(--color-red);
  border-color: rgba(254, 78, 78, 0.35);
}
.cv-pill.is-update {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.35);
}
.cv-pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-green);
  box-shadow: 0 0 6px var(--color-green);
}
.cv-pill-dot.is-live {
  background: var(--color-blue, #12e0ff);
  box-shadow: 0 0 6px var(--color-blue, #12e0ff);
  animation: cv-pill-pulse 1.8s infinite;
}
.cv-pill-dot.is-red {
  background: #fe4e4e;
  box-shadow: 0 0 6px #fe4e4e;
}
@keyframes cv-pill-pulse {
  70% {
    box-shadow: 0 0 0 5px rgba(18, 224, 255, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(18, 224, 255, 0);
  }
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
  background: transparent;
  font-family: inherit;
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
  /* 9px: at 7px the three groups did not exist for anyone reading the rail,
     and the grouping is the reason the rail makes sense. */
  font-size: 9px;
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
  height: 28px;
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

/* Upgrade: the one row that is an offer rather than a destination, so it is the
   one row with a filled background. Inherits .cv-sb-page geometry exactly — it
   must read as the same size button as Settings above it, not as an ornament.
   Flat gold on a darker gold border. NO glow, no gradient, no shadow. */
.cv-sb-upgrade {
  background: rgba(212, 175, 55, 0.14);
  border-color: rgba(212, 175, 55, 0.42);
  color: var(--color-yellow);
}

.cv-sb-upgrade:hover {
  background: rgba(212, 175, 55, 0.2);
  border-color: rgba(212, 175, 55, 0.6);
  color: var(--color-yellow);
}

.cv-sb-upgrade:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.7);
  outline-offset: -2px;
}

/* Sits apart from Settings so it reads as its own thing, not another nav row. */
.cv-sidebar .cv-sb-upgrade {
  margin-top: 6px;
}

.cv-sidebar.expanded .cv-sb-upgrade .cv-sb-label-inner {
  font-weight: 600;
  letter-spacing: 0.3px;
}

/* Live count on a row that has something happening. Expanded it sits at the
   row's right edge; collapsed it badges the icon's corner like the unread dot. */
.cv-sb-badge {
  display: none;
  margin-left: 4px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.cv-sb-badge.is-warn {
  color: var(--color-yellow, #ffd700);
}
/* A row the account just unlocked: a 6px dot in the live-count slot, so the
   label is never truncated and the rail never reflows; blue, so it is never
   mistaken for the green unread dot or a count. */
.cv-sb-badge.is-new {
  width: 6px;
  height: 6px;
  padding: 0;
  border-radius: 50%;
  background: var(--color-blue, #12e0ff);
  flex-shrink: 0;
}
.cv-sidebar.expanded .cv-sb-badge {
  display: inline-block;
}
.cv-sidebar:not(.expanded) .cv-sb-badge {
  display: inline-block;
  position: absolute;
  top: 1px;
  right: 2px;
  margin: 0;
  font-size: 8px;
  line-height: 10px;
  padding: 0 3px;
  border-radius: 5px;
  background: var(--color-background);
  border: 1px solid var(--terminal-border-color);
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
  height: 28px;
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
  height: 28px;
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

.cv-dashboard > .cv-backdrop {
  flex: none; /* absolutely positioned; must not take a flex slot */
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
