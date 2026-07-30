<template>
  <div class="fallback-providers">
    <!-- Header: title + toggle on one flex row (title flexes, toggle fixed),
         subtitle on its own full-width line below. -->
    <div class="fb-header">
      <div class="fb-header-toprow">
        <label class="fb-toggle" :title="enabled ? 'Failover enabled' : 'Failover disabled'">
          <input type="checkbox" v-model="enabled" @change="markDirty" />
          <span class="fb-toggle-track"><span class="fb-toggle-thumb"></span></span>
          <span class="fb-toggle-label">{{ enabled ? 'Enabled' : 'Disabled' }}</span>
        </label>
      </div>
      <h2 class="fb-title">Fallback AI Providers</h2>
      <p class="fb-subtitle">
        If your default provider is unavailable, Annie automatically retries these
        in order — up to three backups. Used only when the default fails.
      </p>
    </div>

    <div class="fb-body" :class="{ 'fb-disabled': !enabled }">
      <div v-if="rows.length === 0" class="fb-empty">
        <i class="fas fa-layer-group"></i>
        <p>No fallback providers configured. Add one to protect against outages.</p>
      </div>

      <div v-for="(row, idx) in rows" :key="idx" class="fb-row">
        <span class="fb-tier">{{ idx + 1 }}</span>

        <div class="fb-selects">
          <select
            class="fb-select"
            :value="row.provider"
            @change="onProviderChange(idx, $event.target.value)"
          >
            <option value="" disabled>Select provider…</option>
            <option
              v-for="p in availableForRow(idx)"
              :key="p.key"
              :value="p.key"
            >{{ p.label }}</option>
          </select>

          <select
            class="fb-select"
            :value="row.model"
            :disabled="!row.provider || modelsFor(row.provider).length === 0"
            @change="onModelChange(idx, $event.target.value)"
          >
            <option value="" :disabled="modelsFor(row.provider).length > 0">
              {{ modelsFor(row.provider).length ? 'Select model…' : (row.provider ? 'Provider default' : '—') }}
            </option>
            <option
              v-for="m in modelsFor(row.provider)"
              :key="m"
              :value="m"
            >{{ m }}</option>
          </select>
        </div>

        <button class="fb-remove" title="Remove" @click="removeRow(idx)">
          <i class="fas fa-trash"></i>
        </button>
      </div>

      <div class="fb-actions">
        <button
          v-if="rows.length < MAX"
          class="fb-add"
          :disabled="!hasCandidates"
          :title="hasCandidates ? 'Add a fallback provider' : 'No other connected providers available'"
          @click="addRow"
        >
          <i class="fas fa-plus"></i> Add fallback
        </button>
        <span v-else class="fb-max-note">Maximum of {{ MAX }} fallbacks reached.</span>

        <BaseButton
          variant="primary"
          size="small"
          :disabled="!dirty || saving"
          @click="save"
        >
          <i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
          {{ saving ? 'Saving…' : 'Save changes' }}
        </BaseButton>
      </div>

      <p v-if="!hasCandidates && rows.length === 0" class="fb-hint">
        Connect at least one more AI provider (besides your default) in the
        Auth Connections section to enable fallbacks.
      </p>

      <div v-if="statusMsg" class="fb-status" :class="statusOk ? 'ok' : 'err'">
        <i class="fas" :class="statusOk ? 'fa-check-circle' : 'fa-exclamation-triangle'"></i>
        <span>{{ statusMsg }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import {
  AI_PROVIDERS_WITH_API,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_FETCH_ACTIONS,
  resolveProviderKey,
} from '@/store/app/aiProvider.js';

const MAX = 3;

export default {
  name: 'FallbackProviders',
  components: { BaseButton },
  setup() {
    const store = useStore();

    const enabled = ref(false);
    const rows = ref([]); // [{ provider: <displayName>, model: <id|''> }]
    const dirty = ref(false);
    const saving = ref(false);
    const statusMsg = ref('');
    const statusOk = ref(true);

    // ── Data sources (mirrors ProviderSelector.vue) ───────────────────────
    // filteredProviders → array of provider DISPLAY-NAME strings (e.g. 'GrokAI')
    const providerNames = computed(() => store.getters['aiProvider/filteredProviders'] || []);
    // connectedApps → array of lowercase provider KEYS that are actually connected
    const connectedLower = computed(() =>
      (store.state.appAuth?.connectedApps || []).map((p) => String(p).toLowerCase())
    );
    // The current default provider (display name) — excluded from fallbacks.
    const defaultProviderLower = computed(() =>
      String(store.state.aiProvider?.selectedProvider || '').toLowerCase()
    );

    // A provider is offerable as a fallback when it needs an API key, is
    // connected, and isn't the current default.
    const connectableProviders = computed(() => {
      return providerNames.value
        .filter((name) => {
          const key = resolveProviderKey(name);
          const lower = String(name).toLowerCase();
          if (lower === defaultProviderLower.value) return false;
          if (key === 'local') return false;
          return (
            AI_PROVIDERS_WITH_API.includes(key) &&
            connectedLower.value.includes(key)
          );
        })
        .map((name) => ({ key: name, label: PROVIDER_DISPLAY_NAMES[name] || name }));
    });

    function modelsFor(providerName) {
      if (!providerName) return [];
      return store.state.aiProvider?.allModels?.[providerName] || [];
    }

    // Fetch a provider's model list on demand (so the model dropdown fills).
    async function ensureModels(providerName) {
      if (!providerName) return;
      if (modelsFor(providerName).length > 0) return;
      const action = PROVIDER_FETCH_ACTIONS[providerName];
      if (!action) return;
      try { await store.dispatch(action); } catch (e) { /* non-fatal */ }
    }

    // Providers available for a given row: connectable, minus those chosen in
    // OTHER rows (dedupe across tiers), plus this row's own current choice.
    function availableForRow(idx) {
      const chosenElsewhere = new Set(
        rows.value.filter((_, i) => i !== idx).map((r) => r.provider).filter(Boolean)
      );
      return connectableProviders.value.filter(
        (p) => !chosenElsewhere.has(p.key) || p.key === rows.value[idx]?.provider
      );
    }

    const hasCandidates = computed(() => {
      const used = new Set(rows.value.map((r) => r.provider).filter(Boolean));
      return connectableProviders.value.some((p) => !used.has(p.key));
    });

    function markDirty() { dirty.value = true; statusMsg.value = ''; }

    function addRow() {
      if (rows.value.length >= MAX) return;
      rows.value.push({ provider: '', model: '' });
      markDirty();
    }
    function removeRow(idx) { rows.value.splice(idx, 1); markDirty(); }

    async function onProviderChange(idx, val) {
      rows.value[idx].provider = val;
      rows.value[idx].model = '';
      markDirty();
      await ensureModels(val);
      // Default to first model once loaded, if none chosen.
      const models = modelsFor(val);
      if (models.length && !rows.value[idx].model) rows.value[idx].model = models[0];
    }
    function onModelChange(idx, val) { rows.value[idx].model = val; markDirty(); }

    // ── Load / Save via /api/users/settings ───────────────────────────────
    function authToken() {
      return localStorage.getItem('token') || localStorage.getItem('authToken') || '';
    }

    async function load() {
      try {
        const res = await fetch('/api/users/settings', {
          headers: { Authorization: 'Bearer ' + authToken() },
        });
        const data = await res.json();
        enabled.value = !!data.fallbackEnabled;
        const list = Array.isArray(data.fallbackProviders) ? data.fallbackProviders : [];
        rows.value = list.slice(0, MAX).map((e) => ({
          provider: e.provider || '',
          model: e.model || '',
        }));
        // Warm the model lists for any saved providers so their dropdowns fill.
        for (const r of rows.value) ensureModels(r.provider);
        dirty.value = false;
      } catch (e) {
        console.warn('[FallbackProviders] load failed:', e);
      }
    }

    async function save() {
      saving.value = true;
      statusMsg.value = '';
      try {
        const payload = rows.value
          .filter((r) => r.provider)
          .slice(0, MAX)
          .map((r) => ({ provider: r.provider, model: r.model || null }));
        const res = await fetch('/api/users/settings', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + authToken(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fallbackProviders: payload,
            fallbackEnabled: enabled.value,
          }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        statusOk.value = true;
        statusMsg.value = 'Fallback providers saved.';
        dirty.value = false;
        await load();
      } catch (e) {
        statusOk.value = false;
        statusMsg.value = 'Could not save: ' + e.message;
      } finally {
        saving.value = false;
      }
    }

    onMounted(async () => {
      // Make sure the connected-apps + provider lists are populated.
      try { await store.dispatch('appAuth/fetchConnectedApps'); } catch (e) { /* ignore */ }
      await load();
    });

    return {
      MAX,
      enabled, rows, dirty, saving, statusMsg, statusOk,
      connectableProviders, modelsFor, availableForRow, hasCandidates,
      markDirty, addRow, removeRow, onProviderChange, onModelChange, save,
    };
  },
};
</script>

<style scoped>
.fallback-providers {
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  margin-top: 24px;
  width: 100%;
  box-sizing: border-box;
}

/* ── Header ── title + toggle share a flex row; subtitle full-width below.
   Title uses flex:1 + min-width:0 so it fills the row and never collapses. */
.fb-header { margin-bottom: 16px; }
.fb-header-toprow {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.fb-title {
  display: block;
  width: 100%;
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.3;
}
.fb-subtitle {
  margin: 6px 0 0 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-muted);
  max-width: 68ch;
}

.fb-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.fb-toggle input { display: none; }
.fb-toggle-track {
  width: 40px; height: 22px; border-radius: 11px;
  background: var(--terminal-border-color);
  position: relative; transition: background 0.2s ease;
  flex-shrink: 0;
}
.fb-toggle input:checked + .fb-toggle-track { background: var(--color-green); }
.fb-toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--color-navy, #0d1117);
  transition: transform 0.2s ease;
}
.fb-toggle input:checked + .fb-toggle-track .fb-toggle-thumb { transform: translateX(18px); }
.fb-toggle-label { font-size: 0.85rem; color: var(--color-text-muted); }

.fb-body { transition: opacity 0.2s ease; }
.fb-body.fb-disabled { opacity: 0.5; pointer-events: none; }

.fb-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 24px; color: var(--color-text-muted);
  text-align: center;
}
.fb-empty i { font-size: 1.6rem; opacity: 0.5; }
.fb-empty p { margin: 0; font-size: 0.9rem; }

.fb-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0;
  min-width: 0;
}
.fb-tier {
  width: 26px; height: 26px; flex: 0 0 auto;
  border-radius: 50%;
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
  display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 0.85rem;
}
.fb-selects {
  display: flex; gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}
.fb-select {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-popup);
  color: var(--color-text);
  font-family: inherit; font-size: 0.9rem;
  transition: border-color 0.2s ease;
}
.fb-select:focus { outline: none; border-color: var(--color-green); }
.fb-select:disabled { opacity: 0.5; cursor: not-allowed; }

.fb-remove {
  background: transparent; border: none;
  color: var(--color-text-muted); cursor: pointer;
  padding: 6px 8px; border-radius: 6px; flex: 0 0 auto;
  transition: color 0.2s ease, background 0.2s ease;
}
.fb-remove:hover { color: var(--color-red); background: rgba(255,107,107,0.1); }

.fb-actions {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 12px;
  padding-top: 12px; border-top: 1px solid var(--terminal-border-color);
  min-width: 0;
}
.fb-add {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent;
  border: 1px dashed var(--terminal-border-color);
  color: var(--color-text-muted);
  padding: 8px 14px; border-radius: 8px; cursor: pointer;
  font-size: 0.9rem; transition: all 0.2s ease;
  flex: 0 0 auto;
}
.fb-add:hover:not(:disabled) { border-color: var(--color-green); color: var(--color-green); }
.fb-add:disabled { opacity: 0.4; cursor: not-allowed; }
.fb-max-note { font-size: 0.85rem; color: var(--color-text-muted); }

.fb-hint {
  margin: 12px 0 0 0;
  font-size: 0.82rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.fb-status {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 14px; border-radius: 8px;
  font-size: 0.9rem;
}
.fb-status.ok {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
}
.fb-status.err {
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  color: var(--color-red);
}
</style>
