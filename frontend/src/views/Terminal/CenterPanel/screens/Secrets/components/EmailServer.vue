<template>
  <div class="email-server-container">
    <div class="email-server-header">
      <h3>
        Email Server Connections
        <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
      </h3>
      <p class="subtitle">Managed email server for your workflows</p>
    </div>

    <div v-if="isLoading" class="loading">Loading email servers...</div>

    <div v-else-if="emailServers.length === 0 && isPro" class="no-email-servers">
      <i class="fas fa-envelope-open-text"></i>
      <p style="color: var(--color-yellow); font-weight: 600">🚀 Email Server Enabled</p>
      <p class="hint">You can now use email nodes to enable email functionality within your workflows</p>
    </div>

    <!-- Example email servers for non-pro users -->
    <div v-if="!isPro" class="email-servers-list locked">
      <div v-for="i in 2" :key="'example-' + i" class="email-server-card locked">
        <div class="email-server-info">
          <div class="email-server-name">
            <i class="fas fa-server"></i>
            <span class="server-link">Example Email Server {{ i }}</span>
          </div>
          <div class="email-server-details">
            <span class="label">Host:</span>
            <code class="detail-text">workflow-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx@agnt.gg</code>
            <Tooltip text="Upgrade to PRO to access email servers" width="auto">
              <button class="copy-btn disabled" disabled>
                <i class="fas fa-copy"></i>
                <i class="fas fa-lock lock-icon"></i>
              </button>
            </Tooltip>
          </div>
          <div class="email-server-meta">
            <span class="meta-item status-badge status-listening">
              <i class="fas fa-circle"></i>
              active
            </span>
            <span class="meta-item">
              <i class="fas fa-exchange-alt"></i>
              SMTP
            </span>
            <span class="meta-item">
              <i class="fas fa-lock"></i>
              TLS
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

    <div v-else-if="isPro" class="email-servers-list">
      <div v-for="server in emailServers" :key="server.id" class="email-server-card">
        <div class="email-server-info">
          <div class="email-server-name">
            <i class="fas fa-server"></i>
            <span class="server-link">
              {{ server.name || 'Unnamed Server' }}
            </span>
          </div>
          <div class="email-server-details">
            <span class="label">Host:</span>
            <code class="detail-text">{{ server.host }}:{{ server.port }}</code>
            <Tooltip :text="isPro ? 'Copy Host' : 'Upgrade to PRO to access email servers'" width="auto">
              <button
                class="copy-btn"
                @click="isPro ? copyToClipboard(server.host, server.id) : null"
                :disabled="!isPro"
                :class="{ disabled: !isPro }"
              >
                <i :class="copiedId === server.id ? 'fas fa-check' : 'fas fa-copy'"></i>
                <span v-if="copiedId === server.id" class="copied-text">Copied!</span>
              </button>
            </Tooltip>
          </div>
          <div class="email-server-meta">
            <span class="meta-item status-badge" :class="getStatusClass(server.status)">
              <i class="fas fa-circle"></i>
              {{ server.status || 'unknown' }}
            </span>
            <span v-if="server.protocol" class="meta-item">
              <i class="fas fa-exchange-alt"></i>
              {{ server.protocol }}
            </span>
            <span v-if="server.secure" class="meta-item">
              <i class="fas fa-lock"></i>
              {{ server.secure ? 'TLS' : 'No TLS' }}
            </span>
            <span class="meta-item">
              <i class="fas fa-calendar"></i>
              {{ formatDate(server.created_at) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useLicense } from '@/composables/useLicense';

export default {
  name: 'EmailServer',
  components: {
    Tooltip,
  },
  setup() {
    const store = useStore();
    const emailServers = ref([]);
    const isLoading = ref(false);
    const copiedId = ref(null);

    // Use verified license for premium check
    const { isPremium, hasEmailServer } = useLicense();
    const isPro = computed(() => isPremium.value && hasEmailServer.value);

    onMounted(() => {
      if (isPro.value) {
        // TODO: Fetch email servers from store/API
        // store.dispatch('emailServers/fetchEmailServers');
        isLoading.value = false;
      }
    });

    const copyToClipboard = async (text, serverId) => {
      try {
        await navigator.clipboard.writeText(text);
        copiedId.value = serverId;
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

    const getStatusClass = (status) => {
      switch (status) {
        case 'active':
          return 'status-listening';
        case 'inactive':
          return 'status-stopped';
        case 'error':
          return 'status-error';
        default:
          return 'status-unknown';
      }
    };

    return {
      emailServers,
      isLoading,
      copiedId,
      isPro,
      copyToClipboard,
      formatDate,
      getStatusClass,
    };
  },
};
</script>

<style scoped>
.email-server-header {
  margin-bottom: 24px;
}

.email-server-header h3 {
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
  color: #ffd700;
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
.no-email-servers {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-yellow);
  border-top: 1px solid var(--terminal-border-color);
}

.no-email-servers i {
  font-size: 3em;
  margin-bottom: 16px;
  color: var(--color-yellow);
}

.no-email-servers p {
  margin: 8px 0;
}

.hint {
  font-size: 0.85em;
  opacity: 0.7;
}

.email-servers-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

.email-servers-list.locked {
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
  border: 2px solid #ffd700;
  pointer-events: all;
  z-index: 10;
}

.locked-overlay i {
  font-size: 2.5em;
  color: #ffd700;
  margin-bottom: 12px;
  display: block;
}

.locked-overlay p {
  margin: 0;
  color: #fff;
  font-weight: 600;
  font-size: 1.1em;
}

.email-server-card {
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  transition: all 0.2s ease;
}

.email-server-card.locked {
  filter: grayscale(100%);
  opacity: 0.5;
}

body.dark .email-server-card {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.email-server-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.email-server-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1em;
  font-weight: 600;
  width: fit-content;
}

.email-server-name i {
  color: var(--color-green);
}

.server-link {
  color: var(--color-text);
  transition: color 0.2s ease;
}

.email-server-details {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.email-server-details .label {
  color: var(--color-light-med-navy);
  font-weight: 600;
  width: fit-content;
}

.detail-text {
  flex: 1;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
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
  color: #ffd700;
  margin-left: 4px;
}

.copied-text {
  font-size: 0.9em;
  font-weight: 600;
}

.email-server-meta {
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

.status-listening {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.status-stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-grey);
}

.status-error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.status-unknown {
  background: rgba(127, 129, 147, 0.1);
  color: var(--color-light-med-navy);
}
</style>
