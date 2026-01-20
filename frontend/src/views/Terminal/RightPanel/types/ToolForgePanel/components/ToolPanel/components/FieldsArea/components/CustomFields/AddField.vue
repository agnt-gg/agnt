<template>
  <!-- CUSTOM FIELDS -->
  <div class="custom-fields" style="display: none">
    <!-- CUSTOM FIELDS APPENDED HERE DYNAMICALLY -->
  </div>
  <!-- NEW FIELDS MODAL -->
  <div class="new-field-modal" style="display: none">
    <button class="close" @click="closeFieldForm">
      <i class="fas fa-times"></i>
    </button>
    <div class="field-group">
      <label for="field-name">Field Name</label>
      <input type="text" id="field-name" name="field-name" placeholder="Enter Field Name" autocomplete="off" />
    </div>
    <div class="field-group">
      <p class="label">Field Type</p>
      <CustomSelect ref="fieldTypeSelect" :options="fieldTypeOptions" placeholder="Select Field Type" @option-selected="handleFieldTypeSelected" />
    </div>
    <div class="field-group" v-if="selectedFieldType === 'select'">
      <label for="field-options">Select Options (comma-separated)</label>
      <input
        type="text"
        id="field-options"
        name="field-options"
        placeholder="Option 1, Option 2, Option 3"
        autocomplete="off"
        v-model="selectOptions"
      />
      <small style="color: var(--color-text-muted); font-size: 0.85em; margin-top: 4px">
        Enter options separated by commas (e.g., "Red, Green, Blue")
      </small>
    </div>
    <div class="field-group conditional-section">
      <label class="checkbox-label">
        <input type="checkbox" v-model="isConditional" />
        <span>Make this field conditional</span>
      </label>
      <small style="color: var(--color-text-muted); font-size: 0.85em; margin-top: 4px">
        Only show this field when another field has a specific value
      </small>
    </div>
    <div class="field-group" v-if="isConditional && existingFieldOptions.length > 0">
      <label>Show when field:</label>
      <CustomSelect
        ref="conditionalFieldSelect"
        :options="existingFieldOptions"
        placeholder="Select Field"
        @option-selected="handleConditionalFieldSelected"
      />
    </div>
    <div class="field-group" v-if="isConditional && conditionalField">
      <label for="conditional-value">Has value (comma-separated for multiple):</label>
      <input
        type="text"
        id="conditional-value"
        name="conditional-value"
        placeholder="e.g., Bearer, Webhook"
        autocomplete="off"
        v-model="conditionalValue"
      />
      <small style="color: var(--color-text-muted); font-size: 0.85em; margin-top: 4px"> Enter one or more values separated by commas </small>
    </div>
    <div class="field-group" v-if="isConditional && existingFieldOptions.length === 0">
      <small style="color: var(--color-warning); font-size: 0.85em">
        <i class="fas fa-exclamation-triangle"></i> No existing fields available. Add other fields first to create conditional logic.
      </small>
    </div>
    <!-- AND CONDITIONAL SECTION -->
    <div class="field-group conditional-section" v-if="isConditional && conditionalField">
      <label class="checkbox-label">
        <input type="checkbox" v-model="hasAndCondition" />
        <span>Add additional AND condition</span>
      </label>
      <small style="color: var(--color-text-muted); font-size: 0.85em; margin-top: 4px"> Field must match BOTH conditions to be shown </small>
    </div>
    <div class="field-group" v-if="hasAndCondition && existingFieldOptions.length > 0">
      <label>AND when field:</label>
      <CustomSelect
        ref="andConditionalFieldSelect"
        :options="existingFieldOptions"
        placeholder="Select Field"
        @option-selected="handleAndConditionalFieldSelected"
      />
    </div>
    <div class="field-group" v-if="hasAndCondition && andConditionalField">
      <label for="and-conditional-value">Has value (comma-separated for multiple):</label>
      <input
        type="text"
        id="and-conditional-value"
        name="and-conditional-value"
        placeholder="e.g., OpenAI, Gemini"
        autocomplete="off"
        v-model="andConditionalValue"
      />
      <small style="color: var(--color-text-muted); font-size: 0.85em; margin-top: 4px"> Enter one or more values separated by commas </small>
    </div>
    <Tooltip text="Add Field" width="auto">
      <button class="icon" tabindex="0" @click="addCustomField">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="0.5" y="0.5" width="31" height="31" stroke="#01052A" stroke-opacity="0.25" stroke-dasharray="2 2" />
          <path d="M13.2516 22.5L8 17.305L10.3932 14.9376L13.2516 17.7735L21.6068 9.5L24 11.8674L13.2516 22.5Z" fill="#01052A" fill-opacity="0.5" />
        </svg>
      </button>
    </Tooltip>
  </div>
  <!-- ADD NEW FIELD BUTTON -->
  <div id="add-new-field" class="add-new-field">
    <Tooltip text="Add New Field" width="auto">
      <button id="add-new-field-button" class="icon" tabindex="0" @click="showFieldForm">
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
  <SimpleModal ref="modal" />
</template>

<script>
import { formatTextToDivId } from '@/views/_utils/stringFormatting.js';
import { attachFieldEventListeners } from '@/views/_components/base/fields';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'AddField',
  emits: ['field-added'],
  components: {
    CustomSelect,
    SimpleModal,
    Tooltip,
  },
  data() {
    return {
      editingFieldKey: null,
      selectedFieldType: '',
      selectOptions: '',
      isConditional: false,
      conditionalField: '',
      conditionalValue: '',
      hasAndCondition: false,
      andConditionalField: '',
      andConditionalValue: '',
      fieldTypeOptions: [
        { label: 'Text', value: 'text' },
        { label: 'Textarea', value: 'textarea' },
        { label: 'Number', value: 'number' },
        { label: 'Password', value: 'password' },
        { label: 'Boolean', value: 'boolean' },
        { label: 'Select', value: 'select' },
        { label: 'Checkbox', value: 'checkbox' },
        { label: 'File', value: 'file' },
        { label: 'Code Area', value: 'codearea' },
      ],
    };
  },
  computed: {
    existingFields() {
      // Get existing fields from parent component
      return this.$parent.$parent?.formData?.customFields || {};
    },
    existingFieldOptions() {
      // Convert existing fields to options for the conditional field selector
      return Object.keys(this.existingFields).map((key) => ({
        label: this.existingFields[key].label || key,
        value: key,
      }));
    },
  },
  methods: {
    showFieldForm(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Reset all form fields when opening for a new field (not editing)
      if (!this.editingFieldKey) {
        document.querySelector('#field-name').value = '';
        this.selectedFieldType = '';
        this.selectOptions = '';
        this.isConditional = false;
        this.conditionalField = '';
        this.conditionalValue = '';
        this.hasAndCondition = false;
        this.andConditionalField = '';
        this.andConditionalValue = '';

        // Reset CustomSelect components
        this.$nextTick(() => {
          if (this.$refs.fieldTypeSelect) {
            this.$refs.fieldTypeSelect.setSelectedOption(null);
          }
          if (this.$refs.conditionalFieldSelect) {
            this.$refs.conditionalFieldSelect.setSelectedOption(null);
          }
          if (this.$refs.andConditionalFieldSelect) {
            this.$refs.andConditionalFieldSelect.setSelectedOption(null);
          }
        });
      }

      document.querySelector('.add-new-field').style.display = 'none';
      document.querySelector('.new-field-modal').style.display = 'flex';
    },
    closeFieldForm(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Reset ALL form state when closing
      document.querySelector('#field-name').value = '';
      this.selectedFieldType = '';
      this.selectOptions = '';
      this.isConditional = false;
      this.conditionalField = '';
      this.conditionalValue = '';
      this.hasAndCondition = false;
      this.andConditionalField = '';
      this.andConditionalValue = '';
      this.editingFieldKey = null; // IMPORTANT: Reset editing state

      // Reset CustomSelect components
      this.$nextTick(() => {
        if (this.$refs.fieldTypeSelect) {
          this.$refs.fieldTypeSelect.setSelectedOption(null);
        }
        if (this.$refs.conditionalFieldSelect) {
          this.$refs.conditionalFieldSelect.setSelectedOption(null);
        }
        if (this.$refs.andConditionalFieldSelect) {
          this.$refs.andConditionalFieldSelect.setSelectedOption(null);
        }
      });

      document.querySelector('.new-field-modal').style.display = 'none';
      document.querySelector('.add-new-field').style.display = 'flex';
    },
    handleFieldTypeSelected(option) {
      this.selectedFieldType = option.value;
    },
    handleConditionalFieldSelected(option) {
      this.conditionalField = option.value;
    },
    handleAndConditionalFieldSelected(option) {
      this.andConditionalField = option.value;
    },
    handleEditField(event) {
      const { key, field } = event.detail;

      // Store the key of the field being edited
      this.editingFieldKey = key;

      // Populate the form with existing field data
      document.querySelector('#field-name').value = field.label || key;
      this.selectedFieldType = field.type;

      // Populate select options if it's a select field
      if (field.type === 'select' && field.options) {
        this.selectOptions = field.options.join(', ');
      } else {
        this.selectOptions = '';
      }

      // Populate conditional logic if present
      if (field.conditional) {
        this.isConditional = true;
        this.conditionalField = field.conditional.field;
        this.conditionalValue = Array.isArray(field.conditional.value) ? field.conditional.value.join(', ') : field.conditional.value;

        // Populate AND conditional logic if present
        if (field.conditional.and) {
          this.hasAndCondition = true;
          this.andConditionalField = field.conditional.and.field;
          this.andConditionalValue = Array.isArray(field.conditional.and.value)
            ? field.conditional.and.value.join(', ')
            : field.conditional.and.value;
        } else {
          this.hasAndCondition = false;
          this.andConditionalField = '';
          this.andConditionalValue = '';
        }
      } else {
        this.isConditional = false;
        this.conditionalField = '';
        this.conditionalValue = '';
        this.hasAndCondition = false;
        this.andConditionalField = '';
        this.andConditionalValue = '';
      }

      // Show the form
      this.showFieldForm();

      // Wait for next tick to ensure DOM is updated, then update CustomSelect components
      this.$nextTick(() => {
        // Update field type selector
        if (this.$refs.fieldTypeSelect) {
          const fieldTypeOption = this.fieldTypeOptions.find((opt) => opt.value === field.type);
          if (fieldTypeOption) {
            this.$refs.fieldTypeSelect.setSelectedOption(fieldTypeOption);
          }
        }

        // Update conditional field selector if conditional
        if (field.conditional && this.$refs.conditionalFieldSelect) {
          setTimeout(() => {
            const conditionalFieldOption = this.existingFieldOptions.find((opt) => opt.value === field.conditional.field);
            if (conditionalFieldOption) {
              this.$refs.conditionalFieldSelect.setSelectedOption(conditionalFieldOption);
            }

            // Update AND conditional field selector if AND conditional exists
            if (field.conditional.and && this.$refs.andConditionalFieldSelect) {
              setTimeout(() => {
                const andConditionalFieldOption = this.existingFieldOptions.find((opt) => opt.value === field.conditional.and.field);
                if (andConditionalFieldOption) {
                  this.$refs.andConditionalFieldSelect.setSelectedOption(andConditionalFieldOption);
                }
              }, 100);
            }
          }, 100);
        }
      });
    },
    async addCustomField(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      let customFieldName = document.querySelector('#field-name').value;
      let customFieldType = this.selectedFieldType;
      let divId = formatTextToDivId(customFieldName);

      if (!divId) {
        await this.$refs.modal.showModal({
          title: 'Invalid Field Name',
          message: 'Please enter a valid field name.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      if (!customFieldType) {
        await this.$refs.modal.showModal({
          title: 'Invalid Field Type',
          message: 'Please select a valid field type.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      // Validate select options if field type is select
      let options = [];
      if (customFieldType === 'select') {
        if (!this.selectOptions || this.selectOptions.trim() === '') {
          await this.$refs.modal.showModal({
            title: 'Missing Options',
            message: 'Please enter at least one option for the select field.',
            confirmText: 'OK',
            showCancel: false,
          });
          return;
        }
        // Parse comma-separated options and trim whitespace
        options = this.selectOptions
          .split(',')
          .map((opt) => opt.trim())
          .filter((opt) => opt !== '');
        if (options.length === 0) {
          await this.$refs.modal.showModal({
            title: 'Invalid Options',
            message: 'Please enter valid options separated by commas.',
            confirmText: 'OK',
            showCancel: false,
          });
          return;
        }
      }

      // Validate conditional logic if enabled
      if (this.isConditional) {
        if (!this.conditionalField) {
          await this.$refs.modal.showModal({
            title: 'Missing Conditional Field',
            message: 'Please select which field this field depends on.',
            confirmText: 'OK',
            showCancel: false,
          });
          return;
        }
        if (!this.conditionalValue || this.conditionalValue.trim() === '') {
          await this.$refs.modal.showModal({
            title: 'Missing Conditional Value',
            message: 'Please enter the value(s) that trigger this field to show.',
            confirmText: 'OK',
            showCancel: false,
          });
          return;
        }
      }

      // Emit the new field data
      const fieldData = {
        name: divId,
        type: customFieldType,
        label: customFieldName,
      };

      // Add options array if field type is select
      if (customFieldType === 'select') {
        fieldData.options = options;
      }

      // Add conditional logic if enabled
      if (this.isConditional && this.conditionalField && this.conditionalValue) {
        // Parse conditional values (comma-separated)
        const condValues = this.conditionalValue
          .split(',')
          .map((val) => val.trim())
          .filter((val) => val !== '');

        // Store as single value or array based on count
        fieldData.conditional = {
          field: this.conditionalField,
          value: condValues.length === 1 ? condValues[0] : condValues,
        };

        // Add AND condition if enabled
        if (this.hasAndCondition && this.andConditionalField && this.andConditionalValue) {
          const andCondValues = this.andConditionalValue
            .split(',')
            .map((val) => val.trim())
            .filter((val) => val !== '');

          fieldData.conditional.and = {
            field: this.andConditionalField,
            value: andCondValues.length === 1 ? andCondValues[0] : andCondValues,
          };
        }
      }

      // If editing, use the existing key; otherwise use the new divId
      if (this.editingFieldKey) {
        fieldData.name = this.editingFieldKey;
        fieldData.isEdit = true;
      }

      this.$emit('field-added', fieldData);

      this.closeFieldForm();

      // Reset form
      document.querySelector('#field-name').value = '';
      this.selectedFieldType = '';
      this.selectOptions = '';
      this.isConditional = false;
      this.conditionalField = '';
      this.conditionalValue = '';
      this.hasAndCondition = false;
      this.andConditionalField = '';
      this.andConditionalValue = '';
      this.editingFieldKey = null;
    },
  },
  mounted() {
    attachFieldEventListeners();
    // Listen for edit field events
    window.addEventListener('edit-field', this.handleEditField);
  },
  updated() {
    attachFieldEventListeners();
  },
  beforeUnmount() {
    window.removeEventListener('edit-field', this.handleEditField);
  },
};
</script>

<style>
.new-field-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  width: 100%;
  width: -webkit-fill-available;
  gap: 16px;
  padding: 16px 12px;
  border: 2px solid var(--color-primary);
  border-radius: 8px;
}
</style>
