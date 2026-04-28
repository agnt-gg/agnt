// useWorkflowChatContext — page-state capture for the Workflow Forge panel.
// Pulls live workflow state from the canvas Vuex slice, with localStorage as
// a fallback (matching the legacy WorkflowChatContainer behavior).

import { computed, toValue } from 'vue';
import { useStore } from 'vuex';

export function useWorkflowChatContext({ workflowId, nodes, edges } = {}) {
  const store = useStore();
  const channelKey = computed(() => `workflow:${toValue(workflowId) || 'default'}`);
  const pageContext = computed(() => ({ workflowId: toValue(workflowId) }));

  const pageState = computed(() => {
    const id = toValue(workflowId);
    let workflowState = null;

    const cached = store.getters['canvas/canvasState'];
    if (cached && cached.id === id) {
      workflowState = cached;
    } else {
      try {
        const raw = localStorage.getItem('canvasState');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.id === id) workflowState = parsed;
        }
      } catch { /* ignore */ }
    }

    if (!workflowState) {
      workflowState = {
        id,
        nodes: toValue(nodes) || [],
        edges: toValue(edges) || [],
      };
    }

    return {
      workflowContext: { id },
      workflowState,
    };
  });

  const onFrontendEvent = (eventType, eventData) => {
    if (!eventType) return;
    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType, eventData } }));
  };

  return {
    channelKey,
    chatType: 'workflow',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
