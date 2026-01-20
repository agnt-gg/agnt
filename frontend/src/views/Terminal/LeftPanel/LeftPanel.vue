<template>
  <div class="left-panel">
    <button v-if="isMobile" @click="closePanel" class="mobile-close-button">Back ></button>

    <!-- Use the Header component and pass props -->
    <Header :stats="stats" :formattedTokens="formattedTokens">
      <template #nav-links>
        <Navigation :activeScreen="activeScreen" @navigate="handleNavigation" />
      </template>
    </Header>

    <!-- Dynamic panel content -->
    <Suspense>
      <template #default>
        <div class="panel-content-wrapper">
          <component
            v-if="activePanelComponent"
            :is="activePanelComponent"
            ref="activePanelComponentRef"
            v-bind="props.panelProps"
            @panel-action="handlePanelAction"
          />
          <div v-else class="default-left-panel">
            <!-- Default left panel content -->
            <div class="nav-section">
              <h4>Quick Actions</h4>
              <div class="quick-actions">
                <button class="action-btn" @click="handleQuickAction('new-chat')"><i class="fas fa-plus"></i> New Chat</button>
                <button class="action-btn" @click="handleQuickAction('new-workflow')"><i class="fas fa-cogs"></i> New Workflow</button>
                <button class="action-btn" @click="handleQuickAction('new-agent')"><i class="fas fa-robot"></i> New Agent</button>
              </div>
            </div>

            <div class="nav-section">
              <h4>Recent</h4>
              <div class="recent-items">
                <div class="recent-item">
                  <i class="fas fa-comment"></i>
                  <span>Chat Session #1</span>
                </div>
                <div class="recent-item">
                  <i class="fas fa-cog"></i>
                  <span>Data Workflow</span>
                </div>
                <div class="recent-item">
                  <i class="fas fa-robot"></i>
                  <span>Assistant Agent</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #fallback>
        <div class="loading-panel"></div>
      </template>
    </Suspense>
  </div>
</template>

<script>
import { computed, defineAsyncComponent, ref, inject } from 'vue';
import { useStore } from 'vuex';
import Header from '../LeftPanel/header/Header.vue';
import Navigation from '../LeftPanel/header/Navigation.vue';

// Dynamic panel loader function
const loadPanel = (panelName) => {
  return defineAsyncComponent(() =>
    import(`./types/${panelName}/${panelName}.vue`).catch(() => {
      // console.warn(`Panel ${panelName} not found, falling back to ChatPanel`);
      return import('./types/ChatPanel/ChatPanel.vue');
    })
  );
};

// Known panels for fallback (can be expanded as needed)
const knownPanels = ['AgentPanel', 'ChatPanel', 'RunsPanel', 'SettingsPanel', 'ToolForgePanel', 'ToolsPanel', 'WorkflowForgePanel', 'WorkflowsPanel'];

export default {
  name: 'LeftPanel',
  components: { Header, Navigation },
  props: {
    activeScreen: {
      type: String,
      required: true,
    },
    activePanel: {
      type: [String, null],
      required: false,
      default: null,
    },
    panelProps: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const activePanelComponentRef = ref(null);
    const isMobile = inject('isMobile', ref(false));
    const store = useStore();

    const activePanelComponent = computed(() => {
      // If we have an activePanel prop, try to load it dynamically
      if (props.activePanel) {
        return loadPanel(props.activePanel);
      }

      // Try to derive panel name from activeScreen
      if (props.activeScreen) {
        // Convert screen names to panel names (e.g., 'chat' -> 'ChatPanel')
        const panelName = props.activeScreen.charAt(0).toUpperCase() + props.activeScreen.slice(1).toLowerCase() + 'Panel';

        // Check if this is a known panel, otherwise try to load it dynamically
        if (knownPanels.includes(panelName)) {
          return loadPanel(panelName);
        } else {
          // Try to load it anyway, will fall back to ChatPanel if not found
          return loadPanel(panelName);
        }
      }

      // Default fallback to ChatPanel
      return loadPanel('ChatPanel');
    });

    const stats = computed(
      () =>
        store.getters['userStats/stats'] || {
          tokens: 0,
          totalWorkflows: 0,
          totalCustomTools: 0,
          tokensPerDay: 0,
        }
    );

    const formattedTokens = computed(() => store.getters['userStats/formattedTokens'] || '0');

    const closePanel = () => {
      emit('panel-action', 'close-left-panel');
    };

    const handlePanelAction = (action, payload) => {
      emit('panel-action', action, payload);
    };

    const handleQuickAction = (action) => {
      emit('panel-action', 'quick-action', action);
    };

    const handleNavigation = (targetScreenId) => {
      emit('panel-action', 'navigate', targetScreenId);
    };

    return {
      stats,
      formattedTokens,
      activePanelComponent,
      activePanelComponentRef,
      isMobile,
      closePanel,
      handlePanelAction,
      handleQuickAction,
      handleNavigation,
      props,
    };
  },
};
</script>

<style scoped>
.left-panel {
  flex-shrink: 0;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  border-right: 1px solid var(--terminal-border-color);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 12px;
  position: relative;
  z-index: 3;
  scrollbar-width: none;
  container-type: inline-size;
  container-name: left-panel;
}

/* Compact padding for narrow panels */
@container left-panel (max-width: 320px) {
  .left-panel {
    padding: 8px;
    gap: 8px;
  }
}

@container left-panel (max-width: 280px) {
  .left-panel {
    padding: 6px;
    gap: 6px;
  }
}

.left-panel-header {
  border-bottom: 1px solid rgba(127, 129, 147, 0.08);
  padding-bottom: 12px;
}

.panel-title {
  color: var(--color-green);
  font-size: 1.1em;
  font-weight: 600;
  margin: 0;
  text-shadow: 0 0 5px rgba(25, 239, 131, 0.3);
}

.mobile-close-button {
  background: none;
  border: 1px solid var(--color-dull-navy);
  color: var(--color-light-med-navy);
  padding: 4px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.9em;
  align-self: flex-start;
}

.mobile-close-button:hover {
  color: var(--color-white);
  opacity: 0.5;
}

.panel-content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.default-left-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nav-section h4 {
  color: var(--color-light-green);
  font-size: 0.9em;
  font-weight: 500;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.8;
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  color: var(--color-light-green);
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
  text-align: left;
}

.action-btn:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.5);
  transform: translateX(2px);
}

.action-btn i {
  width: 14px;
  text-align: center;
}

.recent-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  font-size: 0.85em;
  color: var(--color-light-med-navy);
}

.recent-item:hover {
  background: rgba(25, 239, 131, 0.05);
  color: var(--color-light-green);
}

.recent-item i {
  width: 12px;
  text-align: center;
  opacity: 0.7;
}

.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-green);
  font-family: 'Courier New', monospace;
  text-shadow: 0 0 5px rgba(25, 239, 131, 0.4);
  flex: 1;
}

/* Scrollbar styling */
.left-panel::-webkit-scrollbar {
  display: none;
  width: 8px;
}

.left-panel::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 16px 0px 0px 16px;
}

.left-panel::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 16px 0px 0px 16px;
  border: 1px solid rgba(25, 239, 131, 0.6);
  cursor: default;
}

.left-panel::-webkit-scrollbar-thumb:hover {
  background-color: rgba(25, 239, 131, 0.6);
}

@media (max-width: 800px) {
  .left-panel {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    max-width: 400px;
    height: 100%;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.3s ease-in-out;
    border-right: none;
    box-shadow: 5px 0 15px rgba(0, 0, 0, 0.3);
  }

  .left-panel.panel-active {
    transform: translateX(0);
  }
}
</style>
