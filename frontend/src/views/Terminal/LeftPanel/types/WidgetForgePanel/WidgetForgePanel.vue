<template>
  <div class="widget-forge-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Widget Forge</h2>
    </div>

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
        </div>
        <textarea
          v-model="forge.form.source_code"
          class="code-editor"
          placeholder="Enter HTML, CSS, and JavaScript code for your widget..."
          spellcheck="false"
        ></textarea>
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
          <label class="field">
            <span class="field-label">Category</span>
            <select v-model="forge.form.category">
              <option value="custom">Custom</option>
              <option value="dashboard">Dashboard</option>
              <option value="home">Home</option>
              <option value="assets">Assets</option>
              <option value="system">System</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Widget Type</span>
            <select v-model="forge.form.widget_type">
              <option value="html">HTML (Sandboxed iframe)</option>
              <option value="template">Template (Pre-built)</option>
              <option value="iframe">External URL (iframe)</option>
              <option value="markdown">Markdown</option>
            </select>
          </label>
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
import { inject } from 'vue';

export default {
  name: 'WidgetForgePanel',
  emits: ['panel-action'],
  setup() {
    const forge = inject('widgetForge');
    return { forge };
  },
};
</script>

<style scoped>
.widget-forge-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

/* ── Tabs ── */
.panel-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 0;
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
  color: var(--color-text-muted, #556);
  font-size: 10px;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.tab-btn:hover {
  color: var(--color-light-0, #aab);
}

.tab-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

/* ── Content ── */
.panel-content {
  flex: 1;
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
  background: rgba(255, 255, 255, 0.02);
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
  background: rgba(255, 255, 255, 0.03);
}

.tmpl-card.active {
  border-color: rgba(var(--green-rgb), 0.35);
  background: rgba(var(--green-rgb), 0.04);
}

.tmpl-icon {
  font-size: 14px;
  color: var(--color-text-muted, #556);
  flex-shrink: 0;
}

.tmpl-card.active .tmpl-icon {
  color: var(--color-green);
}

.tmpl-name {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-light-0, #aab);
  font-weight: 600;
}

/* ── Code editor ── */
.forge-code {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.section-title {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--color-text-muted, #556);
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

.code-editor {
  flex: 1;
  background: var(--color-darker-1, #050510);
  color: var(--color-light-0, #c8c8d4);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
  resize: none;
  outline: none;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
  min-height: 200px;
}

.code-editor:focus {
  border-color: rgba(var(--green-rgb), 0.3);
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
  color: var(--color-text-muted, #556);
  font-weight: 600;
}

.field input,
.field select {
  padding: 6px 10px;
  background: var(--color-darker-1, #050510);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-light-0, #aab);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: rgba(var(--green-rgb), 0.3);
}

.field select {
  cursor: pointer;
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
  color: var(--color-text-muted, #556);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  padding: 0;
}

.icon-btn:hover {
  color: var(--color-light-0, #aab);
  border-color: rgba(255, 255, 255, 0.1);
}

.icon-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.08);
}

.config-json {
  width: 100%;
  background: var(--color-darker-1, #050510);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-light-0, #aab);
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
</style>
