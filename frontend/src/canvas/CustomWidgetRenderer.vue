<template>
  <div class="cwr-root" :class="['cwr-type-' + widgetType]">
    <!-- HTML widget: sandboxed iframe -->
    <iframe
      v-if="widgetType === 'html' || widgetType === 'iframe'"
      class="cwr-iframe"
      :srcdoc="renderedSource"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      frameborder="0"
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
    const isLoading = ref(false);
    const error = ref(null);
    let refreshTimer = null;

    const widgetType = computed(() => props.definition?.widget_type || 'html');
    const config = computed(() => props.definition?.config || {});
    const sourceCode = computed(() => props.definition?.source_code || '');

    // ── HTML rendering ──
    const renderedSource = computed(() => {
      if (widgetType.value === 'iframe') {
        // External URL - use srcdoc with redirect
        const url = config.value.url || '';
        return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body></body></html>`;
      }

      // HTML widget — user source can contain <style>, <script>, and HTML freely
      const html = sourceCode.value || '';
      const themeVars = `
        <style>
          :root {
            --color-green: #19ef83;
            --color-red: #ff4757;
            --color-yellow: #ffd700;
            --color-blue: #12e0ff;
            --color-purple: #7d3de5;
            --color-pink: #e53d8f;
            --color-background: #0c0c18;
            --color-text: #c8c8d4;
            --color-text-muted: #556;
            --color-border: #1a1a2e;
            --font-family: 'JetBrains Mono', 'Fira Code', monospace;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-family);
            background: var(--color-background);
            color: var(--color-text);
            overflow: auto;
            width: 100%;
            height: 100vh;
          }
        </style>
      `;
      // If user includes their own <html> or <head>, use their source directly with theme prepended
      if (html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
        return html;
      }
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${themeVars}</head><body>${html}</body></html>`;
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
      setupAutoRefresh();
    });

    onBeforeUnmount(() => {
      clearAutoRefresh();
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
