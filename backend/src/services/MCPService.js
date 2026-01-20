import fs from 'fs/promises';
import path from 'path';
import PathManager from '../utils/PathManager.js';

class MCPService {
  constructor() {
    // Initialize mcpFilePath later or access via PathManager directly
    this.mcpFileName = 'mcp.json';
  }

  /**
   * Get the path to mcp.json, initializing it in userData if needed
   */
  async getMcpFilePath() {
    return await PathManager.ensureFile(this.mcpFileName);
  }

  /**
   * Read the MCP configuration file
   */
  async readMCPFile() {
    try {
      const filePath = await this.getMcpFilePath();
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default structure
        return { servers: [] };
      }
      throw new Error(`Failed to read MCP file: ${error.message}`);
    }
  }

  /**
   * Write to the MCP configuration file
   */
  async writeMCPFile(data) {
    try {
      const filePath = await this.getMcpFilePath();
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to write MCP file: ${error.message}`);
    }
  }

  /**
   * Get all MCP servers
   */
  async getServers(req, res) {
    try {
      const config = await this.readMCPFile();
      res.json({ success: true, servers: config.servers || [] });
    } catch (error) {
      console.error('Error getting MCP servers:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Add a new MCP server
   */
  async addServer(req, res) {
    try {
      const serverConfig = req.body;

      // Validate server configuration
      const validation = this.validateServerConfig(serverConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      const config = await this.readMCPFile();

      // Check if server name already exists
      if (config.servers.some((s) => s.name === serverConfig.name)) {
        return res.status(400).json({ success: false, error: 'Server name already exists' });
      }

      // Add the new server
      config.servers.push(serverConfig);
      await this.writeMCPFile(config);

      res.json({ success: true, server: serverConfig, message: 'Server added successfully' });
    } catch (error) {
      console.error('Error adding MCP server:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update an existing MCP server
   */
  async updateServer(req, res) {
    try {
      const { name } = req.params;
      const serverConfig = req.body;

      // Validate server configuration
      const validation = this.validateServerConfig(serverConfig);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      const config = await this.readMCPFile();
      const serverIndex = config.servers.findIndex((s) => s.name === name);

      if (serverIndex === -1) {
        return res.status(404).json({ success: false, error: 'Server not found' });
      }

      // If name is being changed, check for conflicts
      if (serverConfig.name !== name) {
        if (config.servers.some((s) => s.name === serverConfig.name)) {
          return res.status(400).json({ success: false, error: 'New server name already exists' });
        }
      }

      // Update the server
      config.servers[serverIndex] = serverConfig;
      await this.writeMCPFile(config);

      res.json({ success: true, server: serverConfig, message: 'Server updated successfully' });
    } catch (error) {
      console.error('Error updating MCP server:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Delete an MCP server
   */
  async deleteServer(req, res) {
    try {
      const { name } = req.params;

      const config = await this.readMCPFile();
      const serverIndex = config.servers.findIndex((s) => s.name === name);

      if (serverIndex === -1) {
        return res.status(404).json({ success: false, error: 'Server not found' });
      }

      // Remove the server
      config.servers.splice(serverIndex, 1);
      await this.writeMCPFile(config);

      res.json({ success: true, message: 'Server deleted successfully' });
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get server capabilities (tools, resources, prompts)
   */
  async getServerCapabilities(req, res) {
    try {
      const { name } = req.params;

      const config = await this.readMCPFile();
      const server = config.servers.find((s) => s.name === name);

      if (!server) {
        return res.status(404).json({ success: false, error: 'Server not found' });
      }

      // Dynamically import MCPClient
      const { default: MCPClient } = await import('../tools/library/mcp/MCPClient.js');

      // Create client based on transport type
      const transportOptions = {};
      let transportType = server.transport.type;

      if (server.transport.type === 'http') {
        transportOptions.endpoint = server.transport.endpoint;
        transportType = 'http';
      } else if (server.transport.type === 'stdio') {
        transportOptions.command = server.transport.command;
        transportOptions.args = server.transport.args || [];
        transportOptions.env = server.transport.env || {};
        transportType = 'stdio';
      }

      const client = new MCPClient({
        transport: transportType,
        transportOptions,
        clientName: 'tasktitan-mcp-client',
        clientVersion: '1.0.0',
      });

      try {
        // Initialize the client
        await client.initialize();

        // Fetch capabilities
        const [tools, resources, prompts] = await Promise.all([
          client.listTools().catch(() => []),
          client.listResources().catch(() => []),
          client.listPrompts().catch(() => []),
        ]);

        const serverInfo = client.getServerInfo();

        await client.close();

        res.json({
          success: true,
          capabilities: {
            tools: tools || [],
            resources: resources || [],
            prompts: prompts || [],
            serverInfo: serverInfo.serverInfo,
            serverCapabilities: serverInfo.serverCapabilities,
          },
        });
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    } catch (error) {
      console.error('Error getting server capabilities:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Test connection to an MCP server
   */
  async testConnection(req, res) {
    try {
      const { name } = req.params;

      const config = await this.readMCPFile();
      const server = config.servers.find((s) => s.name === name);

      if (!server) {
        return res.status(404).json({ success: false, error: 'Server not found' });
      }

      // For HTTP transport, try to fetch the endpoint
      if (server.transport.type === 'http') {
        try {
          const response = await fetch(server.transport.endpoint, {
            method: 'GET',
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });

          res.json({
            success: true,
            connected: response.ok,
            status: response.status,
            message: response.ok ? 'Connection successful' : 'Connection failed',
          });
        } catch (error) {
          res.json({
            success: true,
            connected: false,
            message: `Connection failed: ${error.message}`,
          });
        }
      } else if (server.transport.type === 'stdio') {
        // For STDIO, we can't easily test without actually running the command
        // Return a message indicating this
        res.json({
          success: true,
          connected: null,
          message: 'STDIO transport cannot be tested directly. Server will be validated when used.',
        });
      } else {
        res.status(400).json({ success: false, error: 'Unknown transport type' });
      }
    } catch (error) {
      console.error('Error testing MCP server connection:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Validate server configuration
   */
  validateServerConfig(config) {
    // Check required fields
    if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
      return { valid: false, error: 'Server name is required' };
    }

    if (!config.transport || typeof config.transport !== 'object') {
      return { valid: false, error: 'Transport configuration is required' };
    }

    if (!config.transport.type || !['http', 'stdio'].includes(config.transport.type)) {
      return { valid: false, error: 'Transport type must be "http" or "stdio"' };
    }

    // Validate based on transport type
    if (config.transport.type === 'http') {
      if (!config.transport.endpoint || typeof config.transport.endpoint !== 'string') {
        return { valid: false, error: 'HTTP transport requires an endpoint URL' };
      }

      // Basic URL validation
      try {
        new URL(config.transport.endpoint);
      } catch {
        return { valid: false, error: 'Invalid endpoint URL' };
      }
    } else if (config.transport.type === 'stdio') {
      if (!config.transport.command || typeof config.transport.command !== 'string') {
        return { valid: false, error: 'STDIO transport requires a command' };
      }

      if (config.transport.args && !Array.isArray(config.transport.args)) {
        return { valid: false, error: 'STDIO transport args must be an array' };
      }

      if (config.transport.env && typeof config.transport.env !== 'object') {
        return { valid: false, error: 'STDIO transport env must be an object' };
      }
    }

    return { valid: true };
  }
}

export default new MCPService();
