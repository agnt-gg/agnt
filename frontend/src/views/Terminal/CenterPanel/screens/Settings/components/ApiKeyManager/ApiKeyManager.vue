<template>
  <div class="api-key-page">
  <!-- Only creating and revoking a key needs the plan. How a request is
       authenticated is documentation, so every plan can read it. -->
  <ProGate feature="apiAccess" label="API keys" hint="Create the key your bots and scripts use to reach your AGNT.">
    <!-- ProGate's hidden preview falls back to the default slot, which would
         put live Create and Revoke buttons in the DOM for a locked plan. -->
    <template #preview><span></span></template>
      <!-- The key -->
      <section class="api-card" aria-labelledby="api-key-heading">
        <div class="api-card-head">
          <div>
            <h3 id="api-key-heading">Secret key</h3>
            <p>A key for bots, scripts and other services that call your AGNT. It never expires.</p>
          </div>
          <span class="api-status" :class="newKey ? 'is-new' : 'is-hidden'">
            <span class="api-status-dot" aria-hidden="true"></span>{{ newKey ? 'New key, not saved anywhere' : 'Hidden after creation' }}
          </span>
        </div>

        <div class="api-key-field" :class="{ empty: !newKey }">
          <input
            ref="apiKeyInput"
            type="text"
            readonly
            spellcheck="false"
            :value="newKey"
            :placeholder="'agnt_sk_' + '•'.repeat(24)"
            aria-label="Your AGNT API key"
            data-test="api-key-value"
            @focus="$event.target.select()"
          />
          <button v-if="newKey" type="button" class="api-btn api-btn-quiet" data-test="api-key-copy" @click="copyApiKey">
            <i :class="copied ? 'fas fa-check' : 'far fa-copy'" aria-hidden="true"></i>{{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <p v-if="newKey" class="api-callout api-callout-warn" role="status">
          <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
          Copy this key now. AGNT stores only a fingerprint of it, so it can't be shown again.
        </p>
        <p v-else class="api-callout">
          <i class="fas fa-info-circle" aria-hidden="true"></i>
          For security, a key is shown once, when you create it. Lost it? Create a new one.
        </p>

        <div class="api-card-actions">
          <button type="button" class="api-btn api-btn-primary" :disabled="busy" data-test="api-key-generate" @click="generateKey">
            <i class="fas fa-key" aria-hidden="true"></i>{{ newKey ? 'Create another key' : 'Create key' }}
          </button>
          <button type="button" class="api-btn api-btn-danger" :disabled="busy" data-test="api-key-revoke" @click="revokeKey">
            <i class="fas fa-ban" aria-hidden="true"></i>Revoke key
          </button>
          <span class="api-card-note">Creating a key replaces the previous one immediately.</span>
        </div>
      </section>
  </ProGate>

    <!-- How to use it -->
    <section class="api-card" aria-labelledby="api-usage-heading">
      <div class="api-card-head">
        <div>
          <h3 id="api-usage-heading">Authenticate a request</h3>
          <p>Send the key in the <code>Authorization</code> header of every request.</p>
        </div>
      </div>
      <div class="api-code">
        <div class="api-code-bar">
          <span>HTTP header</span>
        </div>
        <div class="api-code-body"><code>Authorization: Bearer {{ newKey || 'YOUR_API_KEY' }}</code></div>
      </div>
      <ul class="api-facts">
        <li><i class="fas fa-infinity" aria-hidden="true"></i><span><strong>Never expires.</strong> Unlike your sign-in, which renews on its own.</span></li>
        <li><i class="fas fa-user-lock" aria-hidden="true"></i><span><strong>Acts as you.</strong> It can do anything your account can, so keep it out of code you share.</span></li>
        <li><i class="fas fa-sync-alt" aria-hidden="true"></i><span><strong>One active key.</strong> Creating or revoking one takes effect at once.</span></li>
      </ul>
    </section>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref } from 'vue';
import axios from 'axios';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ProGate from '@/components/ProGate.vue';
import { API_CONFIG } from '@/tt.config.js';

/**
 * An AGNT API key: minted by api.agnt.gg, returned exactly once, stored there
 * only as a hash. This screen used to show the 30-day sign-in token under this
 * name, which is why integrations built on it stopped working a month later.
 *
 * The plan gate is ProGate's 'apiAccess' rule (premium AND the apiAccess
 * feature): the same rule this page enforced by hand, now with the app's one
 * upgrade card instead of a dimmed copy of the page under a lock.
 */
export default {
  name: 'ApiKeyManager',
  components: { SimpleModal, ProGate },
  setup() {
    const store = useStore();
    const apiKeyInput = ref(null);
    const modal = ref(null);
    const newKey = ref('');
    const busy = ref(false);
    const copied = ref(false);

    const authHeaders = () => ({ Authorization: `Bearer ${store.state.userAuth.token}` });

    const showAlert = (title, message) => modal.value.showModal({ title, message, confirmText: 'OK', showCancel: false });
    const confirm = (title, message, confirmText) => modal.value.showModal({ title, message, confirmText, cancelText: 'Cancel' });

    const failureMessage = (error, action) => {
      if (error?.response?.status === 403) return 'API keys need a plan with API access.';
      return `Could not ${action} the key. ${error?.response?.data?.error || error?.message || ''}`.trim();
    };

    const generateKey = async () => {
      const ok = await confirm('Create API key', 'Any key you created before stops working immediately. Continue?', 'Create key');
      if (!ok) return;
      busy.value = true;
      try {
        const { data } = await axios.post(`${API_CONFIG.REMOTE_URL}/users/generate-api-key`, {}, { headers: authHeaders() });
        if (!data?.apiKey) throw new Error('The server returned no key.');
        newKey.value = data.apiKey;
        copied.value = false;
      } catch (error) {
        await showAlert('Error', failureMessage(error, 'create'));
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

    let copiedTimer = null;
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
          const ok = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (!ok) throw new Error('execCommand copy returned false');
        }
        // Confirmed in place on the button: a modal for a copy interrupts more than it informs.
        copied.value = true;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
      } catch (err) {
        console.error('Failed to copy API key:', err);
        await showAlert('Error', 'Failed to copy automatically. Select the key above and copy it manually (Ctrl/Cmd+C).');
      }
    };

    return { apiKeyInput, modal, newKey, busy, copied, generateKey, revokeKey, copyApiKey };
  },
};
</script>

<style scoped>
/* Settings' own type and colour tokens throughout, so the page reads like its
   neighbours (Billing, Usage) rather than a one-off form. */
.api-key-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 820px;
  font-family: inherit;
  color: var(--text-primary);
}
.api-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  background: var(--color-background);
}
.api-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.api-card-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.api-card-head p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.api-card-head code,
.api-facts code {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--surface-hover);
  font-family: var(--font-family-mono);
  font-size: 12px;
}
.api-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--terminal-border-color);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.api-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.api-status.is-new {
  border-color: rgba(var(--green-rgb), 0.35);
  color: var(--color-green);
}
.api-status.is-new .api-status-dot {
  background: var(--color-green);
}

.api-key-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-0);
}
.api-key-field:focus-within {
  border-color: rgba(var(--green-rgb), 0.45);
}
.api-key-field input {
  flex: 1;
  min-width: 0;
  padding: 8px 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: 13px;
  letter-spacing: 0.02em;
}
.api-key-field.empty input::placeholder {
  color: var(--text-tertiary);
}

.api-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-hover);
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.api-callout i {
  margin-top: 3px;
  font-size: 12px;
}
.api-callout-warn {
  background: rgba(var(--yellow-rgb), 0.1);
  color: var(--text-primary);
}
.api-callout-warn i {
  color: var(--color-yellow);
}

.api-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 16px;
}
.api-card-note {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* Buttons follow Studio's action language (ScreenToolbar, BaseScreen). */
.api-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.api-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.api-btn-primary {
  border-color: rgba(var(--green-rgb), 0.25);
  background: rgba(var(--green-rgb), 0.06);
  color: var(--color-green);
}
.api-btn-primary:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.12);
  border-color: rgba(var(--green-rgb), 0.35);
}
.api-btn-danger {
  color: var(--fill-danger, var(--color-red));
}
.api-btn-danger:hover:not(:disabled) {
  border-color: var(--fill-danger, var(--color-red));
  background: var(--surface-hover);
}
.api-btn-quiet {
  flex: none;
  font-weight: 500;
}
.api-btn-quiet:hover:not(:disabled) {
  background: var(--surface-hover);
}

.api-code {
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-0);
}
.api-code-bar {
  padding: 8px 14px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 12px;
  color: var(--text-tertiary);
}
/* A div, not <pre>: themes style every pre and code globally (the light
   theme with !important), which drew a pill inside this box. */
.api-code-body {
  padding: 14px;
  overflow-x: auto;
}
.api-code-body code {
  display: block;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.api-code code {
  font-family: var(--font-family-mono);
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre;
}

.api-facts {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.api-facts li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.api-facts i {
  width: 16px;
  margin-top: 3px;
  text-align: center;
  color: var(--color-green);
}
.api-facts strong {
  color: var(--text-primary);
  font-weight: 600;
}

@media (max-width: 640px) {
  .api-card {
    padding: 20px;
  }
  .api-card-head {
    flex-direction: column;
  }
  .api-card-note {
    margin-left: 0;
  }
}
</style>
