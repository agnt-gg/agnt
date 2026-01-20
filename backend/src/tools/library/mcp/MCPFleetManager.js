import MCPClient from './MCPClient.js';
import Semaphore from './utils/Semaphore.js';
import Backoff from './utils/Backoff.js';
import Circuit from './utils/Circuit.js';
import { setTimeout as sleep } from 'timers/promises';

/**
 * MCP Fleet Manager - Manage hundreds of MCP servers efficiently
 * Features: lazy connection pooling, concurrency control, circuit breakers, health checks
 */
class MCPFleetManager {
  constructor(registry = [], options = {}) {
    this.registry = new Map();
    this.clients = new Map();
    this.sema = new Semaphore(options.concurrency || 20);
    this.clientName = options.clientName || 'mcp-fleet-manager';
    this.httpHeaders = options.httpHeaders || {};
    this.state = new Map();

    // Add servers from registry
    for (const server of registry) {
      this.addServer(server);
    }
  }

  /**
   * Add a server to the registry
   */
  addServer(desc) {
    if (!desc?.name) {
      throw new Error('Server needs a name');
    }

    this.registry.set(desc.name, desc);
    this.state.set(desc.name, {
      backoff: new Backoff(),
      circuit: new Circuit(),
      health: {
        status: 'unknown',
        lastCheck: 0,
        serverInfo: null,
        capabilities: null,
      },
    });
  }

  /**
   * Remove a server from the registry
   */
  removeServer(name) {
    this.disconnect(name).catch(() => {});
    this.registry.delete(name);
    this.state.delete(name);
  }

  /**
   * Connect to a server (lazy)
   */
  async _connect(name) {
    if (this.clients.has(name)) {
      return this.clients.get(name);
    }

    const desc = this.registry.get(name);
    if (!desc) {
      throw new Error(`Unknown server: ${name}`);
    }

    const transport = desc.transport;
    let options;

    if (transport === 'http') {
      options = {
        transport: 'http',
        transportOptions: {
          endpoint: desc.http.endpoint,
          headers: {
            ...this.httpHeaders,
            ...(desc.http.headers || {}),
          },
          openBackgroundGetStream: true,
        },
        clientName: this.clientName,
        roots: desc.roots || [],
      };
    } else if (transport === 'stdio') {
      options = {
        transport: 'stdio',
        transportOptions: {
          command: desc.stdio.command,
          args: desc.stdio.args || [],
          cwd: desc.stdio.cwd,
          env: {
            ...process.env,
            ...(desc.stdio.env || {}),
          },
        },
        clientName: this.clientName,
        roots: desc.roots || [],
      };
    } else {
      throw new Error(`Unknown transport type: ${transport}`);
    }

    const client = new MCPClient(options);
    const init = await client.initialize();

    const st = this.state.get(name);
    st.backoff.reset();
    st.circuit.recordSuccess();
    st.health = {
      status: 'up',
      lastCheck: Date.now(),
      serverInfo: init.serverInfo,
      capabilities: init.serverCapabilities,
    };

    this.clients.set(name, client);
    return client;
  }

  /**
   * Disconnect from a server
   */
  async disconnect(name) {
    const client = this.clients.get(name);
    if (client) {
      try {
        await client.close();
      } catch (err) {
        // Ignore errors during close
      } finally {
        this.clients.delete(name);
      }
    }
  }

  /**
   * Execute an operation with a client, handling retries and circuit breakers
   */
  async _withClient(name, fn) {
    const st = this.state.get(name);
    if (!st) {
      throw new Error(`Unknown server state: ${name}`);
    }

    if (!st.circuit.canAttempt()) {
      throw new Error(`Circuit open for ${name}, skipping until cooldown`);
    }

    try {
      const client = await this._connect(name);
      const result = await fn(client);
      st.circuit.recordSuccess();
      return result;
    } catch (err) {
      st.circuit.recordFailure();
      await this.disconnect(name);
      const delay = st.backoff.nextDelay();
      await sleep(delay);
      throw err;
    }
  }

  /**
   * Fan-out operation across multiple servers
   */
  async fanout(names, operation, options = {}) {
    const concurrency = options.concurrency || this.sema.max;
    const tolerateErrors = options.tolerateErrors !== false;
    const results = {};

    const sema = new Semaphore(concurrency);

    await Promise.all(
      names.map((name) =>
        sema.with(async () => {
          try {
            const result = await this._withClient(name, operation);
            results[name] = { ok: true, data: result };
          } catch (err) {
            if (!tolerateErrors) throw err;
            results[name] = { ok: false, error: String(err.message || err) };
          }
        })
      )
    );

    return results;
  }

  /**
   * List tools across multiple servers
   */
  async listToolsAcross(names = [...this.registry.keys()], options = {}) {
    return this.fanout(names, (client) => client.listTools(), options);
  }

  /**
   * List resources across multiple servers
   */
  async listResourcesAcross(names = [...this.registry.keys()], options = {}) {
    return this.fanout(names, (client) => client.listResources(), options);
  }

  /**
   * List prompts across multiple servers
   */
  async listPromptsAcross(names = [...this.registry.keys()], options = {}) {
    return this.fanout(names, (client) => client.listPrompts(), options);
  }

  /**
   * Call a tool across multiple servers
   */
  async callToolAcross(toolName, toolArgs = {}, names = [...this.registry.keys()], options = {}) {
    return this.fanout(names, (client) => client.callTool(toolName, toolArgs), options);
  }

  /**
   * Health check across multiple servers
   */
  async healthCheck(names = [...this.registry.keys()], options = {}) {
    return this.fanout(
      names,
      async (client) => {
        const info = client.getServerInfo();
        return {
          initialized: info.initialized,
          serverInfo: info.serverInfo,
          capabilities: info.serverCapabilities,
        };
      },
      { concurrency: options.concurrency || 20, tolerateErrors: true }
    );
  }

  /**
   * Get server info
   */
  getServerInfo(name) {
    const desc = this.registry.get(name);
    const state = this.state.get(name);
    const client = this.clients.get(name);

    return {
      name,
      transport: desc?.transport,
      connected: this.clients.has(name),
      health: state?.health,
      clientInfo: client ? client.getServerInfo() : null,
    };
  }

  /**
   * Get all server names
   */
  getServerNames() {
    return [...this.registry.keys()];
  }

  /**
   * Get registry
   */
  getRegistry() {
    return this.registry;
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll() {
    const names = [...this.clients.keys()];
    await Promise.all(names.map((name) => this.disconnect(name)));
  }
}

export default MCPFleetManager;
