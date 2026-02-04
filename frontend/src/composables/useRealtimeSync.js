import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { io } from 'socket.io-client';
import { debounce } from 'lodash-es';
import { API_CONFIG } from '../tt.config.js';
import { useStore } from 'vuex';

// Singleton socket instance
let socket = null;
const isConnected = ref(false);
const isAuthenticated = ref(false);

// Debounced fetch functions to prevent cascade of API calls
// When multiple events fire rapidly, only the last one triggers a fetch
let debouncedAgentFetch = null;
let debouncedWorkflowFetch = null;
let debouncedContentFetch = null;

/**
 * Composable for real-time sync via Socket.IO
 * Automatically connects on mount and disconnects on unmount
 *
 * @returns {Object} { isConnected, socket }
 */
export function useRealtimeSync() {
  const store = useStore();

  // Computed property to get current user ID
  const userId = computed(() => store.state.userAuth?.user?.id);

  /**
   * Authenticate socket with user ID
   */
  const authenticate = () => {
    if (socket && socket.connected && userId.value && !isAuthenticated.value) {
      console.log('[Realtime] Authenticating with userId:', userId.value);
      socket.emit('authenticate', { userId: userId.value });
    }
  };

  /**
   * Initialize Socket.IO connection
   */
  const connect = () => {
    if (socket && socket.connected) {
      console.log('[Realtime] Already connected');
      return;
    }

    // Socket.IO client connects using http/https, not ws/wss
    // Socket.IO handles the protocol upgrade internally
    const socketUrl = API_CONFIG.BASE_URL.replace('/api', '');
    console.log('[Realtime] Connecting to:', socketUrl);

    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('[Realtime] Connected to server');
      isConnected.value = true;
      isAuthenticated.value = false; // Reset on new connection

      // Try to authenticate if user is already available
      authenticate();
    });

    socket.on('authenticated', (data) => {
      if (data.success) {
        console.log('[Realtime] Authenticated successfully for user:', data.userId);
        isAuthenticated.value = true;
      } else {
        console.error('[Realtime] Authentication failed:', data.error);
        isAuthenticated.value = false;
      }
    });

    socket.on('disconnect', () => {
      console.log('[Realtime] Disconnected from server');
      isConnected.value = false;
      isAuthenticated.value = false;
    });

    socket.on('connect_error', (error) => {
      console.error('[Realtime] Connection error:', error);
      isConnected.value = false;
    });

    // Initialize debounced fetch functions
    // These prevent multiple rapid events from triggering multiple API calls
    if (!debouncedAgentFetch) {
      debouncedAgentFetch = debounce(() => {
        store.dispatch('agents/fetchAgents', { force: true });
      }, 500, { leading: true, trailing: true });
    }

    if (!debouncedWorkflowFetch) {
      debouncedWorkflowFetch = debounce(() => {
        store.dispatch('workflows/fetchWorkflows', { force: true });
      }, 500, { leading: true, trailing: true });
    }

    if (!debouncedContentFetch) {
      debouncedContentFetch = debounce(() => {
        store.dispatch('contentOutputs/refreshOutputs');
      }, 500, { leading: true, trailing: true });
    }

    // Agent events - use optimistic updates + debounced sync
    socket.on('agent:created', (data) => {
      console.log('[Realtime] Agent created:', data);
      // Optimistic: add agent to store immediately if data provided
      if (data.agent) {
        store.commit('agents/ADD_AGENT', data.agent);
      }
      // Debounced full sync for consistency
      debouncedAgentFetch();
    });

    socket.on('agent:updated', (data) => {
      console.log('[Realtime] Agent updated:', data);
      // Optimistic: update agent in store immediately if data provided
      if (data.agent) {
        store.commit('agents/UPDATE_AGENT', data.agent);
      }
      debouncedAgentFetch();
    });

    socket.on('agent:deleted', (data) => {
      console.log('[Realtime] Agent deleted:', data);
      // Optimistic: remove agent from store immediately
      if (data.id) {
        store.commit('agents/DELETE_AGENT', data.id);
      }
      debouncedAgentFetch();
    });

    // Workflow events - use optimistic updates + debounced sync
    socket.on('workflow:created', (data) => {
      console.log('[Realtime] Workflow created:', data);
      if (data.workflow) {
        store.commit('workflows/ADD_WORKFLOW', data.workflow);
      }
      debouncedWorkflowFetch();
    });

    socket.on('workflow:updated', (data) => {
      console.log('[Realtime] Workflow updated:', data);

      // Update Vuex store if we have a workflow object
      if (data.workflow) {
        store.commit('workflows/UPDATE_WORKFLOW', data.workflow);
      }

      // CRITICAL: If workflowState is included, dispatch window event for real-time canvas update
      if (data.workflowState && data.id) {
        console.log('[Realtime] Dispatching workflow-updated window event with full state');
        window.dispatchEvent(new CustomEvent('workflow-updated', {
          detail: data.workflowState
        }));

        // Also update canvas store if this is the active workflow
        try {
          const currentCanvasId = store.state?.canvas?.canvasState?.id;
          if (currentCanvasId && currentCanvasId === data.id) {
            console.log('[Realtime] Updating canvas store for active workflow');
            store.commit('canvas/SET_CANVAS_STATE', data.workflowState);
          }
        } catch (err) {
          console.warn('[Realtime] Could not update canvas store:', err);
        }
      }

      debouncedWorkflowFetch();
    });

    socket.on('workflow:deleted', (data) => {
      console.log('[Realtime] Workflow deleted:', data);
      if (data.id) {
        store.commit('workflows/DELETE_WORKFLOW', data.id);
      }
      debouncedWorkflowFetch();
    });

    // Execution events (future: show notifications)
    socket.on('execution:started', (data) => {
      console.log('[Realtime] Execution started:', data);
    });

    socket.on('execution:completed', (data) => {
      console.log('[Realtime] Execution completed:', data);
    });

    socket.on('execution:failed', (data) => {
      console.log('[Realtime] Execution failed:', data);
    });

    // Content output events (saved outputs / chat history) - debounced
    socket.on('content:created', (data) => {
      console.log('[Realtime] Content output created:', data);
      debouncedContentFetch();
    });

    socket.on('content:updated', (data) => {
      console.log('[Realtime] Content output updated:', data);
      debouncedContentFetch();
    });

    socket.on('content:deleted', (data) => {
      console.log('[Realtime] Content output deleted:', data.id);

      // Directly remove the deleted item from the store (instant UI update)
      store.commit('contentOutputs/REMOVE_OUTPUT', data.id);

      // If the deleted content is the current chat conversation, reset the chat
      const currentSavedOutputId = store.state.chat?.savedOutputId;
      if (currentSavedOutputId && data.id === currentSavedOutputId) {
        console.log('[Realtime] Current conversation was deleted, resetting chat');
        store.commit('chat/RESET_CHAT');
      }
    });

    // Chat events (real-time message sync across tabs)
    socket.on('chat:user_message', (data) => {
      console.log('[Realtime] User message from another tab:', data);
      // Store will handle updating the UI
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'user_message',
        ...data,
      });
    });

    socket.on('chat:message_start', (data) => {
      console.log('[Realtime] Assistant message started:', data);
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'message_start',
        ...data,
      });
    });

    socket.on('chat:content_delta', (data) => {
      console.log('[Realtime] Content delta:', data.delta);
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'content_delta',
        ...data,
      });
    });

    socket.on('chat:tool_start', (data) => {
      console.log('[Realtime] Tool started:', data);
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'tool_start',
        ...data,
      });
    });

    socket.on('chat:tool_end', (data) => {
      console.log('[Realtime] Tool ended:', data);
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'tool_end',
        ...data,
      });
    });

    socket.on('chat:message_end', (data) => {
      console.log('[Realtime] Message ended:', data);
      store.dispatch('chat/handleRealtimeChatEvent', {
        type: 'message_end',
        ...data,
      });
    });
  };

  /**
   * Disconnect Socket.IO
   */
  const disconnect = () => {
    if (socket) {
      console.log('[Realtime] Disconnecting...');
      socket.disconnect();
      socket = null;
      isConnected.value = false;
    }
  };

  // Watch for user changes - authenticate when user becomes available
  watch(userId, (newUserId, oldUserId) => {
    if (newUserId && newUserId !== oldUserId) {
      console.log('[Realtime] User changed, authenticating:', newUserId);
      isAuthenticated.value = false; // Reset so we can re-authenticate
      authenticate();
    }
  });

  onMounted(() => {
    connect();
  });

  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    isAuthenticated,
    socket,
    connect,
    disconnect,
    authenticate,
  };
}

export default useRealtimeSync;
