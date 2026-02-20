<template>
  <div class="tool-forge-center-panel">
    <div class="scrollable-content">
      <TopMenu :selectedTool="selectedTool" :formData="formData" @tool-selected="onToolSelected" @clear-fields="clearFields" />
      <FieldsArea ref="toolFields" :formData="formData" @form-updated="onFormUpdated" />
    </div>
    <div class="bottom-actions">
      <button id="generate" class="generate" @click="handleGenerateClick"><img src="@/assets/icons/create-light.svg" alt="" />Run Tool</button>
    </div>
  </div>
  <SimpleModal ref="modal" />
</template>

<script>
import { provide, onMounted } from 'vue';
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

    onMounted(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const toolId = urlParams.get('tool-id');
      if (toolId) {
        loadToolById(toolId);
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
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bottom-actions {
  flex-shrink: 0;
  /* padding: 16px 0 0; */
  background: transparent;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
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

.generate {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.generate:hover {
  /* background: rgba(var(--green-rgb), 0.8); */
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.generate:active {
  transform: translateY(0);
}

.generate img {
  width: 20px;
  height: 20px;
}
</style>
