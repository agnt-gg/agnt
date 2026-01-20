<template>
  <editor-panel>
    <top-section>
      <TopMenu :selectedTool="selectedTool" :formData="formData" @tool-selected="onToolSelected" @clear-fields="clearFields" />
      <FieldsArea ref="toolFields" :formData="formData" @form-updated="onFormUpdated" />
    </top-section>
    <bottom-menu>
      <button id="generate" class="generate" @click="handleGenerateClick"><img src="@/assets/icons/create-light.svg" alt="" />Run Tool</button>
    </bottom-menu>
  </editor-panel>
  <SimpleModal ref="modal" />
</template>

<script>
import { provide, onMounted, onUnmounted } from 'vue';
import TopMenu from './components/TopMenu/TopMenu.vue';
import FieldsArea from './components/FieldsArea/FieldsArea.vue';
import { useToolPanel } from './useToolPanel';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import toolForgeEventBridge from '@/views/ToolForge/toolForgeEventBridge';

export default {
  name: 'ToolPanel',
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

      // Initialize the event bridge with references to tool panel methods
      toolForgeEventBridge.initialize({
        updateFormData: onFormUpdated,
        addCustomField: (field) => {
          // Add custom field through the FieldsArea component
          const toolFields = document.querySelector('#template-fields');
          if (toolFields && toolFields.__vueParentComponent) {
            toolFields.__vueParentComponent.ctx.addCustomField(field);
          }
        },
        deleteCustomField: (fieldName) => {
          // Remove custom field through the FieldsArea component
          const toolFields = document.querySelector('#template-fields');
          if (toolFields && toolFields.__vueParentComponent) {
            toolFields.__vueParentComponent.ctx.deleteCustomField(fieldName);
          }
        },
        saveFormDataToDB,
        clearFields,
        onToolSelected,
      });
    });

    onUnmounted(() => {
      // Clean up event bridge when component is destroyed
      toolForgeEventBridge.destroy();
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
top-section {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  height: -webkit-fill-available;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  overflow-y: scroll;
  background: transparent;
}

top-section::-webkit-scrollbar {
  width: 0;
  height: 0;
}
</style>
