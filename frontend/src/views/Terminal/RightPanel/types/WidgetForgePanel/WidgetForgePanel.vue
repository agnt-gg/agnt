<template>
  <div class="widget-forge-right-panel">
    <!-- Panel tabs -->
    <div class="panel-tabs">
      <button class="tab-btn" :class="{ active: forge.activePanel.value === 'template' }" @click="forge.activePanel.value = 'template'">
        <i class="fas fa-th-large"></i> Templates
      </button>
      <button class="tab-btn" :class="{ active: forge.activePanel.value === 'code' }" @click="forge.activePanel.value = 'code'">
        <i class="fas fa-code"></i> Code
      </button>
      <button class="tab-btn" :class="{ active: forge.activePanel.value === 'config' }" @click="forge.activePanel.value = 'config'">
        <i class="fas fa-sliders-h"></i> Config
      </button>
    </div>

    <div class="panel-content">
      <!-- Templates list -->
      <div v-if="forge.activePanel.value === 'template'" class="forge-templates">
        <div
          v-for="tmpl in forge.filteredTemplates.value"
          :key="tmpl.id"
          class="tmpl-card"
          :class="{ active: forge.selectedTemplate.value === tmpl.id }"
          @click="forge.selectTemplate(tmpl)"
        >
          <div class="tmpl-icon"><i :class="tmpl.icon"></i></div>
          <div class="tmpl-name">{{ tmpl.name }}</div>
        </div>
      </div>

      <!-- Code editor -->
      <div v-if="forge.activePanel.value === 'code'" class="forge-code">
        <div class="section-title">
          SOURCE CODE
          <span class="type-badge">{{ forge.form.widget_type.toUpperCase() }}</span>
          <span class="line-count">{{ lineCount }} lines</span>
          <button class="format-btn" title="Format Code (Shift+Alt+F)" @click="formatCode">
            <i class="fas fa-magic"></i> Format
          </button>
        </div>
        <div class="codemirror-wrapper">
          <codemirror
            :model-value="forge.form.source_code"
            :style="{ height: '100%', width: '100%' }"
            :indent-with-tab="true"
            :tab-size="2"
            :extensions="extensions"
            placeholder="Enter HTML, CSS, and JavaScript code for your widget..."
            @update:model-value="handleCodeChange"
          />
        </div>
      </div>

      <!-- Config form -->
      <div v-if="forge.activePanel.value === 'config'" class="forge-config">
        <div class="config-form">
          <label class="field">
            <span class="field-label">Name</span>
            <input v-model="forge.form.name" type="text" placeholder="Widget name" />
          </label>
          <label class="field">
            <span class="field-label">Description</span>
            <input v-model="forge.form.description" type="text" placeholder="Short description" />
          </label>
          <div class="field">
            <span class="field-label">Icon</span>
            <div class="icon-grid">
              <button
                v-for="ico in forge.WIDGET_ICONS"
                :key="ico"
                type="button"
                class="icon-btn"
                :class="{ active: forge.form.icon === ico }"
                @click="forge.form.icon = ico"
              >
                <i :class="ico"></i>
              </button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">Category</span>
            <CustomSelect
              ref="categorySelect"
              :options="categoryOptions"
              placeholder="Select category"
              @option-selected="forge.form.category = $event.value"
            />
          </div>
          <div class="field">
            <span class="field-label">Widget Type</span>
            <CustomSelect
              ref="widgetTypeSelect"
              :options="widgetTypeOptions"
              placeholder="Select widget type"
              @option-selected="forge.form.widget_type = $event.value"
            />
          </div>
          <div class="field-row">
            <label class="field half">
              <span class="field-label">Default Columns</span>
              <input v-model.number="forge.form.default_size.cols" type="number" min="1" max="12" />
            </label>
            <label class="field half">
              <span class="field-label">Default Rows</span>
              <input v-model.number="forge.form.default_size.rows" type="number" min="1" max="8" />
            </label>
          </div>
          <div class="field-row">
            <label class="field half">
              <span class="field-label">Min Columns</span>
              <input v-model.number="forge.form.min_size.cols" type="number" min="1" max="12" />
            </label>
            <label class="field half">
              <span class="field-label">Min Rows</span>
              <input v-model.number="forge.form.min_size.rows" type="number" min="1" max="8" />
            </label>
          </div>

          <label class="field toggle-field">
            <span class="field-label">Use Theme Styles</span>
            <div class="toggle-row">
              <button
                type="button"
                class="toggle-switch"
                :class="{ active: forge.form.useThemeStyles }"
                @click="forge.form.useThemeStyles = !forge.form.useThemeStyles"
              >
                <span class="toggle-knob"></span>
              </button>
              <span class="toggle-desc">{{ forge.form.useThemeStyles ? 'Uses --color-text, --color-primary, etc.' : 'Standalone styling (no theme vars)' }}</span>
            </div>
          </label>

          <!-- Template-specific config (JSON) -->
          <label v-if="forge.form.widget_type === 'template'" class="field">
            <span class="field-label">Template Config (JSON)</span>
            <textarea
              v-model="forge.configJson.value"
              class="config-json"
              rows="6"
              placeholder='{"template_id":"metric-card","label":"Users","value":"1,234"}'
              spellcheck="false"
            ></textarea>
          </label>

          <!-- iframe URL -->
          <label v-if="forge.form.widget_type === 'iframe'" class="field">
            <span class="field-label">External URL</span>
            <input v-model="forge.form.config.url" type="url" placeholder="https://example.com" />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject, computed, watch, ref, onMounted, nextTick } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { html_beautify } from 'js-beautify';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';

const beautifyOpts = {
  indent_size: 2,
  indent_char: ' ',
  max_preserve_newlines: 2,
  preserve_newlines: true,
  indent_inner_html: true,
  wrap_line_length: 120,
  wrap_attributes: 'auto',
  end_with_newline: true,
};

function beautifyHtml(code) {
  if (!code || !code.trim()) return code;
  return html_beautify(code, beautifyOpts);
}

/** Detects minified HTML: single line or very low newline ratio */
function looksMinified(code) {
  if (!code || code.length < 80) return false;
  const lines = code.split('\n').length;
  // If it's mostly one giant line, it's minified
  if (lines <= 3 && code.length > 200) return true;
  // If avg line length is absurdly long
  if (code.length / lines > 500) return true;
  return false;
}

export default {
  name: 'WidgetForgeRightPanel',
  components: { Codemirror, CustomSelect },
  emits: ['panel-action'],
  setup() {
    const forge = inject('widgetForge');

    const categorySelect = ref(null);
    const widgetTypeSelect = ref(null);

    const categoryOptions = [
      { label: 'Custom', value: 'custom' },
      { label: 'Dashboard', value: 'dashboard' },
      { label: 'Home', value: 'home' },
      { label: 'Assets', value: 'assets' },
      { label: 'System', value: 'system' },
    ];

    const widgetTypeOptions = [
      { label: 'HTML (Sandboxed iframe)', value: 'html' },
      { label: 'Template (Pre-built)', value: 'template' },
      { label: 'External URL (iframe)', value: 'iframe' },
      { label: 'Markdown', value: 'markdown' },
    ];

    // Sync CustomSelect display when form values change (e.g. from AI generation)
    const syncSelects = () => {
      nextTick(() => {
        if (categorySelect.value) {
          const cat = categoryOptions.find((o) => o.value === forge.form.category);
          if (cat) categorySelect.value.setSelectedOption(cat);
        }
        if (widgetTypeSelect.value) {
          const wt = widgetTypeOptions.find((o) => o.value === forge.form.widget_type);
          if (wt) widgetTypeSelect.value.setSelectedOption(wt);
        }
      });
    };

    onMounted(syncSelects);
    watch(() => forge.form.category, syncSelects);
    watch(() => forge.form.widget_type, syncSelects);

    // Keyboard shortcut: Shift+Alt+F to format
    const formatKeymap = keymap.of([
      {
        key: 'Shift-Alt-f',
        run: () => {
          forge.form.source_code = beautifyHtml(forge.form.source_code);
          return true;
        },
      },
    ]);

    // Paste handler: auto-format pasted content if it looks minified
    const pasteHandler = EditorView.domEventHandlers({
      paste: (event, view) => {
        const pasted = event.clipboardData?.getData('text/plain');
        if (pasted && looksMinified(pasted)) {
          event.preventDefault();
          const formatted = beautifyHtml(pasted);
          // Replace entire doc content if editor is empty, otherwise insert at cursor
          const currentContent = view.state.doc.toString();
          if (!currentContent.trim()) {
            forge.form.source_code = formatted;
          } else {
            // Insert formatted text at cursor position
            const cursor = view.state.selection.main.head;
            view.dispatch({
              changes: { from: cursor, insert: formatted },
            });
            forge.form.source_code = view.state.doc.toString();
          }
        }
      },
    });

    const extensions = [html(), oneDark, EditorView.lineWrapping, formatKeymap, pasteHandler];

    const lineCount = computed(() => {
      return (forge.form.source_code || '').split('\n').length;
    });

    const handleCodeChange = (value) => {
      forge.form.source_code = value;
    };

    const formatCode = () => {
      forge.form.source_code = beautifyHtml(forge.form.source_code);
    };

    // Auto-format when source_code is set externally (e.g. from AI) and looks minified
    watch(
      () => forge.form.source_code,
      (newVal, oldVal) => {
        // Only auto-format if it's a big change (likely from AI, not user typing)
        if (newVal && oldVal !== newVal && looksMinified(newVal)) {
          const formatted = beautifyHtml(newVal);
          if (formatted !== newVal) {
            forge.form.source_code = formatted;
          }
        }
      }
    );

    return { forge, extensions, lineCount, handleCodeChange, formatCode, categorySelect, widgetTypeSelect, categoryOptions, widgetTypeOptions };
  },
};
</script>

<style scoped>
.widget-forge-right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

/* ── Tabs ── */
.panel-tabs {
  display: flex;
  gap: 2px;
  padding: 0 0 8px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.tab-btn:hover {
  color: var(--color-text);
}

.tab-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

/* ── Content ── */
.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
  min-height: 0;
}

.panel-content::-webkit-scrollbar {
  display: none;
}

/* ── Templates ── */
.forge-templates {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

.tmpl-card {
  padding: 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.tmpl-card:hover {
  border-color: rgba(var(--green-rgb), 0.25);
  background: var(--color-darker-1);
}

.tmpl-card.active {
  border-color: rgba(var(--green-rgb), 0.35);
  background: rgba(var(--green-rgb), 0.04);
}

.tmpl-icon {
  font-size: 14px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.tmpl-card.active .tmpl-icon {
  color: var(--color-green);
}

.tmpl-name {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text);
  font-weight: 600;
}

/* ── Code editor ── */
.forge-code {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.section-title {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--color-text-muted);
  padding: 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.type-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
  letter-spacing: 0.5px;
}

.line-count {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--color-darker-0);
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
  margin-left: auto;
}

.format-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 3px;
  background: rgba(var(--green-rgb), 0.06);
  color: var(--color-green);
  font-size: 9px;
  letter-spacing: 0.5px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
  flex-shrink: 0;
}

.format-btn:hover {
  background: rgba(var(--green-rgb), 0.12);
  border-color: rgba(var(--green-rgb), 0.35);
}

.codemirror-wrapper {
  flex: 1;
  min-height: 200px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  overflow: hidden;
}

/* ── Config form ── */
.forge-config {
  padding: 8px 0;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-label {
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 600;
}

.field input {
  padding: 6px 10px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.field input:focus {
  border-color: rgba(var(--green-rgb), 0.3);
}

.field-row {
  display: flex;
  gap: 8px;
}

.half {
  flex: 1;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
}

.icon-btn {
  aspect-ratio: 1;
  background: none;
  border: 1px solid var(--terminal-border-color);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  padding: 0;
}

.icon-btn:hover {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
}

.icon-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.08);
}

.config-json {
  width: 100%;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 8px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.config-json:focus {
  border-color: rgba(var(--green-rgb), 0.3);
}

.toggle-field {
  gap: 5px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-1);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s;
}

.toggle-switch.active {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.4);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-text-muted);
  transition: all 0.2s;
}

.toggle-switch.active .toggle-knob {
  left: 16px;
  background: var(--color-green);
}

.toggle-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  letter-spacing: 0.3px;
}
</style>

<style>
/* CodeMirror theme overrides for widget code editor */
.widget-forge-right-panel .cm-editor {
  background: var(--color-darker-1) !important;
  color: var(--color-text);
  border: none;
  font-size: 12px;
}

.widget-forge-right-panel .cm-editor.cm-focused {
  outline: none;
  border: none !important;
}

.widget-forge-right-panel .cm-scroller {
  overflow: auto;
}
</style>
