import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import { API_CONFIG } from '../tt.config.js';
import { useStore } from 'vuex';

// Singleton socket instance
let socket = null;
const isConnected = ref(false);

/**
 * Composable for real-time sync via Socket.IO
 * Automatically connects on mount and disconnects on unmount
 *
 * @returns {Object} { isConnected, socket }
 */
export function useRealtimeSync() {
  const store = useStore();

  /**
   * Initialize Socket.IO connection
   */
  const connect = () => {
    if (socket && socket.connected) {
      console.log('[Realtime] Already connected');
      return;
    }

    const socketUrl = API_CONFIG.BASE_URL.replace(/^http/, 'ws');
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
    });

    socket.on('disconnect', () => {
      console.log('[Realtime] Disconnected from server');
      isConnected.value = false;
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

  onMounted(() => {
    connect();
  });

  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    socket,
    connect,
    disconnect,
  };
}

export default useRealtimeSync;
