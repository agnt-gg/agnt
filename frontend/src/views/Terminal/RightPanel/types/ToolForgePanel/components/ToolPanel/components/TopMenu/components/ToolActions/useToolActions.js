import { inject, provide } from "vue";

export function useToolActions() {
  const {
    saveFormDataToDB,
    confirmDelete,
    importTemplate,
    shareTemplate,
    clearFields,
    onToolGenerated,
    selectedTool: selectedTemplate,
    formData,
    fetchTemplates
  } = inject('toolActions');

  const emitToolChange = inject('emitToolChange');

  // Wrap saveFormDataToDB and confirmDelete to emit changes
  const wrappedSaveFormDataToDB = async (...args) => {
    await saveFormDataToDB(...args);
    emitToolChange();
  };

  const wrappedConfirmDelete = async (...args) => {
    await confirmDelete(...args);
    emitToolChange();
  };

  return {
    saveFormDataToDB: wrappedSaveFormDataToDB,
    confirmDelete: wrappedConfirmDelete,
    importTemplate,
    shareTemplate,
    clearFields,
    onToolGenerated,
    selectedTemplate,
    formData,
    fetchTemplates
  };
}