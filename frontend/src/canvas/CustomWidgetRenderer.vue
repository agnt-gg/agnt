<template>
  <div class="cwr-root" :class="['cwr-type-' + widgetType]">
    <!-- External URL iframe -->
    <iframe
      v-if="widgetType === 'iframe'"
      class="cwr-iframe"
      :src="config.url || ''"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      frameborder="0"
      loading="eager"
      @load="onIframeLoad"
    ></iframe>

    <!-- HTML widget: sandboxed iframe with srcdoc -->
    <iframe
      v-else-if="widgetType === 'html'"
      class="cwr-iframe"
      :srcdoc="renderedSource"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      frameborder="0"
      loading="eager"
      @load="onIframeLoad"
    ></iframe>

    <!-- Markdown widget -->
    <div v-else-if="widgetType === 'markdown'" class="cwr-markdown" v-html="renderedMarkdown"></div>

    <!-- Template widget -->
    <component
      v-else-if="widgetType === 'template'"
      :is="templateComponent"
      v-bind="templateProps"
    />

    <!-- Fallback / error -->
    <div v-else class="cwr-fallback">
      <div class="cwr-fallback-icon"><i class="fas fa-puzzle-piece"></i></div>
      <div class="cwr-fallback-text">{{ definition?.name || 'Custom Widget' }}</div>
      <div class="cwr-fallback-hint">Widget type "{{ widgetType }}" not supported</div>
    </div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="cwr-loading">
      <div class="cwr-spinner"></div>
    </div>

    <!-- Error overlay -->
    <div v-if="error" class="cwr-error">
      <i class="fas fa-exclamation-triangle"></i>
      <span>{{ error }}</span>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue';
import MetricCardTemplate from './templates/MetricCardTemplate.vue';
import ChartWidgetTemplate from './templates/ChartWidgetTemplate.vue';
import DataTableTemplate from './templates/DataTableTemplate.vue';
import CountdownTemplate from './templates/CountdownTemplate.vue';
import LiveFeedTemplate from './templates/LiveFeedTemplate.vue';
import MarkdownNoteTemplate from './templates/MarkdownNoteTemplate.vue';

const TEMPLATE_MAP = {
  'metric-card': MetricCardTemplate,
  'chart-widget': ChartWidgetTemplate,
  'data-table': DataTableTemplate,
  'countdown': CountdownTemplate,
  'live-feed': LiveFeedTemplate,
  'markdown-note': MarkdownNoteTemplate,
};

export default {
  name: 'CustomWidgetRenderer',
  props: {
    definition: { type: Object, required: true },
    widgetInstanceId: { type: String, default: '' },
  },
  setup(props) {
    const isLoading = ref(true);
    const error = ref(null);
    let refreshTimer = null;

    const widgetType = computed(() => props.definition?.widget_type || 'html');
    const config = computed(() => props.definition?.config || {});
    const sourceCode = computed(() => props.definition?.source_code || '');

    // ── HTML rendering ──
    // Build theme CSS to inject into widget iframes so all theme variables are available
    const themeStyleTag = computed(() => {
      // Grab computed CSS variables from the document root (respects active theme)
      const rootStyle = getComputedStyle(document.documentElement);
      const get = (name) => rootStyle.getPropertyValue(name).trim();

      return `<style id="agnt-theme">
:root {
  /* Accent colors */
  --color-red: ${get('--color-red') || '#fe4e4e'};
  --color-orange: ${get('--color-orange') || '#ff9500'};
  --color-yellow: ${get('--color-yellow') || '#ffd700'};
  --color-green: ${get('--color-green') || '#19ef83'};
  --color-blue: ${get('--color-blue') || '#12e0ff'};
  --color-indigo: ${get('--color-indigo') || '#7d3de5'};
  --color-violet: ${get('--color-violet') || '#d13de5'};
  --color-pink: ${get('--color-pink') || '#e53d8f'};

  /* Semantic colors */
  --color-primary: ${get('--color-primary') || '#19ef83'};
  --color-secondary: ${get('--color-secondary') || '#12e0ff'};
  --color-background: ${get('--color-background') || '#10101f'};
  --color-text: ${get('--color-text') || '#f7f7f7'};
  --color-text-muted: ${get('--color-text-muted') || '#7f8193'};
  --color-text-secondary: ${get('--color-text-secondary') || '#7f8193'};
  --color-text-dull: ${get('--color-text-dull') || '#1f1f2f'};

  /* Surface colors */
  --color-darker-0: ${get('--color-darker-0') || 'rgba(0,0,0,0.1)'};
  --color-darker-1: ${get('--color-darker-1') || 'rgba(0,0,0,0.2)'};
  --color-darker-2: ${get('--color-darker-2') || 'rgba(0,0,0,0.4)'};
  --color-darker-3: ${get('--color-darker-3') || 'rgba(0,0,0,0.8)'};

  /* Borders */
  --terminal-border-color: ${get('--terminal-border-color') || '#1f1f2f'};
  --terminal-border-color-light: ${get('--terminal-border-color-light') || '#26263a'};

  /* RGB components */
  --primary-rgb: ${get('--primary-rgb') || '25, 239, 131'};
  --green-rgb: ${get('--green-rgb') || '25, 239, 131'};
  --blue-rgb: ${get('--blue-rgb') || '18, 224, 255'};
  --pink-rgb: ${get('--pink-rgb') || '229, 61, 143'};
  --red-rgb: ${get('--red-rgb') || '254, 78, 78'};
  --yellow-rgb: ${get('--yellow-rgb') || '255, 215, 0'};
  --indigo-rgb: ${get('--indigo-rgb') || '125, 61, 229'};

  /* Typography */
  --base-font-size: 16px;
  --font-size-xs: calc(var(--base-font-size) * 0.75);
  --font-size-sm: calc(var(--base-font-size) * 0.875);
  --font-size-md: var(--base-font-size);
  --font-size-lg: calc(var(--base-font-size) * 1.125);
  --font-size-xl: calc(var(--base-font-size) * 1.25);
  --font-size-xxl: calc(var(--base-font-size) * 1.5);
  --font-size-xxxl: calc(var(--base-font-size) * 2);
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-xxs: 2px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-xxl: 48px;

  /* Border radius */
  --border-radius-xs: 2px;
  --border-radius-sm: 4px;
  --border-radius-md: 8px;
  --border-radius-lg: 16px;
  --border-radius-xl: 24px;
  --border-radius-full: 50%;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);

  /* Transitions */
  --transition-fast: 150ms ease-in-out;
  --transition-medium: 300ms ease-in-out;
  --transition-slow: 500ms ease-in-out;
}
</style>`;
    });

    const renderedSource = computed(() => {
      const html = sourceCode.value || '';
      const theme = themeStyleTag.value;

      if (html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
        // Inject theme vars into existing <head> (or after <html> if no <head>)
        if (/<head[^>]*>/i.test(html)) {
          return html.replace(/<head([^>]*)>/i, `<head$1>${theme}`);
        }
        return html.replace(/<html([^>]*)>/i, `<html$1><head>${theme}</head>`);
      }
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${theme}</head><body>${html}</body></html>`;
    });

    // ── Markdown rendering (basic) ──
    const renderedMarkdown = computed(() => {
      const md = sourceCode.value || '';
      // Very basic markdown → HTML conversion
      return md
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');
    });

    // ── Template rendering ──
    const templateComponent = computed(() => {
      const templateId = config.value.template_id || '';
      const comp = TEMPLATE_MAP[templateId];
      return comp ? markRaw(comp) : null;
    });

    const templateProps = computed(() => ({
      config: config.value,
      definition: props.definition,
    }));

    function onIframeLoad() {
      isLoading.value = false;
    }

    // Auto-refresh
    function setupAutoRefresh() {
      clearAutoRefresh();
      const interval = config.value.refresh_interval;
      if (interval && interval > 0) {
        refreshTimer = setInterval(() => {
          // Force iframe reload by toggling key
          isLoading.value = true;
          setTimeout(() => (isLoading.value = false), 100);
        }, interval * 1000);
      }
    }

    function clearAutoRefresh() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    onMounted(() => {
      // Only show loading for iframe-based widgets
      if (widgetType.value !== 'html' && widgetType.value !== 'iframe') {
        isLoading.value = false;
      }
      setupAutoRefresh();
    });

    onBeforeUnmount(() => {
      clearAutoRefresh();
    });

    // Show spinner when iframe source changes
    watch(renderedSource, () => {
      if (widgetType.value === 'html' || widgetType.value === 'iframe') {
        isLoading.value = true;
      }
    });

    watch(() => config.value.refresh_interval, setupAutoRefresh);

    return {
      isLoading,
      error,
      widgetType,
      config,
      renderedSource,
      renderedMarkdown,
      templateComponent,
      templateProps,
      onIframeLoad,
    };
  },
};
</script>

<style scoped>
.cwr-root {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--color-background);
}

.cwr-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}

.cwr-markdown {
  padding: 12px;
  font-size: 13px;
  color: var(--color-light-0, #c8c8d4);
  line-height: 1.6;
  overflow-y: auto;
  height: 100%;
}

.cwr-markdown h1 { font-size: 18px; color: var(--color-green); margin-bottom: 8px; }
.cwr-markdown h2 { font-size: 15px; color: var(--color-green); margin-bottom: 6px; }
.cwr-markdown h3 { font-size: 13px; color: var(--color-green); margin-bottom: 4px; }
.cwr-markdown code {
  background: rgba(255,255,255,0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.cwr-markdown strong { color: var(--color-light-0, #eee); }

.cwr-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
}

.cwr-fallback-icon {
  font-size: 28px;
  color: var(--color-text-muted, #334);
  opacity: 0.4;
}

.cwr-fallback-text {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
}

.cwr-fallback-hint {
  font-size: 10px;
  color: var(--color-text-muted, #334);
}

.cwr-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  z-index: 5;
}

.cwr-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: var(--color-green);
  border-radius: 50%;
  animation: cwr-spin 0.6s linear infinite;
}

@keyframes cwr-spin {
  to { transform: rotate(360deg); }
}

.cwr-error {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6px 10px;
  background: rgba(var(--red-rgb), 0.1);
  color: var(--color-red);
  font-size: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 5;
}
</style>
