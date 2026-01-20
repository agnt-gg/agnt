<template>
  <div class="api-key-display">
    <h3 style="margin-bottom: 12px">
      AGNT.gg API Key
      <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
    </h3>

    <div class="key-container-wrapper">
      <div class="key-container" :class="{ locked: !isPro }">
        <input type="text" :value="displayApiKey" readonly ref="apiKeyInput" :disabled="!isPro" />
        <Tooltip :text="isPro ? 'Copy API Key' : 'Upgrade to PRO to access API Key'" width="auto">
          <button
            @click="isPro ? copyApiKey() : null"
            class="copy-button"
            :class="{ disabled: !isPro }"
            :disabled="!isPro"
          >
            <i class="fa fa-copy"></i>
            <i v-if="!isPro" class="fas fa-lock lock-icon"></i>
          </button>
        </Tooltip>
      </div>
      <div v-if="!isPro" class="locked-overlay">
        <i class="fas fa-lock"></i>
        <p>Upgrade to PRO to unlock</p>
      </div>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useLicense } from '@/composables/useLicense';

export default {
  name: 'ApiKeyDisplay',
  components: { SvgIcon, SimpleModal, Tooltip },
  setup() {
    const store = useStore();
    const apiKeyInput = ref(null);
    const modal = ref(null);

    // Use verified license for premium check
    const { isPremium, hasApiAccess } = useLicense();
    const isPro = computed(() => isPremium.value && hasApiAccess.value);

    const apiKey = computed(() => store.state.userAuth.token || '');
    const maskedApiKey = computed(() => {
      if (apiKey.value.length > 10) {
        return apiKey.value.slice(0, 12) + '...' + apiKey.value.slice(-12);
      }
      return apiKey.value;
    });

    const displayApiKey = computed(() => {
      if (!isPro.value) {
        return '••••••••••••••••••••••••••••••••';
      }
      return maskedApiKey.value;
    });

    const showAlert = async (title, message) => {
      await modal.value.showModal({
        title,
        message,
        confirmText: 'OK',
        showCancel: false,
      });
    };

    const copyApiKey = async () => {
      try {
        await navigator.clipboard.writeText(apiKey.value);
        await showAlert('Success', 'API Key copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy API Key:', err);
        await showAlert('Error', 'Failed to copy API Key. Please try again.');
      }
    };

    return {
      maskedApiKey,
      displayApiKey,
      copyApiKey,
      apiKeyInput,
      modal,
      isPro,
    };
  },
};
</script>

<style scoped>
.api-key-display {
  width: 100%;
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.65em;
  color: #ffd700;
  background: rgba(255, 215, 0, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
  margin-left: 8px;
}

.pro-locked-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text);
  background: rgba(255, 215, 0, 0.05);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: 8px;
  margin-top: 8px;
}

.pro-locked-message i {
  font-size: 3em;
  color: #ffd700;
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

body.dark .pro-locked-message h4 {
  color: var(--color-dull-white);
}

.key-container-wrapper {
  position: relative;
}

.key-container {
  display: flex;
  align-items: center;
  position: relative;
}

.key-container.locked {
  opacity: 0.4;
  pointer-events: none;
  user-select: none;
  filter: grayscale(100%);
}

.locked-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 12px 16px;
  border-radius: 8px;
  border: 2px solid #ffd700;
  pointer-events: all;
  z-index: 10;
  white-space: nowrap;
}

.locked-overlay i {
  font-size: 1.2em;
  color: #ffd700;
  margin-right: 6px;
}

.locked-overlay p {
  margin: 0;
  color: #fff;
  font-weight: 600;
  font-size: 0.85em;
  display: inline;
}

input {
  flex-grow: 1;
  padding: 8px;
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  background-color: var(--color-dull-white);
  color: var(--color-dark-navy);
}

input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-button {
  margin-left: 8px;
  padding: 8px;
  background-color: var(--color-light-navy);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}

.copy-button:hover:not(.disabled) {
  background-color: var(--color-navy);
}

.copy-button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-button.disabled:hover {
  background-color: var(--color-light-navy);
}

.lock-icon {
  font-size: 10px;
  color: #ffd700;
}

body.dark .copy-button {
  background-color: var(--color-dull-navy);
}

body.dark .copy-button:hover:not(.disabled) {
  background-color: var(--color-navy);
}

body.dark .copy-button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

body.dark .copy-button.disabled:hover {
  background-color: var(--color-dull-navy);
}

/* body.dark input {
  background-color: var(--color-ultra-dark-navy);
  color: var(--color-dull-white);
  border-color: var(--color-dull-navy);
} */
</style>
