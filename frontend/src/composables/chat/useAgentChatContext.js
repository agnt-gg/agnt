// useAgentChatContext — page-state capture for the AgentForge panel.
// Replaces the per-container DOM scrape of `#agent-form` / `#agent-name`
// / `#agent-description` / `#agent-instructions` with a small composable.

import { computed, toValue } from 'vue';

export function useAgentChatContext({ agentId, agents, customAgents } = {}) {
  // 'agent-chat' is the AgentForge editing mode (full registry, Annie persona).
  // Anything else is "chat with this saved agent" (assignedTools filter applies on backend).
  const resolvedId = computed(() => toValue(agentId) || 'agent-chat');
  const channelKey = computed(() => `agent:${resolvedId.value}`);

  const pageContext = computed(() => ({ agentId: resolvedId.value }));

  const pageState = computed(() => {
    const state = {
      agentContext: { id: resolvedId.value },
      agentState: {
        id: resolvedId.value,
        agents: toValue(agents) || [],
        customAgents: toValue(customAgents) || [],
      },
    };

    try {
      if (typeof document !== 'undefined' && document.querySelector('#agent-form')) {
        state.agentState.currentAgent = {
          name: document.querySelector('#agent-name')?.value || '',
          description: document.querySelector('#agent-description')?.value || '',
          instructions: document.querySelector('#agent-instructions')?.value || '',
        };
      }
    } catch { /* SSR / detached env — skip */ }

    return state;
  });

  const onFrontendEvent = (eventType, eventData) => {
    if (!eventType) return;
    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType, eventData } }));
  };

  return {
    channelKey,
    chatType: 'agent',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
