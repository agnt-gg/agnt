<template>
  <div class="code-editor-container">
    <div class="editor-header">
      <div class="editor-title">
        <i :class="languageIcon"></i>
        {{ languageLabel }} Code
      </div>
      <div class="editor-info">
        <span class="line-count">{{ lineCount }} lines</span>
      </div>
    </div>
    <codemirror
      :model-value="modelValue || placeholder"
      :style="{ height: '400px', width: '100%' }"
      :indent-with-tab="true"
      :tab-size="2"
      :extensions="codeEditorExtensions"
      @update:model-value="handleInput"
    />
    <div class="editor-footer">
      <div class="editor-hints">
        <span class="hint">
          <i class="fas fa-info-circle"></i>
          Code runs as a function. Access params with params.name. MUST use 'return' statement (Python: return or print). Success/error wrapped
          automatically.
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import { Codemirror } from 'vue-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

export default {
  name: 'CodeEditor',
  components: {
    Codemirror,
  },
  props: {
    modelValue: {
      type: String,
      default: '',
    },
    language: {
      type: String,
      default: 'javascript',
      validator: (value) => ['javascript', 'python'].includes(value),
    },
  },
  emits: ['update:modelValue'],
  computed: {
    lineCount() {
      return (this.modelValue || this.placeholder).split('\n').length;
    },
    languageIcon() {
      return this.language === 'python' ? 'fab fa-python' : 'fab fa-js';
    },
    languageLabel() {
      return this.language === 'python' ? 'Python' : 'JavaScript';
    },
    codeEditorExtensions() {
      const languageExtension = this.language === 'python' ? python() : javascript();
      return [languageExtension, oneDark];
    },
    placeholder() {
      if (this.language === 'python') {
        return `# Input parameters: Access with params.paramName
import random

# Example with params "min" and "max":
min_val = params.min if hasattr(params, 'min') else 1
max_val = params.max if hasattr(params, 'max') else 100

# Your code here
result = random.randint(int(min_val), int(max_val))

# MUST use return (or print) - success/error wrapped automatically
return {
    "randomNumber": result
}`;
      } else {
        return `// Input parameters: Access with params.paramName

// Example with params "min" and "max":
const min = params.min || 1;
const max = params.max || 100;

// Your code here
const result = Math.floor(Math.random() * (max - min + 1)) + min;

// MUST use return - success/error wrapped automatically
return {
    randomNumber: result
};`;
      }
    },
  },
  methods: {
    handleInput(value) {
      // Don't emit if it's just the placeholder
      if (value !== this.placeholder) {
        this.$emit('update:modelValue', value);
      }
    },
  },
};
</script>

<style scoped>
.code-editor-container {
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color, #3a3a3a);
  width: calc(100% - 2px);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-darker-0, #2a2a2a);
  border-bottom: 1px solid var(--terminal-border-color, #3a3a3a);
}

.editor-title {
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-title i {
  font-size: 16px;
  color: var(--color-primary);
}

.editor-info {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--color-med-navy, #b0b0b0);
}

.line-count {
  padding: 4px 8px;
  background: var(--color-darker-0, #1e1e1e);
  border-radius: 4px;
}

.editor-footer {
  padding: 12px 16px;
  background: var(--color-darker-0, #2a2a2a);
  border-top: 1px solid var(--terminal-border-color, #3a3a3a);
}

.editor-hints {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.hint {
  font-size: 12px;
  color: var(--color-med-navy, #b0b0b0);
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint i {
  color: var(--color-green, #4a9eff);
}

/* CodeMirror specific styles */
:deep(.cm-editor) {
  height: 100%;
  width: 100%;
  font-family: var(--font-family-mono);
  font-size: 14px;
}

:deep(.cm-scroller) {
  overflow: auto;
}

/* Dark mode adjustments */
body.dark .code-editor-container {
  /* background: var(--color-darker-0); */
  border-color: var(--terminal-border-color);
}

body.dark .editor-header,
body.dark .editor-footer {
  background: var(--color-darker-0);
  border-color: var(--terminal-border-color);
}
</style>

<style>
/* Global CodeMirror styles matching PanelTab.vue */
.code-editor-container .cm-editor {
  background: var(--color-darker-1) !important;
  color: var(--color-text);
  border: none;
  border-radius: 0;
  font-weight: 300;
  cursor: text;
}

.ͼo .cm-gutters {
  background-color: transparent;
  color: var(--color-light-navy);
  margin-left: 4px;
  border: none;
}

.ͼ1 .cm-foldGutter span {
  opacity: 0;
}

.cm-content {
  margin-left: -6px !important;
  padding: 12px 6px !important;
  padding-left: 0 !important;
}

.ͼo .cm-cursor,
.ͼo .cm-dropCursor {
  border-left-color: var(--color-primary) !important;
}

.cm-activeLine .cm-line {
  caret-color: var(--color-primary) !important;
}

.cm-focused {
  border: 2px solid var(--color-primary) !important;
}

.cm-activeLine {
  background: transparent !important;
  border-left-color: var(--color-primary) !important;
}

.cm-content {
  color: var(--color-primary);
  font-weight: 600;
}

.ͼt {
  color: var(--color-dull-white);
  font-weight: 300;
}

.ͼp {
  color: var(--color-blue);
  font-weight: 300;
}

.ͼq {
  color: var(--color-dull-white);
  font-weight: 300;
}

.ͼr {
  color: #ffd97d;
  font-weight: 300;
}

.ͼ13 {
  color: var(--color-primary);
  font-weight: 600;
}

.ͼu {
  color: var(--color-green);
  font-weight: 300;
}

.ͼv {
  color: var(--color-dull-white);
}

.ͼw {
  color: #7d8799;
  opacity: 0.85;
}

.ͼo .cm-gutters {
  color: #3e405a85;
}

.ͼo .cm-activeLineGutter {
  background-color: #3e405a50;
}

.ͼo.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,
.ͼo .cm-selectionBackground,
.ͼo .cm-content ::selection {
  background-color: #3e405a50;
}

body.dark .ͼo .cm-activeLineGutter {
  background-color: var(--color-dark-navy) !important;
}

body.dark .ͼo.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,
body.dark .ͼo .cm-selectionBackground,
body.dark .ͼo .cm-content ::selection {
  background-color: var(--color-lighter-0) !important;
}

body.dark .ͼo.cm-focused .cm-matchingBracket,
body.dark .ͼo.cm-focused .cm-nonmatchingBracket {
  background-color: var(--color-dull-navy) !important;
}
</style>
