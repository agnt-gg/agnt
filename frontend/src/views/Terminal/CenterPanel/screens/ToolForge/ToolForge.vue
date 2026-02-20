<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeLeftPanel="'ToolForgePanel'"
    activeRightPanel="ToolForgeResponsePanel"
    :panelProps="{
      onTestTool: handleTestTool,
      onSaveTool: handleSaveTool,
    }"
    screenId="ToolForgeScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="toolforge-panel">
        <!-- Editor now in center -->
        <ToolForgePanel :currentTool="currentTool" @update-tool="updateCurrentTool" @test-tool="handleTestTool" @save-tool="handleSaveTool" />
      </div>

      <div class="terminal-modal" v-if="isExecuting">
        <div class="terminal-modal-content">
          <div class="terminal-modal-header">
            <i class="fas fa-cogs"></i>
            <span>Executing Tool</span>
          </div>
          <div class="terminal-modal-loader">
            <div class="loader-dot"></div>
            <div class="loader-dot"></div>
            <div class="loader-dot"></div>
          </div>
          <div class="terminal-modal-text">Please wait while your tool is being executed...</div>
        </div>
      </div>

      <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="toolForge" @close="onTutorialClose" />
    </template>
  </BaseScreen>
</template>

<script>
import { ref, onMounted, computed } from 'vue';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import ToolForgePanel from '../../../RightPanel/types/ToolForgePanel/ToolForgePanel.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import ResponseArea from './components/ResponseArea/ResponseArea.vue';
import ContentActions from './components/ContentActions/ContentActions.vue';
import useToolForge from './useToolForge';
import { useToolForgeTutorial } from './useToolForgeTutorial.js';
import { useContentLoader } from '@/composables/useContentLoader';
import { AI_PROVIDERS_CONFIG } from '@/../user.config';

export default {
  name: 'ToolForgeScreen',
  components: {
    BaseScreen,
    TerminalHeader,
    ToolForgePanel,
    PopupTutorial,
    ResponseArea,
    ContentActions,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const isExecuting = ref(false);
    const toolOutput = ref('');
    const currentTool = ref(null);

    const { initializeToolForge, saveToolTemplate, loadTools, loadTool, deleteToolTemplate, executeToolTemplate } = useToolForge();

    const { tutorialConfig, startTutorial, onTutorialClose, initializeToolForgeTutorial } = useToolForgeTutorial();

    const { loadContentFromQuery } = useContentLoader();

    const toolStatus = computed(() => {
      if (!currentTool.value) return 'Not Created';
      if (!currentTool.value.isValid) return 'Incomplete';
      return currentTool.value.isSaved ? 'Saved' : 'Unsaved';
    });

    const toolStatusClass = computed(() => {
      if (!currentTool.value) return 'status-none';
      if (!currentTool.value.isValid) return 'status-error';
      return currentTool.value.isSaved ? 'status-saved' : 'status-pending';
    });

    const canTestTool = computed(() => {
      return currentTool.value && currentTool.value.isValid;
    });

    const onResponseAreaLoaded = () => {
      terminalLines.value.push('Response area loaded and ready');
    };

    const handleUserInputSubmit = (input) => {
      terminalLines.value.push(`> ${input}`);
      // Process user input if needed
    };

    const updateCurrentTool = (tool) => {
      currentTool.value = tool;
      terminalLines.value.push(`Tool "${tool.name}" updated`);
    };

    const runCurrentTool = async () => {
      if (!canTestTool.value) return;

      isExecuting.value = true;
      toolOutput.value = '';
      terminalLines.value.push(`Executing tool: ${currentTool.value.name}`);

      try {
        // Make sure we have provider and model values
        if (!currentTool.value.provider) {
          currentTool.value.provider = AI_PROVIDERS_CONFIG.providers[0] || 'OpenAI'; // Fallback
        }
        if (!currentTool.value.model) {
          const providerModels = AI_PROVIDERS_CONFIG.modelsByProvider[currentTool.value.provider];
          currentTool.value.model = providerModels?.[0] || 'gpt-4o-mini'; // Fallback
        }

        // Clear the hidden response area first
        const responseArea = document.getElementById('response-area');
        if (responseArea) {
          responseArea.innerHTML = '';
        }

        // Run the tool and get streaming results
        const result = await executeToolTemplate(currentTool.value);

        // If we have output, note success in terminal
        terminalLines.value.push(`Tool execution complete`);
      } catch (error) {
        console.error('Tool execution error:', error);
        toolOutput.value = `Error: ${error.message || 'Unknown error during tool execution'}`;
        terminalLines.value.push(`Tool execution failed: ${error.message}`);
      } finally {
        isExecuting.value = false;
        baseScreenRef.value?.scrollToBottom();
      }
    };

    const handleTestTool = async (toolData) => {
      currentTool.value = toolData;
      runCurrentTool();
    };

    const handleSaveTool = async (toolData) => {
      terminalLines.value.push(`Saving tool "${toolData.name}"...`);
      try {
        const savedTool = await saveToolTemplate(toolData);
        currentTool.value = savedTool;
        terminalLines.value.push(`Tool "${savedTool.name}" saved successfully`);
      } catch (error) {
        terminalLines.value.push(`Failed to save tool: ${error.message}`);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const clearOutput = () => {
      toolOutput.value = '';
      terminalLines.value.push('Tool output cleared');
    };

    const handlePanelAction = (action, payload) => {
      switch (action) {
        case 'update-tool-template':
          updateCurrentTool(payload);
          break;
        case 'execute-tool':
          handleTestTool(payload);
          break;
        default:
          console.log('Unhandled panel action:', action, payload);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const initializeScreen = async () => {
      terminalLines.value.push('Initializing Tool Forge...');
      document.body.setAttribute('data-page', 'terminal-tool-forge');
      await initializeToolForge();

      // Check for content-id in query params and load if present
      const contentLoaded = await loadContentFromQuery();
      if (contentLoaded) {
        terminalLines.value.push('Loaded content from query parameter.');
      }

      // Try to load saved tools
      try {
        const tools = await loadTools();
        if (tools && tools.length > 0) {
          terminalLines.value.push(`Found ${tools.length} saved tools.`);
        } else {
          terminalLines.value.push('No saved tools found. Create a new tool to begin.');
        }
      } catch (error) {
        terminalLines.value.push('Error loading saved tools: ' + error.message);
      }

      terminalLines.value.push('Tool Forge ready.');
      baseScreenRef.value?.scrollToBottom();

      // Show tutorial after a short delay
      setTimeout(() => {
        initializeToolForgeTutorial();
      }, 2000);
    };

    onMounted(() => {
      console.log('ToolForgeScreen mounted');
    });

    return {
      baseScreenRef,
      terminalLines,
      isExecuting,
      currentTool,
      toolOutput,
      toolStatus,
      toolStatusClass,
      canTestTool,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      onResponseAreaLoaded,
      handleUserInputSubmit,
      updateCurrentTool,
      runCurrentTool,
      handleTestTool,
      handleSaveTool,
      clearOutput,
      handlePanelAction,
      initializeScreen,
      emit,
    };
  },
};
</script>

<style scoped>
/* Response Panel Container - fills the right panel */
.response-panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  gap: 16px;
  padding: 16px;
}

.response-area-container {
  flex: 1;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-actions-container {
  flex-shrink: 0;
}

.terminal-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.terminal-modal-content {
  background: var(--color-dark-navy);
  border: 1px solid var(--color-green);
  border-radius: 4px;
  padding: 24px;
  width: 400px;
  box-shadow: 0 0 20px rgba(var(--green-rgb), 0.4);
  text-align: center;
}

.terminal-modal-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 16px;
}

.terminal-modal-header i {
  color: var(--color-green);
  font-size: 24px;
}

.terminal-modal-header span {
  color: var(--color-light-green);
  font-size: 18px;
  font-weight: bold;
}

.terminal-modal-loader {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
}

.loader-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--color-green);
  animation: dot-pulse 1.5s infinite ease-in-out;
}

.loader-dot:nth-child(2) {
  animation-delay: 0.5s;
}

.loader-dot:nth-child(3) {
  animation-delay: 1s;
}

.terminal-modal-text {
  color: var(--color-grey-light);
  font-size: 14px;
}

@keyframes dot-pulse {
  0% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
  }
  100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
}
.toolforge-panel {
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: auto;
}
</style>
