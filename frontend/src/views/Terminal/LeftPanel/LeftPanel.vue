<template>
  <div class="left-panel">
    <button v-if="isMobile" @click="closePanel" class="mobile-close-button">Back ></button>

    <!-- Dynamic panel content -->
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
  </div>
</template>

<script>
import { computed, ref, inject } from 'vue';

// Eagerly import all panel components so they're available instantly
import AgentForgePanel from './types/AgentForgePanel/AgentForgePanel.vue';
import AgentsPanel from './types/AgentsPanel/AgentsPanel.vue';
import ChatPanel from './types/ChatPanel/ChatPanel.vue';
import GoalsPanel from './types/GoalsPanel/GoalsPanel.vue';
import MarketplacePanel from './types/MarketplacePanel/MarketplacePanel.vue';
import RunsPanel from './types/RunsPanel/RunsPanel.vue';
import SecretsPanel from './types/SecretsPanel/SecretsPanel.vue';
import SettingsPanel from './types/SettingsPanel/SettingsPanel.vue';
import ToolForgePanel from './types/ToolForgePanel/ToolForgePanel.vue';
import ToolsPanel from './types/ToolsPanel/ToolsPanel.vue';
import WorkflowForgePanel from './types/WorkflowForgePanel/WorkflowForgePanel.vue';
import WorkflowsPanel from './types/WorkflowsPanel/WorkflowsPanel.vue';

const panelMap = {
  AgentForgePanel,
  AgentsPanel,
  ChatPanel,
  GoalsPanel,
  MarketplacePanel,
  RunsPanel,
  SecretsPanel,
  SettingsPanel,
  ToolForgePanel,
  ToolsPanel,
  WorkflowForgePanel,
  WorkflowsPanel,
};

const getPanel = (panelName) => panelMap[panelName] || ChatPanel;

export default {
  name: 'LeftPanel',
  components: {},
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

    const activePanelComponent = computed(() => {
      // If we have an activePanel prop, use it directly
      if (props.activePanel) {
        return getPanel(props.activePanel);
      }

      // Try to derive panel name from activeScreen
      if (props.activeScreen) {
        const panelName = props.activeScreen.charAt(0).toUpperCase() + props.activeScreen.slice(1).toLowerCase() + 'Panel';
        return getPanel(panelName);
      }

      // Default fallback to ChatPanel
      return ChatPanel;
    });

    const closePanel = () => {
      emit('panel-action', 'close-left-panel');
    };

    const handlePanelAction = (action, payload) => {
      emit('panel-action', action, payload);
    };

    const handleQuickAction = (action) => {
      emit('panel-action', 'quick-action', action);
    };

    return {
      activePanelComponent,
      activePanelComponentRef,
      isMobile,
      closePanel,
      handlePanelAction,
      handleQuickAction,
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
