import fetch from 'node-fetch';
import * as EventSource from 'eventsource';

/**
 * HTTP/SSE Transport for MCP
 * Handles communication via HTTP POST and Server-Sent Events
 */
class HTTPTransport {
  constructor(options = {}) {
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.openBackgroundGetStream = options.openBackgroundGetStream !== false;
    this.sse = null;
    this.connectionId = null;
    this.messageHandlers = new Map();
    this.notificationHandlers = [];
    this.connected = false;
    this.requestCounter = 0;
  }

  async connect() {
    if (this.connected) return;

    // Use the endpoint exactly as provided - no modifications
    const sseUrl = this.endpoint;

    console.log(`[HTTPTransport] Connecting to SSE: ${sseUrl}`);
    console.log(`[HTTPTransport] Headers being sent:`, JSON.stringify(this.headers, null, 2));

    this.sse = new EventSource.EventSource(sseUrl, {
      headers: this.headers,
    });

    // Set up message handler
    this.sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (err) {
        console.error('[HTTPTransport] Error parsing SSE message:', err);
      }
    };

    // Error handler
    this.sse.onerror = (err) => {
      console.error('[HTTPTransport] SSE error:', err);
      this.connected = false;
    };

    // Open handler
    this.sse.onopen = () => {
      console.log('[HTTPTransport] SSE connection opened');
    };

    // Wait for connection to be established
    await this._establishConnection();
    this.connected = true;
  }

  async _establishConnection() {
    return new Promise((resolve, reject) => {
      let connectionEstablished = false;
      let lastError = null;

      const timeout = setTimeout(() => {
        if (!connectionEstablished) {
          this.sse.close();
          // Use the last error if available, otherwise generic timeout
          if (lastError) {
            reject(lastError);
          } else {
            reject(new Error('Timeout waiting for connection'));
          }
        }
      }, 10000);

      // Capture SSE errors
      const errorHandler = (err) => {
        if (connectionEstablished) return;

        // Build a descriptive error message
        let errorMessage = 'SSE connection failed';
        if (err.code) {
          errorMessage += ` (HTTP ${err.code})`;
        }
        if (err.message && err.message !== 'error') {
          errorMessage += `: ${err.message}`;
        }

        lastError = new Error(errorMessage);
        console.error('[HTTPTransport] SSE error captured:', errorMessage);
      };

      // Replace the error handler temporarily
      this.sse.onerror = errorHandler;

      // Listen for connection event
      this.sse.addEventListener('connection', (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.connectionId) {
            this.connectionId = data.connectionId;
            connectionEstablished = true;
            clearTimeout(timeout);
            console.log('[HTTPTransport] Connected with ID:', this.connectionId);
            resolve();
          }
        } catch (err) {
          console.error('[HTTPTransport] Error parsing connection event:', err);
        }
      });

      // Also check regular messages for connection info
      const checkMessage = (event) => {
        if (connectionEstablished) return;

        try {
          const data = JSON.parse(event.data);

          // Check for authenticated user ID
          if (data.isAuthenticated && data.id) {
            this.connectionId = data.id;
            connectionEstablished = true;
            clearTimeout(timeout);
            console.log('[HTTPTransport] Connected with authenticated ID:', this.connectionId);
            resolve();
          }
        } catch (err) {
          // Ignore parse errors
        }
      };

      // Attach to existing onmessage
      const originalOnMessage = this.sse.onmessage;
      this.sse.onmessage = (event) => {
        checkMessage(event);
        if (originalOnMessage) originalOnMessage(event);
      };
    });
  }

  _handleMessage(data) {
    // Handle response to a request
    if (data.id && this.messageHandlers.has(data.id)) {
      const handler = this.messageHandlers.get(data.id);
      handler.resolve(data);
      this.messageHandlers.delete(data.id);
      return;
    }

    // Handle notification (no id, or method present)
    if (data.method) {
      for (const handler of this.notificationHandlers) {
        handler(data);
      }
    }
  }

  async _sendMessage(message) {
    const url = new URL(this.endpoint);
    const baseUrl = `${url.protocol}//${url.host}`;

    const headers = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    if (this.connectionId) {
      headers['X-Connection-ID'] = this.connectionId;
    }

    await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });
  }

  async send(message) {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    const requestId = message.id || `req-${Date.now()}-${++this.requestCounter}`;
    message.id = requestId;

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(requestId);
        reject(new Error(`Timeout waiting for response to ${message.method}`));
      }, 30000);

      this.messageHandlers.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
      });
    });

    await this._sendMessage(message);
    return responsePromise;
  }

  onNotification(handler) {
    this.notificationHandlers.push(handler);
  }

  async close() {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    this.connected = false;
    this.connectionId = null;
    this.messageHandlers.clear();
    this.notificationHandlers = [];
  }
}

export default HTTPTransport;
