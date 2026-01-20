import fetch from 'node-fetch';

/**
 * POST-only HTTP Transport for MCP
 * For servers that don't support SSE (like GitHub Copilot MCP)
 * Uses stateless HTTP POST requests with session management
 */
class POSTTransport {
  constructor(options = {}) {
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.sessionId = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;

    console.log(`[POSTTransport] Connecting to: ${this.endpoint}`);
    console.log(`[POSTTransport] Headers:`, JSON.stringify(this.headers, null, 2));

    // For POST-only transport, we're "connected" immediately
    // Session management happens per-request
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.connected = true;

    console.log(`[POSTTransport] Connected with session ID: ${this.sessionId}`);
  }

  async send(message) {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    const requestId = message.id || `req-${Date.now()}`;
    message.id = requestId;

    const headers = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    console.log(`[POSTTransport] Sending ${message.method} request...`);
    console.log(`[POSTTransport] Request headers:`, JSON.stringify(headers, null, 2));
    console.log(`[POSTTransport] Request body:`, JSON.stringify(message, null, 2));

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[POSTTransport] HTTP ${response.status} error response:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`[POSTTransport] Received response for ${message.method}`);

      return data;
    } catch (err) {
      console.error(`[POSTTransport] Error sending ${message.method}:`, err.message);
      throw err;
    }
  }

  onNotification(handler) {
    // POST-only transport doesn't support server-initiated notifications
    // Notifications would need to be polled or use a separate mechanism
    console.warn('[POSTTransport] Server-initiated notifications not supported in POST-only mode');
  }

  async close() {
    this.connected = false;
    this.sessionId = null;
    console.log('[POSTTransport] Connection closed');
  }
}

export default POSTTransport;
