<template>
  <div class="plugin-builder">
    <!-- Header -->
    <div class="builder-header">
      <div class="header-content">
        <h3><i class="fas fa-magic"></i> AI Plugin Builder</h3>
        <p>Describe your plugin and let AI generate it for you</p>
      </div>
      <div class="header-actions">
        <BaseButton v-if="isGenerationComplete" variant="secondary" size="small" @click="resetBuilder">
          <i class="fas fa-redo"></i> Start Over
        </BaseButton>
      </div>
    </div>

    <!-- Step 1: Description Input -->
    <div v-if="!isGenerationComplete" class="builder-section">
      <div class="section-header">
        <span class="step-badge">1</span>
        <h4>Describe Your Plugin</h4>
      </div>
      <div class="description-input">
        <textarea
          v-model="pluginDescription"
          placeholder="Describe what your plugin should do. For example:

• 'A plugin that integrates with the Notion API to create pages, update databases, and search content'
• 'A weather plugin that fetches current weather and forecasts from OpenWeatherMap'
• 'A Stripe plugin for processing payments, creating customers, and managing subscriptions'"
          rows="6"
          :disabled="isGenerating"
        ></textarea>
      </div>

      <div class="generation-controls">
        <div class="provider-info">
          <span class="provider-label">Using:</span>
          <span class="provider-value">{{ selectedProvider }} / {{ selectedModel }}</span>
        </div>
        <BaseButton variant="primary" @click="generatePlugin" :disabled="!pluginDescription || isGenerating">
          <i class="fas" :class="isGenerating ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'"></i>
          {{ isGenerating ? 'Generating...' : 'Generate Plugin' }}
        </BaseButton>
      </div>

      <!-- Generation Progress -->
      <div v-if="isGenerating" class="generation-progress">
        <div class="progress-steps">
          <div class="progress-step" :class="{ active: generationProgress === 'manifest', complete: manifestGenerated }">
            <i class="fas" :class="manifestGenerated ? 'fa-check-circle' : 'fa-file-code'"></i>
            <span>Generating manifest.json</span>
          </div>
          <div class="progress-step" :class="{ active: generationProgress === 'code', complete: codeGenerated }">
            <i class="fas" :class="codeGenerated ? 'fa-check-circle' : 'fa-code'"></i>
            <span>Generating tool code</span>
          </div>
          <div class="progress-step" :class="{ active: generationProgress === 'package', complete: packageGenerated }">
            <i class="fas" :class="packageGenerated ? 'fa-check-circle' : 'fa-box'"></i>
            <span>Generating package.json</span>
          </div>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="generationError" class="error-message">
        <i class="fas fa-exclamation-triangle"></i>
        <span>{{ generationError }}</span>
      </div>
    </div>

    <!-- Step 2: Preview Generated Files -->
    <div v-if="isGenerationComplete" class="builder-section">
      <div class="section-header">
        <span class="step-badge complete">✓</span>
        <h4>Generated Plugin: {{ pluginName }}</h4>
      </div>

      <div class="files-preview">
        <!-- File List -->
        <div class="file-list">
          <div
            v-for="file in generatedFiles"
            :key="file.name"
            class="file-item"
            :class="{ active: activePreviewFile === file.name }"
            @click="selectFile(file.name)"
          >
            <i class="fas fa-file-code"></i>
            <span>{{ file.name }}</span>
          </div>
        </div>

        <!-- File Content Preview -->
        <div class="file-content">
          <div class="file-content-header">
            <span>{{ activePreviewFile || 'Select a file' }}</span>
            <div class="file-actions" v-if="activePreviewFile">
              <BaseButton variant="secondary" size="small" @click="copyFileContent">
                <i class="fas fa-copy"></i>
              </BaseButton>
            </div>
          </div>
          <textarea v-if="activePreviewFile" v-model="fileContentModel" class="code-editor" spellcheck="false"></textarea>
          <div v-else class="no-file-selected">
            <i class="fas fa-file-alt"></i>
            <p>Select a file to preview its contents</p>
          </div>
        </div>
      </div>

      <!-- Plugin Info -->
      <div class="plugin-info">
        <div class="info-item">
          <span class="info-label">Plugin Name:</span>
          <span class="info-value">{{ pluginName }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Tools:</span>
          <span class="info-value">{{ pluginTools.length }} tool(s)</span>
        </div>
        <div class="info-item" v-if="pluginTools.length > 0">
          <span class="info-label">Tool Types:</span>
          <div class="tool-badges">
            <span v-for="tool in pluginTools" :key="tool.type" class="tool-badge">
              {{ tool.schema?.title || tool.type }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3: Build & Install -->
    <div v-if="isGenerationComplete" class="builder-section">
      <div class="section-header">
        <span class="step-badge">2</span>
        <h4>Build & Install</h4>
      </div>

      <div class="build-controls">
        <p class="build-description">Build your plugin into an installable .agnt package and add it to your AGNT installation.</p>

        <BaseButton variant="primary" @click="buildAndInstall" :disabled="isBuilding">
          <i class="fas" :class="isBuilding ? 'fa-spinner fa-spin' : 'fa-hammer'"></i>
          {{ buildButtonText }}
        </BaseButton>

        <!-- Build Progress -->
        <div v-if="buildProgress" class="build-progress">
          <div class="progress-indicator">
            <i class="fas fa-spinner fa-spin"></i>
            <span>{{ buildProgressText }}</span>
          </div>
        </div>

        <!-- Build Error -->
        <div v-if="buildError" class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <span>{{ buildError }}</span>
        </div>

        <!-- Build Success -->
        <div v-if="buildResult?.success" class="success-message">
          <i class="fas fa-check-circle"></i>
          <span>Plugin "{{ buildResult.pluginName }}" installed successfully!</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';

export default {
  name: 'PluginBuilder',
  components: {
    BaseButton,
  },
  emits: ['show-alert', 'plugin-installed'],
  setup(props, { emit }) {
    const store = useStore();

    // Local state
    const pluginDescription = ref('');

    // Computed from store
    const isGenerating = computed(() => store.state.pluginBuilder.isGenerating);
    const generationProgress = computed(() => store.state.pluginBuilder.generationProgress);
    const generationError = computed(() => store.state.pluginBuilder.generationError);
    const generatedManifest = computed(() => store.state.pluginBuilder.generatedManifest);
    const generatedCode = computed(() => store.state.pluginBuilder.generatedCode);
    const generatedPackageJson = computed(() => store.state.pluginBuilder.generatedPackageJson);
    const isBuilding = computed(() => store.state.pluginBuilder.isBuilding);
    const buildProgress = computed(() => store.state.pluginBuilder.buildProgress);
    const buildError = computed(() => store.state.pluginBuilder.buildError);
    const buildResult = computed(() => store.state.pluginBuilder.buildResult);
    const activePreviewFile = computed(() => store.state.pluginBuilder.activePreviewFile);
    const playSound = inject('playSound', () => {});

    // AI Provider
    const selectedProvider = computed(() => store.state.aiProvider.selectedProvider || 'Not selected');
    const selectedModel = computed(() => store.state.aiProvider.selectedModel || 'Not selected');

    // Getters
    const generatedFiles = computed(() => store.getters['pluginBuilder/generatedFiles']);
    const isGenerationComplete = computed(() => store.getters['pluginBuilder/isGenerationComplete']);
    const pluginName = computed(() => store.getters['pluginBuilder/pluginName']);
    const pluginTools = computed(() => store.getters['pluginBuilder/pluginTools']);

    // Progress indicators
    const manifestGenerated = computed(() => generatedManifest.value !== null);
    const codeGenerated = computed(() => Object.keys(generatedCode.value).length > 0);
    const packageGenerated = computed(() => generatedPackageJson.value !== null);

    // Current file content
    const currentFileContent = computed(() => {
      if (!activePreviewFile.value) return '';
      return store.getters['pluginBuilder/getFileContent'](activePreviewFile.value);
    });

    // Writable computed for file editing
    const fileContentModel = computed({
      get: () => currentFileContent.value,
      set: (val) => {
        if (activePreviewFile.value) {
          store.dispatch('pluginBuilder/updateFile', {
            fileName: activePreviewFile.value,
            content: val,
          });
        }
      },
    });

    // Build button text
    const buildButtonText = computed(() => {
      if (isBuilding.value) return 'Building...';
      if (buildResult.value?.success) return 'Installed!';
      return 'Build & Install Plugin';
    });

    // Build progress text
    const buildProgressText = computed(() => {
      switch (buildProgress.value) {
        case 'preparing':
          return 'Preparing plugin files...';
        case 'building':
          return 'Building .agnt package...';
        case 'installing':
          return 'Installing plugin...';
        case 'complete':
          return 'Complete!';
        default:
          return 'Processing...';
      }
    });

    // Methods
    async function generatePlugin() {
      if (!pluginDescription.value) {
        emit('show-alert', 'Error', 'Please describe your plugin first');
        return;
      }

      if (!store.state.aiProvider.selectedProvider || !store.state.aiProvider.selectedModel) {
        emit('show-alert', 'Error', 'Please select an AI provider and model in Settings');
        return;
      }

      store.dispatch('pluginBuilder/setPluginDescription', pluginDescription.value);
      const result = await store.dispatch('pluginBuilder/generatePlugin', {
        description: pluginDescription.value,
      });

      if (!result.success) {
        emit('show-alert', 'Error', result.error || 'Failed to generate plugin');
      }
    }

    function selectFile(fileName) {
      playSound('typewriterKeyPress');
      store.dispatch('pluginBuilder/setActivePreviewFile', fileName);
    }

    function copyFileContent() {
      if (currentFileContent.value) {
        navigator.clipboard.writeText(currentFileContent.value);
        emit('show-alert', 'Success', 'Code copied to clipboard');
      }
    }

    async function buildAndInstall() {
      const result = await store.dispatch('pluginBuilder/buildAndInstallPlugin');

      if (result.success) {
        emit('show-alert', 'Success', `Plugin "${result.result.pluginName}" installed successfully!`);
        emit('plugin-installed');
      } else {
        emit('show-alert', 'Error', result.error || 'Failed to build plugin');
      }
    }

    function resetBuilder() {
      pluginDescription.value = '';
      store.dispatch('pluginBuilder/resetAll');
    }

    // Auto-select first file when generation completes
    watch(isGenerationComplete, (complete) => {
      if (complete && generatedFiles.value.length > 0 && !activePreviewFile.value) {
        selectFile(generatedFiles.value[0].name);
      }
    });

    // Load persisted description
    watch(
      () => store.state.pluginBuilder.pluginDescription,
      (desc) => {
        if (desc && !pluginDescription.value) {
          pluginDescription.value = desc;
        }
      },
      { immediate: true }
    );

    return {
      pluginDescription,
      isGenerating,
      generationProgress,
      generationError,
      generatedManifest,
      generatedCode,
      generatedPackageJson,
      isBuilding,
      buildProgress,
      buildError,
      buildResult,
      activePreviewFile,
      selectedProvider,
      selectedModel,
      generatedFiles,
      isGenerationComplete,
      pluginName,
      pluginTools,
      manifestGenerated,
      codeGenerated,
      packageGenerated,
      currentFileContent,
      fileContentModel,
      buildButtonText,
      buildProgressText,
      generatePlugin,
      selectFile,
      copyFileContent,
      buildAndInstall,
      resetBuilder,
    };
  },
};
</script>

<style scoped>
.plugin-builder {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.builder-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.builder-header h3 {
  margin: 0 0 4px 0;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.builder-header h3 i {
  color: var(--color-green);
}

.builder-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.builder-section {
  background: var(--color-dull-white);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}

body.dark .builder-section {
  background: rgba(0, 0, 0, 10%);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.section-header h4 {
  margin: 0;
  color: var(--color-text);
}

.step-badge {
  width: 28px;
  height: 28px;
  background: var(--color-green);
  color: var(--color-navy);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9em;
}

.step-badge.complete {
  background: var(--color-green);
}

.description-input textarea {
  width: 100%;
  padding: 16px;
  border: 2px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-popup);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
  resize: vertical;
  min-height: 120px;
  transition: border-color 0.2s ease;
}

.description-input textarea:focus {
  outline: none;
  border-color: var(--color-green);
}

.description-input textarea::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.generation-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.provider-label {
  color: var(--color-text-muted);
}

.provider-value {
  color: var(--color-green);
  font-weight: 500;
}

.generation-progress {
  margin-top: 20px;
  padding: 16px;
  background: rgba(25, 239, 131, 0.05);
  border-radius: 8px;
}

.progress-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.progress-step.active {
  color: var(--color-green);
}

.progress-step.active i {
  animation: pulse 1s infinite;
}

.progress-step.complete {
  color: var(--color-green);
}

.progress-step.complete i {
  animation: none;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 8px;
  color: #ff6b6b;
  font-size: 0.9em;
}

.success-message {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 8px;
  color: var(--color-green);
  font-size: 0.9em;
}

.files-preview {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
  min-height: 300px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--terminal-border-color);
  padding-right: 16px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.9em;
  transition: all 0.2s ease;
}

.file-item:hover {
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-text);
}

.file-item.active {
  background: rgba(25, 239, 131, 0.2);
  color: var(--color-green);
}

.file-content {
  display: flex;
  flex-direction: column;
}

.file-content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-weight: 500;
  color: var(--color-text);
}

.code-editor {
  flex: 1;
  margin: 0;
  padding: 16px;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: auto;
  font-family: 'Fira Code', 'Monaco', monospace;
  font-size: 0.85em;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre;
  resize: none;
  outline: none;
  transition: border-color 0.2s ease;
}

.code-editor:focus {
  border-color: var(--color-green);
}

.no-file-selected {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  gap: 8px;
}

.no-file-selected i {
  font-size: 2em;
  opacity: 0.5;
}

.plugin-info {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--terminal-border-color);
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.info-value {
  color: var(--color-text);
  font-weight: 500;
}

.tool-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-badge {
  padding: 4px 10px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  color: var(--color-green);
  font-size: 0.85em;
}

.build-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.build-description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.build-progress {
  padding: 12px 16px;
  background: rgba(25, 239, 131, 0.05);
  border-radius: 8px;
}

.progress-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-green);
  font-size: 0.9em;
}
</style>
