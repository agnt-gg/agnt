import fetch from 'node-fetch';

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function resolveRequestTimeoutMs(optionValue) {
  if (Number.isFinite(optionValue) && optionValue > 0) return optionValue;
  const envValue = Number(process.env.MCP_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * POST-only HTTP Transport for MCP
 * For servers that don't support SSE (like GitHub Copilot MCP)
 * Uses stateless HTTP POST requests with session management
 */
class POSTTransport {
  constructor(options = {}) {
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.requestTimeoutMs = resolveRequestTimeoutMs(options.requestTimeoutMs);
    this.sessionId = null;
    this.connected = false;
    this.requestCounter = 0;
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

    const requestId = message.id || `req-${Date.now()}-${++this.requestCounter}`;
    message.id = requestId;

    const headers = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    console.log(`[POSTTransport] Sending ${message.method} request...`);
    console.log(`[POSTTransport] Request headers:`, JSON.stringify(headers, null, 2));
    console.log(`[POSTTransport] Request body:`, JSON.stringify(message, null, 2));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
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
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Timeout waiting for response to ${message.method}`);
        console.error(`[POSTTransport] ${timeoutErr.message}`);
        throw timeoutErr;
      }
      console.error(`[POSTTransport] Error sending ${message.method}:`, err.message);
      throw err;
    } finally {
      clearTimeout(timer);
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
