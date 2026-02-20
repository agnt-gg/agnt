<template>
  <div class="controls-panel">
    <button v-if="isMobile" @click="closePanel" class="mobile-close-button">< Back</button>

    <!-- Dynamic panel content -->
    <div class="panel-content-wrapper">
      <component
        v-if="activePanelComponent"
        :is="activePanelComponent"
        ref="activePanelComponentRef"
        v-bind="props.panelProps"
        @panel-action="handlePanelAction"
        @close-details="handleCloseDetails"
      />
      <div v-else class="no-panel-placeholder">
        <!-- Panel area available. Select an item for details. -->
      </div>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted, defineAsyncComponent, ref, watch, nextTick, inject } from 'vue';
import { useStore } from 'vuex';

// Lazy-load panel components on demand (cached so re-navigation is instant)
const panelCache = new Map();
const loadPanel = (panelName) => {
  if (panelCache.has(panelName)) {
    return panelCache.get(panelName);
  }
  const component = defineAsyncComponent(() =>
    import(`./types/${panelName}/${panelName}.vue`).catch(() => {
      return import('./types/ChatPanel/ChatPanel.vue');
    })
  );
  panelCache.set(panelName, component);
  return component;
};

export default {
  name: 'RightPanel',
  components: {},
  props: {
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
    const store = useStore();
    const activePanelComponentRef = ref(null);
    const isMobile = inject('isMobile', ref(false));

    const activePanelComponent = computed(() => {
      if (props.activePanel) {
        return loadPanel(props.activePanel);
      }

      // Show nothing when explicitly null
      if (props.activePanel === null) {
        return null;
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
        },
    );

    const formattedTokens = computed(() => store.getters['userStats/formattedTokens'] || '0');

    const closePanel = () => {
      emit('panel-action', 'close-panel');
    };

    const handlePanelAction = (action, payload) => {
      console.log('RightPanel: Received generic panel action:', action, payload);

      // Handle specific actions that should be processed by the right panel
      if (action === 'update-execution-details') {
        // Call the method on the active panel component if it exists
        if (activePanelComponentRef.value && activePanelComponentRef.value.updateSelectedExecution) {
          activePanelComponentRef.value.updateSelectedExecution(payload);
        }
        return;
      }

      if (action !== 'close-details') {
        emit('panel-action', action, payload);
      }
    };

    const handleCloseDetails = () => {
      console.log('RightPanel: Received close-details event.');
      emit('panel-action', 'close-details');
    };

    const fetchStats = () => {
      store.dispatch('userStats/fetchStats');
    };

    let pollingInterval;

    onMounted(() => {
      fetchStats();
      pollingInterval = setInterval(fetchStats, 5000);
    });

    onUnmounted(() => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    });

    watch(
      () => props.activePanel,
      (newPanel, oldPanel) => {
        console.log(`RightPanel: Active panel changed from "${oldPanel}" to "${newPanel}"`);
        activePanelComponentRef.value = null;
        nextTick(() => {
          console.log('RightPanel: Active panel component ref after change:', activePanelComponentRef.value);
        });
      },
    );

    return {
      stats,
      formattedTokens,
      activePanelComponent,
      handlePanelAction,
      handleCloseDetails,
      activePanelComponentRef,
      props,
      isMobile,
      closePanel,
    };
  },
};
</script>

<style scoped>
.controls-panel {
  flex-shrink: 0;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  background: var(--color-background);
  border-left: 1px solid var(--terminal-border-color);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 16px;
  position: relative;
  z-index: 3;
  scrollbar-width: none;
  /* border-bottom-right-radius: 10px; */
}

.mobile-close-button {
  background: none;
  border: 1px solid var(--color-dull-navy);
  color: var(--color-light-med-navy);
  padding: 4px 12px;
  margin-right: 0;
  cursor: pointer;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.9em;
}
.mobile-close-button:hover {
  /* background: var(--color-dull-navy); */
  color: var(--color-white);
  opacity: 0.5;
}

.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-med-navy);
  font-family: var(--font-family-mono);
  flex: 1;
}

/* Scrollbar styling */
.controls-panel::-webkit-scrollbar {
  display: none;
  width: 8px;
}

.controls-panel::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 0px 16px 16px 0px;
}

.controls-panel::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 0px 16px 16px 0px;
  border: 1px solid var(--color-duller-navy);
  cursor: default;
}

.controls-panel::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-duller-navy);
}

.panel-content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.no-panel-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-grey);
  font-style: italic;
  padding: 16px;
  text-align: center;
}
</style>

<style>
/* Global styles to hide RightPanel when LeftPanel chat is in fullscreen mode */
body.workflow-editor-fullscreen .controls-panel,
body.tool-editor-fullscreen .controls-panel,
body.agent-editor-fullscreen .controls-panel {
  z-index: 1 !important;
  pointer-events: none;
  opacity: 0;
}
</style>
