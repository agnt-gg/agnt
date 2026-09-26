<template>
  <div class="bundle-preflight">
    <span class="bp-counts">{{ breakdown }}</span>

    <ul v-if="warnings.length" class="bp-warnings">
      <li v-for="warning in warnings" :key="`${warning.kind}|${warning.file}|${warning.detail}`">
        <span>{{ warningText(warning) }}</span>
        <button
          v-if="warning.folder && !includeDirs.includes(warning.folder)"
          class="bp-button"
          :disabled="busy"
          @click="$emit('include-folder', warning.folder)"
        >Include folder {{ warning.folder }}/</button>
      </li>
    </ul>

    <div v-if="includeDirs.length" class="bp-folders">
      <span class="bp-label">Included folders</span>
      <span v-for="dir in includeDirs" :key="dir" class="bp-chip">
        {{ dir }}/
        <button :disabled="busy" :aria-label="`Stop including ${dir}`" @click="$emit('remove-folder', dir)">&times;</button>
      </span>
    </div>

    <details class="bp-why">
      <summary>Why these {{ manifest.totals.files }} files</summary>
      <ul>
        <li v-for="file in listed" :key="file.path">
          <code>{{ file.path }}</code>
          <span class="bp-reason">{{ file.reason }}</span>
          <span class="bp-size">{{ formatSize(file.size) }}</span>
        </li>
      </ul>
      <p v-if="hiddenCount" class="bp-more">…and {{ hiddenCount }} more</p>
    </details>

    <div class="bp-add">
      <input
        v-model="folder"
        placeholder="Include a whole folder (workspace-relative)"
        :disabled="busy"
        @keyup.enter="includeTyped"
      />
      <button class="bp-button" :disabled="busy || !folder.trim()" @click="includeTyped">Include</button>
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue';

// What a share bundle contains and why. Bundles are built from references;
// folders travel whole only when the user includes them here.
const LISTED_FILES = 200;
const KIND_LABELS = { entry: 'entry', reference: 'referenced', pattern: 'matched by a name pattern', folder: 'from included folders' };

export default {
  name: 'ShareBundlePreflight',
  props: {
    manifest: { type: Object, required: true },
    includeDirs: { type: Array, default: () => [] },
    busy: { type: Boolean, default: false },
  },
  emits: ['include-folder', 'remove-folder'],
  setup(props, { emit }) {
    const folder = ref('');
    const sources = computed(() => props.manifest.sources || {});
    const warnings = computed(() => props.manifest.warnings || []);
    const files = computed(() => props.manifest.files.map((file) => ({ ...file, reason: sources.value[file.path]?.reason || 'referenced' })));
    const listed = computed(() => files.value.slice(0, LISTED_FILES));
    const hiddenCount = computed(() => Math.max(0, files.value.length - LISTED_FILES));
    const breakdown = computed(() => {
      const counts = {};
      for (const file of props.manifest.files) {
        const kind = sources.value[file.path]?.kind || 'reference';
        counts[kind] = (counts[kind] || 0) + 1;
      }
      const parts = Object.keys(KIND_LABELS).filter((kind) => counts[kind]).map((kind) => `${counts[kind]} ${KIND_LABELS[kind]}`);
      return `${parts.join(' · ')} · ${formatSize(props.manifest.totals.bytes)}`;
    });
    function warningText(warning) {
      if (warning.kind === 'runtime_load') return `${warning.file}: ${warning.detail}. Files loaded this way can't be found by reading the page.`;
      if (warning.kind === 'runtime_pattern_outside_root') return `${warning.file} builds file names like ${warning.detail} outside the bundle root; they won't load once published.`;
      if (warning.kind === 'runtime_pattern_unresolved') return `${warning.file} builds file names like ${warning.detail}, but has no folder on disk to match them in.`;
      return `${warning.file}: ${warning.detail}`;
    }
    function includeTyped() {
      const value = folder.value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!value) return;
      emit('include-folder', value);
      folder.value = '';
    }
    return { folder, warnings, listed, hiddenCount, breakdown, warningText, includeTyped, formatSize };
  },
};

function formatSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
</script>

<style scoped>
.bundle-preflight {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.95em;
}
.bp-counts {
  color: var(--color-text);
}
.bp-warnings {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bp-warnings li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 196, 0, 0.35);
  background: rgba(255, 196, 0, 0.06);
}
.bp-folders {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.bp-label {
  font-weight: 500;
}
.bp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--terminal-border-color);
  font-family: var(--font-mono, monospace);
}
.bp-chip button {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
}
.bp-button {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.95em;
}
.bp-button:disabled,
.bp-chip button:disabled {
  opacity: 0.5;
  cursor: default;
}
.bp-why summary {
  cursor: pointer;
}
.bp-why ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  max-height: 180px;
  overflow: auto;
}
.bp-why li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  padding: 2px 0;
}
.bp-why code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
}
.bp-reason,
.bp-size,
.bp-more {
  color: var(--color-text-muted);
  white-space: nowrap;
}
.bp-add {
  display: flex;
  gap: 6px;
}
.bp-add input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--color-text);
}
</style>
