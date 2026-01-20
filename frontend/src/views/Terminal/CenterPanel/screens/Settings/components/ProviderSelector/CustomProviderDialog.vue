<template>
  <Teleport to="body">
    <div v-if="isOpen" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-container">
        <div class="dialog-header">
          <h3>{{ isEditing ? 'Edit Custom Provider' : 'Add Custom Provider' }}</h3>
          <button @click="closeDialog" class="close-btn">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="dialog-content">
          <div class="form-group">
            <label for="provider-name">Provider Name *</label>
            <input
              id="provider-name"
              v-model="formData.provider_name"
              type="text"
              placeholder="e.g., My Local LLM"
              :disabled="isTesting || isSaving"
            />
            <span v-if="errors.provider_name" class="error-text">{{ errors.provider_name }}</span>
          </div>

          <div class="form-group">
            <label for="base-url">Base URL *</label>
            <input
              id="base-url"
              v-model="formData.base_url"
              type="text"
              placeholder="e.g., http://localhost:8000/v1"
              :disabled="isTesting || isSaving"
            />
            <span class="help-text">Must be OpenAI-compatible</span>
            <span v-if="errors.base_url" class="error-text">{{ errors.base_url }}</span>
          </div>

          <div class="form-group">
            <label for="api-key">API Key <span class="optional">(Optional)</span></label>
            <input
              id="api-key"
              v-model="formData.api_key"
              type="password"
              placeholder="Enter API key (if required)"
              :disabled="isTesting || isSaving"
            />
            <span v-if="errors.api_key" class="error-text">{{ errors.api_key }}</span>
          </div>

          <!-- Test Connection Results -->
          <div v-if="testResult" class="test-result" :class="{ success: testResult.success, error: !testResult.success }">
            <div class="test-result-header">
              <i :class="testResult.success ? 'fas fa-check-circle' : 'fas fa-exclamation-circle'"></i>
              <span>{{ testResult.success ? 'Connection Successful' : 'Connection Failed' }}</span>
            </div>
            <div v-if="testResult.success" class="test-result-details">
              <p>Found {{ testResult.modelsCount }} model(s)</p>
              <div v-if="testResult.models && testResult.models.length > 0" class="model-list">
                <span v-for="model in testResult.models" :key="model" class="model-tag">{{ model }}</span>
              </div>
            </div>
            <div v-else class="test-result-details">
              <p>{{ testResult.error }}</p>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button @click="testConnection" class="btn btn-secondary" :disabled="!canTest || isTesting || isSaving">
            <i v-if="isTesting" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-plug"></i>
            {{ isTesting ? 'Testing...' : 'Test Connection' }}
          </button>
          <div class="footer-right">
            <button @click="closeDialog" class="btn btn-cancel" :disabled="isTesting || isSaving">Cancel</button>
            <button @click="saveProvider" class="btn btn-primary" :disabled="!canSave || isTesting || isSaving">
              <i v-if="isSaving" class="fas fa-spinner fa-spin"></i>
              <i v-else class="fas fa-save"></i>
              {{ isSaving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'CustomProviderDialog',
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    editProvider: {
      type: Object,
      default: null,
    },
  },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const store = useStore();

    const formData = ref({
      provider_name: '',
      base_url: '',
      api_key: '',
    });

    const errors = ref({});
    const testResult = ref(null);
    const isTesting = ref(false);
    const isSaving = ref(false);

    const isEditing = computed(() => !!props.editProvider);

    const canTest = computed(() => {
      return formData.value.base_url;
    });

    const canSave = computed(() => {
      return formData.value.provider_name && formData.value.base_url && !Object.keys(errors.value).length;
    });

    // Watch for edit provider changes
    watch(
      () => props.editProvider,
      (newProvider) => {
        if (newProvider) {
          formData.value = {
            provider_name: newProvider.provider_name || '',
            base_url: newProvider.base_url || '',
            api_key: '', // Don't populate API key for security
          };
        }
      },
      { immediate: true }
    );

    // Watch for dialog open/close
    watch(
      () => props.isOpen,
      (isOpen) => {
        if (isOpen && !props.editProvider) {
          // Reset form when opening for new provider
          formData.value = {
            provider_name: '',
            base_url: '',
            api_key: '',
          };
          errors.value = {};
          testResult.value = null;
        }
      }
    );

    const validateForm = () => {
      errors.value = {};

      if (!formData.value.provider_name) {
        errors.value.provider_name = 'Provider name is required';
      }

      if (!formData.value.base_url) {
        errors.value.base_url = 'Base URL is required';
      } else {
        try {
          new URL(formData.value.base_url);
        } catch (e) {
          errors.value.base_url = 'Invalid URL format';
        }
      }

      return Object.keys(errors.value).length === 0;
    };

    const testConnection = async () => {
      if (!validateForm()) return;

      isTesting.value = true;
      testResult.value = null;

      try {
        const result = await store.dispatch('aiProvider/testCustomProviderConnection', {
          base_url: formData.value.base_url,
          api_key: formData.value.api_key,
        });

        testResult.value = result;
      } catch (error) {
        testResult.value = {
          success: false,
          error: error.message || 'Connection test failed',
        };
      } finally {
        isTesting.value = false;
      }
    };

    const saveProvider = async () => {
      if (!validateForm()) return;

      isSaving.value = true;

      try {
        let savedProvider;
        if (isEditing.value) {
          // Update existing provider
          const updates = {
            provider_name: formData.value.provider_name,
            base_url: formData.value.base_url,
          };

          // Only include API key if it was changed
          if (formData.value.api_key) {
            updates.api_key = formData.value.api_key;
          }

          savedProvider = await store.dispatch('aiProvider/updateCustomProvider', {
            id: props.editProvider.id,
            updates,
          });
        } else {
          // Create new provider
          savedProvider = await store.dispatch('aiProvider/createCustomProvider', formData.value);
        }

        // Fetch models for the saved provider
        if (savedProvider && savedProvider.id) {
          try {
            await store.dispatch('aiProvider/fetchCustomProviderModels', savedProvider.id);
          } catch (error) {
            console.error('Failed to fetch models for new provider:', error);
          }
        }

        emit('saved', savedProvider);
        closeDialog();
      } catch (error) {
        errors.value.general = error.message || 'Failed to save provider';
      } finally {
        isSaving.value = false;
      }
    };

    const closeDialog = () => {
      emit('close');
    };

    return {
      formData,
      errors,
      testResult,
      isTesting,
      isSaving,
      isEditing,
      canTest,
      canSave,
      testConnection,
      saveProvider,
      closeDialog,
    };
  },
};
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog-container {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  margin: 20px;
  position: relative;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 12px 12px 0 0;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.25em;
  font-weight: 600;
  color: var(--color-green);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  font-size: 1.1em;
}

.close-btn:hover {
  background: rgba(255, 107, 107, 0.1);
  color: var(--color-red);
}

.dialog-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.9em;
  font-weight: 500;
  color: var(--color-light-med-navy);
}

.form-group input {
  width: 100%;
}

.help-text {
  display: block;
  margin-top: 6px;
  font-size: 0.85em;
  color: var(--color-med-navy);
  font-style: italic;
}

.error-text {
  display: block;
  margin-top: 6px;
  font-size: 0.85em;
  color: var(--color-red);
}

.test-result {
  margin-top: 20px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid;
}

.test-result.success {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.3);
}

.test-result.error {
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.3);
}

.test-result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  margin-bottom: 8px;
}

.test-result.success .test-result-header {
  color: var(--color-green);
}

.test-result.error .test-result-header {
  color: var(--color-red);
}

.test-result-details {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
}

.model-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.model-tag {
  padding: 4px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  font-size: 0.85em;
  font-family: var(--font-family-mono);
  color: var(--color-green);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-top: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 0 0 12px 12px;
}

.footer-right {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.95em;
  font-weight: 500;
  cursor: pointer;
  border: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.btn-primary:hover:not(:disabled) {
  /* background: var(--color-light-green);
  transform: translateY(-1px); */
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.3);
}

.btn-secondary {
  background: var(--color-med-navy);
  color: var(--color-light-med-navy);
  border: 1px solid var(--terminal-border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-light-med-navy);
  color: var(--color-dark-navy);
}

.btn-cancel {
  background: transparent;
  color: var(--color-light-med-navy);
  border: 1px solid var(--terminal-border-color);
}

.btn-cancel:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.1);
  border-color: var(--color-red);
  color: var(--color-red);
}
</style>
