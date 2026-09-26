<template>
  <div class="api-key-display">
    <h3 style="margin-bottom: 12px">
      AGNT API Key
      <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
    </h3>

    <p class="api-key-help">
      For bots, scripts and other integrations calling your AGNT. Send it as
      <code>Authorization: Bearer &lt;key&gt;</code>. It does not expire; generating a new key replaces the old one.
    </p>

    <div class="key-container-wrapper">
      <div class="key-container" :class="{ locked: !isPro }">
        <input
          type="text"
          :value="newKey || 'Generate a key to see it here. It is shown once.'"
          readonly
          ref="apiKeyInput"
          :disabled="!isPro || !newKey"
          data-test="api-key-value"
        />
        <Tooltip v-if="newKey" text="Copy API Key" width="auto">
          <button @click="copyApiKey" class="copy-button" data-test="api-key-copy">
            <i class="fa fa-copy"></i>
          </button>
        </Tooltip>
      </div>
      <div v-if="!isPro" class="locked-overlay">
        <i class="fas fa-lock"></i>
        <p>Upgrade to PRO to unlock</p>
      </div>
    </div>

    <p v-if="newKey" class="api-key-warning">Copy this key now. Only a hash of it is stored, so it cannot be shown again.</p>

    <div v-if="isPro" class="api-key-actions">
      <button class="copy-button" :disabled="busy" @click="generateKey" data-test="api-key-generate">
        <i class="fas fa-key"></i> {{ newKey ? 'Generate another key' : 'Generate key' }}
      </button>
      <button class="copy-button" :disabled="busy" @click="revokeKey" data-test="api-key-revoke">
        <i class="fas fa-ban"></i> Revoke key
      </button>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { computed, ref } from 'vue';
import axios from 'axios';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useLicense } from '@/composables/useLicense';
import { API_CONFIG } from '@/tt.config.js';

/**
 * An AGNT API key: minted by api.agnt.gg, returned exactly once, stored there
 * only as a hash. This screen used to show the 30-day sign-in token under this
 * name, which is why integrations built on it stopped working a month later.
 */
export default {
  name: 'ApiKeyManager',
  components: { SimpleModal, Tooltip },
  setup() {
    const store = useStore();
    const apiKeyInput = ref(null);
    const modal = ref(null);
    const newKey = ref('');
    const busy = ref(false);

    const { isPremium, hasApiAccess } = useLicense();
    const isPro = computed(() => isPremium.value && hasApiAccess.value);

    const authHeaders = () => ({ Authorization: `Bearer ${store.state.userAuth.token}` });

    const showAlert = (title, message) => modal.value.showModal({ title, message, confirmText: 'OK', showCancel: false });
    const confirm = (title, message, confirmText) => modal.value.showModal({ title, message, confirmText, cancelText: 'Cancel' });

    const failureMessage = (error, action) => {
      if (error?.response?.status === 403) return 'API keys need a plan with API access.';
      return `Could not ${action} the key. ${error?.response?.data?.error || error?.message || ''}`.trim();
    };

    const generateKey = async () => {
      const ok = await confirm(
        'Generate API key',
        'Any key you generated before stops working immediately. Continue?',
        'Generate',
      );
      if (!ok) return;
      busy.value = true;
      try {
        const { data } = await axios.post(`${API_CONFIG.REMOTE_URL}/users/generate-api-key`, {}, { headers: authHeaders() });
        if (!data?.apiKey) throw new Error('The server returned no key.');
        newKey.value = data.apiKey;
      } catch (error) {
        await showAlert('Error', failureMessage(error, 'generate'));
      } finally {
        busy.value = false;
      }
    };

    const revokeKey = async () => {
      const ok = await confirm('Revoke API key', 'Integrations using your key stop working immediately. Continue?', 'Revoke');
      if (!ok) return;
      busy.value = true;
      try {
        await axios.delete(`${API_CONFIG.REMOTE_URL}/users/api-key`, { headers: authHeaders() });
        newKey.value = '';
        await showAlert('Revoked', 'Your API key no longer works.');
      } catch (error) {
        await showAlert('Error', failureMessage(error, 'revoke'));
      } finally {
        busy.value = false;
      }
    };

    const copyApiKey = async () => {
      const text = newKey.value;
      try {
        // navigator.clipboard is undefined outside secure contexts (plain HTTP on a
        // LAN IP for self-hosted Docker), so fall back to the legacy execCommand path.
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.top = '0';
          textarea.style.left = '0';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const copied = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (!copied) throw new Error('execCommand copy returned false');
        }
        await showAlert('Success', 'API Key copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy API Key:', err);
        await showAlert('Error', 'Failed to copy automatically. Select the key above and copy it manually (Ctrl/Cmd+C).');
      }
    };

    return { apiKeyInput, modal, newKey, busy, isPro, generateKey, revokeKey, copyApiKey };
  },
};
</script>

<style scoped>
.api-key-display {
  width: 100%;
}

.api-key-help,
.api-key-warning {
  margin: 0 0 12px 0;
  color: var(--text-secondary, var(--color-light-med-navy));
  font-size: 0.9em;
  line-height: 1.5;
}

.api-key-warning {
  margin-top: 8px;
  color: var(--color-yellow);
}

.api-key-help code {
  font-family: var(--font-family-mono, monospace);
  font-size: 0.95em;
}

.api-key-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.api-key-actions .copy-button {
  margin-left: 0;
  gap: 6px;
  color: var(--text-primary);
}

.api-key-actions .copy-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.65em;
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
  margin-left: 8px;
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
  border: 2px solid var(--color-yellow);
  pointer-events: all;
  z-index: 10;
  white-space: nowrap;
}

.locked-overlay i {
  font-size: 1.2em;
  color: var(--color-yellow);
  margin-right: 6px;
}

.locked-overlay p {
  margin: 0;
  color: var(--text-on-scrim);
  font-weight: 600;
  font-size: 0.85em;
  display: inline;
}

input {
  flex-grow: 1;
  padding: 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background-color: var(--color-darker-0);
  color: var(--text-primary);
  font-family: var(--font-family-mono, monospace);
}

input:disabled {
  opacity: 0.6;
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

.copy-button:hover:not(:disabled) {
  background-color: var(--color-navy);
}

body.dark .copy-button {
  background-color: var(--color-dull-navy);
}

body.dark .copy-button:hover:not(:disabled) {
  background-color: var(--color-navy);
}
</style>
