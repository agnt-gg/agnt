// useToolChatContext — page-state capture for the Tool Forge panel.
// Replaces the per-container DOM scrape of `#template-form` / `#template-name`
// / `#template-instructions` with a small reactive composable.

import { computed, toValue } from 'vue';

export function useToolChatContext({ toolId, tools, customTools } = {}) {
  const channelKey = computed(() => `tool:${toValue(toolId) || 'default'}`);
  const pageContext = computed(() => ({ toolId: toValue(toolId) || 'default' }));

  const pageState = computed(() => {
    const id = toValue(toolId) || 'default';
    const state = {
      toolState: {
        id,
        tools: toValue(tools) || [],
        customTools: toValue(customTools) || [],
      },
      toolContext: { id },
    };

    // Best-effort backwards compatibility — if the legacy ToolForge form is on
    // the page, capture the same fields the old container scraped.
    try {
      if (typeof document !== 'undefined' && document.querySelector('#template-form')) {
        state.toolState.currentTool = {
          title: document.querySelector('#template-name')?.value || '',
          instructions: document.querySelector('#template-instructions')?.value || '',
        };
      }
    } catch { /* SSR / detached env — skip */ }

    return state;
  });

  // Tool Forge ships its own widget-style frontend events for things like
  // tool-field updates; the panel-level container handles those directly.
  const onFrontendEvent = (eventType, eventData) => {
    if (!eventType) return;
    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType, eventData } }));
  };

  return {
    channelKey,
    chatType: 'tool',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
