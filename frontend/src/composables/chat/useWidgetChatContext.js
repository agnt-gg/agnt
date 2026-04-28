// useWidgetChatContext — page-state capture for the Widget Forge panel.
// Reads the live widget form from the `widgetForge` provide/inject hook used
// by the existing WidgetForge editor. Falls back to the bare widgetId only.

import { computed, inject, toValue } from 'vue';

export function useWidgetChatContext({ widgetId } = {}) {
  const forge = inject('widgetForge', null);

  const channelKey = computed(() => `widget:${toValue(widgetId) || forge?.widgetId?.value || 'widget-forge'}`);
  const pageContext = computed(() => ({
    widgetId: toValue(widgetId) || forge?.widgetId?.value || 'widget-forge',
  }));

  const pageState = computed(() => {
    const id = toValue(widgetId) || forge?.widgetId?.value || 'widget-forge';
    const widgetState = { id };
    if (forge?.form) {
      widgetState.name = forge.form.name || '';
      widgetState.description = forge.form.description || '';
      widgetState.icon = forge.form.icon || '';
      widgetState.category = forge.form.category || '';
      widgetState.widget_type = forge.form.widget_type || 'html';
      widgetState.source_code = forge.form.source_code || '';
      widgetState.config = forge.form.config || {};
      widgetState.default_size = forge.form.default_size || { cols: 4, rows: 3 };
      widgetState.min_size = forge.form.min_size || { cols: 2, rows: 2 };
      widgetState.useThemeStyles = forge.form.useThemeStyles !== false;
    }
    return {
      widgetContext: { id },
      widgetState,
    };
  });

  // Widget chat dispatches a CustomEvent so the WidgetForge editor can react
  // to backend-issued `widget-field-updated`, `widget-saved`, `widget-loaded`,
  // and `widget-stream-done` events. The legacy container did this manually;
  // we keep the contract unchanged so the editor doesn't need to migrate.
  const onFrontendEvent = (eventType, eventData, toolCall) => {
    if (!eventType) return;
    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType, eventData } }));

    if (toolCall && toolCall.name === 'save_widget' && eventType === 'tool-completed') {
      let toolResult = toolCall.result;
      if (typeof toolResult === 'string') {
        try { toolResult = JSON.parse(toolResult); } catch { /* not JSON */ }
      }
      if (toolResult?.success) {
        window.dispatchEvent(new CustomEvent('widget-saved', { detail: toolResult }));
      }
    }
    if (toolCall && toolCall.name === 'load_widget' && eventType === 'tool-completed') {
      let toolResult = toolCall.result;
      if (typeof toolResult === 'string') {
        try { toolResult = JSON.parse(toolResult); } catch { /* not JSON */ }
      }
      if (toolResult?.success) {
        window.dispatchEvent(new CustomEvent('widget-loaded', { detail: toolResult.widgetData }));
      }
    }
  };

  return {
    channelKey,
    chatType: 'widget',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
