<template>
  <template-fields id="template-fields">
    <form action="" id="template-form" enctype="multipart/form-data">
      <!-- HIDDEN FIELD FOR TOOL TYPE -->
      <input type="hidden" name="tool-type" :value="(formData.title || '').toLowerCase().replace(/\s+/g, '-')" />

      <!-- Main Content Grid -->
      <div class="main-content-grid">
        <!-- Row 1: Tool Information (Full Width) -->
        <div class="info-card full-width">
          <div class="card-header">
            <h3 class="card-title">Tool Information</h3>
          </div>
          <div class="info-fields">
            <!-- Template Name | Tool Type (2 columns) -->
            <div class="two-column-row">
              <!-- TOOL NAME -->
              <div class="form-field half-width">
                <label for="template-name">Tool Template Name</label>
                <input
                  type="text"
                  id="template-name"
                  name="template-name"
                  placeholder="Joke Generator"
                  autocomplete="off"
                  :value="formData.title"
                  @input="updateFormData('title', $event.target.value)"
                />
              </div>

              <!-- TOOL TYPE -->
              <div class="form-field half-width">
                <ToolTypeSelector v-model="formData.toolType" @update:modelValue="updateFormData('toolType', $event)" />
              </div>
            </div>

            <!-- Icon | Provider/Model (2 columns) -->
            <div class="two-column-row">
              <!-- TOOL ICON -->
              <div class="form-field half-width">
                <IconSelector :iconValue="formData.icon" @update:iconValue="updateFormData('icon', $event)" />
              </div>

              <!-- MODEL SELECTOR (AI tools only) -->
              <div class="form-field half-width" v-if="formData.toolType === 'AI'">
                <ModelSelector v-model:provider="formData.provider" v-model:model="formData.model" />
              </div>
            </div>
          </div>
        </div>

        <!-- Row 2: Instructions / Code (Full Width) -->
        <div class="code-card full-width" v-if="formData.toolType === 'AI' || formData.toolType === 'CODE_JS' || formData.toolType === 'CODE_PYTHON'">
          <div class="card-header">
            <h3 class="card-title">{{ formData.toolType === 'AI' ? 'Tool Instructions' : 'Code' }}</h3>
          </div>
          <div class="code-content">
            <!-- AI PROMPT TOOLS: INSTRUCTIONS -->
            <div class="form-field" v-if="formData.toolType === 'AI'">
              <textarea
                id="template-instructions"
                name="template-instructions"
                placeholder="Generate a funny joke based on the following..."
                :value="formData.instructions"
                @input="updateFormData('instructions', $event.target.value)"
                rows="6"
              ></textarea>
            </div>

            <!-- CODE TOOLS: CODE EDITOR -->
            <CodeEditor
              v-if="formData.toolType === 'CODE_JS' || formData.toolType === 'CODE_PYTHON'"
              v-model="formData.code"
              :language="formData.toolType === 'CODE_PYTHON' ? 'python' : 'javascript'"
              @update:modelValue="updateFormData('code', $event)"
            />
          </div>
        </div>

        <!-- Row 3: Input Parameters (Full Width) -->
        <div class="parameters-card full-width">
          <div class="card-header">
            <h3 class="card-title">
              <i class="fas fa-arrow-down"></i>
              Input Parameters
            </h3>
          </div>
          <div class="parameters-content">
            <!-- CUSTOM FIELDS -->
            <div class="custom-fields" v-if="Object.keys(formData.customFields).length > 0">
              <div
                v-for="(field, key) in formData.customFields"
                :key="key"
                v-show="shouldShowField(field)"
                class="field-group"
                :class="{ 'conditional-field': field.conditional }"
              >
                <div class="field-header">
                  <label :for="key" contenteditable="true" draggable="true" style="cursor: grab">
                    {{ field.label || key }}
                    <Tooltip
                      v-if="field.conditional"
                      :text="`Shows when ${formData.customFields[field.conditional.field]?.label || field.conditional.field} = ${
                        Array.isArray(field.conditional.value) ? field.conditional.value.join(' or ') : field.conditional.value
                      }`"
                      width="auto"
                    >
                      <span class="conditional-indicator">
                        <i class="fas fa-link"></i>
                      </span>
                    </Tooltip>
                  </label>
                  <div class="field-actions">
                    <Tooltip text="Edit Field Properties" width="auto">
                      <button type="button" class="edit-field-button" @click.prevent="editCustomField(key, field)">
                        <i class="fas fa-edit"></i>
                      </button>
                    </Tooltip>
                    <Tooltip text="Delete Field" width="auto">
                      <button type="button" class="delete-field-button" @click.prevent="deleteCustomField(key)">
                        <i class="fas fa-trash"></i>
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <textarea
                  v-if="field.type === 'textarea'"
                  :id="key"
                  :name="key"
                  v-model="field.value"
                  @input="updateCustomField(key, $event.target.value)"
                ></textarea>
                <select
                  v-else-if="field.type === 'select'"
                  :id="key"
                  :name="key"
                  v-model="field.value"
                  @change="updateCustomField(key, $event.target.value)"
                >
                  <option value="" disabled>Select an option</option>
                  <option v-for="(option, index) in field.options" :key="index" :value="option">{{ option }}</option>
                </select>
                <input v-else-if="field.type === 'file'" type="file" :id="key" :name="key" @change="updateCustomField(key, $event.target.files[0])" />
                <input v-else type="text" :id="key" :name="key" v-model="field.value" @input="updateCustomField(key, $event.target.value)" />
              </div>
            </div>
            <div class="no-params" v-else>
              <p>No input parameters defined. Add parameters that your tool will receive.</p>
            </div>
            <AddField @field-added="addCustomField" />
          </div>
        </div>

        <!-- Row 4: Output Parameters (Full Width) -->
        <AddOutput
          :outputs="formData.customOutputs || {}"
          :toolType="formData.toolType"
          @output-added="addCustomOutput"
          @output-deleted="deleteCustomOutput"
        />
      </div>
    </form>
  </template-fields>
</template>

<script>
import { toRefs, onMounted, onUnmounted } from 'vue';
import IconSelector from './components/IconSelector/IconSelector.vue';
import ModelSelector from './components/ModelSelector/ModelSelector.vue';
import AddField from './components/CustomFields/AddField.vue';
import AddOutput from './components/CustomFields/AddOutput.vue';
import ToolTypeSelector from '../ToolTypeSelector.vue';
import CodeEditor from '../CodeEditor.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useFieldsArea } from './useFieldsArea';

export default {
  name: 'FieldsArea',
  components: {
    ModelSelector,
    IconSelector,
    AddField,
    AddOutput,
    ToolTypeSelector,
    CodeEditor,
    Tooltip,
  },
  props: {
    formData: {
      type: Object,
      required: true,
    },
  },
  emits: ['form-updated'],
  setup(props, { emit }) {
    const { formData } = toRefs(props);
    const {
      updateFormData,
      updateCustomField,
      deleteCustomField,
      addCustomField,
      addCustomOutput,
      deleteCustomOutput,
      editCustomField,
      shouldShowField,
    } = useFieldsArea(formData, emit);

    // Event handlers for tool generation events
    const handleToolFieldUpdated = (event) => {
      console.log('FieldsArea: tool-field-updated', event.detail);
      const { field, value } = event.detail;
      updateFormData(field, value);
    };

    const handleToolCustomFieldAdded = (event) => {
      console.log('FieldsArea: tool-custom-field-added', event.detail);
      const { fieldName, fieldType, label, value } = event.detail;
      addCustomField({
        name: fieldName,
        type: fieldType,
        label: label || fieldName,
        value: value || '',
      });
    };

    const handleToolCustomFieldRemoved = (event) => {
      console.log('FieldsArea: tool-custom-field-removed', event.detail);
      const { fieldName } = event.detail;
      deleteCustomField(fieldName);
    };

    const handleToolFieldsCleared = () => {
      console.log('FieldsArea: tool-fields-cleared');
      // Clear all custom fields
      Object.keys(formData.value.customFields).forEach((key) => {
        deleteCustomField(key);
      });
      // Reset basic fields
      updateFormData('title', '');
      updateFormData('instructions', '');
    };

    const handleChatSSEEvent = (event) => {
      const { eventType, eventData } = event.detail;
      console.log('FieldsArea: Received chat SSE event', eventType, eventData);

      switch (eventType) {
        case 'tool-field-updated':
          handleToolFieldUpdated({ detail: eventData });
          break;
        case 'tool-custom-field-added':
          handleToolCustomFieldAdded({ detail: eventData });
          break;
        case 'tool-custom-field-removed':
          handleToolCustomFieldRemoved({ detail: eventData });
          break;
        case 'tool-fields-cleared':
          handleToolFieldsCleared();
          break;
      }
    };

    onMounted(() => {
      console.log('FieldsArea: Setting up event listeners');
      window.addEventListener('tool-field-updated', handleToolFieldUpdated);
      window.addEventListener('tool-custom-field-added', handleToolCustomFieldAdded);
      window.addEventListener('tool-custom-field-removed', handleToolCustomFieldRemoved);
      window.addEventListener('tool-fields-cleared', handleToolFieldsCleared);
      window.addEventListener('chat-sse-event', handleChatSSEEvent);
    });

    onUnmounted(() => {
      console.log('FieldsArea: Removing event listeners');
      window.removeEventListener('tool-field-updated', handleToolFieldUpdated);
      window.removeEventListener('tool-custom-field-added', handleToolCustomFieldAdded);
      window.removeEventListener('tool-custom-field-removed', handleToolCustomFieldRemoved);
      window.removeEventListener('tool-fields-cleared', handleToolFieldsCleared);
      window.removeEventListener('chat-sse-event', handleChatSSEEvent);
    });

    return {
      formData,
      updateFormData,
      updateCustomField,
      deleteCustomField,
      addCustomField,
      addCustomOutput,
      deleteCustomOutput,
      editCustomField,
      shouldShowField,
    };
  },
};
</script>

<style scoped>
template-fields {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
  padding: 0 0 16px 0;
  width: 100%;
  width: -webkit-fill-available;
  height: 100%;
  overflow-y: scroll;
  background: transparent;
}

/* Main Content Grid */
.main-content-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
}

.full-width {
  width: calc(100% - 4px);
}

/* Two Column Row Layout */
.two-column-row {
  display: flex;
  gap: 20px;
  width: 100%;
  align-items: stretch;
}

.half-width {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Card Styles */
.info-card,
.code-card,
.parameters-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-primary);
  border-radius: 12px;
  overflow: visible;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
}

.info-card:hover,
.code-card:hover,
.parameters-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-header {
  padding: 16px 20px;
  background: var(--terminal-darken-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.card-title {
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title i {
  color: var(--color-primary);
  font-size: 1em;
}

/* Info Fields */
.info-fields {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: visible;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.form-field:focus-within {
  z-index: 10;
}

.form-field label {
  color: var(--color-text);
  font-size: 0.9em;
  font-weight: 500;
}

.form-field input[type='text'],
.form-field textarea {
  width: 100%;
  /* padding: 10px 12px; */
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  /* font-size: 0.9em; */
  transition: all 0.2s ease;
}

.form-field input[type='text']:focus,
.form-field textarea:focus {
  border-color: var(--color-primary);
  outline: none;
}

/* Code Content */
.code-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.code-content textarea {
  width: 100%;
  height: 48px;
  min-height: 48px;
  resize: vertical;
}

/* Parameters Content */
.parameters-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.custom-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.custom-fields .field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--terminal-darken-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  position: relative;
  width: calc(100% - 32px);
}

.field-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-bottom: 4px;
  flex-wrap: nowrap;
}

.custom-fields .field-group label {
  color: var(--color-text);
  font-size: 0.9em;
  font-weight: 500;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-fields .field-group input,
.custom-fields .field-group textarea,
.custom-fields .field-group select {
  width: 100%;
  /* padding: 10px 12px; */
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  /* font-size: 0.9em; */
}

.custom-fields .field-group select {
  cursor: pointer;
}

.custom-fields .field-group select:focus {
  border-color: var(--color-primary);
  outline: none;
}

.custom-fields .field-group select option {
  background: var(--color-popup);
  color: var(--color-text);
}

/* Conditional Field Styles */
.custom-fields .field-group.conditional-field {
  border-left: 3px solid var(--color-primary);
}

.conditional-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  padding: 2px 6px;
  background: rgba(var(--color-primary-rgb, 25, 239, 131), 0.1);
  border: 1px solid rgba(var(--color-primary-rgb, 25, 239, 131), 0.3);
  border-radius: 4px;
  font-size: 0.75em;
  color: var(--color-primary);
  cursor: help;
  transition: all 0.2s ease;
}

.conditional-indicator:hover {
  background: rgba(var(--color-primary-rgb, 25, 239, 131), 0.2);
  border-color: rgba(var(--color-primary-rgb, 25, 239, 131), 0.5);
}

.conditional-indicator i {
  font-size: 1em;
}

.field-actions {
  display: flex !important;
  flex-direction: row !important;
  gap: 8px !important;
  align-items: center !important;
  flex: 0 0 auto !important;
  flex-shrink: 0 !important;
  flex-wrap: nowrap !important;
}

.edit-field-button,
.delete-field-button {
  padding: 6px 10px !important;
  border-radius: 6px !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 0.8em !important;
  font-weight: 500 !important;
  transition: all 0.2s ease !important;
  white-space: nowrap !important;
  flex: 0 0 auto !important;
  width: 32px !important;
  height: 28px !important;
  min-width: 32px !important;
  max-width: 32px !important;
  position: relative !important;
}

.edit-field-button {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: rgba(59, 130, 246, 0.9);
}

.edit-field-button:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
}

.delete-field-button {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: rgba(239, 68, 68, 0.9);
}

.delete-field-button:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
}

.no-params {
  padding: 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.9em;
  font-style: italic;
}

/* Responsive Design */
@media (max-width: 768px) {
  .two-column-row {
    flex-direction: column;
  }

  .main-content-grid {
    padding: 0 8px;
  }

  .info-fields,
  .code-content,
  .parameters-content {
    padding: 16px;
  }
}
</style>
