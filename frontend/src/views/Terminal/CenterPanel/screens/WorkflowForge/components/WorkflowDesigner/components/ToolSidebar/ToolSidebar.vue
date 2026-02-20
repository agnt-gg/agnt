<template>
  <div id="sidebar-wrapper" :class="{ closed: isClosed }">
    <SimpleModal ref="simpleModal" />
    <div id="sidebar" class="no-select" :class="{ closed: isClosed }">
      <button class="close-sidebar-button" @click="toggleSidebar" type="button">&lsaquo;</button>
      <div class="inner-sidebar">
        <input v-model="searchQuery" type="text" placeholder="Search tools..." class="search-input" />
        <div v-for="(section, sectionName) in filteredTools" :key="sectionName" :id="`sidebar-${sectionName}`" class="sidebar-section">
          <p class="title">{{ formatSectionName(sectionName) }}</p>
          <div
            v-for="(node, index) in section"
            :key="node.title"
            v-show="index < 3 || expandedSections[sectionName]"
            class="node starter"
            :class="{ 'locked-node': isNodeLocked(node) }"
            :data-category="node.category"
            :data-type="node.type"
            :data-requires-pro="node.requiresPro || false"
            :data-is-plugin="node.isPlugin || false"
            :data-plugin-name="node.pluginName || ''"
            :draggable="!isNodeLocked(node)"
            @dragstart="handleDragStart"
          >
            <SvgIcon :name="node.icon" />
            <p>{{ node.title }}</p>
            <span v-if="node.requiresPro && !isPro" class="pro-badge">PRO</span>
            <i v-if="isNodeLocked(node)" class="fas fa-lock lock-icon"></i>
            <svg data-v-719d46ce="" xmlns="http://www.w3.org/2000/svg" width="10" height="14" viewBox="0 0 10 14" fill="none">
              <path
                data-v-719d46ce=""
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M3.07692 1.81486C3.07692 2.20777 2.91484 2.58459 2.62632 2.86242C2.3378 3.14025 1.94649 3.29634 1.53846 3.29634C1.13044 3.29634 0.739122 3.14025 0.450605 2.86242C0.162087 2.58459 0 2.20777 0 1.81486C0 1.42194 0.162087 1.04512 0.450605 0.76729C0.739122 0.489458 1.13044 0.333374 1.53846 0.333374C1.94649 0.333374 2.3378 0.489458 2.62632 0.76729C2.91484 1.04512 3.07692 1.42194 3.07692 1.81486ZM1.53846 8.48152C1.94649 8.48152 2.3378 8.32544 2.62632 8.04761C2.91484 7.76977 3.07692 7.39295 3.07692 7.00004C3.07692 6.60713 2.91484 6.23031 2.62632 5.95248C2.3378 5.67464 1.94649 5.51856 1.53846 5.51856C1.13044 5.51856 0.739122 5.67464 0.450605 5.95248C0.162087 6.23031 0 6.60713 0 7.00004C0 7.39295 0.162087 7.76977 0.450605 8.04761C0.739122 8.32544 1.13044 8.48152 1.53846 8.48152ZM1.53846 13.6667C1.94649 13.6667 2.3378 13.5106 2.62632 13.2328C2.91484 12.955 3.07692 12.5781 3.07692 12.1852C3.07692 11.7923 2.91484 11.4155 2.62632 11.1377C2.3378 10.8598 1.94649 10.7037 1.53846 10.7037C1.13044 10.7037 0.739122 10.8598 0.450605 11.1377C0.162087 11.4155 0 11.7923 0 12.1852C0 12.5781 0.162087 12.955 0.450605 13.2328C0.739122 13.5106 1.13044 13.6667 1.53846 13.6667ZM10 1.81486C10 2.20777 9.83791 2.58459 9.54939 2.86242C9.26088 3.14025 8.86956 3.29634 8.46154 3.29634C8.05351 3.29634 7.6622 3.14025 7.37368 2.86242C7.08517 2.58459 6.92308 2.20777 6.92308 1.81486C6.92308 1.42194 7.08517 1.04512 7.37368 0.76729C7.6622 0.489458 8.05351 0.333374 8.46154 0.333374C8.86956 0.333374 9.26088 0.489458 9.54939 0.76729C9.83791 1.04512 10 1.42194 10 1.81486ZM8.46154 8.48152C8.86956 8.48152 9.26088 8.32544 9.54939 8.04761C9.83791 7.76977 10 7.39295 10 7.00004C10 6.60713 9.83791 6.23031 9.54939 5.95248C9.26088 5.67464 8.86956 5.51856 8.46154 5.51856C8.05351 5.51856 7.6622 5.67464 7.37368 5.95248C7.08517 6.23031 6.92308 6.60713 6.92308 7.00004C6.92308 7.39295 7.08517 7.76977 7.37368 8.04761C7.6622 8.32544 8.05351 8.48152 8.46154 8.48152ZM8.46154 13.6667C8.86956 13.6667 9.26088 13.5106 9.54939 13.2328C9.83791 12.955 10 12.5781 10 12.1852C10 11.7923 9.83791 11.4155 9.54939 11.1377C9.26088 10.8598 8.86956 10.7037 8.46154 10.7037C8.05351 10.7037 7.6622 10.8598 7.37368 11.1377C7.08517 11.4155 6.92308 11.7923 6.92308 12.1852C6.92308 12.5781 7.08517 12.955 7.37368 13.2328C7.6622 13.5106 8.05351 13.6667 8.46154 13.6667Z"
                fill="#01052A"
                fill-opacity="0.25"
              ></path>
            </svg>
          </div>
          <div v-if="section.length > 3" class="expand-section" @click="toggleSection(sectionName)">
            {{ expandedSections[sectionName] ? 'Less' : 'More' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { debounce } from 'lodash-es';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/fetchWorkflowTools)
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'ToolSidebar',
  components: {
    SvgIcon,
    SimpleModal,
  },
  setup() {
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const isClosed = ref(localStorage.getItem('sidebarClosed') === 'true');
    const expandedSections = reactive({});
    const searchQuery = ref('');
    const isLoadingTools = ref(false);
    let pluginUpdateInterval = null;

    // Check if user has PRO plan using Vuex getter
    const planType = computed(() => {
      const plan = store.getters['userAuth/planType'] || 'free';
      console.log('🔍 ToolSidebar - Current planType:', plan);
      return plan;
    });
    const isPro = computed(() => {
      const result = planType.value !== 'free';
      console.log('🔍 ToolSidebar - isPro:', result, '(planType:', planType.value, ')');
      return result;
    });

    /**
     * Fetch workflow tools using centralized Vuex store
     */
    const fetchWorkflowTools = async () => {
      // Check if we already have tools and they are not too old (using the store's logic)
      const lastFetched = store.state.tools.workflowToolsLastFetched;
      const now = Date.now();
      const needsFetch = !lastFetched || now - lastFetched > 5 * 60 * 1000;

      if (needsFetch) {
        isLoadingTools.value = true;
        try {
          await store.dispatch('tools/fetchWorkflowTools');
          console.log('🔌 ToolSidebar - Fetched workflow tools via Vuex store');
        } catch (error) {
          console.error('Error fetching workflow tools:', error);
        } finally {
          isLoadingTools.value = false;
        }
      } else {
        console.log('🔌 ToolSidebar - Using cached workflow tools from Vuex');
      }
    };

    /**
     * Refresh plugin tools periodically
     */
    const refreshPluginTools = async () => {
      // Force refresh workflow tools to get latest plugins
      await store.dispatch('tools/fetchWorkflowTools', { force: true });
    };

    // Handler for plugin install events - refresh tools immediately
    const handlePluginInstalled = async () => {
      console.log('[ToolSidebar] Plugin installed, refreshing tools...');
      try {
        await refreshPluginTools();
        console.log('[ToolSidebar] Tools refreshed successfully');
      } catch (error) {
        console.error('[ToolSidebar] Error refreshing tools:', error);
      }
    };

    onMounted(() => {
      // Fetch workflow tools from Vuex store (centralized)
      fetchWorkflowTools();

      // Set up periodic refresh for plugin updates (every 5 minutes instead of 30 seconds)
      // This reduces unnecessary API calls while still catching plugin updates
      pluginUpdateInterval = setInterval(refreshPluginTools, 300000);

      // Listen for plugin install events to refresh immediately
      window.addEventListener('plugin-installed', handlePluginInstalled);
    });

    onUnmounted(() => {
      // Clean up interval
      if (pluginUpdateInterval) {
        clearInterval(pluginUpdateInterval);
      }
      // Clean up event listener
      window.removeEventListener('plugin-installed', handlePluginInstalled);
    });

    watch(
      () => store.state.userAuth.user,
      (newUser) => {
        console.log('User state changed:', newUser);
        if (newUser) {
          console.log('New user detected, fetching tools');
          fetchWorkflowTools();
        }
      }
    );

    // Get workflow tools from Vuex store (centralized source)
    const allTools = computed(() => {
      const storeTools = store.getters['tools/workflowTools'];
      if (storeTools) {
        const processedTools = {};
        Object.entries(storeTools).forEach(([category, tools]) => {
          if (Array.isArray(tools)) {
            processedTools[category] = tools.map((tool) => ({
              ...tool,
              requiresPro: tool.requiresPro || false,
            }));
          }
        });
        return processedTools;
      }

      // Return empty structure while loading
      return {
        triggers: [],
        actions: [],
        utilities: [],
        widgets: [],
        controls: [],
        custom: [],
      };
    });

    // Add computed property for filtered tools
    const filteredTools = computed(() => {
      const query = searchQuery.value.toLowerCase();

      const filtered = {};
      Object.entries(allTools.value).forEach(([category, tools]) => {
        let categoryTools = tools;

        // Apply search filter if query exists
        if (query) {
          categoryTools = tools.filter((tool) => tool.title.toLowerCase().includes(query) || tool.type.toLowerCase().includes(query));
        }

        // Sort alphabetically by title (case-insensitive)
        if (categoryTools.length > 0) {
          filtered[category] = [...categoryTools].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
        }
      });

      return filtered;
    });

    const toggleSection = (sectionName) => {
      playSound('buttonClick');
      expandedSections[sectionName] = !expandedSections[sectionName];
    };

    const toggleSidebar = () => {
      isClosed.value = !isClosed.value;
      localStorage.setItem('sidebarClosed', isClosed.value);
    };

    const formatSectionName = (name) => {
      return name.charAt(0).toUpperCase() + name.slice(1);
    };

    const simpleModal = ref(null);

    const handleDragStart = async (e) => {
      const type = e.target.getAttribute('data-type');
      const requiresPro = e.target.getAttribute('data-requires-pro') === 'true';

      // Block dragging for PRO nodes if user is not PRO
      if (requiresPro && !isPro.value) {
        e.preventDefault();
        const isPlugin = e.target.getAttribute('data-is-plugin') === 'true';
        const pluginName = e.target.getAttribute('data-plugin-name');

        let message = 'This feature requires a PRO subscription. Please upgrade to use this node.';
        if (isPlugin && pluginName) {
          message = `This plugin node requires a PRO subscription. Please upgrade to use the ${pluginName} plugin.`;
        }

        await simpleModal.value?.showModal({
          title: 'PRO Feature',
          message: message,
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      playSound('buttonClick');
      const category = e.target.getAttribute('data-category');
      const text = e.target.innerText.trim();
      e.dataTransfer.setData('text/plain', JSON.stringify({ text, type, category }));
    };

    const isNodeLocked = (node) => {
      return node.requiresPro && !isPro.value;
    };

    return {
      simpleModal,
      allTools,
      filteredTools,
      isClosed,
      expandedSections,
      toggleSection,
      toggleSidebar,
      formatSectionName,
      handleDragStart,
      searchQuery,
      isPro,
      isNodeLocked,
    };
  },
};
</script>

<style scoped>
/* Adjust styles for closed sidebar */
#sidebar.closed .search-input {
  display: none;
}

div#sidebar-wrapper {
  position: absolute;
  /* top: 16px;
  left: 64px; */
  width: fit-content;
  height: calc(100% - 29px);
  /* overflow: hidden; */
  overflow: visible;
  border: none;
  transition: 0.3s ease-in-out;
}

#sidebar {
  position: fixed;
  display: flex;
  top: 16px;
  left: 16px;
  max-width: 288px;
  width: -webkit-fill-available;
  height: calc(100% - 32px);
  background-color: transparent;
  border: none;
  border-radius: 0;
  /* margin: 48px; */
  padding: 0;
  padding-bottom: 72px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow: visible;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
  z-index: 3;
  width: 100%;
}

/* body.cyberpunk #sidebar {
  top: 32px;
  left: 32px;
  height: calc(100% - 64px);
} */

.inner-sidebar {
  position: fixed;
  display: flex;
  top: 16px;
  left: 16px;
  max-width: 288px;
  width: -webkit-fill-available;
  height: calc(100% - 32px);
  background-color: transparent;
  border: none;
  border-radius: 0;
  /* margin: 48px; */
  padding: 0;
  padding-bottom: 72px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow: scroll;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 0;
  z-index: 3;
  width: 288px;
}

/* body.cyberpunk .inner-sidebar {
  top: 32px;
  left: 32px;
  height: calc(100% - 64px);
} */

div.sidebar-section {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding-top: 16px;
  padding-bottom: 16px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

#sidebar p {
  font-weight: 400;
  color: var(--color-navy);
  opacity: 1;
  line-height: normal;
  white-space: nowrap;
}

body.dark #sidebar p {
  font-weight: 300;
}

#sidebar p.title {
  width: 100%;
  font-size: var(--font-size-sm);
  opacity: 0.5;
  line-height: 1.25;
  user-select: none;
}

.node {
  position: absolute;
  width: 280px;
  height: 48px;
  margin: auto;
  border-radius: 8px;
  border: 1px solid rgba(1, 5, 42, 0.25);
  /* background: var(--color-dull-white); */
  background: var(--color-lighter-1);
  color: var(--Dark-Navy, #01052a);
  font-family: var(--font-family-primary) !important;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  cursor: move;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  box-sizing: border-box;
  z-index: 2;
  margin: auto;
  text-align: center;
  transition: 0.3s ease;
}

.node.starter p {
  transform: scale(1);
  transition: 0.3s ease;
}

.node.starter {
  position: relative;
  width: 100%;
  height: 48px;
  border: none;
  background: var(--color-lighter-0);
  background-image: url("data:image/svg+xml,%3Csvg width='240' height='48' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='1' y='1' width='238' height='46' fill='none' stroke='rgba(1,5,42,0.25)' stroke-width='1' stroke-dasharray='5,8' rx='8' ry='8'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  /* opacity: .9; */
}

.node.starter[data-category='trigger'] {
  position: relative;
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 32px;
  /* background: #ebebebd9;
  background-image: url("data:image/svg+xml,%3Csvg width='240' height='48' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='1' y='1' width='238' height='46' fill='none' stroke='rgba(1,5,42,0.25)' stroke-width='1' stroke-dasharray='5,8' rx='22' ry='22'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%; */
}

div#sidebar-wrapper.closed {
  width: 48px;
}

#sidebar.closed {
  width: 48px;
  padding: 0;
  gap: 0;
}

#sidebar.closed div#sidebar-wrapper,
#sidebar.closed div.inner-sidebar {
  width: 48px;
  gap: 0;
}

#sidebar.closed div.sidebar-section {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  align-items: center;
  text-align: center;
  width: 48px;
  max-width: 48px;
  padding-top: 16px;
}

.sidebar-section:first-child {
  padding-top: 0 !important;
}

#sidebar.closed p.title {
  font-size: var(--font-size-sm);
  /* display: none; */
}

#sidebar.closed .node.starter {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: center;
  align-items: center;
  width: 48px;
  height: 48px;
  padding: 0;
  /* transition: none; */
}

#sidebar.closed .node.starter svg {
  transform: scale(1);
}

#sidebar.closed .node.starter p {
  width: 0;
  padding: 0;
  opacity: 0;
  transform: scale(0);
  pointer-events: none;
  transition: none;
}

#sidebar.closed .node.starter svg:last-child {
  display: none;
}

#sidebar.closed .node.starter[data-category='trigger'] {
  background-image: url("data:image/svg+xml,%3Csvg width='48' height='48' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='1' y='1' width='46' height='46' fill='none' stroke='rgba(1,5,42,0.25)' stroke-width='1' stroke-dasharray='5,8' rx='22' ry='22'/%3E%3C/svg%3E");
}

#sidebar.closed .node.starter {
  background-image: url("data:image/svg+xml,%3Csvg width='48' height='48' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='1' y='1' width='46' height='46' fill='none' stroke='rgba(1,5,42,0.25)' stroke-width='1' stroke-dasharray='5,8' rx='8' ry='8'/%3E%3C/svg%3E");
}

#sidebar.closed div#sidebar-triggers {
  padding-top: 0 !important;
}

.close-sidebar-button {
  position: absolute;
  top: 3px;
  right: 0;
  cursor: pointer;
  z-index: 4;
  color: var(--color-med-navy);
  font-size: 24px;
  line-height: 1;
  transition: transform 0.3s ease;
  opacity: 0.5;
}

#sidebar.closed .close-sidebar-button {
  top: -3px;
  right: -16px;
  transform: rotate(180deg);
}

body.dark .close-sidebar-button {
  color: var(--color-med-navy);
}

.expand-section {
  cursor: pointer;
  color: var(--color-navy);
  opacity: 0.5;
  font-size: var(--font-size-xs);
  /* font-weight: bold; */
  text-align: center;
}

body.dark .expand-section {
  color: var(--color-med-navy);
}

.search-input {
  width: calc(100% - 40px) !important;
  min-height: 26px;
  margin-bottom: 16px;
  color: var(--color-navy);
  border: 1px solid rgba(1, 5, 42, 0.15);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  background: transparent;
}

body.dark .search-input {
  border: 1px solid var(--color-dull-navy);
}

.pro-badge {
  position: absolute;
  right: 32px;
  padding: 2px 6px 1px;
  border-radius: 8px;
  font-size: 9px;
  font-weight: 700;
  background: rgba(255, 215, 0, 0.15);
  color: var(--color-yellow);
  border: 1px solid rgba(255, 215, 0, 0.4);
  text-transform: uppercase;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.3);
  pointer-events: none;
  z-index: 10;
}

#sidebar.closed .pro-badge {
  display: none;
}

/* Locked node styles */
.locked-node {
  opacity: 0.5;
  cursor: not-allowed !important;
  pointer-events: auto;
}

.locked-node:hover {
  opacity: 0.6;
}

.lock-icon {
  position: absolute;
  left: 16px;
  font-size: 14px;
  color: rgba(1, 5, 42, 0.4);
  pointer-events: none;
  z-index: 11;
}

body.dark .lock-icon {
  color: rgba(255, 255, 255, 0.3);
}

#sidebar.closed .lock-icon {
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
}

.node.starter.locked-node .lock-icon {
  display: none;
}

/* ELECTRON STYLES */

body.electron #sidebar-wrapper {
  top: 0;
}

body.electron #sidebar {
  top: 0;
}

body.electron .inner-sidebar {
  top: 16px;
}

body.electron .close-sidebar-button {
  top: 18px;
}

body.electron #sidebar.closed .close-sidebar-button {
  top: 13px;
}
</style>
