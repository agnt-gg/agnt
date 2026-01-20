<template>
  <div class="chat-actions-bar">
    <!-- Autosave Status Indicator -->
    <div class="autosave-status" :class="statusClass" v-if="saveStatus || isSaving">
      <span class="status-icon">{{ statusIcon }}</span>
      <span class="status-text">{{ statusText }}</span>
    </div>
    <Tooltip text="Save Conversation Now" width="auto">
      <button class="action-icon-button save-button" @click="handleManualSave" :disabled="isSaving">💾</button>
    </Tooltip>
    <Tooltip text="Clear Chat History" width="auto">
      <button class="action-icon-button clear-button" @click="$emit('clear')">🗑️</button>
    </Tooltip>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ChatActions',
  components: {
    Tooltip,
  },
  emits: ['clear'],
  setup() {
    const store = useStore();

    const saveStatus = computed(() => store.state.chat.saveStatus);
    const isSaving = computed(() => store.state.chat.isSaving);
    const lastSaveTimestamp = computed(() => store.state.chat.lastSaveTimestamp);

    const statusIcon = computed(() => {
      if (isSaving.value || saveStatus.value === 'saving') return '⏳';
      if (saveStatus.value === 'saved') return '✅';
      if (saveStatus.value === 'error') return '❌';
      return '💾';
    });

    const statusText = computed(() => {
      if (isSaving.value || saveStatus.value === 'saving') return 'Saving...';
      if (saveStatus.value === 'saved') return 'Saved';
      if (saveStatus.value === 'error') return 'Save failed';

      // Show relative time if we have a last save timestamp
      if (lastSaveTimestamp.value) {
        const secondsAgo = Math.floor((Date.now() - lastSaveTimestamp.value) / 1000);
        if (secondsAgo < 60) return 'Saved just now';
        if (secondsAgo < 3600) return `Saved ${Math.floor(secondsAgo / 60)}m ago`;
        return `Saved ${Math.floor(secondsAgo / 3600)}h ago`;
      }

      return '';
    });

    const statusClass = computed(() => {
      return {
        saving: isSaving.value || saveStatus.value === 'saving',
        saved: saveStatus.value === 'saved',
        error: saveStatus.value === 'error',
      };
    });

    const handleManualSave = () => {
      // Trigger autosave immediately without debouncing
      store.dispatch('chat/autosaveConversation', { debounce: false });
    };

    return {
      saveStatus,
      isSaving,
      statusIcon,
      statusText,
      statusClass,
      handleManualSave,
    };
  },
};
</script>

<style scoped>
.chat-actions-bar {
  position: absolute;
  bottom: 6px;
  right: 8px;
  z-index: 10;
  display: flex;
  gap: 8px;
  align-items: center;
}

.autosave-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 18px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.2);
  font-size: 0.85em;
  transition: all 0.2s ease;
}

.autosave-status.saving {
  background: rgba(18, 224, 255, 0.15);
  border-color: rgba(18, 224, 255, 0.3);
  animation: pulse 1.5s ease-in-out infinite;
}

.autosave-status.saved {
  background: rgba(25, 239, 131, 0.15);
  border-color: rgba(25, 239, 131, 0.3);
  animation: success-pop 0.3s ease-out;
}

.autosave-status.error {
  background: rgba(255, 107, 107, 0.15);
  border-color: rgba(255, 107, 107, 0.3);
}

.status-icon {
  font-size: 1em;
  line-height: 1;
}

.status-text {
  color: var(--color-light-med-navy);
  font-size: 0.9em;
  white-space: nowrap;
}

.autosave-status.saving .status-text {
  color: var(--color-blue);
}

.autosave-status.saved .status-text {
  color: var(--color-green);
}

.autosave-status.error .status-text {
  color: #ff6b6b;
}

.action-icon-button {
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.2);
  color: var(--color-light-med-navy);
  padding: 8px 10px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
}

.save-button:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.4);
  color: var(--color-white);
}

.save-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-button:hover {
  background: rgba(255, 107, 107, 0.2);
  border-color: rgba(255, 107, 107, 0.4);
  color: var(--color-white);
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.02);
    opacity: 0.9;
  }
}

@keyframes success-pop {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}
</style>
