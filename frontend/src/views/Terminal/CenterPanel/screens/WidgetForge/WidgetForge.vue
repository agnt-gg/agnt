<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="WidgetForgePanel"
    activeRightPanel="WidgetForgePanel"
    screenId="WidgetForgeScreen"
    :showInput="false"
    @screen-change="(screenName) => $emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
  >
    <template #default>
      <div class="wf-root">
        <!-- Top toolbar -->
        <div class="wf-toolbar">
          <button class="wf-back" @click="goBack" title="Back to Widget Manager">
            <i class="fas fa-arrow-left"></i>
          </button>
          <span class="wf-toolbar-title">{{ isEditing ? 'EDIT WIDGET' : 'NEW WIDGET' }}</span>

          <div class="wf-toolbar-right">
            <button class="wf-btn wf-btn-save" :class="{ 'wf-saved': saveFlash }" @click="saveWidget" :disabled="!canSave || saveFlash">
              <i :class="saveFlash ? 'fas fa-check' : 'fas fa-save'"></i> {{ saveFlash ? 'Saved!' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Main content: full-width preview -->
        <div class="wf-main">
          <div class="wf-preview-panel">
            <div class="wf-panel-title">
              LIVE PREVIEW
              <span class="wf-preview-size">{{ form.default_size.cols }}×{{ form.default_size.rows }}</span>
            </div>
            <div class="wf-preview-container">
              <div class="wf-preview-frame" :style="previewFrameStyle">
                <div class="wf-preview-header">
                  <i :class="form.icon || 'fas fa-puzzle-piece'"></i>
                  <span>{{ form.name || 'Untitled Widget' }}</span>
                </div>
                <div class="wf-preview-body">
                  <CustomWidgetRenderer v-if="previewDefinition" :definition="previewDefinition" :key="previewKey" />
                  <div v-else class="wf-preview-empty">
                    <i class="fas fa-eye"></i>
                    <span>Preview will appear here</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, watch, onMounted, reactive, provide } from 'vue';
import { useStore } from 'vuex';
import CustomWidgetRenderer from '@/canvas/CustomWidgetRenderer.vue';
import BaseScreen from '../../BaseScreen.vue';

const WIDGET_ICONS = [
  'fas fa-puzzle-piece',
  'fas fa-chart-bar',
  'fas fa-chart-line',
  'fas fa-chart-pie',
  'fas fa-table',
  'fas fa-hashtag',
  'fas fa-clock',
  'fas fa-rss',
  'fas fa-sticky-note',
  'fas fa-code',
  'fas fa-globe',
  'fas fa-database',
  'fas fa-server',
  'fas fa-bolt',
  'fas fa-fire',
  'fas fa-star',
  'fas fa-heart',
  'fas fa-shield-alt',
  'fas fa-rocket',
  'fas fa-brain',
  'fas fa-cube',
  'fas fa-cubes',
  'fas fa-cog',
  'fas fa-wrench',
  'fas fa-terminal',
  'fas fa-palette',
  'fas fa-image',
  'fas fa-video',
  'fas fa-music',
  'fas fa-bell',
  'fas fa-envelope',
  'fas fa-comments',
  'fas fa-users',
  'fas fa-robot',
  'fas fa-atom',
  'fas fa-flask',
  'fas fa-gem',
  'fas fa-crown',
  'fas fa-leaf',
  'fas fa-cloud',
];

const TEMPLATES = [
  {
    id: 'metric-card',
    name: 'Metric Card',
    icon: 'fas fa-hashtag',
    description: 'Display a single metric with optional trend indicator',
    type: 'template',
    defaultConfig: { template_id: 'metric-card', label: 'Metric', value: '1,234', subtext: 'Total count', trend: 12.5 },
  },
  {
    id: 'chart-widget',
    name: 'Chart Widget',
    icon: 'fas fa-chart-bar',
    description: 'Bar chart, progress bars, or list view',
    type: 'template',
    defaultConfig: {
      template_id: 'chart-widget',
      title: 'Chart',
      chart_type: 'bar',
      data: [
        { label: 'A', value: 40 },
        { label: 'B', value: 65 },
        { label: 'C', value: 30 },
      ],
    },
  },
  {
    id: 'data-table',
    name: 'Data Table',
    icon: 'fas fa-table',
    description: 'Tabular data display with scrollable rows',
    type: 'template',
    defaultConfig: {
      template_id: 'data-table',
      title: 'Data Table',
      columns: ['Name', 'Value', 'Status'],
      data: [
        { Name: 'Item 1', Value: '100', Status: 'Active' },
        { Name: 'Item 2', Value: '200', Status: 'Pending' },
      ],
    },
  },
  {
    id: 'countdown',
    name: 'Countdown Timer',
    icon: 'fas fa-clock',
    description: 'Countdown to a specific date/time',
    type: 'template',
    defaultConfig: { template_id: 'countdown', label: 'Launch In', target_date: new Date(Date.now() + 7 * 86400000).toISOString() },
  },
  {
    id: 'live-feed',
    name: 'Live Feed',
    icon: 'fas fa-rss',
    description: 'Scrollable list of items with status dots',
    type: 'template',
    defaultConfig: {
      template_id: 'live-feed',
      title: 'Activity Feed',
      items: [
        { text: 'Agent completed task', time: '2m ago' },
        { text: 'Workflow triggered', time: '5m ago' },
        { text: 'New goal created', time: '12m ago' },
      ],
    },
  },
  {
    id: 'markdown-note',
    name: 'Markdown Note',
    icon: 'fas fa-sticky-note',
    description: 'Static markdown-rendered content',
    type: 'template',
    defaultConfig: {
      template_id: 'markdown-note',
      title: 'Notes',
      content: '# Hello\n\nThis is a **markdown** note widget.\n\n- Item one\n- Item two\n- Item three',
    },
  },
  { id: 'custom-html', name: 'Custom HTML', icon: 'fas fa-code', description: 'Write your own HTML/CSS/JS widget', type: 'html', defaultConfig: {} },
  { id: 'embed', name: 'Embed (iframe)', icon: 'fas fa-globe', description: 'Embed an external webpage', type: 'iframe', defaultConfig: { url: '' } },
];

export default {
  name: 'WidgetForgeScreen',
  components: { BaseScreen, CustomWidgetRenderer },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const activePanel = ref('template');
    const selectedTemplate = ref(null);
    const previewKey = ref(0);
    const activeCategory = ref('all');
    const saveFlash = ref(false);

    // Form state
    const form = reactive({
      name: '',
      description: '',
      icon: 'fas fa-puzzle-piece',
      category: 'custom',
      widget_type: 'html',
      source_code: '',
      config: {},
      default_size: { cols: 4, rows: 3 },
      min_size: { cols: 2, rows: 2 },
    });

    const configJson = ref('{}');

    // Map template types to forge categories for filtering
    const filteredTemplates = computed(() => {
      if (activeCategory.value === 'all' || !activeCategory.value) return TEMPLATES;
      return TEMPLATES.filter((t) => {
        if (activeCategory.value === 'template') return t.type === 'template';
        if (activeCategory.value === 'code') return t.type === 'html';
        if (activeCategory.value === 'embed') return t.type === 'iframe';
        return true;
      });
    });

    const isEditing = computed(() => !!store.getters['widgetDefinitions/activeDefinition']);

    const canSave = computed(() => form.name.trim().length > 0);

    // Load existing definition or reset form — runs on mount AND when activeDefinition changes
    function loadOrResetForm() {
      const existing = store.getters['widgetDefinitions/activeDefinition'];
      if (existing) {
        form.name = existing.name || '';
        form.description = existing.description || '';
        form.icon = existing.icon || 'fas fa-puzzle-piece';
        form.category = existing.category || 'custom';
        form.widget_type = existing.widget_type || 'html';
        form.source_code = existing.source_code || '';
        form.config = existing.config || {};
        form.default_size = existing.default_size || { cols: 4, rows: 3 };
        form.min_size = existing.min_size || { cols: 2, rows: 2 };
        configJson.value = JSON.stringify(existing.config || {}, null, 2);

        if (form.widget_type === 'html' || form.widget_type === 'markdown') {
          activePanel.value = 'code';
        } else {
          activePanel.value = 'config';
        }
      } else {
        form.name = '';
        form.description = '';
        form.icon = 'fas fa-puzzle-piece';
        form.category = 'custom';
        form.widget_type = 'html';
        form.source_code = '';
        form.config = {};
        form.default_size = { cols: 4, rows: 3 };
        form.min_size = { cols: 2, rows: 2 };
        configJson.value = '{}';
        activePanel.value = 'template';
        selectedTemplate.value = null;
        previewKey.value++;
      }
    }

    // React to activeDefinition changes (covers both mount and screen switches)
    watch(
      () => store.getters['widgetDefinitions/activeDefinition'],
      () => loadOrResetForm(),
      { immediate: true },
    );

    onMounted(() => {
      document.body.setAttribute('data-page', 'terminal-widget-forge');
    });

    // Sync configJson ↔ form.config
    watch(configJson, (val) => {
      try {
        form.config = JSON.parse(val);
      } catch {}
    });

    // Preview definition
    const previewDefinition = computed(() => {
      if (!form.name && !form.source_code && !form.config?.template_id) return null;
      return {
        name: form.name || 'Preview',
        widget_type: form.widget_type,
        source_code: form.source_code,
        config: form.config,
      };
    });

    // Debounced preview refresh
    let previewTimer = null;
    watch(
      () => [form.source_code, form.widget_type, JSON.stringify(form.config)],
      () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
          previewKey.value++;
        }, 500);
      },
    );

    const previewFrameStyle = computed(() => {
      // Scale preview to fit
      return {
        aspectRatio: `${form.default_size.cols} / ${form.default_size.rows}`,
      };
    });

    function selectTemplate(tmpl) {
      selectedTemplate.value = tmpl.id;
      form.name = form.name || tmpl.name;
      form.description = form.description || tmpl.description;
      form.widget_type = tmpl.type;

      if (tmpl.type === 'template') {
        form.config = { ...tmpl.defaultConfig };
        configJson.value = JSON.stringify(tmpl.defaultConfig, null, 2);
      } else if (tmpl.type === 'html') {
        form.source_code =
          form.source_code ||
          `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#19ef83;font-size:20px;font-family:monospace;">
  Hello Widget!
</div>`;
        activePanel.value = 'code';
      } else if (tmpl.type === 'iframe') {
        form.config = { url: '' };
        activePanel.value = 'config';
      }

      previewKey.value++;
    }

    // Provide forge state to left panel
    provide('widgetForge', {
      form,
      configJson,
      activePanel,
      selectedTemplate,
      filteredTemplates,
      selectTemplate,
      WIDGET_ICONS,
      TEMPLATES,
    });

    async function saveWidget() {
      if (!canSave.value || saveFlash.value) return;

      const widgetData = {
        name: form.name,
        description: form.description,
        icon: form.icon,
        category: form.category,
        widget_type: form.widget_type,
        source_code: form.source_code,
        config: form.config,
        default_size: form.default_size,
        min_size: form.min_size,
      };

      const existing = store.getters['widgetDefinitions/activeDefinition'];
      if (existing) {
        await store.dispatch('widgetDefinitions/updateDefinition', {
          id: existing.id,
          updates: widgetData,
        });
      } else {
        await store.dispatch('widgetDefinitions/createDefinition', widgetData);
      }

      // Flash "Saved!" then navigate back
      saveFlash.value = true;
      setTimeout(() => {
        saveFlash.value = false;
        store.dispatch('widgetDefinitions/setActiveDefinition', null);
        emit('screen-change', 'WidgetManagerScreen');
      }, 800);
    }

    function goBack() {
      store.dispatch('widgetDefinitions/setActiveDefinition', null);
      emit('screen-change', 'WidgetManagerScreen');
    }

    function handlePanelAction(action, payload) {
      if (action === 'navigate') {
        emit('screen-change', payload);
      } else if (action === 'category-filter-changed' && payload) {
        activeCategory.value = payload.selectedCategory || 'all';
      } else if (action === 'select-template' && payload) {
        // Handle direct template selection (by id)
        if (payload.id) {
          const tmpl = TEMPLATES.find((t) => t.id === payload.id);
          if (tmpl) selectTemplate(tmpl);
        }
        // Handle category selection from the left panel
        if (payload.selectedCategory !== undefined) {
          activeCategory.value = payload.selectedCategory || 'all';
        }
      }
    }

    return {
      previewKey,
      form,
      isEditing,
      canSave,
      saveFlash,
      previewDefinition,
      previewFrameStyle,
      saveWidget,
      goBack,
      handlePanelAction,
    };
  },
};
</script>

<style scoped>
.wf-root {
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Toolbar ── */
.wf-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  width: 100%;
}

.wf-back {
  background: none;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.12s;
}

.wf-back:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
}

.wf-toolbar-title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
}

.wf-toolbar-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.wf-btn-save {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 4px;
  background: rgba(var(--green-rgb), 0.06);
  color: var(--color-green);
  font-size: 10px;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.wf-btn-save:hover {
  background: rgba(var(--green-rgb), 0.12);
}

.wf-btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.wf-btn-save.wf-saved {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  opacity: 1;
}

/* ── Main layout ── */
.wf-main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  width: 100%;
}

.wf-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.wf-panel-title {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--color-text-muted);
  padding: 8px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.wf-preview-size {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
  letter-spacing: 0.5px;
}

/* ── Preview panel ── */
.wf-preview-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: hidden;
}

.wf-preview-frame {
  width: 100%;
  max-height: 100%;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-darker-0);
  min-height: 200px;
}

.wf-preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 10px;
  color: var(--color-text-muted);
  letter-spacing: 1px;
  flex-shrink: 0;
}

.wf-preview-header i {
  font-size: 10px;
}

.wf-preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.wf-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.wf-preview-empty i {
  font-size: 24px;
  opacity: 0.3;
}
</style>
