<template>
  <div class="pack-studio">
    <!-- ─── PACK DETAILS ─── -->
    <div class="ps-header">
      <div class="ps-header-bar">
        <i class="fas fa-box ps-header-bar-icon"></i>
        <span class="ps-header-bar-title">Pack Details</span>
      </div>

      <!-- Row 1: Pack Name (required) + Description -->
      <div class="ps-row">
        <label class="ps-field ps-flex-2">
          <span class="ps-label">Pack Name <span class="ps-req">*</span></span>
          <input
            :value="pack.pluginName"
            @input="pack.pluginName = sanitizePackName($event.target.value)"
            type="text"
            class="input"
            placeholder="my-finance-pack"
            spellcheck="false"
          />
        </label>
        <label class="ps-field ps-flex-3">
          <span class="ps-label">Description</span>
          <input
            v-model="pack.description"
            type="text"
            class="input"
            placeholder="What this pack does"
          />
        </label>
      </div>

      <!-- Row 2: Version, Category, Author, Icon -->
      <div class="ps-row">
        <label class="ps-field ps-flex-1">
          <span class="ps-label">Version</span>
          <input
            v-model="pack.version"
            type="text"
            class="input"
            placeholder="1.0.0"
            spellcheck="false"
          />
        </label>
        <div class="ps-field ps-flex-2">
          <span class="ps-label">Category</span>
          <BaseSelect
            v-model="pack.category"
            :options="categoryOptions"
            placeholder="Uncategorized"
          />
        </div>
        <label class="ps-field ps-flex-2">
          <span class="ps-label">Author</span>
          <input
            v-model="pack.author"
            type="text"
            class="input"
            placeholder="optional"
          />
        </label>
        <label class="ps-field ps-flex-1">
          <span class="ps-label">Icon</span>
          <input
            v-model="pack.iconClass"
            type="text"
            class="input"
            placeholder="fa-cube"
            spellcheck="false"
          />
        </label>
      </div>
    </div>

    <!-- ─── BODY: two columns ─── -->
    <div class="ps-body">
      <!-- LIBRARY -->
      <section class="ps-pane">
        <div class="ps-pane-head">
          <span class="ps-pane-title">
            <i class="fas fa-book"></i>
            Library
          </span>
          <span class="ps-pane-sub">{{ libraryFilteredCount }} of {{ libraryTotalCount }}</span>
        </div>

        <div class="ps-toolbar">
          <button
            v-for="tab in kindTabs"
            :key="tab.key"
            class="ps-chip"
            :class="{ active: libraryFilter === tab.key }"
            @click="libraryFilter = tab.key"
          >
            <i v-if="tab.icon" :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
            <span class="ps-chip-count">{{ tab.count }}</span>
          </button>
          <input
            v-model="librarySearch"
            type="text"
            class="ps-search"
            placeholder="Search…"
          />
        </div>

        <div class="ps-grid">
          <div v-if="visibleLibraryItems.length === 0" class="ps-empty">
            <i class="fas fa-inbox"></i>
            <span v-if="libraryFilter === 'tools'">
              No custom tools yet — built-ins auto-resolve, build your own in Tool Forge to bundle them
            </span>
            <span v-else>No matching items</span>
          </div>

          <button
            v-for="entry in visibleLibraryItems"
            :key="`${entry.kind}-${entry.item.id}`"
            class="ps-card"
            :class="{ added: isInPack(entry.kind, entry.item.id) }"
            :disabled="isInPack(entry.kind, entry.item.id)"
            @click="addToPack(entry.kind, entry.item.id)"
          >
            <span class="ps-card-kind" :title="kindLabel(entry.kind)">
              <i :class="kindIcon(entry.kind)"></i>
            </span>
            <span class="ps-card-body">
              <span class="ps-card-name">{{ entry.item.name || entry.item.title || entry.item.slug || entry.item.id }}</span>
              <span v-if="entry.item.description" class="ps-card-desc">{{ entry.item.description }}</span>
            </span>
            <span class="ps-card-action">
              <i :class="isInPack(entry.kind, entry.item.id) ? 'fas fa-check' : 'fas fa-plus'"></i>
            </span>
          </button>
        </div>
      </section>

      <!-- PACK -->
      <section class="ps-pane">
        <div class="ps-pane-head">
          <span class="ps-pane-title">
            <i class="fas fa-box"></i>
            Pack
          </span>
          <span class="ps-pane-sub">{{ totalAssetsInPack }} {{ totalAssetsInPack === 1 ? 'asset' : 'assets' }}</span>
        </div>

        <div class="ps-toolbar">
          <button
            v-for="tab in packKindTabs"
            :key="tab.key"
            class="ps-chip"
            :class="{ active: packFilter === tab.key }"
            @click="packFilter = tab.key"
            :disabled="tab.count === 0 && tab.key !== 'all'"
          >
            <i v-if="tab.icon" :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
            <span class="ps-chip-count">{{ tab.count }}</span>
          </button>
        </div>

        <div class="ps-grid ps-grid-pack">
          <div v-if="totalAssetsInPack === 0" class="ps-empty ps-empty-large">
            <i class="fas fa-arrow-left"></i>
            <span>Click items in the Library to add them here</span>
          </div>

          <div v-else-if="visiblePackItems.length === 0" class="ps-empty">
            <i class="fas fa-filter"></i>
            <span>No {{ packFilter }} in this pack yet</span>
          </div>

          <div
            v-for="entry in visiblePackItems"
            :key="`${entry.kind}-${entry.item.id}`"
            class="ps-card ps-card-armed"
          >
            <span class="ps-card-kind" :title="kindLabel(entry.kind)">
              <i :class="kindIcon(entry.kind)"></i>
            </span>
            <span class="ps-card-body">
              <span class="ps-card-name">{{ entry.item.name || entry.item.title || entry.item.slug || entry.item.id }}</span>
              <span v-if="entry.refs.length" class="ps-card-refs">
                <span
                  v-for="(ref, i) in entry.refs"
                  :key="i"
                  :class="['ps-ref', `ps-ref-${ref.status}`]"
                  :title="`${ref.kind}: ${ref.name} — ${refLabel(ref.status)}`"
                >{{ ref.name }}</span>
              </span>
            </span>
            <button
              class="ps-card-action ps-card-remove"
              :title="'Remove'"
              @click="removeFromPack(entry.kind, entry.item.id)"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- ─── FOOTER: validation + actions ─── -->
    <footer class="ps-footer">
      <div class="ps-stats">
        <span class="ps-stat" :class="{ ok: !validation.brokenRefs, warn: validation.brokenRefs }">
          <i :class="validation.brokenRefs ? 'fas fa-exclamation-triangle' : 'fas fa-check-circle'"></i>
          {{ validation.brokenRefs }} broken
        </span>
        <span v-if="validation.authProviders.length" class="ps-stat warn">
          <i class="fas fa-key"></i>
          {{ validation.authProviders.join(' · ') }}
        </span>
        <span class="ps-stat">
          <i class="fas fa-cube"></i>
          {{ totalAssetsInPack }} payload
        </span>
      </div>

      <div class="ps-actions">
        <span v-if="bundleBlocker" class="ps-blocker">
          <i class="fas fa-info-circle"></i>
          {{ bundleBlocker }}
        </span>
        <label class="ps-toggle">
          <input type="checkbox" v-model="installAfterBuild" />
          <span class="ps-toggle-text">Install on this instance</span>
        </label>
        <button
          class="ps-bundle"
          :class="{ ready: canBundle }"
          :disabled="!canBundle"
          :title="bundleBlocker || 'Build the .agnt archive'"
          @click="bundlePack"
        >
          <i class="fas fa-hammer"></i>
          Build .agnt
        </button>
      </div>
    </footer>
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';

// Asset kinds the bundler understands. Tools are user-authored (with `code`
// source in the DB) — built-in tools auto-resolve at runtime so they don't
// need re-bundling.
const KINDS = [
  { key: 'agents', label: 'Agents', icon: 'fas fa-robot' },
  { key: 'workflows', label: 'Workflows', icon: 'fas fa-project-diagram' },
  { key: 'skills', label: 'Skills', icon: 'fas fa-brain' },
  { key: 'widgets', label: 'Widgets', icon: 'fas fa-th-large' },
  { key: 'tools', label: 'Tools', icon: 'fas fa-tools' },
];

export default {
  name: 'PackStudio',
  components: { BaseSelect },
  emits: ['plugin-installed', 'show-alert'],
  setup(_, { emit }) {
    const store = useStore();

    const pack = ref({
      pluginName: '',
      version: '1.0.0',
      description: '',
      author: '',
      iconClass: 'fa-cube',
      category: '',
    });
    const installAfterBuild = ref(false);
    const sanitizePackName = (raw) =>
      String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+/, '');

    const librarySearch = ref('');
    const libraryFilter = ref('all'); // 'all' | kind.key
    const packFilter = ref('all');

    const packIcon = computed(() => pack.value.iconClass || 'fa-cube');
    const categories = computed(() => store.getters['agents/agentCategories'] || []);
    const categoryOptions = computed(() => [
      { value: '', label: 'Uncategorized' },
      ...categories.value.map((cat) => ({ value: cat, label: cat })),
    ]);

    const selection = ref({
      agents: new Set(),
      workflows: new Set(),
      skills: new Set(),
      widgets: new Set(),
      tools: new Set(),
    });

    const isInPack = (kind, id) => selection.value[kind].has(id);
    const addToPack = (kind, id) => {
      if (isInPack(kind, id)) return;
      selection.value[kind].add(id);
      selection.value = { ...selection.value, [kind]: new Set(selection.value[kind]) };
    };
    const removeFromPack = (kind, id) => {
      selection.value[kind].delete(id);
      selection.value = { ...selection.value, [kind]: new Set(selection.value[kind]) };
    };

    // Library data — fall back gracefully if a getter doesn't exist yet
    const allAgents = computed(() => store.getters['agents/allAgents'] || []);
    const allWorkflows = computed(() => store.getters['workflows/allWorkflows'] || []);
    const allSkills = computed(() => store.getters['skills/allSkills'] || []);
    const allWidgets = computed(() => store.getters['widgetDefinitions/allDefinitions'] || []);
    const allTools = computed(() => store.getters['tools/allTools'] || []);

    // The tools store merges TWO sources:
    //   - /api/tools/orchestrator-tools (id = type, marks ALL non-plugins as is_builtin: true)
    //   - /api/custom-tools/            (id = DB UUID, has the real `code` source)
    // Custom tools end up in the list twice (once per source), with different IDs.
    // The orchestrator copy has is_builtin: true, the custom copy has the UUID.
    // We want only the UUID copy: it's the one the backend bundler can find.
    //
    // Strategy: dedupe by `type`, prefer the entry with a non-builtin flag.
    const bundleableTools = computed(() => {
      const byType = new Map();
      for (const t of allTools.value) {
        const key = t.type || t.id;
        const existing = byType.get(key);
        // Prefer the non-builtin / non-plugin variant when both exist
        const better = !t.is_builtin && !t.is_plugin;
        if (!existing || (better && (existing.is_builtin || existing.is_plugin))) {
          byType.set(key, t);
        }
      }
      // Keep only entries that aren't ultimately built-in or plugin
      return Array.from(byType.values()).filter((t) => !t.is_builtin && !t.is_plugin);
    });

    const libraryByKind = computed(() => ({
      agents: allAgents.value,
      workflows: allWorkflows.value,
      skills: allSkills.value,
      widgets: allWidgets.value,
      tools: bundleableTools.value,
    }));

    const kindIcon = (key) => KINDS.find((k) => k.key === key)?.icon || 'fas fa-cube';
    const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label || key;

    // Counts per kind for the chip strip
    const kindCounts = computed(() => {
      const m = {};
      for (const k of KINDS) m[k.key] = (libraryByKind.value[k.key] || []).length;
      m.all = Object.values(m).reduce((a, b) => a + b, 0);
      return m;
    });

    const kindTabs = computed(() => [
      { key: 'all', label: 'All', icon: 'fas fa-asterisk', count: kindCounts.value.all },
      ...KINDS.map((k) => ({ ...k, count: kindCounts.value[k.key] })),
    ]);

    // Flatten all library items into [{kind, item}] entries, applying filter + search
    const visibleLibraryItems = computed(() => {
      const q = librarySearch.value.trim().toLowerCase();
      const out = [];
      for (const k of KINDS) {
        if (libraryFilter.value !== 'all' && libraryFilter.value !== k.key) continue;
        const items = libraryByKind.value[k.key] || [];
        for (const item of items) {
          if (q) {
            const name = (item.name || item.title || '').toLowerCase();
            const desc = (item.description || '').toLowerCase();
            if (!name.includes(q) && !desc.includes(q)) continue;
          }
          out.push({ kind: k.key, item });
        }
      }
      return out;
    });

    const libraryFilteredCount = computed(() => visibleLibraryItems.value.length);
    const libraryTotalCount = computed(() => kindCounts.value.all);

    // Pack-side
    const totalAssetsInPack = computed(() =>
      Object.values(selection.value).reduce((acc, s) => acc + s.size, 0)
    );

    const packKindCounts = computed(() => {
      const m = {};
      for (const k of KINDS) m[k.key] = selection.value[k.key].size;
      m.all = totalAssetsInPack.value;
      return m;
    });

    const packKindTabs = computed(() => [
      { key: 'all', label: 'All', icon: 'fas fa-asterisk', count: packKindCounts.value.all },
      ...KINDS.map((k) => ({ ...k, count: packKindCounts.value[k.key] })),
    ]);

    const nameFor = (kind, id) => {
      const items = libraryByKind.value[kind] || [];
      const found = items.find((it) => it.id === id || it.slug === id || it.name === id);
      return found?.name || found?.title || id;
    };

    const resolveRefsFor = (kind, item) => {
      const refs = [];
      if (kind !== 'agents') return refs;

      const resolveTool = (toolName) => {
        const found = allTools.value.find((t) => t.id === toolName || t.title === toolName || t.type === toolName);
        return { kind: 'tool', name: toolName, status: found ? 'external' : 'missing' };
      };
      const resolveSkill = (skillId) => {
        if (selection.value.skills.has(skillId)) return { kind: 'skill', name: nameFor('skills', skillId), status: 'bundled' };
        const found = allSkills.value.find((s) => s.id === skillId || s.slug === skillId || s.name === skillId);
        return { kind: 'skill', name: nameFor('skills', skillId) || skillId, status: found ? 'external' : 'missing' };
      };
      const resolveWorkflow = (wfId) => {
        if (selection.value.workflows.has(wfId)) return { kind: 'workflow', name: nameFor('workflows', wfId), status: 'bundled' };
        const found = allWorkflows.value.find((w) => w.id === wfId);
        return { kind: 'workflow', name: nameFor('workflows', wfId) || wfId, status: found ? 'external' : 'missing' };
      };

      for (const t of item.assignedTools || []) refs.push(resolveTool(t));
      for (const s of item.assignedSkills || []) refs.push(resolveSkill(s));
      for (const w of item.assignedWorkflows || []) refs.push(resolveWorkflow(w));
      return refs;
    };

    const refLabel = (status) =>
      status === 'bundled' ? 'in this pack'
      : status === 'external' ? 'requires external asset'
      : 'missing';

    const visiblePackItems = computed(() => {
      const out = [];
      for (const k of KINDS) {
        if (packFilter.value !== 'all' && packFilter.value !== k.key) continue;
        const ids = selection.value[k.key];
        const items = libraryByKind.value[k.key] || [];
        for (const item of items) {
          if (!ids.has(item.id)) continue;
          out.push({ kind: k.key, item, refs: resolveRefsFor(k.key, item) });
        }
      }
      return out;
    });

    const validation = computed(() => {
      let broken = 0;
      const authProviders = new Set();
      for (const k of KINDS) {
        const items = libraryByKind.value[k.key] || [];
        const ids = selection.value[k.key];
        for (const item of items) {
          if (!ids.has(item.id)) continue;
          for (const r of resolveRefsFor(k.key, item)) {
            if (r.status === 'missing') broken++;
          }
          if (k.key === 'agents') {
            for (const tname of item.assignedTools || []) {
              const t = allTools.value.find((x) => x.id === tname || x.title === tname || x.type === tname);
              if (t?.authProvider) authProviders.add(t.authProvider);
            }
          }
        }
      }
      return { brokenRefs: broken, authProviders: Array.from(authProviders) };
    });

    const bundleBlocker = computed(() => {
      const name = pack.value.pluginName.trim();
      const ver = pack.value.version.trim();
      if (!name) return 'Enter a pack name';
      if (!ver) return 'Enter a version';
      if (totalAssetsInPack.value === 0) return 'Add at least one asset from the Library';
      return null;
    });
    const canBundle = computed(() => bundleBlocker.value === null);

    const bundlePack = async () => {
      if (!canBundle.value) return;
      try {
        const token = localStorage.getItem('token');
        const body = {
          pluginName: pack.value.pluginName.trim(),
          version: pack.value.version.trim(),
          description: pack.value.description,
          author: pack.value.author,
          icon: pack.value.iconClass || 'fa-cube',
          selection: {
            agentIds: Array.from(selection.value.agents),
            workflowIds: Array.from(selection.value.workflows),
            skillIds: Array.from(selection.value.skills),
            widgetIds: Array.from(selection.value.widgets),
            toolIds: Array.from(selection.value.tools),
          },
          install: installAfterBuild.value,
        };
        const r = await fetch(`${API_CONFIG.BASE_URL}/plugins/bundle-from-assets`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);

        const blob = new Blob(
          [Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))],
          { type: 'application/octet-stream' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.fileName || `${body.pluginName}.agnt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (installAfterBuild.value && data.installed) {
          emit('plugin-installed');
          emit('show-alert', 'Pack Built', `${body.pluginName}.agnt downloaded and installed.`);
        } else {
          emit('show-alert', 'Pack Built', `${body.pluginName}.agnt downloaded.`);
        }
      } catch (e) {
        console.error('Pack bundle failed:', e);
        emit('show-alert', 'Build Failed', e.message);
      }
    };

    onMounted(() => {
      // Force-fetch so all four asset libraries load reliably even if the
      // user navigates here straight from a fresh app launch.
      store.dispatch('agents/fetchAgents', { force: true }).catch(() => {});
      store.dispatch('workflows/fetchWorkflows', { force: true }).catch(() => {});
      store.dispatch('skills/fetchSkills').catch(() => {});
      store.dispatch('widgetDefinitions/fetchDefinitions').catch(() => {});
      store.dispatch('tools/fetchTools', { force: true }).catch(() => {});
    });

    return {
      pack,
      packIcon,
      categories,
      categoryOptions,
      installAfterBuild,
      sanitizePackName,
      bundleBlocker,
      librarySearch,
      libraryFilter,
      packFilter,
      kindTabs,
      packKindTabs,
      kindIcon,
      kindLabel,
      visibleLibraryItems,
      visiblePackItems,
      libraryFilteredCount,
      libraryTotalCount,
      totalAssetsInPack,
      isInPack,
      addToPack,
      removeFromPack,
      validation,
      canBundle,
      bundlePack,
      refLabel,
    };
  },
};
</script>

<style scoped>
.pack-studio {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  height: 100%;
}

/* ─── Pack Details Header (simple flex, no grid) ─── */
.ps-header {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  flex-shrink: 0;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.ps-header-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--terminal-border-color);
}
.ps-header-bar-icon {
  color: var(--color-green);
  font-size: var(--font-size-sm);
}
.ps-header-bar-title {
  font-size: var(--font-size-xs);
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: var(--font-weight-semibold);
}

.ps-row {
  display: flex;
  gap: var(--spacing-md);
  align-items: flex-end;
}

.ps-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.ps-flex-1 { flex: 1; }
.ps-flex-2 { flex: 2; }
.ps-flex-3 { flex: 3; }

.ps-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: var(--font-weight-semibold);
  display: block;
}
.ps-req {
  color: var(--color-red);
  margin-left: 2px;
}


/* ─── Body two-pane ─── */
.ps-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: var(--spacing-md);
  min-height: 0;
}

.ps-pane {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  min-height: 0;
}

.ps-pane-head {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--terminal-border-color);
}
.ps-pane-title {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: var(--font-weight-semibold);
}
.ps-pane-title i { font-size: var(--font-size-xs); }
.ps-pane-sub {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ─── Filter + search toolbar ─── */
.ps-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--terminal-border-color);
}
.ps-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}
.ps-chip:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}
.ps-chip.active {
  color: var(--color-green);
  border-color: var(--color-green);
  background: var(--color-darker-1);
}
.ps-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ps-chip i { font-size: var(--font-size-xs); }
.ps-chip-count {
  padding: 0 var(--spacing-xs);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  opacity: 0.75;
}
.ps-search {
  margin-left: auto;
  flex: 0 1 220px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  padding: var(--spacing-xxs) var(--spacing-sm);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-xs);
  outline: none;
}
.ps-search:focus { border-color: var(--color-green); }
.ps-search::placeholder { color: var(--color-text-muted); }

/* ─── Card grid ─── */
.ps-grid {
  flex: 1;
  overflow-y: auto;
  /* Cap visible height to ~8 rows × 2 cols ≈ 16 cards before scrolling */
  max-height: 440px;
  padding: var(--spacing-sm) var(--spacing-md);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--spacing-xs);
  align-content: start;
  scrollbar-gutter: stable;
}
.ps-grid::-webkit-scrollbar { width: 8px; }
.ps-grid::-webkit-scrollbar-track { background: transparent; }
.ps-grid::-webkit-scrollbar-thumb {
  background: var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
}
.ps-grid::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}
.ps-grid-pack {
  /* slightly more breathing room when listing armed items */
  gap: var(--spacing-sm);
}

.ps-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.ps-empty i { font-size: var(--font-size-md); opacity: 0.5; }
.ps-empty-large {
  flex-direction: column;
  padding: var(--spacing-xxl) var(--spacing-md);
  text-align: center;
}
.ps-empty-large i { font-size: var(--font-size-xxl); }

/* ─── Card ─── */
.ps-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-xs);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), transform 80ms ease-out;
}
.ps-card:hover:not(:disabled) {
  border-color: var(--color-green);
  background: var(--color-darker-1);
}
.ps-card:active:not(:disabled) {
  transform: translateY(1px);
}
.ps-card:disabled,
.ps-card.added {
  cursor: default;
  opacity: 0.55;
}

.ps-card-kind {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-green);
  font-size: 10px;
  flex-shrink: 0;
}

.ps-card-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ps-card-name {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-card-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ps-card-action {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  font-size: 10px;
  flex-shrink: 0;
  font-family: inherit;
}
.ps-card:hover:not(:disabled) .ps-card-action {
  color: var(--color-green);
  border-color: var(--color-green);
}
.ps-card.added .ps-card-action { color: var(--color-green); border-color: var(--color-green); }

/* ─── Pack-side card ─── */
.ps-card-armed {
  cursor: default;
  border-color: var(--color-green);
  border-left-width: 3px;
}
.ps-card-armed:hover { background: var(--color-darker-1); }

.ps-card-remove {
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ps-card-remove:hover {
  color: var(--color-red);
  border-color: var(--color-red);
}

.ps-card-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xxs);
  margin-top: 2px;
}
.ps-ref {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 9px;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-ref-bundled { color: var(--color-green); border-color: var(--color-green); }
.ps-ref-external { color: var(--color-yellow); border-color: var(--color-yellow); }
.ps-ref-missing { color: var(--color-red); border-color: var(--color-red); }

/* ─── Footer ─── */
.ps-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
}
.ps-stats {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}
.ps-stat {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  font-size: var(--font-size-xs);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
}
.ps-stat i { font-size: var(--font-size-xs); }
.ps-stat.ok { color: var(--color-green); border-color: var(--color-green); }
.ps-stat.warn { color: var(--color-yellow); border-color: var(--color-yellow); }

.ps-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}
.ps-blocker {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-style: italic;
}
.ps-blocker i { color: var(--color-yellow); }

.ps-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
}
.ps-toggle input { cursor: pointer; }

.ps-bundle {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}
.ps-bundle:not(:disabled):hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}
.ps-bundle.ready {
  color: var(--color-green);
  border-color: var(--color-green);
}
.ps-bundle.ready:hover {
  background: var(--color-darker-1);
}
.ps-bundle:disabled { cursor: not-allowed; opacity: 0.55; }

@media (max-width: 1100px) {
  .ps-body { grid-template-columns: 1fr; }
  .ps-row { flex-wrap: wrap; }
  .ps-row .ps-field { flex: 1 0 200px; }
}
</style>
