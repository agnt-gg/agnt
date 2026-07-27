<template>
  <div class="connection-settings">
    <div class="settings-header">
      <h3>Backend Connection</h3>
      <p class="settings-description">
        Run the desktop app against a remote AGNT server (Docker / self-hosted) instead of the local backend.
      </p>
    </div>

    <div v-if="!hasDesktopBridge" class="notice info">
      <i class="fas fa-info-circle"></i>
      <div>
        Desktop connection controls need the AGNT <strong>desktop shell</strong> (Electron). In a plain browser you are
        already on the host that served this page — use that server as the remote URL from another Mac’s desktop app.
      </div>
    </div>

    <div class="status-card" :class="statusClass">
      <div class="status-row">
        <span class="status-dot"></span>
        <div>
          <strong>{{ statusLabel }}</strong>
          <p>{{ displayBackendUrl }}</p>
        </div>
      </div>
      <span class="source-badge" v-if="effective.source">source: {{ effective.source }}</span>
    </div>

    <div v-if="effective.envOverrides" class="notice warn">
      <i class="fas fa-exclamation-triangle"></i>
      <div>
        Environment variables (<code>USE_EXTERNAL_BACKEND</code> / <code>BACKEND_URL</code>) override the form below for this
        session. Clear them and restart to use Settings-only config.
      </div>
    </div>

    <div class="connection-controls" role="radiogroup" aria-label="Backend mode">
      <!-- Exclusive mode selection (radio cards) — only the selected mode is highlighted -->
      <button
        type="button"
        class="control-row mode-row mode-card"
        :class="{ active: !useExternalBackend }"
        :disabled="!hasDesktopBridge"
        role="radio"
        :aria-checked="(!useExternalBackend).toString()"
        @click="selectMode('local')"
      >
        <div class="control-info">
          <div class="control-label">
            <span class="radio-dot" aria-hidden="true"></span>
            <i class="fas fa-laptop"></i>
            <span>Local backend</span>
          </div>
          <p class="control-description">
            This Mac runs Express on port 3333 (default). Use when you are not pointing at another host.
          </p>
        </div>
      </button>

      <button
        type="button"
        class="control-row mode-row mode-card"
        :class="{ active: useExternalBackend }"
        :disabled="!hasDesktopBridge"
        role="radio"
        :aria-checked="useExternalBackend.toString()"
        @click="selectMode('external')"
      >
        <div class="control-info">
          <div class="control-label">
            <span class="radio-dot" aria-hidden="true"></span>
            <i class="fas fa-network-wired"></i>
            <span>External backend</span>
          </div>
          <p class="control-description">
            Skip the local Express server. This app’s UI stays local; API traffic goes to the remote host (another Mac,
            Docker, VPS).
          </p>
        </div>
      </button>

      <div class="control-row" :class="{ disabled: !useExternalBackend || !hasDesktopBridge, active: useExternalBackend }">
        <div class="control-info">
          <div class="control-label">
            <i class="fas fa-link"></i>
            <span>Backend URL</span>
          </div>
          <p class="control-description">
            Base URL of the remote AGNT API (no trailing <code>/api</code>). Remote only needs the API —
            <code>/api/health</code> must respond.
          </p>
        </div>
        <input
          class="url-input"
          type="url"
          v-model="backendUrl"
          :disabled="!useExternalBackend || !hasDesktopBridge"
          placeholder="http://192.168.1.50:3333"
          spellcheck="false"
          autocomplete="off"
        />
      </div>
    </div>

    <div class="action-row">
      <button type="button" class="secondary-btn" :disabled="!hasDesktopBridge || testing || !canTest" @click="testConnection">
        <i class="fas" :class="testing ? 'fa-spinner fa-spin' : 'fa-stethoscope'"></i>
        {{ testing ? 'Testing…' : 'Test connection' }}
      </button>
      <button type="button" class="primary-btn" :disabled="!hasDesktopBridge || saving || !dirty" @click="saveSettings">
        <i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <button type="button" class="primary-btn restart-btn" :disabled="!hasDesktopBridge || relaunching" @click="relaunch">
        <i class="fas" :class="relaunching ? 'fa-spinner fa-spin' : 'fa-redo'"></i>
        {{ relaunching ? 'Restarting…' : 'Restart app' }}
      </button>
    </div>

    <div v-if="message" class="notice" :class="messageType">
      <i class="fas" :class="messageType === 'success' ? 'fa-check-circle' : messageType === 'error' ? 'fa-exclamation-triangle' : 'fa-info-circle'"></i>
      {{ message }}
    </div>

    <div class="info-card">
      <i class="fas fa-info-circle"></i>
      <div class="info-content">
        <h4>How hybrid mode works</h4>
        <ul>
          <li>This page is always listed under Settings → Configuration → Connection.</li>
          <li>
            External mode serves this app’s UI on <code>http://127.0.0.1:19333</code> and reverse-proxies
            <code>/api</code> + <code>/socket.io</code> to the remote host.
          </li>
          <li>Remote only needs the AGNT API (<code>/api/health</code>); it does not need to serve the frontend.</li>
          <li>After Save, restart the app so Electron applies local vs external mode.</li>
          <li>CLI equivalent: <code>USE_EXTERNAL_BACKEND=true BACKEND_URL=http://host:3333 npm start</code></li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';

function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  const api = window.electron;
  if (!api?.getConnectionConfig || !api?.setConnectionConfig) return null;
  return api;
}

export default {
  name: 'ConnectionSettings',
  setup() {
    const useExternalBackend = ref(false);
    const backendUrl = ref('');
    const initial = ref({ useExternalBackend: false, backendUrl: '' });
    const effective = ref({
      useExternalBackend: false,
      backendUrl: '',
      source: 'default',
      envOverrides: false,
    });

    const testing = ref(false);
    const saving = ref(false);
    const relaunching = ref(false);
    const message = ref('');
    const messageType = ref('info');
    // Re-evaluated on mount; bridge is present for local + remote pages inside Electron.
    const hasDesktopBridge = ref(Boolean(getDesktopBridge()));

    const dirty = computed(() => {
      return (
        useExternalBackend.value !== initial.value.useExternalBackend ||
        (backendUrl.value || '').trim() !== (initial.value.backendUrl || '').trim()
      );
    });

    const canTest = computed(() => {
      if (useExternalBackend.value) {
        return Boolean((backendUrl.value || '').trim());
      }
      return true;
    });

    const statusLabel = computed(() => {
      if (!hasDesktopBridge.value) {
        return 'Viewing in browser (desktop shell not attached)';
      }
      return effective.value.useExternalBackend ? 'Connected to external backend' : 'Using local backend';
    });

    const statusClass = computed(() => {
      if (!hasDesktopBridge.value) return 'local';
      return effective.value.useExternalBackend ? 'external' : 'local';
    });

    const displayBackendUrl = computed(() => {
      if (effective.value.backendUrl) return effective.value.backendUrl;
      if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
      }
      return '—';
    });

    const setMessage = (text, type = 'info') => {
      message.value = text;
      messageType.value = type;
    };

    /** Exclusive local vs external selection (replaces dual independent toggles). */
    const selectMode = (mode) => {
      if (!hasDesktopBridge.value) return;
      useExternalBackend.value = mode === 'external';
    };

    const load = async () => {
      const electron = getDesktopBridge();
      hasDesktopBridge.value = Boolean(electron);
      if (!electron) {
        // Browser / non-desktop: show current page origin as the active host.
        effective.value = {
          useExternalBackend: false,
          backendUrl: typeof window !== 'undefined' ? window.location.origin : '',
          source: 'browser',
          envOverrides: false,
        };
        return;
      }
      try {
        const cfg = await electron.getConnectionConfig();
        effective.value = {
          useExternalBackend: Boolean(cfg.useExternalBackend),
          backendUrl: cfg.backendUrl || '',
          source: cfg.source || 'default',
          envOverrides: Boolean(cfg.envOverrides),
        };
        const form = cfg.form || cfg.stored || {};
        useExternalBackend.value = Boolean(form.useExternalBackend);
        backendUrl.value = form.backendUrl || '';
        initial.value = {
          useExternalBackend: useExternalBackend.value,
          backendUrl: backendUrl.value,
        };
      } catch (err) {
        setMessage(err.message || 'Failed to load connection settings', 'error');
      }
    };

    const testConnection = async () => {
      const electron = getDesktopBridge();
      if (!electron?.testConnection) return;
      testing.value = true;
      setMessage('');
      try {
        const url = useExternalBackend.value
          ? (backendUrl.value || '').trim()
          : effective.value.backendUrl;
        const result = await electron.testConnection({ backendUrl: url });
        if (result.ok) {
          setMessage(`Health OK (${result.latencyMs ?? '?'} ms) — ${result.backendUrl}`, 'success');
        } else {
          setMessage(result.error || `Health check failed for ${result.backendUrl}`, 'error');
        }
      } catch (err) {
        setMessage(err.message || 'Test failed', 'error');
      } finally {
        testing.value = false;
      }
    };

    const saveSettings = async () => {
      const electron = getDesktopBridge();
      if (!electron?.setConnectionConfig) return;
      saving.value = true;
      setMessage('');
      try {
        const result = await electron.setConnectionConfig({
          useExternalBackend: useExternalBackend.value,
          backendUrl: (backendUrl.value || '').trim(),
        });
        if (!result.ok) {
          setMessage(result.error || 'Save failed', 'error');
          return;
        }
        initial.value = {
          useExternalBackend: useExternalBackend.value,
          backendUrl: (backendUrl.value || '').trim(),
        };
        setMessage(result.message || 'Saved. Restart AGNT to apply.', 'success');
        await load();
      } catch (err) {
        setMessage(err.message || 'Save failed', 'error');
      } finally {
        saving.value = false;
      }
    };

    const relaunch = async () => {
      const electron = getDesktopBridge();
      if (!electron?.relaunchApp) return;
      if (dirty.value) {
        setMessage('Save your changes before restarting.', 'error');
        return;
      }
      relaunching.value = true;
      try {
        await electron.relaunchApp();
      } catch (err) {
        relaunching.value = false;
        setMessage(err.message || 'Relaunch failed', 'error');
      }
    };

    onMounted(load);

    return {
      hasDesktopBridge,
      useExternalBackend,
      backendUrl,
      effective,
      testing,
      saving,
      relaunching,
      message,
      messageType,
      dirty,
      canTest,
      statusLabel,
      statusClass,
      displayBackendUrl,
      selectMode,
      testConnection,
      saveSettings,
      relaunch,
    };
  },
};
</script>

<style scoped>
.connection-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-header h3 {
  color: var(--color-text);
  font-size: 1.3em;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.settings-description {
  color: var(--color-text-muted);
  font-size: 0.95em;
  margin: 0;
  opacity: 0.85;
}

.status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
  background: rgba(var(--primary-rgb), 0.05);
}

/* Active runtime mode (local or external) uses the same emphasis color */
.status-card.local,
.status-card.external {
  border-color: rgba(var(--primary-rgb), 0.45);
  background: rgba(var(--primary-rgb), 0.1);
}

.status-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.status-row strong {
  color: var(--color-text);
  display: block;
}

.status-row p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
  word-break: break-all;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--color-green, #3dd68c);
  box-shadow: 0 0 8px rgba(61, 214, 140, 0.5);
  flex-shrink: 0;
}

.source-badge {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.connection-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: rgba(var(--primary-rgb), 0.03);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  gap: 20px;
  flex-wrap: wrap;
  transition: border-color 0.2s ease, background 0.2s ease;
}

/* Only the selected mode row (local or external) is emphasized */
.control-row.active {
  border-color: rgba(var(--primary-rgb), 0.45);
  background: rgba(var(--primary-rgb), 0.1);
}

.control-row.mode-row:not(.active) {
  opacity: 0.85;
}

button.mode-card {
  width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

button.mode-card:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

button.mode-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--color-text-muted);
  flex-shrink: 0;
  box-sizing: border-box;
  position: relative;
}

.mode-card.active .radio-dot {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 3px var(--color-primary);
}

.control-row.disabled {
  opacity: 0.55;
}

.control-info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-weight: 600;
}

.control-label i {
  color: var(--color-primary);
  width: 18px;
  text-align: center;
}

.control-description {
  color: var(--color-text-muted);
  font-size: 0.85em;
  margin: 0;
}

.url-input {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0, rgba(0, 0, 0, 0.25));
  color: var(--color-text);
  font-family: var(--font-family-mono, ui-monospace, monospace);
  font-size: 0.9em;
}

.url-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: rgba(127, 129, 147, 0.3);
  transition: 0.3s;
  border-radius: 28px;
  border: 1px solid var(--terminal-border-color);
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch input:checked + .slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.toggle-switch input:checked + .slider:before {
  transform: translateX(24px);
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.primary-btn,
.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
  transition: all 0.2s ease;
}

.primary-btn {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.45);
}

.primary-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.35);
}

.secondary-btn {
  background: transparent;
  color: var(--color-text);
}

.secondary-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.primary-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.restart-btn {
  margin-left: auto;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  font-size: 0.9em;
  line-height: 1.4;
}

.notice.success {
  border-color: rgba(61, 214, 140, 0.45);
  background: rgba(61, 214, 140, 0.08);
}

.notice.error {
  border-color: rgba(255, 99, 99, 0.45);
  background: rgba(255, 99, 99, 0.08);
}

.notice.warn {
  border-color: rgba(255, 196, 0, 0.45);
  background: rgba(255, 196, 0, 0.08);
}

.notice.info {
  background: rgba(var(--primary-rgb), 0.06);
}

.notice code,
.info-content code {
  font-family: var(--font-family-mono, ui-monospace, monospace);
  font-size: 0.9em;
}

.info-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
  background: rgba(var(--primary-rgb), 0.04);
}

.info-card > i {
  color: var(--color-primary);
  margin-top: 2px;
}

.info-content h4 {
  margin: 0 0 8px;
  color: var(--color-text);
}

.info-content ul {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-muted);
  font-size: 0.9em;
  line-height: 1.5;
}
</style>
