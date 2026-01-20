import BaseAction from '../BaseAction.js';
import MCPClient from '../mcp/MCPClient.js';
import MCPDiscovery from '../mcp/MCPDiscovery.js';
import MCPFleetManager from '../mcp/MCPFleetManager.js';

/**
 * Comprehensive MCP Client Action Node
 * Supports SSE, STDIO, discovery, and fleet operations
 */
class McpClientAction extends BaseAction {
  static schema = {
    title: 'MCP Client',
    category: 'action',
    type: 'mcp-client',
    icon: 'claude',
    description:
      'Connect to MCP (Model Context Protocol) servers. Automatically discovers servers from mcp.json. WORKFLOW: 1) List Servers to see available MCPs, 2) Get Server Capabilities to see what tools/resources a server offers, 3) Use Server to call those tools/resources.',
    parameters: {
      operation: {
        type: 'string',
        inputType: 'select',
        inputSize: 'full',
        options: ['List Servers', 'Get Server Capabilities', 'Use Server', 'Connect to Remote URL', 'Close Connection', 'Close All Connections'],
        default: 'List Servers',
        description:
          "REQUIRED WORKFLOW: First use 'List Servers' to see available MCPs, then 'Get Server Capabilities' to see what a specific server offers (tools/resources/prompts), finally 'Use Server' to call those capabilities. 'Connect to Remote URL' connects directly to a remote MCP server via URL. 'Close Connection' resets a specific server connection. 'Close All Connections' resets all server connections.",
      },
      serverUrl: {
        type: 'string',
        inputType: 'text',
        description:
          'Remote MCP server URL (e.g., https://api.githubcopilot.com/mcp/, https://mcp.notion.com/mcp, https://mcp.sentry.dev/sse, https://mcp.linear.app/sse)',
        conditional: {
          field: 'operation',
          value: 'Connect to Remote URL',
        },
      },
      authToken: {
        type: 'string',
        inputType: 'password',
        description: 'Optional Bearer token for authentication (if required by the remote server)',
        conditional: {
          field: 'operation',
          value: 'Connect to Remote URL',
        },
      },
      serverName: {
        type: 'string',
        inputType: 'text',
        description: 'Name of the MCP server (from the List Servers output). Example: chrome-devtools, local-example-server',
        conditional: {
          field: 'operation',
          value: ['Get Server Capabilities', 'Use Server', 'Close Connection'],
        },
      },
      action: {
        type: 'string',
        inputType: 'select',
        options: ['List Tools', 'Call Tool', 'List Resources', 'Read Resource', 'List Prompts', 'Get Prompt'],
        default: 'List Tools',
        description: 'The action to perform on the MCP server',
        conditional: {
          field: 'operation',
          value: ['Use Server', 'Connect to Remote URL'],
        },
      },
      toolName: {
        type: 'string',
        inputType: 'text',
        description: "Name of the tool to call (from the server's tools list)",
        conditional: {
          field: 'action',
          value: 'Call Tool',
        },
      },
      toolArgs: {
        type: 'string',
        inputType: 'textarea',
        description:
          'JSON STRING of arguments for the tool. Must be a valid JSON string, not an object. Example: "{\\"query\\": \\"hello\\", \\"limit\\": 10}"',
        conditional: {
          field: 'action',
          value: 'Call Tool',
        },
      },
      resourceUri: {
        type: 'string',
        inputType: 'text',
        description: "URI of the resource (from the server's resources list). Example: file:///path/to/file.txt",
        conditional: {
          field: 'action',
          value: 'Read Resource',
        },
      },
      promptName: {
        type: 'string',
        inputType: 'text',
        description: "Name of the prompt to retrieve (from the server's prompts list)",
        conditional: {
          field: 'action',
          value: 'Get Prompt',
        },
      },
      promptArgs: {
        type: 'string',
        inputType: 'textarea',
        description: 'JSON object of arguments for the prompt template. Example: {"name": "John", "topic": "AI"}',
        conditional: {
          field: 'action',
          value: 'Get Prompt',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the operation was successful',
      },
      servers: {
        type: 'array',
        description: 'List of available MCP servers (for List Servers operation)',
      },
      count: {
        type: 'number',
        description: 'Number of available servers (for List Servers operation)',
      },
      serverName: {
        type: 'string',
        description: 'Name of the server (for Get Server Capabilities operation)',
      },
      capabilities: {
        type: 'object',
        description: 'Server capabilities including tools, resources, and prompts arrays (for Get Server Capabilities operation)',
      },
      toolCount: {
        type: 'number',
        description: 'Number of tools available (for Get Server Capabilities operation)',
      },
      resourceCount: {
        type: 'number',
        description: 'Number of resources available (for Get Server Capabilities operation)',
      },
      promptCount: {
        type: 'number',
        description: 'Number of prompts available (for Get Server Capabilities operation)',
      },
      result: {
        type: 'object',
        description: 'The result of the action (for Use Server operation)',
      },
      serverInfo: {
        type: 'object',
        description: 'Server information including version and capabilities',
      },
      error: {
        type: 'string',
        description: 'Error message if the operation failed',
      },
    },
  };

  constructor() {
    super('mcp-client');
    this.discovery = new MCPDiscovery();
    this.fleetManager = null;
    this.discoveredServers = [];
    this.workflowClients = new Map(); // Map of workflowId -> Map of active clients
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const { operation, serverName, action, toolName, toolArgs, resourceUri, promptName, promptArgs } = params;

      console.log('[MCP Client] Executing with params:', JSON.stringify(params, null, 2));

      // Get workflow run ID to scope connections per run
      // All nodes in the same workflow run share connections, but different runs get fresh connections
      const workflowId = workflowEngine?.workflowId || 'default';
      const executionId = workflowEngine?.currentExecutionId || inputData?.trigger?.timestamp || 'default';
      const connectionKey = `${workflowId}-${executionId}`;

      console.log(`[MCP Client] Connection key: ${connectionKey} (workflowId: ${workflowId}, executionId: ${executionId})`);

      // Initialize client map for this execution if it doesn't exist
      if (!this.workflowClients.has(connectionKey)) {
        this.workflowClients.set(connectionKey, new Map());
        console.log(`[MCP Client] Initialized client map for execution ${connectionKey}`);
      }

      const activeClients = this.workflowClients.get(connectionKey);

      // ALWAYS re-discover servers to pick up new additions from mcp.json
      // This ensures new MCP servers are available without server restart
      console.log('[MCP Client] Discovering servers from mcp.json...');
      await this._handleDiscovery({});

      // Operation: List Servers (default if no operation specified)
      if (!operation || operation === 'List Servers') {
        return {
          success: true,
          servers: this.discoveredServers.map((s) => ({
            name: s.name,
            transport: s.transport,
            from: s.from,
          })),
          count: this.discoveredServers.length,
        };
      }

      // Operation: Get Server Capabilities
      if (operation === 'Get Server Capabilities') {
        if (!serverName) {
          throw new Error('serverName is required for Get Server Capabilities');
        }
        return await this._getServerCapabilities(serverName);
      }

      // Operation: Use Server (execute action on server)
      if (operation === 'Use Server') {
        if (!serverName) {
          throw new Error('serverName is required for Use Server');
        }
        if (!action) {
          throw new Error('action is required for Use Server');
        }
        return await this._handleSingleServer({ serverName, action, toolName, toolArgs, resourceUri, promptName, promptArgs }, activeClients);
      }

      // Operation: Connect to Remote URL (direct URL connection)
      if (operation === 'Connect to Remote URL') {
        const { serverUrl, authToken } = params;
        if (!serverUrl) {
          throw new Error('serverUrl is required for Connect to Remote URL');
        }
        if (!action) {
          throw new Error('action is required for Connect to Remote URL');
        }

        // Add auth header if provided
        const headers = {};
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        return await this._handleSingleServer(
          {
            serverUrl,
            action,
            toolName,
            toolArgs,
            resourceUri,
            promptName,
            promptArgs,
            headers,
          },
          activeClients
        );
      }

      // Operation: Close Connection (force close a server connection)
      if (operation === 'Close Connection') {
        if (!serverName) {
          throw new Error('serverName is required for Close Connection');
        }
        return await this._closeConnection(serverName, activeClients);
      }

      // Operation: Close All Connections
      if (operation === 'Close All Connections') {
        return await this._closeAllConnections(connectionKey);
      }

      throw new Error(`Unknown operation: ${operation || 'undefined'}`);
    } catch (error) {
      console.error('[MCP Client] Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async _getServerCapabilities(serverName) {
    const serverConfig = this.discovery.getServer(serverName);
    if (!serverConfig) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // Create client
    const clientOptions = {
      transport: serverConfig.transport,
      clientName: 'TaskTitan-MCP-Client',
      roots: serverConfig.roots || [],
    };

    if (serverConfig.transport === 'http' || serverConfig.transport === 'http-post') {
      clientOptions.transport = serverConfig.transport;
      clientOptions.transportOptions = {
        endpoint: serverConfig.http.endpoint,
        headers: serverConfig.http.headers || {},
      };
    } else if (serverConfig.transport === 'stdio') {
      clientOptions.transportOptions = {
        command: serverConfig.stdio.command,
        args: serverConfig.stdio.args || [],
        cwd: serverConfig.stdio.cwd,
        env: serverConfig.stdio.env || {},
      };
    }

    const client = new MCPClient(clientOptions);

    try {
      // Initialize
      await client.initialize();

      // Get all capabilities
      const [tools, resources, prompts] = await Promise.all([
        client.listTools().catch(() => []),
        client.listResources().catch(() => []),
        client.listPrompts().catch(() => []),
      ]);

      return {
        success: true,
        serverName,
        serverInfo: client.getServerInfo(),
        capabilities: {
          tools,
          resources,
          prompts,
        },
        toolCount: tools.length,
        resourceCount: resources.length,
        promptCount: prompts.length,
      };
    } finally {
      await client.close();
    }
  }
  async _handleDiscovery(params) {
    const { baseUrls } = params;

    console.log('[MCP Client] Discovering servers...');

    const options = {};
    if (baseUrls) {
      try {
        options.baseUrls = JSON.parse(baseUrls);
      } catch (err) {
        options.baseUrls = baseUrls.split(',').map((u) => u.trim());
      }
    }

    this.discoveredServers = await this.discovery.discoverAll(options);

    return {
      success: true,
      servers: this.discoveredServers,
      count: this.discoveredServers.length,
      result: {
        servers: this.discoveredServers,
        byTransport: {
          http: this.discovery.getServersByTransport('http').length,
          stdio: this.discovery.getServersByTransport('stdio').length,
        },
      },
    };
  }
  async _handleSingleServer(params, activeClients) {
    const { serverUrl, serverName, transport, action, toolName, toolArgs, resourceUri, promptName, promptArgs, headers } = params;

    let serverConfig;

    // Determine server configuration
    if (serverName) {
      // Use discovered server - auto-discover if not already done
      serverConfig = this.discovery.getServer(serverName);
      if (!serverConfig) {
        console.log('[MCP Client] Server not found in cache, running discovery...');
        await this._handleDiscovery(params);
        serverConfig = this.discovery.getServer(serverName);
        if (!serverConfig) {
          throw new Error(`Server "${serverName}" not found even after discovery. Check mcp.json configuration.`);
        }
      }
    } else if (serverUrl) {
      // Use direct URL (HTTP transport)
      // Generate a unique name based on the URL
      const urlObj = new URL(serverUrl);
      const urlName = `remote-${urlObj.host}${urlObj.pathname.replace(/\//g, '-')}`;

      serverConfig = {
        name: urlName,
        transport: 'http',
        http: {
          endpoint: serverUrl,
          headers: headers || {},
        },
      };
    } else {
      throw new Error('Either serverUrl or serverName is required');
    }

    // Create client
    const clientOptions = {
      transport: serverConfig.transport,
      clientName: 'TaskTitan-MCP-Client',
      roots: serverConfig.roots || [],
    };

    if (serverConfig.transport === 'http' || serverConfig.transport === 'http-post') {
      clientOptions.transportOptions = {
        endpoint: serverConfig.http.endpoint,
        headers: {
          ...(serverConfig.http.headers || {}),
          ...(headers || {}),
        },
      };
    } else if (serverConfig.transport === 'stdio') {
      clientOptions.transportOptions = {
        command: serverConfig.stdio.command,
        args: serverConfig.stdio.args || [],
        cwd: serverConfig.stdio.cwd,
        env: serverConfig.stdio.env || {},
      };
    }

    // Check if we already have an active client for this server
    const clientKey = serverConfig.name;
    let client = activeClients.get(clientKey);

    if (!client) {
      // Create new client if one doesn't exist
      client = new MCPClient(clientOptions);
      await client.initialize();
      activeClients.set(clientKey, client);
      console.log(`[MCP Client] Created new connection for ${clientKey}`);
    } else {
      console.log(`[MCP Client] Reusing existing connection for ${clientKey}`);
    }

    try {
      // Perform action
      let result;

      switch (action) {
        case 'Get Server Info':
          result = client.getServerInfo();
          break;

        case 'List Tools':
          result = await client.listTools();
          break;

        case 'Call Tool':
          if (!toolName) throw new Error('toolName is required for Call Tool');
          const parsedArgs = toolArgs ? JSON.parse(toolArgs) : {};
          result = await client.callTool(toolName, parsedArgs);
          break;

        case 'List Resources':
          result = await client.listResources();
          break;

        case 'Read Resource':
          if (!resourceUri) throw new Error('resourceUri is required for Read Resource');
          result = await client.readResource(resourceUri);
          break;

        case 'Subscribe Resource':
          if (!resourceUri) throw new Error('resourceUri is required for Subscribe Resource');
          result = await client.subscribeResource(resourceUri);
          break;

        case 'Unsubscribe Resource':
          if (!resourceUri) throw new Error('resourceUri is required for Unsubscribe Resource');
          result = await client.unsubscribeResource(resourceUri);
          break;

        case 'List Prompts':
          result = await client.listPrompts();
          break;

        case 'Get Prompt':
          if (!promptName) throw new Error('promptName is required for Get Prompt');
          const parsedPromptArgs = promptArgs ? JSON.parse(promptArgs) : {};
          result = await client.getPrompt(promptName, parsedPromptArgs);
          break;

        case 'List Roots':
          result = await client.listRoots();
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return {
        success: true,
        result,
        serverInfo: client.getServerInfo(),
      };
    } catch (error) {
      // If there's an error, close and remove the client so it can be recreated next time
      console.error(`[MCP Client] Error with ${clientKey}, closing connection:`, error);
      activeClients.delete(clientKey);
      await client.close();
      throw error;
    }
  }
  async _handleFleetOperations(params) {
    const { fleetAction, toolName, toolArgs, serverNames, serverUrl, concurrency } = params;

    // Parse server names/URLs
    let targetServers = [];
    if (serverNames) {
      try {
        targetServers = JSON.parse(serverNames);
      } catch (err) {
        targetServers = serverNames.split(',').map((s) => s.trim());
      }
    } else if (serverUrl) {
      // Single URL provided
      targetServers = [serverUrl];
    }

    // Check if we have URLs (start with http) or server names
    const hasUrls = targetServers.some((s) => s.startsWith('http://') || s.startsWith('https://'));

    if (hasUrls) {
      // Add URLs as temporary servers to the fleet manager
      const tempServers = targetServers
        .filter((s) => s.startsWith('http://') || s.startsWith('https://'))
        .map((url) => ({
          name: url,
          transport: 'http',
          http: { endpoint: url },
        }));

      // Create or update fleet manager with temp servers
      if (!this.fleetManager) {
        this.fleetManager = new MCPFleetManager(tempServers, {
          concurrency: concurrency || 20,
          clientName: 'TaskTitan-Fleet-Manager',
        });
      } else {
        // Add temp servers to existing fleet
        for (const server of tempServers) {
          if (!this.fleetManager.registry.has(server.name)) {
            this.fleetManager.addServer(server);
          }
        }
      }
    } else {
      // Using server names - need discovered servers
      if (!this.fleetManager || this.discoveredServers.length === 0) {
        // Discover servers first
        await this._handleDiscovery(params);

        // Create fleet manager
        this.fleetManager = new MCPFleetManager(this.discoveredServers, {
          concurrency: concurrency || 20,
          clientName: 'TaskTitan-Fleet-Manager',
        });
      }

      // If no target servers specified, use all discovered
      if (targetServers.length === 0) {
        targetServers = this.fleetManager.getServerNames();
      }
    }

    const options = {
      concurrency: concurrency || 20,
      tolerateErrors: true,
    };

    let result;

    switch (fleetAction) {
      case 'Health Check':
        result = await this.fleetManager.healthCheck(targetServers, options);
        break;

      case 'List Tools Across':
        result = await this.fleetManager.listToolsAcross(targetServers, options);
        break;

      case 'List Resources Across':
        result = await this.fleetManager.listResourcesAcross(targetServers, options);
        break;

      case 'List Prompts Across':
        result = await this.fleetManager.listPromptsAcross(targetServers, options);
        break;

      case 'Call Tool Across':
        if (!toolName) throw new Error('toolName is required for Call Tool Across');
        const parsedArgs = toolArgs ? JSON.parse(toolArgs) : {};
        result = await this.fleetManager.callToolAcross(toolName, parsedArgs, targetServers, options);
        break;

      default:
        throw new Error(`Unknown fleet action: ${fleetAction}`);
    }

    // Calculate summary
    const summary = {
      total: targetServers.length,
      successful: Object.values(result).filter((r) => r.ok).length,
      failed: Object.values(result).filter((r) => !r.ok).length,
    };

    return {
      success: true,
      result,
      summary,
      servers: targetServers,
    };
  }
  async _closeConnection(serverName, activeClients) {
    const client = activeClients.get(serverName);
    if (client) {
      await client.close();
      activeClients.delete(serverName);
      console.log(`[MCP Client] Closed connection for ${serverName}`);
      return {
        success: true,
        message: `Connection to ${serverName} closed`,
      };
    }
    return {
      success: false,
      message: `No active connection found for ${serverName}`,
    };
  }
  async _closeAllConnections(connectionKey) {
    const activeClients = this.workflowClients.get(connectionKey);
    if (!activeClients) {
      return {
        success: true,
        closedConnections: [],
        count: 0,
      };
    }

    const serverNames = Array.from(activeClients.keys());
    for (const name of serverNames) {
      const client = activeClients.get(name);
      if (client) {
        await client.close();
      }
    }
    activeClients.clear();
    this.workflowClients.delete(connectionKey);
    console.log(`[MCP Client] Closed all connections for execution ${connectionKey} (${serverNames.length} total)`);
    return {
      success: true,
      closedConnections: serverNames,
      count: serverNames.length,
    };
  }
}

export default new McpClientAction();
