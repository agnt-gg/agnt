<template>
  <div class="fallback-providers">
    <div class="section-header">
      <div class="section-header-row">
        <h3>Fallback AI Providers</h3>
        <label class="fb-toggle" v-tooltip="enabled ? 'Failover enabled' : 'Failover disabled'">
          <input type="checkbox" v-model="enabled" @change="markDirty" />
          <span class="fb-toggle-label">{{ enabled ? 'Enabled' : 'Disabled' }}</span>
          <span class="fb-toggle-track"><span class="fb-toggle-thumb"></span></span>
        </label>
      </div>
      <p class="subtitle">Tried in order when the model above is unavailable. Up to {{ MAX }} backups.</p>
    </div>

    <!--
      With dynamic routing on, this list is no longer what runs. The router
      ranks every eligible provider per request and its 2nd and 3rd choices
      BECOME the failover chain, recomputed against live health each turn.

      The saved rows are shown read-only rather than hidden or deleted: they
      are still the exact configuration that returns the moment routing is
      switched off, and silently discarding a user's hand-built chain to enable
      a feature would be unforgivable. Leaving them EDITABLE would be the
      other failure — a control that appears to work and changes nothing.
    -->
    <div v-if="routingMode === 'dynamic'" class="fb-managed">
      <i class="fas fa-bolt"></i>
      <div>
        <strong>Managed by Annie</strong>
        <p>
          Dynamic Provider Routing is on, so the failover chain is chosen per
          request instead of from this list. Your saved backups are kept and
          take effect again as soon as routing is turned off.
        </p>
      </div>
    </div>

    <div class="fb-body" :class="{ 'fb-disabled': !enabled || routingMode === 'dynamic' }">
      <div v-if="rows.length === 0" class="fb-empty">
        <i class="fas fa-layer-group"></i>
        <p>No fallback providers configured. Add one to protect against outages.</p>
      </div>

      <div v-for="(row, idx) in rows" :key="idx" class="fb-row">
        <span class="fb-tier">{{ idx + 1 }}</span>

        <div class="fb-selects">
          <CustomSelect
            class="fb-select"
            :options="providerOptionsFor(idx)"
            :model-value="row.provider"
            placeholder="Select provider…"
            @option-selected="(opt) => onProviderChange(idx, opt.value)"
          />
          <CustomSelect
            class="fb-select"
            :options="modelOptionsFor(row.provider)"
            :model-value="row.model"
            :placeholder="modelPlaceholderFor(row.provider)"
            @option-selected="(opt) => onModelChange(idx, opt.value)"
          />
          <!-- Shown only when this tier's model has an effort control, i.e.
               exactly where the Chat selector would show one. -->
          <CustomSelect
            v-if="effortOptionsFor(row).length"
            class="fb-select fb-effort"
            :options="effortOptionsFor(row)"
            :model-value="row.reasoning"
            placeholder="Effort"
            v-tooltip="'Reasoning effort for this backup'"
            @option-selected="(opt) => onEffortChange(idx, opt.value)"
          />
        </div>

        <button class="fb-remove" v-tooltip="'Remove'" @click="removeRow(idx)">
          <i class="fas fa-trash"></i>
        </button>
      </div>

      <div class="fb-actions">
        <button
          v-if="rows.length < MAX"
          class="fb-add"
          :disabled="!hasCandidates"
          v-tooltip="hasCandidates ? 'Add a fallback provider' : 'No other connected providers available'"
          @click="addRow"
        >
          <i class="fas fa-plus"></i> Add fallback
        </button>
        <span v-else class="fb-max-note">Maximum of {{ MAX }} fallbacks reached.</span>

        <span class="fb-actions-spacer"></span>

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
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import {
  AI_PROVIDERS_WITH_API,
  PROVIDER_DISPLAY_NAMES,
  resolveProviderKey,
} from '@/store/app/aiProvider.js';

const MAX = 3;

export default {
  name: 'FallbackProviders',
  components: { BaseButton, CustomSelect },
  setup() {
    const store = useStore();

    const enabled = ref(false);
    // 'static' | 'dynamic'. When dynamic, this list is superseded by the
    // router's own ranking and is shown read-only rather than removed.
    const routingMode = ref('static');
    // reasoning: '' = same as the chat's selection (the key is then omitted
    // on save, which is also what every chain saved before this field has).
    const rows = ref([]); // [{ provider: <displayName>, model: <id|''>, reasoning: <effort|''> }]
    const dirty = ref(false);
    const saving = ref(false);
    const statusMsg = ref('');
    const statusOk = ref(true);

    const providerNames = computed(() => store.getters['aiProvider/filteredProviders'] || []);
    const connectedLower = computed(() =>
      (store.state.appAuth?.connectedApps || []).map((p) => String(p).toLowerCase())
    );
    const defaultProviderLower = computed(() =>
      String(store.state.aiProvider?.selectedProvider || '').toLowerCase()
    );

    // Custom OpenAI-compatible providers, keyed by UUID rather than by a
    // registry key. They are deliberately NOT gated on connectedApps: that list
    // tracks OAuth / API-key links for built-in providers, and a custom
    // provider carries its own base_url and api_key in custom_openai_providers,
    // so its presence there (is_active = 1) IS its connection. Gating on
    // connectedApps would exclude every custom provider unconditionally.
    const customProviders = computed(() => store.state.aiProvider?.customProviders || []);
    const customProviderIds = computed(
      () => new Set(customProviders.value.map((p) => String(p.id).toLowerCase()))
    );
    function isCustomProviderId(value) {
      return !!value && customProviderIds.value.has(String(value).toLowerCase());
    }
    function customProviderName(id) {
      const hit = customProviders.value.find(
        (p) => String(p.id).toLowerCase() === String(id).toLowerCase()
      );
      return hit?.provider_name || id;
    }

    const connectableProviders = computed(() => {
      const builtIn = providerNames.value
        .filter((name) => {
          const key = resolveProviderKey(name);
          const lower = String(name).toLowerCase();
          if (lower === defaultProviderLower.value) return false;
          if (key === 'local') return false;
          return AI_PROVIDERS_WITH_API.includes(key) && connectedLower.value.includes(key);
        })
        .map((name) => ({ key: name, label: PROVIDER_DISPLAY_NAMES[name] || name }));

      const custom = customProviders.value
        .filter((p) => p && p.id)
        .filter((p) => String(p.id).toLowerCase() !== defaultProviderLower.value)
        .map((p) => ({ key: p.id, label: p.provider_name || p.id }));

      return [...builtIn, ...custom];
    });

    function modelsFor(providerName) {
      if (!providerName) return [];
      return store.state.aiProvider?.allModels?.[providerName] || [];
    }

    function modelPlaceholderFor(providerName) {
      if (!providerName) return '—';
      if (modelsFor(providerName).length) return 'Select model…';
      // "Provider default" is true for a built-in (the chain builder falls back
      // to its first text model) but a lie for a custom provider: there is no
      // static model list, so the backend drops a modelless custom tier.
      if (isCustomProviderId(providerName)) return 'No models found — check the endpoint';
      return 'Provider default';
    }

    // Always ask the store. fetchProviderModels paints from its cache at once
    // and revalidates models AND per-model metadata (which carries the effort
    // control) in the background, so this is cheap.
    //
    // It used to return early whenever a list was already in memory, which
    // pinned a tab to whatever list it first saw (grok-4.7 never appeared
    // until a full reload). It also went through PROVIDER_FETCH_ACTIONS, whose
    // generated names had no action behind them for Grok-Build, Cursor and
    // Antigravity, so those rows never loaded here at all. fetchProviderModels
    // handles built-ins, custom UUIDs and Local alike.
    async function ensureModels(providerName) {
      if (!providerName) return;
      try {
        await store.dispatch('aiProvider/fetchProviderModels', { provider: providerName });
      } catch (e) { /* non-fatal */ }
    }

    // The same control the Chat selector shows for this provider+model:
    // backend metadata first (per-model, e.g. grok-build's proxy-published
    // efforts), else the frontend's inferred fallback.
    function reasoningControlFor(row) {
      if (!row?.provider || !row?.model) return null;
      return (
        store.state.aiProvider?.modelMetadata?.[row.provider]?.[row.model]?.reasoningControl ||
        store.getters['aiProvider/inferReasoningControl']?.(row.provider, row.model) ||
        null
      );
    }
    function effortOptionsFor(row) {
      const control = reasoningControlFor(row);
      if (!control?.options?.length) return [];
      return [
        { label: 'Effort: same as chat', value: '' },
        ...control.options.map((o) => ({
          // 'Default' next to 'same as chat' is ambiguous; this one means the
          // provider's own default for that model.
          label: o.value === 'default' ? 'Provider default' : o.label,
          value: o.value,
        })),
      ];
    }
    // Clear an effort the row's CURRENT model does not offer. Only after a
    // user change: on load the metadata may not have arrived yet, and an
    // unconfirmed value must not be discarded (the wire drops it anyway if the
    // model really does not take it).
    function reconcileEffort(idx) {
      const row = rows.value[idx];
      if (!row?.reasoning) return;
      const offered = effortOptionsFor(row).map((o) => o.value);
      if (!offered.includes(row.reasoning)) row.reasoning = '';
    }

    // CustomSelect option lists ({ label, value }).
    function providerOptionsFor(idx) {
      const chosenElsewhere = new Set(
        rows.value.filter((_, i) => i !== idx).map((r) => r.provider).filter(Boolean)
      );
      return connectableProviders.value
        .filter((p) => !chosenElsewhere.has(p.key) || p.key === rows.value[idx]?.provider)
        .map((p) => ({ label: p.label, value: p.key }));
    }
    function modelOptionsFor(providerName) {
      return modelsFor(providerName).map((m) => ({ label: m, value: m }));
    }

    const hasCandidates = computed(() => {
      const used = new Set(rows.value.map((r) => r.provider).filter(Boolean));
      return connectableProviders.value.some((p) => !used.has(p.key));
    });

    function markDirty() { dirty.value = true; statusMsg.value = ''; }

    function addRow() {
      if (rows.value.length >= MAX) return;
      rows.value.push({ provider: '', model: '', reasoning: '' });
      markDirty();
    }
    function removeRow(idx) { rows.value.splice(idx, 1); markDirty(); }

    async function onProviderChange(idx, val) {
      rows.value[idx].provider = val;
      rows.value[idx].model = '';
      // Effort values are per provider; never carry one across.
      rows.value[idx].reasoning = '';
      markDirty();
      await ensureModels(val);
      const models = modelsFor(val);
      if (models.length && !rows.value[idx].model) rows.value[idx].model = models[0];
    }
    function onModelChange(idx, val) {
      rows.value[idx].model = val;
      reconcileEffort(idx);
      markDirty();
    }
    function onEffortChange(idx, val) {
      rows.value[idx].reasoning = val || '';
      markDirty();
    }

    function authToken() {
      return localStorage.getItem('token') || localStorage.getItem('authToken') || '';
    }

    async function load() {
      try {
        const res = await fetch('/api/users/settings', {
          headers: { Authorization: 'Bearer ' + authToken() },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        enabled.value = !!data.fallbackEnabled;
        routingMode.value = data.routingMode === 'dynamic' ? 'dynamic' : 'static';
        const list = Array.isArray(data.fallbackProviders) ? data.fallbackProviders : [];
        rows.value = list.slice(0, MAX).map((e) => ({
          provider: e.provider || '',
          model: e.model || '',
          reasoning: typeof e.reasoning === 'string' ? e.reasoning : '',
        }));
        // One load per provider: two tiers on the same provider (legacy data,
        // hand edits) must not dispatch the same revalidation twice.
        for (const provider of new Set(rows.value.map((r) => r.provider).filter(Boolean))) {
          ensureModels(provider);
        }
        dirty.value = false;
      } catch (e) {
        console.warn('[FallbackProviders] load failed:', e);
      }
    }

    async function save() {
      saving.value = true;
      statusMsg.value = '';
      try {
        // A custom tier with no model is dropped by buildProviderChain, so
        // sending one would persist a tier the UI displays as configured and
        // that can never fire. Drop it here instead and say so, rather than
        // letting the two layers disagree silently.
        const skipped = rows.value
          .filter((r) => r.provider && isCustomProviderId(r.provider) && !r.model)
          .map((r) => customProviderName(r.provider));

        const payload = rows.value
          .filter((r) => r.provider)
          .filter((r) => !(isCustomProviderId(r.provider) && !r.model))
          .slice(0, MAX)
          .map((r) => ({
            provider: r.provider,
            model: r.model || null,
            // Omitted, not null, when unset: "same as chat".
            ...(r.reasoning ? { reasoning: r.reasoning } : {}),
          }));
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
        if (skipped.length) {
          statusOk.value = false;
          statusMsg.value =
            `Saved, but skipped ${skipped.join(', ')}: a custom provider needs an ` +
            'explicit model, so it was left out of the chain.';
        } else {
          statusOk.value = true;
          statusMsg.value = 'Fallback providers saved.';
        }
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
      // Both lists feed the dropdown, and neither is guaranteed to have been
      // loaded by a sibling component on a cold open of this screen.
      try { await store.dispatch('appAuth/fetchConnectedApps'); } catch (e) { /* ignore */ }
      try { await store.dispatch('aiProvider/fetchCustomProviders'); } catch (e) { /* ignore */ }
      await load();
    });

    return {
      MAX,
      enabled, routingMode, rows, dirty, saving, statusMsg, statusOk,
      connectableProviders, modelsFor, providerOptionsFor, modelOptionsFor, hasCandidates,
      modelPlaceholderFor, isCustomProviderId, effortOptionsFor,
      markDirty, addRow, removeRow, onProviderChange, onModelChange, onEffortChange, save,
    };
  },
};
</script>

<style scoped>
/* Verbatim .connectors-section — the section idiom every other block on this
   page uses. Transparent and borderless is the house style, not an omission. */
.fallback-providers {
  background: transparent;
  border: none;
  padding: 24px;
  transition: all 0.3s ease;
  border-radius: 16px;
  width: 100%;
  box-sizing: border-box;
}

/* Verbatim .webhooks-header / .plugins-header and their h3 + .subtitle. */
.section-header {
  margin-bottom: 24px;
}

.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-header h3 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 12px;
}

.subtitle {
  margin: 0;
  color: var(--color-light-med-navy);
  font-size: 0.9em;
}

.fb-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  flex-shrink: 0;
  justify-content: flex-end;
  width: auto;
}
/* Visually hidden but still focusable + in the tab order (a11y). */
.fb-toggle input {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; border: 0;
}
.fb-toggle-track {
  width: 40px; height: 22px; border-radius: 11px;
  background: var(--terminal-border-color);
  position: relative; transition: background 0.2s ease;
  flex-shrink: 0;
}
/* `~` not `+`: the text label now sits between the input and the track. */
.fb-toggle input:checked ~ .fb-toggle-track { background: var(--color-green); }
.fb-toggle input:focus-visible ~ .fb-toggle-track {
  outline: 2px solid var(--color-green);
  outline-offset: 2px;
}
.fb-toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--color-navy, #0d1117);
  transition: transform 0.2s ease;
}
.fb-toggle input:checked ~ .fb-toggle-track .fb-toggle-thumb { transform: translateX(18px); }
.fb-toggle-label { font-size: 0.85rem; color: var(--color-text-muted); }

.fb-body { transition: opacity 0.2s ease; }
.fb-body.fb-disabled { opacity: 0.5; pointer-events: none; }

/* Same green idiom as .fb-tier and .preset-chip. The earlier version used
   `var(--color-accent, #4a9eff)`: --color-accent IS a real alias for
   --color-primary, so it resolved to green and the blue fallback never fired —
   but a reader had no way to know that, and a hardcoded blue sitting in the
   source of a green product is a trap for the next person. */
.fb-managed {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 14px; margin-bottom: 12px;
  background: rgba(var(--green-rgb), 0.08);
  border: 1px solid rgba(var(--green-rgb), 0.45);
  border-radius: 8px;
}
.fb-managed i { color: var(--color-green); margin-top: 2px; }
.fb-managed strong { display: block; font-size: 0.85em; font-weight: 600; color: var(--color-text); }
.fb-managed p { margin: 4px 0 0; font-size: 0.78em; line-height: 1.5; color: var(--color-text-muted); }

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
.fb-select { flex: 1 1 0; min-width: 0; }
/* Effort values are short (Low / Max / Provider default). */
.fb-select.fb-effort { flex: 0 1 170px; }

.fb-remove {
  background: transparent; border: none;
  color: var(--color-text-muted); cursor: pointer;
  padding: 6px 8px; border-radius: 6px; flex: 0 0 auto;
  transition: color 0.2s ease, background 0.2s ease;
}
.fb-remove:hover { color: var(--color-red); background: rgba(255,107,107,0.1); }

.fb-actions {
  display: flex; align-items: center; flex-wrap: wrap;
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

.fb-actions-spacer { flex: 1; }

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
