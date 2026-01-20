import HTTPTransport from './transports/HTTPTransport.js';
import STDIOTransport from './transports/STDIOTransport.js';
import POSTTransport from './transports/POSTTransport.js';

/**
 * MCP Client - Full-featured Model Context Protocol client
 * Supports HTTP/SSE, POST-only HTTP, and STDIO transports
 */
class MCPClient {
  constructor(options = {}) {
    this.transport = null;
    this.transportType = options.transport || 'http';
    this.transportOptions = options.transportOptions || {};
    this.clientName = options.clientName || 'mcp-client';
    this.clientVersion = options.clientVersion || '1.0.0';
    this.roots = options.roots || [];
    this.serverInfo = null;
    this.serverCapabilities = null;
    this.initialized = false;
  }

  async initialize() {
    // Create transport
    if (this.transportType === 'http') {
      this.transport = new HTTPTransport(this.transportOptions);
    } else if (this.transportType === 'http-post') {
      this.transport = new POSTTransport(this.transportOptions);
    } else if (this.transportType === 'stdio') {
      this.transport = new STDIOTransport(this.transportOptions);
    } else {
      throw new Error(`Unsupported transport type: ${this.transportType}`);
    }

    // Connect transport
    await this.transport.connect();

    // Try MCP initialize handshake (may not be supported by all servers)
    try {
      console.log('[MCPClient] Sending initialize request...');
      const initResponse = await this.transport.send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: {
              listChanged: true,
            },
            sampling: {},
          },
          clientInfo: {
            name: this.clientName,
            version: this.clientVersion,
          },
        },
      });
      console.log('[MCPClient] Initialize response received:', JSON.stringify(initResponse, null, 2));

      if (initResponse.error) {
        // If initialize is not supported, log warning but continue
        if (initResponse.error.code === -32601 || initResponse.error.message?.includes('not found')) {
          console.warn('[MCPClient] Server does not support initialize method, continuing without handshake');
          this.serverInfo = { name: 'unknown', version: 'unknown' };
          this.serverCapabilities = {};
        } else {
          throw new Error(`Initialize failed: ${initResponse.error.message}`);
        }
      } else {
        this.serverInfo = initResponse.result.serverInfo;
        this.serverCapabilities = initResponse.result.capabilities;

        console.log('[MCPClient] Initialized:', {
          server: this.serverInfo,
          capabilities: this.serverCapabilities,
        });

        // Send initialized notification
        try {
          await this.transport.send({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          });
        } catch (err) {
          console.warn('[MCPClient] Failed to send initialized notification:', err.message);
        }
      }
    } catch (err) {
      // If initialize fails completely, log warning but continue
      console.warn('[MCPClient] Initialize handshake failed, continuing without it:', err.message);
      this.serverInfo = { name: 'unknown', version: 'unknown' };
      this.serverCapabilities = {};
    }

    this.initialized = true;

    return {
      serverInfo: this.serverInfo,
      serverCapabilities: this.serverCapabilities,
    };
  }

  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Client not initialized. Call initialize() first.');
    }
  }

  // ==================== TOOLS ====================

  async listTools() {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'tools/list',
    });

    if (response.error) {
      throw new Error(`tools/list failed: ${response.error.message}`);
    }

    return response.result.tools || [];
  }

  async callTool(name, args = {}) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });

    if (response.error) {
      throw new Error(`tools/call failed: ${response.error.message}`);
    }

    return response.result;
  }

  // ==================== RESOURCES ====================

  async listResources() {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'resources/list',
    });

    if (response.error) {
      throw new Error(`resources/list failed: ${response.error.message}`);
    }

    return response.result.resources || [];
  }

  async readResource(uri) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'resources/read',
      params: { uri },
    });

    if (response.error) {
      throw new Error(`resources/read failed: ${response.error.message}`);
    }

    return response.result;
  }

  async subscribeResource(uri) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'resources/subscribe',
      params: { uri },
    });

    if (response.error) {
      throw new Error(`resources/subscribe failed: ${response.error.message}`);
    }

    return response.result;
  }

  async unsubscribeResource(uri) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'resources/unsubscribe',
      params: { uri },
    });

    if (response.error) {
      throw new Error(`resources/unsubscribe failed: ${response.error.message}`);
    }

    return response.result;
  }

  // ==================== PROMPTS ====================

  async listPrompts() {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'prompts/list',
    });

    if (response.error) {
      throw new Error(`prompts/list failed: ${response.error.message}`);
    }

    return response.result.prompts || [];
  }

  async getPrompt(name, args = {}) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'prompts/get',
      params: {
        name,
        arguments: args,
      },
    });

    if (response.error) {
      throw new Error(`prompts/get failed: ${response.error.message}`);
    }

    return response.result;
  }

  // ==================== ROOTS ====================

  async listRoots() {
    this._ensureInitialized();
    return this.roots;
  }

  // ==================== SAMPLING ====================

  async createMessage(params) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'sampling/createMessage',
      params,
    });

    if (response.error) {
      throw new Error(`sampling/createMessage failed: ${response.error.message}`);
    }

    return response.result;
  }

  // ==================== LOGGING ====================

  async setLoggingLevel(level) {
    this._ensureInitialized();

    const response = await this.transport.send({
      jsonrpc: '2.0',
      method: 'logging/setLevel',
      params: { level },
    });

    if (response.error) {
      throw new Error(`logging/setLevel failed: ${response.error.message}`);
    }

    return response.result;
  }

  // ==================== NOTIFICATIONS ====================

  onNotification(handler) {
    if (this.transport) {
      this.transport.onNotification(handler);
    }
  }

  // ==================== LIFECYCLE ====================

  async close() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.initialized = false;
  }

  // ==================== INFO ====================

  getServerInfo() {
    return {
      serverInfo: this.serverInfo,
      serverCapabilities: this.serverCapabilities,
      initialized: this.initialized,
      transportType: this.transportType,
    };
  }
}

export default MCPClient;
