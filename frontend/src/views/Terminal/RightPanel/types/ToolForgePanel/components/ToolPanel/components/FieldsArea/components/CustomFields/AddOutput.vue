<template>
  <!-- OUTPUT FIELDS -->
  <div class="parameters-card full-width">
    <div class="card-header">
      <h3 class="card-title">
        <i class="fas fa-arrow-right"></i>
        Output Parameters
      </h3>
    </div>
    <div class="parameters-content">
      <div class="output-fields-list" v-if="Object.keys(outputs).length > 0">
        <div v-for="(output, key) in outputs" :key="key" class="output-field-item">
          <div class="output-field-header">
            <span class="output-name">{{ key }}</span>
            <span class="output-type">{{ output.type }}</span>
            <Tooltip v-if="!isDefaultOutput(key)" text="Delete Output" width="auto">
              <button class="delete-output-button" @click="deleteOutput(key)">
                <i class="fas fa-trash"></i>
              </button>
            </Tooltip>
            <Tooltip v-else text="Default output - cannot be deleted" width="auto">
              <span class="default-badge">
                <i class="fas fa-lock"></i>
              </span>
            </Tooltip>
          </div>
          <p class="output-description">{{ output.description }}</p>
        </div>
      </div>
      <div class="no-outputs" v-else>
        <p>No output parameters defined. Add outputs to specify what your tool returns.</p>
      </div>

      <!-- NEW OUTPUT MODAL -->
      <div class="new-output-modal" style="display: none">
        <button class="close" @click="closeOutputForm">
          <i class="fas fa-times"></i>
        </button>
        <div class="field-group">
          <label for="output-name">Output Name</label>
          <input type="text" id="output-name" name="output-name" placeholder="e.g., result, data, summary" autocomplete="off" />
        </div>
        <div class="field-group">
          <label for="output-type">Output Type</label>
          <CustomSelect :options="outputTypeOptions" placeholder="Select Output Type" @option-selected="handleOutputTypeSelected" />
        </div>
        <div class="field-group">
          <label for="output-description">Description</label>
          <input type="text" id="output-description" name="output-description" placeholder="Describe what this output contains" autocomplete="off" />
        </div>
        <Tooltip text="Add Output" width="auto">
          <button class="icon" tabindex="0" @click="addOutput">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="0.5" y="0.5" width="31" height="31" stroke="#01052A" stroke-opacity="0.25" stroke-dasharray="2 2" />
              <path
                d="M13.2516 22.5L8 17.305L10.3932 14.9376L13.2516 17.7735L21.6068 9.5L24 11.8674L13.2516 22.5Z"
                fill="#01052A"
                fill-opacity="0.5"
              />
            </svg>
          </button>
        </Tooltip>
      </div>

      <!-- ADD NEW OUTPUT BUTTON -->
      <div id="add-new-output" class="add-new-output">
        <Tooltip text="Add New Output" width="auto">
          <button id="add-new-output-button" class="icon" tabindex="0" @click="showOutputForm">
            <svg xmlns="http://www.w3.org/2000/svg" width="33" height="32" viewBox="0 0 33 32" fill="none">
              <rect x="0.544922" y="0.5" width="31" height="31" rx="7.5" stroke="#01052A" stroke-opacity="0.25" stroke-dasharray="5 5" />
              <path
                d="M15.1878 16.8571H10.0449V15.1429H15.1878V10H16.9021V15.1429H22.0449V16.8571H16.9021V22H15.1878V16.8571Z"
                fill="#01052A"
                fill-opacity="0.5"
              />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
  <SimpleModal ref="modal" />
</template>

<script>
import { formatTextToDivId } from '@/views/_utils/stringFormatting.js';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'AddOutput',
  props: {
    outputs: {
      type: Object,
      default: () => ({}),
    },
    toolType: {
      type: String,
      default: 'AI',
    },
  },
  emits: ['output-added', 'output-deleted'],
  components: {
    CustomSelect,
    SimpleModal,
    Tooltip,
  },
  data() {
    return {
      selectedOutputType: '',
      outputTypeOptions: [
        { label: 'String', value: 'string' },
        { label: 'Number', value: 'number' },
        { label: 'Boolean', value: 'boolean' },
        { label: 'Object', value: 'object' },
        { label: 'Array', value: 'array' },
        { label: 'Any', value: 'any' },
      ],
    };
  },
  computed: {
    defaultOutputKeys() {
      // Define which outputs are defaults and cannot be deleted
      if (this.toolType === 'AI') {
        return ['generatedText', 'tokenCount', 'error'];
      } else {
        return ['success', 'result', 'error'];
      }
    },
  },
  methods: {
    isDefaultOutput(key) {
      return this.defaultOutputKeys.includes(key);
    },
    showOutputForm(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      document.querySelector('.add-new-output').style.display = 'none';
      document.querySelector('.new-output-modal').style.display = 'flex';
    },
    closeOutputForm(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      document.querySelector('.new-output-modal').style.display = 'none';
      document.querySelector('.add-new-output').style.display = 'flex';
      this.selectedOutputType = '';
    },
    handleOutputTypeSelected(option) {
      this.selectedOutputType = option.value;
    },
    async addOutput(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      const outputName = document.querySelector('#output-name').value;
      const outputType = this.selectedOutputType;
      const outputDescription = document.querySelector('#output-description').value;
      const divId = formatTextToDivId(outputName);

      if (!divId) {
        await this.$refs.modal.showModal({
          title: 'Invalid Output Name',
          message: 'Please enter a valid output name.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      if (!outputType) {
        await this.$refs.modal.showModal({
          title: 'Invalid Output Type',
          message: 'Please select a valid output type.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      // Emit the new output data
      this.$emit('output-added', {
        name: divId,
        type: outputType,
        description: outputDescription || `Output: ${outputName}`,
      });

      this.closeOutputForm();

      // Clear form
      document.querySelector('#output-name').value = '';
      document.querySelector('#output-description').value = '';
      this.selectedOutputType = '';
    },
    deleteOutput(key) {
      this.$emit('output-deleted', key);
    },
  },
};
</script>

<style scoped>
/* Card Styles - matching FieldsArea.vue */
.parameters-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-primary);
  border-radius: 12px;
  overflow: visible;
  transition: all 0.2s ease;
}

.parameters-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.full-width {
  width: calc(100% - 5px);
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

/* Parameters Content */
.parameters-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.output-fields-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.output-field-item {
  padding: 16px;
  background: var(--terminal-darken-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  position: relative;
}

.output-field-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.output-name {
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
  font-size: 0.9em;
}

.output-type {
  padding: 2px 8px;
  background: var(--color-green, #22c55e);
  color: white;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.output-description {
  font-size: 0.85em;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.5;
  padding-left: 4px;
}

.delete-output-button {
  padding: 6px 10px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: rgba(239, 68, 68, 0.9);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  font-weight: 500;
  transition: all 0.2s ease;
}

.delete-output-button:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
}

.default-badge {
  padding: 4px 8px;
  color: var(--color-med-navy, #999);
  font-size: 12px;
  opacity: 0.6;
}

.no-outputs {
  padding: 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.9em;
  font-style: italic;
}

.new-output-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--terminal-darken-color);
  border: 2px solid var(--color-primary);
  border-radius: 8px;
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.new-output-modal .close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 18px;
  padding: 4px;
  transition: all 0.2s ease;
}

.new-output-modal .close:hover {
  transform: scale(1.1);
}

.add-new-output {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 100%;
  margin-top: 8px;
  box-sizing: border-box;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.field-group label {
  color: var(--color-text);
  font-size: 0.9em;
  font-weight: 500;
}

.field-group input {
  width: 100%;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

.field-group input:focus {
  border-color: var(--color-primary);
  outline: none;
}

.icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform 0.2s;
}

.icon:hover {
  transform: scale(1.05);
}

/* Responsive Design */
@media (max-width: 768px) {
  .parameters-content {
    padding: 16px;
  }
}
</style>
