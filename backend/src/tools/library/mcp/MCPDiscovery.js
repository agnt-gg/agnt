import { readFile, access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import fetch from 'node-fetch';

/**
 * MCP Discovery - Automatic server discovery from multiple sources
 */
class MCPDiscovery {
  constructor() {
    this.discoveredServers = [];
  }

  /**
   * Discover all MCP servers from all available sources
   */
  async discoverAll(options = {}) {
    this.discoveredServers = [];

    // 0. Explicit config path from env
    if (process.env.MCP_CONFIG_PATH) {
      await this._discoverFromFile(process.env.MCP_CONFIG_PATH, 'environment variable: MCP_CONFIG_PATH');
    }

    // 1. Current directory mcp.json
    await this._discoverFromFile('./mcp.json', 'current directory');

    // 2. User config directory
    await this._discoverFromUserConfig();

    // 3. VSCode workspace
    await this._discoverFromFile('./.vscode/mcp.json', 'VSCode workspace');

    // 4. Environment variable
    await this._discoverFromEnv();

    // 5. Well-known endpoints (if base URLs provided)
    if (options.baseUrls && Array.isArray(options.baseUrls)) {
      for (const baseUrl of options.baseUrls) {
        await this._discoverFromWellKnown(baseUrl);
      }
    }

    return this.discoveredServers;
  }

  /**
   * Discover from a specific file path
   */
  async _discoverFromFile(filePath, source) {
    try {
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');
      const config = JSON.parse(content);

      if (config.servers && Array.isArray(config.servers)) {
        for (const server of config.servers) {
          this._addServer(server, `${source}: ${filePath}`);
        }
      }
    } catch (err) {
      // File doesn't exist or can't be read - that's okay
      if (err.code !== 'ENOENT') {
        console.warn(`[MCPDiscovery] Error reading ${filePath}:`, err.message);
      }
    }
  }

  /**
   * Discover from user config directory
   */
  async _discoverFromUserConfig() {
    const home = homedir();
    let configPath;

    if (process.platform === 'win32') {
      configPath = join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'mcp', 'mcp.json');
    } else if (process.platform === 'darwin') {
      configPath = join(home, 'Library', 'Application Support', 'mcp', 'mcp.json');
    } else {
      configPath = join(home, '.config', 'mcp', 'mcp.json');
    }

    await this._discoverFromFile(configPath, 'user config');
  }

  /**
   * Discover from environment variable
   */
  async _discoverFromEnv() {
    try {
      const envServers = process.env.MCP_SERVERS;
      if (envServers) {
        const servers = JSON.parse(envServers);
        if (Array.isArray(servers)) {
          for (const server of servers) {
            this._addServer(server, 'environment variable: MCP_SERVERS');
          }
        }
      }
    } catch (err) {
      console.warn('[MCPDiscovery] Error parsing MCP_SERVERS env var:', err.message);
    }
  }

  /**
   * Discover from .well-known/mcp.json endpoint
   */
  async _discoverFromWellKnown(baseUrl) {
    try {
      const url = new URL('/.well-known/mcp.json', baseUrl);
      const response = await fetch(url.toString(), {
        timeout: 5000,
      });

      if (response.ok) {
        const config = await response.json();
        if (config.servers && Array.isArray(config.servers)) {
          for (const server of config.servers) {
            this._addServer(server, `.well-known: ${baseUrl}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[MCPDiscovery] Error fetching .well-known from ${baseUrl}:`, err.message);
    }
  }

  /**
   * Substitute environment variables in a string
   */
  _substituteEnvVars(value) {
    if (typeof value !== 'string') return value;

    // Replace ${VAR_NAME} with process.env.VAR_NAME
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || match;
    });
  }

  /**
   * Substitute environment variables in an object recursively
   */
  _substituteEnvVarsInObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this._substituteEnvVars(value);
      } else if (typeof value === 'object') {
        result[key] = this._substituteEnvVarsInObject(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Add a server to the discovered list
   */
  _addServer(server, source) {
    if (!server.name) {
      console.warn('[MCPDiscovery] Skipping server without name:', server);
      return;
    }

    // Normalize server configuration
    const normalized = {
      name: server.name,
      from: source,
    };

    // Handle transport configuration
    if (server.transport) {
      if (server.transport.type === 'stdio') {
        normalized.transport = 'stdio';
        normalized.stdio = {
          command: server.transport.command,
          args: server.transport.args || [],
          cwd: server.transport.cwd,
          env: this._substituteEnvVarsInObject(server.transport.env || {}),
        };
      } else if (server.transport.type === 'http' || server.transport.type === 'http-post') {
        normalized.transport = server.transport.type;

        // Handle both formats: direct headers or requestInit.headers
        let headers = {};
        if (server.transport.requestInit?.headers) {
          headers = server.transport.requestInit.headers;
        } else if (server.transport.headers) {
          headers = server.transport.headers;
        }

        normalized.http = {
          endpoint: this._substituteEnvVars(server.transport.endpoint),
          headers: this._substituteEnvVarsInObject(headers),
        };
      }
    }

    // Handle legacy format (direct properties)
    if (!normalized.transport) {
      if (server.command) {
        normalized.transport = 'stdio';
        normalized.stdio = {
          command: server.command,
          args: server.args || [],
          cwd: server.cwd,
          env: server.env || {},
        };
      } else if (server.endpoint || server.url) {
        normalized.transport = 'http';
        normalized.http = {
          endpoint: server.endpoint || server.url,
          headers: server.headers || {},
        };
      }
    }

    // Add roots if present
    if (server.roots) {
      normalized.roots = server.roots;
    }

    // Check for duplicates
    const existing = this.discoveredServers.find((s) => s.name === normalized.name);
    if (existing) {
      console.log(`[MCPDiscovery] Duplicate server "${normalized.name}" found in ${source}, keeping first from ${existing.from}`);
      return;
    }

    this.discoveredServers.push(normalized);
    console.log(`[MCPDiscovery] Discovered server "${normalized.name}" from ${source}`);
  }

  /**
   * Get all discovered servers
   */
  getServers() {
    return this.discoveredServers;
  }

  /**
   * Get a specific server by name
   */
  getServer(name) {
    return this.discoveredServers.find((s) => s.name === name);
  }

  /**
   * Get servers by transport type
   */
  getServersByTransport(transport) {
    return this.discoveredServers.filter((s) => s.transport === transport);
  }
}

export default MCPDiscovery;
