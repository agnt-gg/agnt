<template>
  <div class="webhooks-container">
    <div class="webhooks-header">
      <h3>
        Active Webhooks
        <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
      </h3>
      <p class="subtitle">Managed webhooks registered for your workflows</p>
    </div>

    <div v-if="isLoading" class="loading">Loading webhooks...</div>

    <div v-else-if="webhooks.length === 0 && isPro" class="no-webhooks">
      <i class="fas fa-webhook"></i>
      <p style="color: var(--color-green); font-weight: 600">🚀 Webhook Server Enabled</p>
      <p class="hint">Webhooks are automatically created when you add a Webhook Trigger node to a workflow</p>
    </div>

    <!-- Example webhooks for non-pro users -->
    <div v-if="!isPro" class="webhooks-list locked">
      <div v-for="i in 2" :key="'example-' + i" class="webhook-card locked">
        <div class="webhook-info">
          <div class="webhook-workflow">
            <i class="fas fa-project-diagram"></i>
            <span class="workflow-link">Example Workflow {{ i }}</span>
          </div>
          <div class="webhook-url">
            <span class="label">URL:</span>
            <code class="url-text">https://api.agnt.gg/webhooks/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>
            <Tooltip text="Upgrade to PRO to access webhooks" width="auto">
              <button class="copy-btn disabled" disabled>
                <i class="fas fa-copy"></i>
                <i class="fas fa-lock lock-icon"></i>
              </button>
            </Tooltip>
          </div>
          <div class="webhook-meta">
            <span class="meta-item status-badge status-listening">
              <i class="fas fa-circle"></i>
              listening
            </span>
            <span class="meta-item">
              <i class="fas fa-exchange-alt"></i>
              POST
            </span>
            <span class="meta-item">
              <i class="fas fa-lock"></i>
              API Key
            </span>
            <span class="meta-item">
              <i class="fas fa-calendar"></i>
              Jan 1, 2024
            </span>
          </div>
        </div>
      </div>
      <div class="locked-overlay">
        <i class="fas fa-lock"></i>
        <p>Upgrade to PRO to unlock</p>
      </div>
    </div>

    <div v-else-if="isPro" class="webhooks-list">
      <div v-for="webhook in webhooks" :key="webhook.id" class="webhook-card">
        <div class="webhook-info">
          <div class="webhook-workflow" @click="openWorkflow(webhook.workflow_id)">
            <i class="fas fa-project-diagram"></i>
            <span class="workflow-link">
              {{ webhook.workflow_name || 'Unnamed Workflow' }}
            </span>
          </div>
          <div class="webhook-url">
            <span class="label">URL:</span>
            <code class="url-text">{{ webhook.webhook_url }}</code>
            <Tooltip :text="isPro ? 'Copy URL' : 'Upgrade to PRO to access webhooks'" width="auto">
              <button
                class="copy-btn"
                @click="isPro ? copyToClipboard(webhook.webhook_url, webhook.id) : null"
                :disabled="!isPro"
                :class="{ disabled: !isPro }"
              >
                <i :class="copiedId === webhook.id ? 'fas fa-check' : 'fas fa-copy'"></i>
                <span v-if="copiedId === webhook.id" class="copied-text">Copied!</span>
              </button>
            </Tooltip>
          </div>
          <div class="webhook-meta">
            <span class="meta-item status-badge" :class="getStatusClass(webhook.workflow_status)">
              <i class="fas fa-circle"></i>
              {{ webhook.workflow_status || 'unknown' }}
            </span>
            <span v-if="webhook.method" class="meta-item">
              <i class="fas fa-exchange-alt"></i>
              {{ webhook.method }}
            </span>
            <span v-if="webhook.auth_type" class="meta-item">
              <i class="fas fa-lock"></i>
              {{ webhook.auth_type }}
            </span>
            <span class="meta-item">
              <i class="fas fa-calendar"></i>
              {{ formatDate(webhook.created_at) }}
            </span>
          </div>
        </div>
        <!-- <div class="webhook-actions">
          <BaseButton variant="danger" size="small" @click="deleteWebhookConfirm(webhook)">
            <i class="fas fa-trash"></i>
          </BaseButton>
        </div> -->
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useLicense } from '@/composables/useLicense';

export default {
  name: 'Webhooks',
  components: {
    BaseButton,
    SimpleModal,
    Tooltip,
  },
  emits: ['open-workflow'],
  setup(props, { emit }) {
    const store = useStore();
    const webhooks = computed(() => store.getters['webhooks/allWebhooks']);
    const isLoading = computed(() => store.getters['webhooks/isLoading']);
    const copiedId = ref(null);

    // Use verified license for premium check
    const { isPremium, hasWebhooks } = useLicense();
    const isPro = computed(() => isPremium.value && hasWebhooks.value);

    onMounted(() => {
      if (isPro.value) {
        store.dispatch('webhooks/fetchWebhooks');
      }
    });

    const openWorkflow = (workflowId) => {
      emit('open-workflow', workflowId);
    };

    const copyToClipboard = async (text, webhookId) => {
      try {
        await navigator.clipboard.writeText(text);
        copiedId.value = webhookId;
        setTimeout(() => {
          copiedId.value = null;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    };

    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    };

    const simpleModal = ref(null);

    const deleteWebhookConfirm = async (webhook) => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Webhook?',
        message: `Delete webhook for "${webhook.workflow_name || 'Unnamed Workflow'}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      const result = await store.dispatch('webhooks/deleteWebhook', webhook.workflow_id);
      if (result.success) {
        console.log('Webhook deleted successfully');
      } else {
        console.error('Failed to delete webhook:', result.error);
      }
    };

    const getStatusClass = (status) => {
      switch (status) {
        case 'running':
          return 'status-running';
        case 'listening':
          return 'status-listening';
        case 'queued':
          return 'status-queued';
        case 'stopped':
          return 'status-stopped';
        case 'error':
          return 'status-error';
        default:
          return 'status-unknown';
      }
    };

    return {
      simpleModal,
      webhooks,
      isLoading,
      copiedId,
      isPro,
      openWorkflow,
      copyToClipboard,
      formatDate,
      deleteWebhookConfirm,
      getStatusClass,
    };
  },
};
</script>

<style scoped>
.webhooks-header {
  margin-bottom: 24px;
}

.webhooks-header h3 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 12px;
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.5em;
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.15);
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
}

.subtitle {
  margin: 0;
  color: var(--color-light-med-navy);
  font-size: 0.9em;
}

.loading,
.no-webhooks,
.pro-locked-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text);
  border-top: 1px solid var(--terminal-border-color);
}

.pro-locked-message {
  background: rgba(255, 215, 0, 0.05);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: 8px;
  margin-top: 16px;
}

.pro-locked-message i {
  font-size: 3em;
  color: var(--color-yellow);
  margin-bottom: 16px;
}

.pro-locked-message h4 {
  margin: 0 0 8px 0;
  color: var(--color-text);
  font-size: 1.2em;
}

.pro-locked-message p {
  margin: 0;
  color: var(--color-light-med-navy);
  font-size: 0.95em;
}

.no-webhooks i {
  font-size: 3em;
  margin-bottom: 16px;
  opacity: 0.5;
}

.no-webhooks p {
  margin: 8px 0;
}

.hint {
  font-size: 0.85em;
  opacity: 0.7;
}

.webhooks-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

.webhooks-list.locked {
  pointer-events: none;
  user-select: none;
}

.locked-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 24px 32px;
  border-radius: 12px;
  border: 2px solid var(--color-yellow);
  pointer-events: all;
  z-index: 10;
}

.locked-overlay i {
  font-size: 2.5em;
  color: var(--color-yellow);
  margin-bottom: 12px;
  display: block;
}

.locked-overlay p {
  margin: 0;
  color: #fff;
  font-weight: 600;
  font-size: 1.1em;
}

.webhook-card {
  background: transparent;
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  transition: all 0.2s ease;
}

.webhook-card.locked {
  filter: grayscale(100%);
  opacity: 0.5;
}

body.dark .webhook-card {
  border: 1px solid var(--terminal-border-color);
}

/* .webhook-card:hover {
  border-color: var(--color-green);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.1);
} */

.webhook-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.webhook-workflow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1em;
  font-weight: 600;
  width: fit-content;
}

.webhook-workflow i {
  color: var(--color-green);
}

.webhook-workflow {
  cursor: pointer;
}

.workflow-link {
  color: var(--color-text);
  transition: color 0.2s ease;
}

.webhook-workflow:hover .workflow-link {
  color: var(--color-green);
  text-decoration: underline;
}

.webhook-url {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.webhook-url .label {
  color: var(--color-light-med-navy);
  font-weight: 600;
  width: fit-content;
}

.url-text {
  flex: 1;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  background: none;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: fit-content;
  justify-content: center;
}

.copy-btn:hover:not(.disabled) {
  background: var(--color-green);
  border-color: var(--color-green);
  color: var(--color-dark-navy);
}

.copy-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  position: relative;
}

.copy-btn.disabled:hover {
  background: none;
  border-color: var(--terminal-border-color);
  color: var(--color-text);
}

.copy-btn .lock-icon {
  font-size: 10px;
  color: var(--color-yellow);
  margin-left: 4px;
}

.copied-text {
  font-size: 0.9em;
  font-weight: 600;
}

.webhook-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 0.85em;
  color: var(--color-light-med-navy);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 100%;
}

.meta-item i {
  opacity: 0.7;
  margin-top: -2px;
}

.webhook-actions {
  display: flex;
  gap: 8px;
}

.status-badge {
  padding: 4px 10px 1px;
  border-radius: 12px;
  font-weight: 600;
  text-transform: capitalize;
  margin-top: -2px;
}

.status-badge i {
  font-size: 0.6em;
}

.status-running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.status-listening {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.status-queued {
  background: rgba(251, 191, 36, 0.2);
  color: var(--color-yellow);
}

.status-stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-grey);
}

.status-error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.status-unknown {
  background: rgba(127, 129, 147, 0.1);
  color: var(--color-light-med-navy);
}
</style>
