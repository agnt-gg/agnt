import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { io } from 'socket.io-client';
import { API_CONFIG } from '../tt.config.js';
import { useStore } from 'vuex';

// Singleton socket instance
let socket = null;
const isConnected = ref(false);
const isAuthenticated = ref(false);

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

    // Agent events
    socket.on('agent:created', (data) => {
      console.log('[Realtime] Agent created:', data);
      store.dispatch('agents/fetchAgents'); // Refresh agent list
    });

    socket.on('agent:updated', (data) => {
      console.log('[Realtime] Agent updated:', data);
      store.dispatch('agents/fetchAgents'); // Refresh agent list
    });

    socket.on('agent:deleted', (data) => {
      console.log('[Realtime] Agent deleted:', data);
      store.dispatch('agents/fetchAgents'); // Refresh agent list
    });

    // Workflow events
    socket.on('workflow:created', (data) => {
      console.log('[Realtime] Workflow created:', data);
      store.dispatch('workflows/fetchWorkflows'); // Refresh workflow list
    });

    socket.on('workflow:updated', (data) => {
      console.log('[Realtime] Workflow updated:', data);
      store.dispatch('workflows/fetchWorkflows'); // Refresh workflow list
    });

    socket.on('workflow:deleted', (data) => {
      console.log('[Realtime] Workflow deleted:', data);
      store.dispatch('workflows/fetchWorkflows'); // Refresh workflow list
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

    // Content output events (saved outputs / chat history)
    socket.on('content:created', (data) => {
      console.log('[Realtime] Content output created:', data);
      store.dispatch('contentOutputs/refreshOutputs');
    });

    socket.on('content:updated', (data) => {
      console.log('[Realtime] Content output updated:', data);
      store.dispatch('contentOutputs/refreshOutputs');
    });

    socket.on('content:deleted', (data) => {
      console.log('[Realtime] Content output deleted:', data);
      store.dispatch('contentOutputs/refreshOutputs');

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
