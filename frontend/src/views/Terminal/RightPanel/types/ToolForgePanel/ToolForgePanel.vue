<template>
  <div class="tool-forge-center-panel">
    <div class="scrollable-content">
      <TopMenu :selectedTool="selectedTool" :formData="formData" @tool-selected="onToolSelected" @clear-fields="clearFields" />
      <FieldsArea ref="toolFields" :formData="formData" @form-updated="onFormUpdated" />
    </div>
    <div class="bottom-actions">
      <button id="generate" class="generate" @click="handleGenerateClick"><i class="fas fa-play"></i>Run Tool</button>
    </div>
  </div>
  <SimpleModal ref="modal" />
</template>

<script>
import { provide, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import TopMenu from './components/ToolPanel/components/TopMenu/TopMenu.vue';
import FieldsArea from './components/ToolPanel/components/FieldsArea/FieldsArea.vue';
import { useToolPanel } from './components/ToolPanel/useToolPanel';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'ToolForgePanel',
  components: {
    TopMenu,
    FieldsArea,
    SimpleModal,
  },
  methods: {
    async showAlert(message, options = {}) {
      await this.$refs.modal.showModal({ message, showCancel: false, ...options });
    },
    async showPrompt(title, message, defaultValue = '', options = {}) {
      const result = await this.$refs.modal.showModal({
        title,
        message,
        isPrompt: true,
        isTextArea: options.isTextArea || false,
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: options.confirmText || 'Save',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
      return result === null ? null : result || defaultValue;
    },
    async showConfirm(title, message, options = {}) {
      return await this.$refs.modal.showModal({
        title,
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || '',
        cancelClass: options.cancelClass || '',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
    },
  },
  setup() {
    const route = useRoute();

    const {
      selectedTool,
      formData,
      templates,
      handleGenerateClick,
      onFormUpdated,
      onToolGenerated,
      onToolSelected,
      onToolSaved,
      onToolDeleted,
      clearFields,
      saveFormDataToDB,
      confirmDelete,
      importTemplate,
      shareTemplate,
      fetchTemplates,
      loadToolById,
    } = useToolPanel();

    provide('toolActions', {
      selectedTool,
      formData,
      fetchTemplates,
      saveFormDataToDB,
      confirmDelete,
      importTemplate,
      shareTemplate,
      clearFields,
      onToolGenerated,
      onToolSaved,
      onToolDeleted,
    });

    provide('toolSelector', {
      templates,
      selectedTemplate: selectedTool,
      onTemplateSelected: onToolSelected,
    });

    // Load tool from query param using Vue Router (reactive, works with SPA navigation)
    const loadToolFromRoute = () => {
      const toolId = route.query['tool-id'];
      if (toolId) {
        loadToolById(toolId);
      }
    };

    onMounted(() => {
      // Always refresh the templates list so deleted/new tools are reflected
      fetchTemplates();
      loadToolFromRoute();
    });

    // Also watch for route query changes (e.g. navigating from Tools screen Edit button)
    watch(() => route.query['tool-id'], (newToolId) => {
      if (newToolId) {
        loadToolById(newToolId);
      }
    });

    return {
      selectedTool,
      formData,
      handleGenerateClick,
      onFormUpdated,
      onToolSelected,
      clearFields,
    };
  },
};
</script>

<style scoped>
.tool-forge-center-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  flex: 1;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
}

.scrollable-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bottom-actions {
  flex-shrink: 0;
  /* padding: 16px 0 0; */
  background: transparent;
  border-top: 1px solid var(--terminal-border-color);
  display: flex;
  justify-content: flex-end;
  z-index: 10;
  position: sticky;
  bottom: 0;
}

.bottom-actions::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* background: var(--color-darker-0); */
  opacity: 0.85;
  z-index: -1;
  pointer-events: none;
}

/* Layout only. This scoped rule is (0,2,0) and beat the global
   `button.generate` at (0,1,1), so it made Run Tool a solid GREEN button here
   while the identical button in ToolPanel.vue rendered as a gradient — the same
   control with two different looks depending on which panel drew it. The colour
   treatment now comes from _buttons.css like every other primary button. */
.generate {
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 600;
}

.generate:active {
  transform: translateY(0);
}
</style>
