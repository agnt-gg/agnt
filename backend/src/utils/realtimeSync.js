/**
 * Real-time Sync Utility
 * Broadcasts database changes to all connected clients via Socket.IO
 */

/**
 * Broadcast an event to all connected clients
 * @param {string} event - Event name (e.g., 'agent:created', 'workflow:updated')
 * @param {object} data - Data to broadcast
 */
export function broadcast(event, data) {
  if (global.io) {
    global.io.emit(event, data);
    console.log(`[Realtime] Broadcasted ${event} to all clients`);
  }
}

/**
 * Broadcast an event to a specific user's clients
 * @param {string} userId - User ID to target
 * @param {string} event - Event name
 * @param {object} data - Data to broadcast
 */
export function broadcastToUser(userId, event, data) {
  if (global.io) {
    const room = `user:${userId}`;
    const socketsInRoom = global.io.sockets.adapter.rooms.get(room);
    const numClients = socketsInRoom ? socketsInRoom.size : 0;
    console.log(`[Realtime] Broadcasting ${event} to room ${room} (${numClients} clients)`);
    global.io.to(room).emit(event, data);
  } else {
    console.log(`[Realtime] Cannot broadcast - Socket.IO not initialized`);
  }
}

/**
 * Standard event names for consistency
 */
export const RealtimeEvents = {
  // Agents
  AGENT_CREATED: 'agent:created',
  AGENT_UPDATED: 'agent:updated',
  AGENT_DELETED: 'agent:deleted',

  // Workflows
  WORKFLOW_CREATED: 'workflow:created',
  WORKFLOW_UPDATED: 'workflow:updated',
  WORKFLOW_DELETED: 'workflow:deleted',
  WORKFLOW_STATUS_CHANGED: 'workflow:status_changed',

  // Executions
  EXECUTION_STARTED: 'execution:started',
  EXECUTION_COMPLETED: 'execution:completed',
  EXECUTION_FAILED: 'execution:failed',

  // Goals
  GOAL_CREATED: 'goal:created',
  GOAL_UPDATED: 'goal:updated',
  GOAL_DELETED: 'goal:deleted',

  // Content Outputs
  CONTENT_CREATED: 'content:created',
  CONTENT_UPDATED: 'content:updated',
  CONTENT_DELETED: 'content:deleted',

  // Tools
  TOOL_CREATED: 'tool:created',
  TOOL_UPDATED: 'tool:updated',
  TOOL_DELETED: 'tool:deleted',

  // Chat Messages (real-time sync across tabs)
  CHAT_MESSAGE_START: 'chat:message_start',
  CHAT_CONTENT_DELTA: 'chat:content_delta',
  CHAT_TOOL_START: 'chat:tool_start',
  CHAT_TOOL_END: 'chat:tool_end',
  CHAT_MESSAGE_END: 'chat:message_end',
  CHAT_USER_MESSAGE: 'chat:user_message',
};

export default {
  broadcast,
  broadcastToUser,
  RealtimeEvents,
};
