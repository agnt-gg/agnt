<template>
  <div class="compaction-card" :class="{ expanded: showFolded }" :data-message-id="message.id">
    <!-- The fold line. Everything above it is history the model no longer
         reads; this card is what it reads instead. -->
    <div class="fold-line">
      <button type="button" class="fold-toggle" @click="$emit('toggle-folded')">
        <i :class="showFolded ? 'fas fa-chevron-down' : 'fas fa-chevron-right'"></i>
        <span>{{ foldedCount }} message{{ foldedCount === 1 ? '' : 's' }} compressed</span>
        <span class="fold-meta">
          {{ formatNumber(stats.tokensBefore) }} &rarr; {{ formatNumber(stats.tokensAfter) }} tokens
          <template v-if="stats.estimatedCost != null"> &middot; {{ formatUsd(stats.estimatedCost) }}</template>
          <template v-if="stats.model"> &middot; {{ stats.model }}</template>
        </span>
        <span class="fold-hint">{{ showFolded ? 'hide originals' : 'show originals' }}</span>
      </button>
      <button type="button" class="fold-undo" v-tooltip="'Send the full history again'" @click="$emit('undo')">
        <i class="fas fa-undo"></i> Undo
      </button>
    </div>

    <div class="summary">
      <div class="summary-head">
        <span class="summary-label"><i class="fas fa-compress-alt"></i> What the model sees from here up</span>
        <button v-if="!editing" type="button" class="summary-edit" @click="startEdit">
          <i class="fas fa-pen"></i> Edit
        </button>
        <span v-else class="summary-edit-actions">
          <button type="button" class="summary-edit" @click="cancelEdit">Cancel</button>
          <button type="button" class="summary-edit save" @click="saveEdit">Save</button>
        </span>
      </div>
      <textarea
        v-if="editing"
        ref="editor"
        v-model="draft"
        class="summary-editor"
        spellcheck="false"
        @keydown.esc.prevent="cancelEdit"
        @keydown.ctrl.enter.prevent="saveEdit"
        @keydown.meta.enter.prevent="saveEdit"
      ></textarea>
      <div v-else class="summary-body markdown-content" v-html="renderedSummary"></div>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, ref } from 'vue';
import { renderMarkdown } from '@/utils/markdownPipeline';

const USD = '\u0024';

function formatNumber(num) {
  const n = Number(num) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatUsd(n) {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return USD + '0.00';
  if (v < 0.01) return USD + v.toFixed(4);
  return USD + v.toFixed(2);
}

export default {
  name: 'CompactionCard',
  props: {
    /** The role:'compaction' marker message. `content` is the summary. */
    message: { type: Object, required: true },
    /** Whether the folded originals above this card are currently shown. */
    showFolded: { type: Boolean, default: false },
  },
  emits: ['toggle-folded', 'undo', 'update-summary'],
  setup(props, { emit }) {
    const stats = computed(() => props.message.compaction || {});
    const foldedCount = computed(() => Number(stats.value.foldedCount) || 0);
    const renderedSummary = computed(() => renderMarkdown(props.message.content || '', {}));

    const editing = ref(false);
    const draft = ref('');
    const editor = ref(null);
    const startEdit = async () => {
      draft.value = props.message.content || '';
      editing.value = true;
      await nextTick();
      editor.value?.focus();
    };
    const cancelEdit = () => { editing.value = false; };
    const saveEdit = () => {
      const next = draft.value.trim();
      editing.value = false;
      if (next && next !== (props.message.content || '')) emit('update-summary', next);
    };

    return {
      stats, foldedCount, renderedSummary,
      editing, draft, editor, startEdit, cancelEdit, saveEdit,
      formatNumber, formatUsd,
    };
  },
};
</script>

<style scoped>
.compaction-card {
  margin: 14px 0 10px;
  border: 1px solid rgba(var(--blue-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--blue-rgb), 0.05);
  overflow: hidden;
}

.fold-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(var(--blue-rgb), 0.1);
  border-bottom: 1px solid rgba(var(--blue-rgb), 0.25);
}

.fold-toggle {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
  background: none;
  border: 0;
  padding: 0;
  color: var(--color-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.fold-toggle i { font-size: 9px; color: var(--color-blue); }

.fold-meta {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fold-hint {
  font-size: 10px;
  font-weight: 500;
  color: var(--color-blue);
  white-space: nowrap;
}

.fold-undo {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 3px 9px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.fold-undo:hover { border-color: rgba(255, 255, 255, 0.35); color: var(--color-text); }
.fold-undo i { font-size: 9px; }

.summary { padding: 10px 14px 12px; }

.summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.summary-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--color-blue);
}

.summary-edit {
  background: none;
  border: 0;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.summary-edit:hover { color: var(--color-text); background: rgba(255, 255, 255, 0.06); }
.summary-edit.save { color: var(--color-blue); font-weight: 600; }
.summary-edit-actions { display: inline-flex; gap: 4px; }

.summary-body {
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--color-text);
}

.summary-body :deep(h2) {
  font-size: 11px;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  margin: 12px 0 4px;
}

.summary-body :deep(h2:first-child) { margin-top: 0; }
.summary-body :deep(ul) { margin: 2px 0 6px; padding-left: 18px; }
.summary-body :deep(li) { margin: 1px 0; }
.summary-body :deep(p) { margin: 4px 0; }
.summary-body :deep(code) { font-size: 0.9em; }

.summary-editor {
  width: 100%;
  min-height: 220px;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(var(--blue-rgb), 0.4);
  background: var(--color-darker-1);
  color: var(--color-text);
  font-family: var(--font-family-mono, monospace);
  font-size: 11.5px;
  line-height: 1.5;
  box-sizing: border-box;
}

.summary-editor:focus { outline: 1px solid var(--color-blue); outline-offset: -1px; }
</style>
