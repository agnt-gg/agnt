<template>
  <div class="mn-root">
    <div class="mn-title" v-if="noteTitle">{{ noteTitle }}</div>
    <div class="mn-content" v-html="renderedContent"></div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'MarkdownNoteTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const noteTitle = computed(() => props.config.title || '');

    const renderedContent = computed(() => {
      const content = props.config.content || props.config.text || 'No content';
      // Basic markdown rendering
      return content
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');
    });

    return { noteTitle, renderedContent };
  },
};
</script>

<style scoped>
.mn-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow-y: auto;
}

.mn-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: 600;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.mn-content {
  font-size: 12px;
  color: var(--color-light-0, #aab);
  line-height: 1.6;
}

.mn-content :deep(h1) { font-size: 16px; color: var(--color-green); margin: 8px 0 4px; }
.mn-content :deep(h2) { font-size: 14px; color: var(--color-green); margin: 6px 0 3px; }
.mn-content :deep(h3) { font-size: 12px; color: var(--color-green); margin: 4px 0 2px; }
.mn-content :deep(strong) { color: var(--color-light-0, #dde); }
.mn-content :deep(code) {
  background: rgba(255,255,255,0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
.mn-content :deep(li) {
  margin-left: 16px;
  list-style: disc;
}
</style>
