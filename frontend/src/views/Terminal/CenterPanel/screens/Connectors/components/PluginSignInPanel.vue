<!-- PluginSignInPanel.vue — the Plugin Forge's Sign-in tab.

     What the plugin needs to connect, and whether everyone who installs it
     could: each sign-in is bundled in the plugin (manifest.auth), shared by
     AGNT, or only its author's. Here you point each tool at a sign-in, add or
     edit the ones the plugin bundles (an API key each user pastes, or OAuth
     with PKCE; there is no field for a secret), and connect them.

     The draft is written through the parent's save (APPLY_FILE), the path the
     chat and the Edit form use. The marketplace applies the same rule at
     publish (validate-core checkPluginSignIns); this shows it while you edit. -->
<template>
  <div class="signin">
    <p v-if="disabled" class="signin-note">Annie is editing this plugin. You can change sign-ins when she has finished.</p>

    <section class="signin-section">
      <h4>What it needs</h4>
      <p v-if="!rows.length" class="signin-note" data-testid="signin-none">No sign-in. Anyone who installs it can use it straight away.</p>
      <div v-for="row in rows" :key="row.id" class="signin-row" :data-signin="row.id" :class="row.source">
        <div class="signin-row-text">
          <strong>{{ row.name }}</strong>
          <small>
            {{ SOURCE_LABEL[row.source] }} · {{ row.kind === 'oauth' ? 'OAuth sign-in' : 'API key' }}
            <template v-if="row.usedBy.length"> · used by {{ row.usedBy.join(', ') }}</template>
            <template v-else> · no tool uses it yet</template>
          </small>
          <small v-if="row.source === 'unresolved'" class="bad warn"><i class="fas fa-exclamation-triangle"></i> <strong>Can't be published:</strong> only you could connect this. Bundle it in the plugin, or pick a shared sign-in for its tools.</small>
          <small v-if="row.redefinesShared" class="bad">AGNT already shares "{{ row.id }}". Remove the bundled copy and use the shared one.</small>
        </div>
        <span v-if="row.connected" class="signin-ok"><i class="fas fa-check"></i> Connected</span>
        <button v-else-if="row.source === 'unresolved'" type="button" class="signin-btn primary" :disabled="disabled" @click="bundle(row)">Bundle it</button>
        <button v-else-if="row.source === 'plugin' && installState !== 'installed'" type="button" class="signin-btn" disabled v-tooltip="'Install the plugin, then connect it'">Install to connect</button>
        <button v-else type="button" class="signin-btn primary" :data-action="`connect-${row.id}`" @click="$emit('connect', row.id)">Connect</button>
      </div>
    </section>

    <section class="signin-section">
      <h4>Which tool uses which</h4>
      <div v-for="tool in manifest.tools || []" :key="tool.type" class="signin-tool" :data-tool="tool.type">
        <span class="signin-tool-name">{{ tool.schema?.title || tool.type }}</span>
        <BaseSelect
          :model-value="toolSignIn(tool)"
          :options="optionsFor(tool)"
          :disabled="disabled"
          :aria-label="`Sign-in for ${tool.schema?.title || tool.type}`"
          @update:model-value="(id) => pick(tool, id)"
        />
      </div>
      <p v-if="sharedError" class="signin-note bad">Could not load AGNT's shared sign-ins: {{ sharedError }}</p>
    </section>

    <section class="signin-section">
      <h4>Bundled in this plugin</h4>
      <p class="signin-note">When AGNT doesn't share a sign-in, the plugin carries it. Each person who installs the plugin connects their own account: they paste their own key, or sign in with OAuth. Never put a key or client secret here.</p>
      <div v-for="(row, index) in editRows" :key="row.key" class="signin-entry" :data-entry="row.id || 'new'">
        <div class="signin-grid">
          <label class="signin-field"><span>Name</span><input v-model="row.name" class="signin-input" :disabled="disabled" @input="row.idTouched || (row.id = slug(row.name))" /></label>
          <label class="signin-field"><span>Id (what tools name)</span><input v-model="row.id" class="signin-input" :disabled="disabled || !row.isNew" @input="row.idTouched = true" /></label>
          <label class="signin-field">
            <span>Kind</span>
            <BaseSelect v-model="row.type" :options="KIND_OPTIONS" :disabled="disabled" />
          </label>
          <label v-if="row.type === 'apikey'" class="signin-field"><span>What the key is called</span><input v-model="row.keyLabel" class="signin-input" :disabled="disabled" placeholder="API key" /></label>
          <template v-else>
            <label class="signin-field wide"><span>Authorization URL</span><input v-model="row.authorizationUrl" class="signin-input" :disabled="disabled" placeholder="https://…/oauth/authorize" /></label>
            <label class="signin-field wide"><span>Token URL</span><input v-model="row.tokenUrl" class="signin-input" :disabled="disabled" placeholder="https://…/oauth/token" /></label>
            <label class="signin-field"><span>Scopes</span><input v-model="row.scopes" class="signin-input" :disabled="disabled" placeholder="read, write" /></label>
            <label class="signin-field"><span>Public client ID (optional)</span><input v-model="row.clientId" class="signin-input" :disabled="disabled" placeholder="Leave empty: each user brings their own" /></label>
          </template>
          <label class="signin-field wide"><span>How to get it</span><input v-model="row.instructions" class="signin-input" :disabled="disabled" placeholder="Settings → Developer → API keys" /></label>
          <label class="signin-field wide"><span>Help link</span><input v-model="row.helpUrl" class="signin-input" :disabled="disabled" placeholder="https://…" /></label>
        </div>
        <p v-for="problem in problemsFor(row, index)" :key="problem" class="signin-note bad" role="alert">{{ problem }}</p>
        <div class="signin-actions">
          <button type="button" class="signin-btn primary" :disabled="disabled || problemsFor(row, index).length > 0" :data-action="`save-${row.id || 'new'}`" @click="saveEntry(row, index)">Save</button>
          <button type="button" class="signin-link danger" :disabled="disabled" @click="removeEntry(row, index)">Remove</button>
        </div>
      </div>
      <div class="signin-actions">
        <button type="button" class="signin-btn" :disabled="disabled" data-action="add-apikey" @click="addEntry('apikey')"><i class="fas fa-plus"></i> API key sign-in</button>
        <button type="button" class="signin-btn" :disabled="disabled" data-action="add-oauth" @click="addEntry('oauth')"><i class="fas fa-plus"></i> OAuth sign-in</button>
      </div>
    </section>
  </div>
</template>

<script>
import { computed, ref, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import {
  slugify,
  toolSignIn,
  signInRows,
  setToolSignIn,
  blankSignIn,
  signInEntry,
  signInRow,
  signInProblems,
} from './pluginDraftEditing.js';

const SOURCE_LABEL = { plugin: 'Bundled in this plugin', shared: 'Shared by AGNT', unresolved: 'Not available to others' };
const KIND_OPTIONS = [{ value: 'apikey', label: 'API key' }, { value: 'oauth2', label: 'OAuth' }];
let keySeed = 0;

/** AGNT's shared sign-ins, asked anonymously: exactly the global ones (no private ones mixed in). */
async function loadShared() {
  const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const list = Array.isArray(body) ? body : body?.providers || [];
  return list.filter((p) => p?.id && (p.is_global === undefined || String(p.is_global) === '1'));
}

export default {
  name: 'PluginSignInPanel',
  components: { BaseSelect },
  props: {
    manifest: { type: Object, required: true },
    /** 'draft' | 'changed' | 'installed': a bundled sign-in is connectable once installed. */
    installState: { type: String, default: 'draft' },
    disabled: { type: Boolean, default: false },
    /** Test seam: the shared list, instead of fetching it. */
    sharedSignIns: { type: Array, default: null },
  },
  emits: ['save', 'connect'],
  setup(props, { emit }) {
    const store = useStore();
    const shared = ref(props.sharedSignIns);
    const sharedError = ref('');
    onMounted(async () => {
      if (shared.value) return;
      try {
        shared.value = await loadShared();
      } catch (error) {
        sharedError.value = error.message;
        shared.value = [];
      }
    });

    const connectedIds = computed(() => (store?.getters?.['appAuth/connectedApps'] ?? store?.state?.appAuth?.connectedApps) || []);
    const bundled = computed(() => (Array.isArray(props.manifest.auth) ? props.manifest.auth : []));
    const sharedSorted = computed(() => [...(shared.value || [])].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))));
    const sharedIds = computed(() => (shared.value || []).map((p) => String(p.id).toLowerCase()));
    const rows = computed(() => signInRows(props.manifest, { shared: shared.value || [], connectedIds: connectedIds.value }));
    const orphan = (tool) => {
      const id = toolSignIn(tool);
      return id && !bundled.value.some((e) => String(e.id).toLowerCase() === id) && !sharedIds.value.includes(id);
    };

    // The bundled entries as editable rows; reset whenever the draft changes underneath.
    const editRows = ref([]);
    const resetRows = () => {
      editRows.value = bundled.value.map((entry) => ({ ...signInRow(entry), key: `e${++keySeed}`, original: entry.id, isNew: false, idTouched: true }));
    };
    watch(bundled, resetRows, { immediate: true, deep: true });

    const problemsFor = (row, index) =>
      signInProblems(row, { sharedIds: sharedIds.value, otherIds: editRows.value.filter((_, i) => i !== index).map((r) => r.id) });

    const kindOf = (id) => {
      const entry = bundled.value.find((e) => String(e.id).toLowerCase() === id) || (shared.value || []).find((p) => String(p.id).toLowerCase() === id);
      const type = entry?.type || entry?.connection_type;
      return type === 'oauth2' || type === 'oauth' ? 'oauth' : 'apikey';
    };

    /** No sign-in, then the plugin's own, then AGNT's shared ones; a private one stays visible so it can be replaced. */
    function optionsFor(tool) {
      const options = [{ value: '', label: 'No sign-in' }];
      for (const entry of bundled.value) options.push({ value: String(entry.id).toLowerCase(), label: `${entry.name || entry.id} (bundled)` });
      for (const provider of sharedSorted.value) options.push({ value: String(provider.id).toLowerCase(), label: `${provider.name || provider.id} (shared)` });
      if (orphan(tool)) options.push({ value: toolSignIn(tool), label: `${toolSignIn(tool)} (not available to others)` });
      return options;
    }

    function pick(tool, id) {
      emit('save', setToolSignIn(props.manifest, tool.type, id || null, kindOf(id)));
    }

    function addEntry(kind, name = '') {
      editRows.value.push({ ...blankSignIn(kind, name), key: `e${++keySeed}`, original: null, isNew: true, idTouched: false });
    }
    /** An unresolved sign-in: a bundled entry with its id, ready to fill in. */
    function bundle(row) {
      if (editRows.value.some((r) => r.id === row.id)) return;
      editRows.value.push({ ...blankSignIn(row.kind, row.name), id: row.id, key: `e${++keySeed}`, original: null, isNew: true, idTouched: true });
    }

    function saveEntry(row, index) {
      if (problemsFor(row, index).length) return;
      const entry = signInEntry(row);
      const others = bundled.value.filter((e) => e.id !== row.original);
      let next = { ...props.manifest, auth: row.original ? bundled.value.map((e) => (e.id === row.original ? entry : e)) : [...others, entry] };
      // Tools follow the entry's kind (API key or OAuth).
      for (const tool of next.tools || []) {
        if (toolSignIn(tool) === entry.id) next = setToolSignIn(next, tool.type, entry.id, entry.type === 'oauth2' ? 'oauth' : 'apikey');
      }
      emit('save', next);
    }

    function removeEntry(row, index) {
      if (!row.original) {
        editRows.value.splice(index, 1);
        return;
      }
      let next = { ...props.manifest, auth: bundled.value.filter((e) => e.id !== row.original) };
      if (!next.auth.length) delete next.auth;
      // Tools that used it now need no sign-in, rather than one nobody can connect.
      for (const tool of next.tools || []) if (toolSignIn(tool) === row.original) next = setToolSignIn(next, tool.type, null);
      emit('save', next);
    }

    return { SOURCE_LABEL, KIND_OPTIONS, optionsFor, shared, sharedError, sharedSorted, bundled, rows, editRows, toolSignIn, orphan, pick, addEntry, bundle, saveEntry, removeEntry, problemsFor, slug: (name) => slugify(name, '') };
  },
};
</script>

<style scoped>
.signin { display: flex; flex-direction: column; gap: 18px; }
.signin-section { display: flex; flex-direction: column; gap: 8px; }
.signin-section { padding-top: 14px; border-top: 1px solid var(--terminal-border-color); }
.signin-section:first-of-type { padding-top: 0; border-top: none; }
.signin-section h4 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.warn { font-size: 12.5px; line-height: 1.4; }
.signin-note { margin: 0; font-size: 12px; color: var(--text-secondary); }
.signin-note.bad, small.bad { color: var(--color-red, #d33); }
.signin-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--terminal-border-color); border-radius: 10px; }
.signin-row.unresolved { border-color: var(--color-red, #d33); }
.signin-row-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.signin-row-text strong { font-size: 13px; color: var(--text-primary); }
.signin-row-text small { font-size: 12px; color: var(--text-secondary); }
.signin-ok { font-size: 12px; color: var(--text-green); white-space: nowrap; }
.signin-tool { display: grid; grid-template-columns: 180px minmax(0, 360px); align-items: center; gap: 12px; }
.signin-tool-name { font-size: 13px; color: var(--text-primary); }
.signin-input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: var(--color-darker-0); color: var(--text-primary); font: inherit; font-size: 13px; }
.signin-input::placeholder { color: var(--text-secondary); opacity: 0.55; }
.signin-input:disabled { opacity: 0.6; }
.signin-entry { border: 1px solid var(--terminal-border-color); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.signin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
.signin-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); min-width: 0; }
.signin-field.wide { grid-column: 1 / -1; }
.signin-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.signin-btn { border: 1px solid var(--terminal-border-color); background: transparent; color: var(--text-primary); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.signin-btn.primary { background: var(--text-primary); color: var(--color-background); border-color: transparent; }
.signin-btn:disabled { opacity: 0.5; cursor: default; }
.signin-link { border: none; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 0; }
.signin-link:hover:not(:disabled) { color: var(--text-primary); }
.signin-link.danger:hover:not(:disabled) { color: var(--color-red, #d33); }
</style>
