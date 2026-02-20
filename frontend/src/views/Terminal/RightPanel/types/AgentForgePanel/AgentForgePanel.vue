<template>
  <div class="ui-panel agentforge-panel">
    <!-- Action Card -->
    <div class="action-card">
      <div class="action-content">
        <div class="validation-status" :class="{ valid: isFormValid || successMessage, invalid: !isFormValid && !successMessage }">
          <i :class="successMessage ? 'fas fa-check-circle' : isFormValid ? 'fas fa-check-circle' : 'fas fa-exclamation-circle'"></i>
          <span v-if="successMessage">{{ successMessage }}</span>
          <span v-else-if="isFormValid">Ready to create agent</span>
          <span v-else>Agent name is required</span>
        </div>

        <BaseButton
          type="button"
          :disabled="!isFormValid || isLoading"
          variant="primary"
          class="create-agent-button"
          :loading="isLoading"
          :full-width="true"
          @click="handleCreateAgent"
        >
          <i class="fas fa-robot"></i>
          <span v-if="isLoading">Creating Agent...</span>
          <span v-else>Create Agent</span>
        </BaseButton>
      </div>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import BaseForm from '@/views/Terminal/_components/BaseForm.vue';
import BaseInput from '@/views/Terminal/_components/BaseInput.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import BaseTextarea from '@/views/Terminal/_components/BaseTextarea.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'AgentForgePanel',
  components: { BaseButton, BaseForm, BaseInput, BaseSelect, BaseTextarea, ResourcesSection },
  props: {
    availableTools: {
      type: Array,
      default: () => [],
    },
    availableWorkflows: {
      type: Array,
      default: () => [],
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
    availableCategories: {
      type: Array,
      default: () => [],
    },
    isFormValid: {
      type: Boolean,
      default: false,
    },
    onCreateAgent: {
      type: Function,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    // Reactive success message for UI feedback
    const successMessage = ref('');

    // Handle create agent button click
    const handleCreateAgent = () => {
      if (props.onCreateAgent) {
        // Reset any previous message
        successMessage.value = '';
        // Call the provided create function
        const result = props.onCreateAgent();
        // If the create function returns a promise, handle success/failure
        if (result && typeof result.then === 'function') {
          result
            .then(() => {
              successMessage.value = 'Agent created successfully!';
              // Auto‑clear after a short delay
              setTimeout(() => {
                successMessage.value = '';
              }, 3000);
            })
            .catch(() => {
              successMessage.value = 'Failed to create agent.';
              setTimeout(() => {
                successMessage.value = '';
              }, 3000);
            });
        }
      }
    };

    return {
      isFormValid: computed(() => props.isFormValid),
      isLoading: computed(() => props.isLoading),
      handleCreateAgent,
      successMessage,
    };
  },
};
</script>

<style scoped>
.ui-panel.agentforge-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  /* background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(18, 224, 255, 0.1); */
  color: var(--color-text);
  border-radius: 0px;
  /* box-shadow: 0 2px 16px rgba(var(--green-rgb), 0.08); */
  /* padding: 18px 18px 0 18px; */
  min-height: 0;
}
.panel-subtitle {
  color: var(--color-green);
  font-size: 1.1em;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.gen-btn {
  margin-top: 4px;
}
.gen-error {
  color: var(--color-red);
  font-size: 1em;
  margin-top: 4px;
  background: rgba(255, 77, 79, 0.08);
  border-radius: 4px;
  padding: 6px 10px;
  border: 1px solid var(--color-red)33;
}
.panel-section.agent-form-section {
  border-radius: 10px;
  padding: 20px 18px 18px 18px;
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(18, 224, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 8px;
}
.panel-title {
  color: var(--color-green);
  font-size: 1.2em;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-actions {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}
.create-btn {
  margin-top: 0;
}
span.button-inner-container {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: center;
  align-items: center;
  gap: 6px;
}

/* Action Card */
.action-card {
  background: var(--color-darker-0);
  /* border: 1px solid var(--terminal-border-color); */
  /* border-radius: 12px; */
  overflow: visible;
  transition: all 0.2s ease;
  /* margin-bottom: 20px; */
}

.action-content {
  /* padding: 20px; */
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* background: var(--terminal-darken-color);
  border-radius: 10px;
  margin: 4px; */
}

.validation-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 0.95em;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
}

.validation-status.valid {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.05);
}

.validation-status.invalid {
  color: var(--color-red);
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.05);
}

.validation-status i {
  font-size: 1.1em;
}

.create-agent-button {
  width: 100%;
  height: 48px;
  font-size: 1em;
  font-weight: 700;
  border-radius: 10px;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background-image: linear-gradient(45deg, var(--color-green), var(--color-blue));
  color: var(--color-dark-navy);
  font-weight: 600;
}

.create-agent-button:focus {
  background-image: linear-gradient(45deg, var(--color-green), var(--color-blue));
  color: var(--color-dark-navy);
  font-weight: 600;
  outline: inherit;
  border: 2px solid var(--color-primary);
}

.create-agent-button:hover:not(:disabled) {
  transform: translateY(-3px);
  background-image: linear-gradient(45deg, var(--color-green), var(--color-blue));
  color: var(--color-dark-navy);
  font-weight: 600;
  /* color: var(--color-green);
  box-shadow: 0 8px 24px rgba(var(--green-rgb), 0.4); */
}

.create-agent-button:disabled {
  opacity: 0.7 5;
  cursor: not-allowed;
  transform: none;
  background-image: linear-gradient(45deg, var(--color-green), var(--color-blue));
  color: var(--color-dark-navy);
  font-weight: 600;
  /* color: var(--color-green);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); */
}

/* Responsive Design */
@media (max-width: 768px) {
  .action-content {
    padding: 16px;
    gap: 12px;
  }
}
</style>
