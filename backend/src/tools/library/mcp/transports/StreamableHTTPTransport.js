/**
 * Streamable HTTP transport for MCP (spec revision 2025-06-18).
 *
 * This is the transport modern remote MCP servers actually speak. It differs
 * from the older HTTPTransport (SSE-first, `/messages` side channel) and from
 * POSTTransport (plain JSON only) in three ways that are not optional:
 *
 *   1. A single POST response may be `application/json` OR a `text/event-stream`
 *      containing the JSON-RPC reply. Servers pick per-request. POSTTransport
 *      assumes JSON and throws on the SSE form.
 *   2. `Mcp-Session-Id` returned by `initialize` must be echoed on every later
 *      request, or the server 404s the session.
 *   3. `MCP-Protocol-Version` must be sent once a version has been negotiated.
 *
 * Auth is injected as an async callback rather than a static header map, so a
 * bearer token can be refreshed mid-session without rebuilding the transport.
 * A 401 triggers exactly one refresh-and-retry — never a loop.
 */

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

function resolveRequestTimeoutMs(optionValue) {
  if (Number.isFinite(optionValue) && optionValue > 0) return optionValue;
  const envValue = Number(process.env.MCP_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Parse an SSE body into the JSON-RPC messages it carries.
 * Keep-alive comments and malformed frames are skipped, not fatal.
 */
function parseSseEvents(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* not a JSON frame — ignore */
    }
  }
  return events;
}

class StreamableHTTPTransport {
  constructor(options = {}) {
    this.endpoint = options.endpoint;
    this.staticHeaders = options.headers || {};
    // async () => string|null — returns a full Authorization header value.
    this.getAuthHeader = options.getAuthHeader || null;
    // async () => boolean — refresh credentials; true means "retry once".
    this.onUnauthorized = options.onUnauthorized || null;
    this.requestTimeoutMs = resolveRequestTimeoutMs(options.requestTimeoutMs);
    this.protocolVersion = null;
    this.sessionId = null;
    this.connected = false;
    this.notificationHandlers = [];
    this.requestCounter = 0;
  }

  async connect() {
    if (!this.endpoint) throw new Error('StreamableHTTPTransport requires an endpoint');
    // Streamable HTTP has no connect step — the first POST establishes state.
    this.connected = true;
  }

  async _buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.staticHeaders,
    };
    if (this.getAuthHeader) {
      const auth = await this.getAuthHeader();
      if (auth) headers.Authorization = auth;
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
    return headers;
  }

  async _post(message, isRetry = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: await this._buildHeaders(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Timeout waiting for response to ${message.method}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && !isRetry && this.onUnauthorized) {
      const refreshed = await this.onUnauthorized(response.headers.get('www-authenticate'));
      if (refreshed) return this._post(message, true);
    }

    const assignedSession = response.headers.get('mcp-session-id');
    if (assignedSession) this.sessionId = assignedSession;

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} from ${this.endpoint}: ${body.slice(0, 500)}`,
      );
    }

    // 202 Accepted with an empty body is the correct reply to a notification.
    if (response.status === 202 || body.trim() === '') return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const events = parseSseEvents(body);
      for (const event of events) {
        // Server-initiated notifications ride the same stream.
        if (!event.id && event.method) {
          for (const handler of this.notificationHandlers) handler(event);
        }
      }
      const reply = events.find((e) => e.id === message.id) || events.filter((e) => e.id != null).pop();
      if (!reply) {
        throw new Error(`SSE stream carried no JSON-RPC response for ${message.method}`);
      }
      return reply;
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`Non-JSON response (${contentType}) for ${message.method}: ${body.slice(0, 300)}`);
    }
  }

  /**
   * Send a JSON-RPC message. Matches MCPClient's transport contract: returns
   * the full envelope so the client can inspect `.error` itself.
   */
  async send(message) {
    if (!this.connected) throw new Error('Transport not connected');

    // Notifications have no id and expect no response.
    const isNotification = !('id' in message) && typeof message.method === 'string'
      && message.method.startsWith('notifications/');

    if (isNotification) {
      await this._post(message);
      return { jsonrpc: '2.0', result: {} };
    }

    if (message.id == null) {
      message.id = `req-${Date.now()}-${++this.requestCounter}`;
    }

    const response = await this._post(message);
    if (response === null) {
      throw new Error(`Empty response to ${message.method}`);
    }

    // Capture the negotiated protocol version for subsequent requests.
    if (message.method === 'initialize' && response.result?.protocolVersion) {
      this.protocolVersion = response.result.protocolVersion;
    } else if (message.method === 'initialize') {
      this.protocolVersion = DEFAULT_PROTOCOL_VERSION;
    }

    return response;
  }

  onNotification(handler) {
    this.notificationHandlers.push(handler);
  }

  async close() {
    // Politely release the server-side session. Never throws — teardown must
    // not be able to fail a caller's happy path.
    if (this.sessionId) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        await fetch(this.endpoint, {
          method: 'DELETE',
          headers: await this._buildHeaders(),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
      } catch {
        /* session expires server-side regardless */
      }
    }
    this.sessionId = null;
    this.connected = false;
    this.notificationHandlers = [];
  }
}

export default StreamableHTTPTransport;
export { parseSseEvents, DEFAULT_PROTOCOL_VERSION };
