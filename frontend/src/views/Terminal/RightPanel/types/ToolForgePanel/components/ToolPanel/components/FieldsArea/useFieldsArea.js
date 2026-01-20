import { onMounted, onUpdated } from 'vue';
import { attachFieldEventListeners } from '@/views/_components/base/fields';

/**
 * Evaluates whether a field should be visible based on its conditional logic
 * @param {Object} field - The field to evaluate
 * @param {Object} allFields - All fields in the form
 * @returns {boolean} - True if field should be visible
 */
function shouldShowField(field, allFields) {
  // If no conditional logic, always show
  if (!field.conditional) return true;

  const { field: dependentFieldKey, value: conditionValue, and } = field.conditional;
  const dependentField = allFields[dependentFieldKey];

  // If dependent field doesn't exist, show the field
  if (!dependentField) return true;

  const currentValue = dependentField.value;

  // Check primary condition
  let primaryMatch = false;
  if (Array.isArray(conditionValue)) {
    primaryMatch = conditionValue.includes(currentValue);
  } else {
    primaryMatch = currentValue === conditionValue;
  }

  // If primary condition fails, don't show the field
  if (!primaryMatch) return false;

  // Check AND condition if it exists
  if (and) {
    const andDependentField = allFields[and.field];

    // If AND dependent field doesn't exist, don't show
    if (!andDependentField) return false;

    const andCurrentValue = andDependentField.value;

    // Check AND condition match
    if (Array.isArray(and.value)) {
      return and.value.includes(andCurrentValue);
    } else {
      return andCurrentValue === and.value;
    }
  }

  // Primary condition passed and no AND condition (or AND passed)
  return true;
}

export function useFieldsArea(formData, emit) {
  function updateFormData(key, value) {
    console.log('useFieldsArea updateFormData:', key, value);
    emit('form-updated', key, value);
  }

  function populateFields(newFormData) {
    Object.keys(newFormData).forEach((key) => {
      if (key === 'customFields') {
        updateFormData('customFields', newFormData.customFields);
      } else {
        updateFormData(key, newFormData[key]);
      }
    });
  }

  function addCustomField(field) {
    const fieldData = {
      type: field.type,
      value: field.isEdit ? formData.value.customFields[field.name]?.value || '' : '',
      label: field.label,
    };

    // Add options array if field type is select
    if (field.type === 'select' && field.options) {
      fieldData.options = field.options;
    }

    // Add conditional logic if present
    if (field.conditional) {
      fieldData.conditional = field.conditional;
    } else {
      // Remove conditional if it was previously set but is now disabled
      delete fieldData.conditional;
    }

    const updatedCustomFields = {
      ...formData.value.customFields,
      [field.name]: fieldData,
    };
    updateFormData('customFields', updatedCustomFields);
  }

  function updateCustomField(key, value) {
    const updatedCustomFields = {
      ...formData.value.customFields,
      [key]: {
        ...formData.value.customFields[key],
        value: value,
      },
    };
    updateFormData('customFields', updatedCustomFields);
  }

  function deleteCustomField(key) {
    const updatedCustomFields = { ...formData.value.customFields };
    delete updatedCustomFields[key];
    updateFormData('customFields', updatedCustomFields);
  }

  function addCustomOutput(output) {
    const updatedCustomOutputs = {
      ...formData.value.customOutputs,
      [output.name]: {
        type: output.type,
        description: output.description,
      },
    };
    updateFormData('customOutputs', updatedCustomOutputs);
  }

  function deleteCustomOutput(key) {
    const updatedCustomOutputs = { ...formData.value.customOutputs };
    delete updatedCustomOutputs[key];
    updateFormData('customOutputs', updatedCustomOutputs);
  }

  function editCustomField(key, field) {
    // Dispatch a custom event to trigger the edit modal in AddField component
    const event = new CustomEvent('edit-field', {
      detail: { key, field },
    });
    window.dispatchEvent(event);
  }

  onMounted(() => {
    attachFieldEventListeners();
  });

  onUpdated(() => {
    attachFieldEventListeners();
  });

  return {
    updateFormData,
    populateFields,
    addCustomField,
    updateCustomField,
    deleteCustomField,
    addCustomOutput,
    deleteCustomOutput,
    editCustomField,
    shouldShowField: (field) => shouldShowField(field, formData.value.customFields),
  };
}
