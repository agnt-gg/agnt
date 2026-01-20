<template>
  <div ref="panelRef" id="editor-panel" v-if="isOpen" :class="{ 'full-screen': isFullScreen }" :style="panelStyle">
    <div class="panel-header" @mousedown="startDrag">
      <h2 class="title">/ {{ panelTitle }}</h2>
      <div class="right-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.name"
          class="tab-button"
          :class="{ active: activeTab === tab.name }"
          @click="setActiveTab(tab.name)"
        >
          <!-- <img :src="tab.icon" :alt="tab.name" :title="tab.title" /> -->
          <SvgIcon :name="tab.icon" :title="tab.title" />
        </button>
        <Tooltip :text="isFullScreen ? 'Contract Panel' : 'Expand Panel'" width="auto">
          <button class="tab-button" :class="{ active: isFullScreen }" @click="toggleFullScreen">
            <i :class="isFullScreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
        </Tooltip>
      </div>
    </div>
    <div class="panel-body" v-if="selectedNodeContent || selectedEdgeContent">
      <template v-if="selectedNodeContent && selectedNodeContent.error">
        <div class="error-message">
          <h3>Error:</h3>
          <p>{{ selectedNodeContent.error }}</p>
        </div>
      </template>
      <PanelTab
        :node-content="selectedNodeContent"
        :edge-content="selectedEdgeContent"
        :active-tab="activeTab"
        :tool-library="toolLibrary"
        :nodes="nodes"
        :node-output="selectedNodeContent ? selectedNodeContent.output : null"
        :customTools="customTools"
        :workflowId="workflowId"
        @update:nodeContent="updateNodeContent"
        @update:edgeContent="updateEdgeContent"
      />
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useStore } from 'vuex';
import PanelTab from './components/PanelTab.vue';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/workflowTools)
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default defineComponent({
  name: 'EditorPanel',
  components: {
    PanelTab,
    SvgIcon,
    Tooltip,
  },
  props: {
    isOpen: {
      type: Boolean,
      required: true,
    },
    selectedNodeContent: {
      type: Object,
      default: null,
    },
    selectedEdgeContent: {
      type: Object,
      default: null,
    },
    nodes: {
      type: Array,
      required: true,
    },
    customTools: {
      type: Array,
      default: () => [],
    },
    workflowId: {
      type: String,
      default: null,
    },
    activeFullscreenPanel: {
      type: String,
      default: null,
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const activeTab = ref('parameters');
    const isFullScreen = computed(() => props.activeFullscreenPanel === 'editor');
    const customTools = ref(props.customTools);

    // Get toolLibrary from Vuex store (centralized source)
    const toolLibrary = computed(() => store.getters['tools/workflowTools'] || {});

    // Fetch workflow tools on mount
    onMounted(() => {
      store.dispatch('tools/fetchWorkflowTools');
    });

    // --- Dragging State ---
    const panelRef = ref(null); // Template ref for the panel element
    const position = ref({ x: 0, y: 0 });
    const dragging = ref(false);
    const startPos = ref({ x: 0, y: 0 });
    const offset = ref({ x: 0, y: 0 });
    const lastPositionBeforeFullScreen = ref(null); // To store position before going full screen
    const padding = 32; // Padding from window edges
    const initialPositionSet = ref(false); // Flag to ensure initial position is set only once

    const tabs = [
      {
        name: 'parameters',
        icon: 'params',
        title: 'Node Parameters',
      },
      {
        name: 'outputs',
        icon: 'output',
        title: 'Node Outputs',
      },
      {
        name: 'docs',
        icon: 'document',
        title: 'Node Docs',
      },
    ];

    // Watch for changes in selectedEdgeContent
    watch(
      () => props.selectedEdgeContent,
      (newEdgeContent) => {
        if (newEdgeContent) {
          activeTab.value = 'parameters';
        }
      }
    );

    watch(
      () => props.customTools,
      (newCustomTools) => {
        customTools.value = newCustomTools;
      }
    );

    const visibleTabs = computed(() => {
      if (props.selectedEdgeContent) {
        return tabs.filter((tab) => tab.name === 'parameters');
      }
      return tabs;
    });

    const setActiveTab = (tabName) => {
      activeTab.value = tabName;
    };

    const panelTitle = computed(() => {
      if (props.selectedEdgeContent) {
        return 'Edge Parameters';
      }
      const tab = tabs.find((t) => t.name === activeTab.value);
      return tab ? tab.title : 'Edit Module';
    });

    // --- Dragging Logic ---
    const setInitialPosition = () => {
      if (!panelRef.value || initialPositionSet.value || !props.isOpen) return;

      const panelWidth = panelRef.value.offsetWidth;
      const topOffset = document.body.classList.contains('electron') ? 80 : 48; // Adjust based on electron/web
      const windowWidth = window.innerWidth;

      position.value = {
        x: windowWidth - panelWidth - padding,
        y: topOffset + padding, // Start near the top-right
      };
      initialPositionSet.value = true; // Mark as set
    };

    const startDrag = (event) => {
      // Don't drag if clicking on buttons inside the header
      if (event.target.closest('button')) {
        return;
      }
      // Prevent dragging in full-screen mode
      if (isFullScreen.value) {
        return;
      }

      dragging.value = true;
      startPos.value = { x: event.clientX, y: event.clientY };
      offset.value = { x: position.value.x, y: position.value.y };
      window.addEventListener('mousemove', handleDrag);
      window.addEventListener('mouseup', stopDrag);
      // Add user-select none to body to prevent text selection during drag
      document.body.style.userSelect = 'none';
    };

    const handleDrag = (event) => {
      if (!dragging.value || !panelRef.value) return;

      const panelWidth = panelRef.value.offsetWidth;
      const panelHeight = panelRef.value.offsetHeight;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const topOffset = document.body.classList.contains('electron') ? 80 : 48; // Consider header height

      const dx = event.clientX - startPos.value.x;
      const dy = event.clientY - startPos.value.y;

      let newX = offset.value.x + dx;
      let newY = offset.value.y + dy;

      // Clamp position within viewport boundaries with padding
      newX = Math.max(padding, Math.min(newX, windowWidth - panelWidth - padding));
      newY = Math.max(topOffset + padding, Math.min(newY, windowHeight - panelHeight - padding)); // Adjust top clamping for header

      position.value = {
        x: newX,
        y: newY,
      };
    };

    const stopDrag = () => {
      if (dragging.value) {
        dragging.value = false;
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', stopDrag);
        // Remove user-select none from body
        document.body.style.userSelect = '';
      }
    };

    // --- Full Screen Integration ---
    const toggleFullScreen = () => {
      const targetState = !isFullScreen.value;
      console.log('Toggling editor panel expanded mode to:', targetState);

      if (targetState) {
        lastPositionBeforeFullScreen.value = { ...position.value };
      }

      window.dispatchEvent(
        new CustomEvent('panel-fullscreen-toggle', {
          detail: { panel: 'editor', isFullScreen: targetState },
        })
      );

      // Explicitly emit event if being used in a context that listens for it
      emit('panel-fullscreen-toggle', { panel: 'editor', isFullScreen: targetState });

      nextTick(() => {
        if (!targetState && lastPositionBeforeFullScreen.value) {
          position.value = { ...lastPositionBeforeFullScreen.value };
        }
        if (!targetState && panelRef.value) {
          handleDrag({ clientX: startPos.value.x, clientY: startPos.value.y });
        }
      });
    };

    const closeModuleModal = () => {
      emit('update:isOpen', false);
      emit('deselect-all-nodes');
    };

    const updateNodeContent = (newContent) => {
      emit('update:nodeContent', newContent);
    };

    const updateEdgeContent = (newContent) => {
      emit('update:edgeContent', newContent);
    };

    // --- Dynamic Styles ---
    const panelStyle = computed(() => {
      if (isFullScreen.value) {
        // Cover entire screen with margin
        return {
          top: '8px',
          left: '8px',
          width: 'calc(100% - 50px)',
          height: 'calc(100% - 50px)',
          maxWidth: 'none',
          maxHeight: 'none',
          cursor: 'default',
        };
      }
      // Apply draggable position when not full screen
      return {
        top: `${position.value.y}px`,
        left: `${position.value.x}px`,
        cursor: dragging.value ? 'grabbing' : 'default',
      };
    });

    // --- Lifecycle Hooks ---
    let bodyClassObserver = null;

    onMounted(() => {
      // Use nextTick to ensure the element is rendered before calculating position
      nextTick(() => {
        setInitialPosition();
      });

      // Watch isOpen prop to set initial position when panel becomes visible
      watch(
        () => props.isOpen,
        (newVal) => {
          if (newVal) {
            nextTick(() => {
              setInitialPosition();
            });
          } else {
            // Reset flag if panel is closed, so position is recalculated if reopened
            initialPositionSet.value = false;
          }
        },
        { immediate: true }
      ); // immediate: true to run on mount too
    });

    onBeforeUnmount(() => {
      // Clean up listeners if component unmounts while dragging
      window.removeEventListener('mousemove', handleDrag);
      window.removeEventListener('mouseup', stopDrag);
      // Reset body style if component unmounts during drag
      if (dragging.value) {
        document.body.style.userSelect = '';
      }
      if (isFullScreen.value) {
        window.dispatchEvent(
          new CustomEvent('panel-fullscreen-toggle', {
            detail: { panel: 'editor', isFullScreen: false },
          })
        );
      }
    });

    return {
      activeTab,
      visibleTabs,
      setActiveTab,
      panelTitle,
      closeModuleModal,
      updateNodeContent,
      updateEdgeContent,
      toolLibrary,
      isFullScreen,
      toggleFullScreen,
      customTools,
      // --- Expose dragging related refs and methods ---
      panelRef,
      panelStyle,
      startDrag,
    };
  },
});
</script>

<style scoped>
#editor-panel {
  position: fixed;
  /* Remove fixed top/right - position is now dynamic via style binding */
  /* top: 48px; */
  /* right: 0; */
  width: 680px; /* Keep default width for non-fullscreen */
  max-width: calc(100% - 144px); /* Keep default max-width */
  /* height: fit-content; */ /* Let height be determined by content or full-screen style */
  max-height: calc(100% - 68px) !important;
  overflow: hidden; /* Change to hidden to contain body scroll */
  background: transparent;
  /* border: 2px solid var(--color-pink); */
  border-radius: 8px;
  /* padding: 16px; */ /* Move padding to header/body if needed, or adjust drag bounds */
  /* gap: 12px; */
  display: flex;
  flex-direction: column;
  z-index: 99;
  color: var(--Dark-Navy, #01052a);
  container-type: inline-size;
  container-name: editor-panel;
}

/* Remove fixed top for electron - handled dynamically */
/* body.electron #editor-panel {
  top: 80px;
} */

/* Styles for full-screen are now primarily handled by the panelStyle computed property */
#editor-panel.full-screen {
  /* width: calc(100% - 144px); */ /* Handled by panelStyle */
  /* height: calc(100% - 96px); */ /* Handled by panelStyle */
  background-color: var(--color-popup); /* Same as LeftPanel chat fullscreen */
  padding: 16px; /* Add padding back in full screen */
  gap: 12px; /* Add gap back in full screen */
  transition: all 0.3s ease;
  /* Ultra-high z-index layering to BEAT the left panel */
  z-index: 999999 !important; /* Editor expanded (absolute highest) */
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  position: fixed !important;
}

#editor-panel .right-tabs button i {
  color: var(--color-dark-navy);
  font-size: 17px;
  opacity: 0.75;
}

body.dark #editor-panel .right-tabs button i {
  color: var(--color-med-navy);
}

/* div#editor-panel.fullscreen {
      width: calc(100% - 81px);
      height: fit-content;
      max-height: calc(100% - 108px);
  } */

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  user-select: none;
  padding: 16px; /* Add padding here */
  cursor: grab; /* Indicate draggable header */
  background: var(--color-dull-white); /* Give header a background */
  border: 1px solid var(--terminal-border-color); /* Add border */
  border-radius: 8px 8px 0 0; /* Round top corners */
  border-bottom: none; /* Remove bottom border if panel-body has top border */
}

#editor-panel.full-screen .panel-header {
  cursor: default; /* No grabbing in full screen */
  border-radius: 0; /* Reset border-radius in full screen */
  border: none;
  padding: 0 0 12px 0; /* Adjust padding */
  background: transparent; /* Reset background */
}

.panel-header:active {
  /* Apply grabbing cursor only when not full screen */
  cursor: grabbing;
}
#editor-panel.full-screen .panel-header:active {
  cursor: default;
}

.panel-header .title {
  color: #e53d8f;
  font-family: 'League Spartan';
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  letter-spacing: 0.48px;
}

.panel-body {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 0 0 8px 8px; /* Round bottom corners */
  overflow: auto; /* Change to auto for scrolling */
  flex-grow: 1; /* Allow body to fill available space */
  min-height: 100px; /* Give a minimum height */
}

#editor-panel.full-screen .panel-body {
  height: 100%; /* Fill height in full screen */
  overflow: scroll; /* Ensure scroll */
  border-radius: 8px; /* Round corners in full screen */
  border: 1px solid var(--terminal-border-color);
  background: transparent;
}

#editor-panel.full-screen .panel-header {
  background: transparent;
  border: none;
}

body.dark #editor-panel .panel-header,
body.dark #editor-panel .panel-body {
  background: var(--color-ultra-dark-navy);
  border-color: var(--terminal-border-color);
}

body.dark #editor-panel.full-screen .panel-header {
  background: transparent;
  border: none;
}
body.dark #editor-panel.full-screen .panel-body {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
}

.panel-body label {
  font-weight: 400;
  user-select: none;
}

.panel-body .title {
  user-select: none;
}

.right-tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  margin-right: 2px;
}

.tab-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  opacity: 0.5;
  transition: opacity 0.3s ease;
}

.tab-button:hover,
.tab-button.active {
  opacity: 1;
}

.capitalize {
  text-transform: capitalize;
}

.error-message {
  color: #fe4e4e;
}

.error-message p {
  margin-top: 8px;
  color: #fe4e4e;
  font-family: monospace;
  padding: 3px 8px;
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  /* animation: error-breathe-inset 1s ease-in-out infinite; */
  border-color: #fe4e4e;
  background: var(--color-bright-light-navy);
  overflow-wrap: anywhere;
}

.output-message p {
  margin-top: 8px;
  font-family: monospace;
  padding: 6px 8px;
  border: 1px solid var(--color-light-navy);
  /* border-color: limegreen; */
  border-radius: 8px;
  background: var(--color-bright-light-navy);
}

.hr {
  width: 100%;
  border-bottom: 1px solid #ddd;
}

body.dark .hr {
  border-bottom: 1px solid var(--color-dull-navy);
}

body.dark .error-message p,
body.dark .output-message p {
  border: 1px solid var(--color-dull-navy);
  background: transparent;
}

.parameter-wrapper .form-row {
  display: flex;
  justify-content: flex-start;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  align-items: flex-start;
}

/* Responsive styles for 1200px screens (MacBook Air) */
/* Stack title and tabs vertically for better readability */
@media (max-width: 1400px) {
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .panel-header .title {
    width: 100%;
  }

  .right-tabs {
    width: 100%;
    justify-content: flex-start;
    gap: 16px;
    margin-right: 0;
  }
}
</style>

<style>
/* Hide other elements when EditorPanel is expanded */
/* Using display: none !important to FORCE it since opacity wasn't enough */
body.node-editor-expanded .left-panel,
body.node-editor-expanded .left-panel-component,
body.node-editor-expanded .designer-container,
body.node-editor-expanded .main-panel {
  display: none !important;
}
</style>
