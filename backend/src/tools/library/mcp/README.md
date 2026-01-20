# Comprehensive MCP Client for TaskTitan

A full-featured Node.js client for the **Model Context Protocol (MCP)** supporting both **STDIO** (local agents) and **HTTP(S)/SSE** (remote agents) transports, with automatic server discovery and fleet management capabilities.

## 🚀 Features

### Core Capabilities

- ✅ **Dual Transport Support**: HTTP/SSE and STDIO
- ✅ **Full MCP Protocol**: Tools, Resources, Prompts, Roots, Sampling
- ✅ **Automatic Discovery**: Find servers from multiple sources
- ✅ **Fleet Management**: Manage hundreds of servers efficiently
- ✅ **Connection Pooling**: Lazy connections with automatic cleanup
- ✅ **Reliability**: Circuit breakers, exponential backoff, health checks
- ✅ **Concurrency Control**: Configurable concurrent operations

### MCP Protocol Support

| Feature            | Methods                                                                            | Status      |
| ------------------ | ---------------------------------------------------------------------------------- | ----------- |
| **Initialization** | `initialize`                                                                       | ✅ Complete |
| **Tools**          | `tools/list`, `tools/call`                                                         | ✅ Complete |
| **Resources**      | `resources/list`, `resources/read`, `resources/subscribe`, `resources/unsubscribe` | ✅ Complete |
| **Prompts**        | `prompts/list`, `prompts/get`                                                      | ✅ Complete |
| **Roots**          | `roots/list`                                                                       | ✅ Complete |
| **Sampling**       | `sampling/createMessage`                                                           | ✅ Complete |
| **Logging**        | `logging/setLevel`                                                                 | ✅ Complete |
| **Notifications**  | Server→Client notifications                                                        | ✅ Complete |

## 📦 Architecture

```
backend/src/tools/library/mcp/
├── MCPClient.js              # Core client with full protocol support
├── MCPDiscovery.js           # Automatic server discovery
├── MCPFleetManager.js        # Fleet management for scale
├── transports/
│   ├── HTTPTransport.js      # HTTP/SSE transport
│   └── STDIOTransport.js     # Process-based transport
└── utils/
    ├── Semaphore.js          # Concurrency control
    ├── Backoff.js            # Exponential backoff
    └── Circuit.js            # Circuit breaker pattern
```

## 🔧 Usage

### 1. Single Server Connection

```javascript
import MCPClient from './mcp/MCPClient.js';

// HTTP/SSE Transport
const client = new MCPClient({
  transport: 'http',
  transportOptions: {
    endpoint: 'https://mcp.example.com',
    headers: { Authorization: 'Bearer token' },
  },
  clientName: 'my-app',
  roots: [{ uri: 'file:///workspace', name: 'workspace' }],
});

await client.initialize();

// List and call tools
const tools = await client.listTools();
const result = await client.callTool('search', { query: 'hello' });

// Work with resources
const resources = await client.listResources();
const data = await client.readResource('file:///data.json');

// Use prompts
const prompts = await client.listPrompts();
const prompt = await client.getPrompt('greeting', { name: 'Alice' });

await client.close();
```

```javascript
// STDIO Transport
const client = new MCPClient({
  transport: 'stdio',
  transportOptions: {
    command: 'node',
    args: ['./mcp-server.js'],
    cwd: '/path/to/server',
    env: { API_KEY: 'secret' },
  },
  clientName: 'my-app',
});

await client.initialize();
// ... use client
await client.close();
```

### 2. Automatic Discovery

```javascript
import MCPDiscovery from './mcp/MCPDiscovery.js';

const discovery = new MCPDiscovery();

// Discover from all sources
const servers = await discovery.discoverAll({
  baseUrls: ['https://api.example.com', 'https://mcp.example.org'],
});

console.log(`Found ${servers.length} servers`);

// Get specific server
const server = discovery.getServer('my-server');

// Filter by transport
const httpServers = discovery.getServersByTransport('http');
const stdioServers = discovery.getServersByTransport('stdio');
```

#### Discovery Sources

1. **Current directory**: `./mcp.json`
2. **User config**:
   - Linux: `~/.config/mcp/mcp.json`
   - macOS: `~/Library/Application Support/mcp/mcp.json`
   - Windows: `%APPDATA%/mcp/mcp.json`
3. **VSCode workspace**: `./.vscode/mcp.json`
4. **Environment variable**: `MCP_SERVERS`
5. **Well-known endpoints**: `https://example.com/.well-known/mcp.json`

### 3. Fleet Management

```javascript
import MCPFleetManager from './mcp/MCPFleetManager.js';

// Create fleet with discovered servers
const fleet = new MCPFleetManager(servers, {
  concurrency: 20,
  clientName: 'fleet-manager',
  httpHeaders: { 'X-Tenant': 'ACME' },
});

// Health check across all servers
const health = await fleet.healthCheck();

// List tools across multiple servers
const toolsByServer = await fleet.listToolsAcross(['server1', 'server2', 'server3'], { concurrency: 10, tolerateErrors: true });

// Call same tool on multiple servers
const results = await fleet.callToolAcross(
  'search',
  { query: 'hello' },
  undefined, // all servers
  { concurrency: 15 }
);

// Results format: { serverName: { ok: true, data: {...} } }
Object.entries(results).forEach(([name, result]) => {
  if (result.ok) {
    console.log(`${name}: Success`, result.data);
  } else {
    console.log(`${name}: Failed`, result.error);
  }
});

await fleet.disconnectAll();
```

### 4. Configuration Format

```json
{
  "servers": [
    {
      "name": "local-stdio",
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["./server.js"],
        "cwd": "/path/to/server",
        "env": {
          "API_KEY": "secret"
        }
      },
      "roots": [
        {
          "uri": "file:///workspace",
          "name": "workspace"
        }
      ]
    },
    {
      "name": "remote-http",
      "transport": {
        "type": "http",
        "endpoint": "https://mcp.example.com",
        "headers": {
          "Authorization": "Bearer token"
        }
      }
    }
  ]
}
```

## 🎯 Workflow Integration

The MCP client is integrated into TaskTitan's workflow engine with three modes:

### Mode 1: Discover Servers

Automatically find all available MCP servers from configuration files and environment.

**Parameters:**

- `baseUrls` (optional): Additional URLs for `.well-known/mcp.json` discovery

**Outputs:**

- `servers`: Array of discovered servers
- `count`: Number of servers found

### Mode 2: Single Server

Connect to a specific server and perform operations.

**Parameters:**

- `serverUrl` OR `serverName`: Direct URL or discovered server name
- `action`: Operation to perform (List Tools, Call Tool, List Resources, etc.)
- Action-specific parameters (toolName, toolArgs, resourceUri, etc.)

**Outputs:**

- `result`: Operation result
- `serverInfo`: Server capabilities and info

### Mode 3: Fleet Operations

Execute operations across multiple servers concurrently.

**Parameters:**

- `fleetAction`: Operation (Health Check, List Tools Across, Call Tool Across, etc.)
- `serverNames` (optional): Target servers (defaults to all)
- `concurrency`: Max concurrent connections (default: 20)

**Outputs:**

- `result`: Results by server
- `summary`: Success/failure counts

## 🔒 Reliability Features

### Circuit Breaker

Prevents repeated attempts to failing servers:

- Tracks failure count per server
- Opens circuit after threshold (default: 5 failures)
- Cooldown period (default: 30 seconds)

### Exponential Backoff

Gradually increases delay between retries:

- Base delay: 250ms
- Max delay: 30 seconds
- Factor: 2x per attempt
- Jitter: ±25% randomization

### Concurrency Control

Limits simultaneous operations:

- Semaphore-based queuing
- Configurable max concurrent connections
- Prevents resource exhaustion

### Health Checks

Monitor server status:

- Connection state tracking
- Last check timestamp
- Server info and capabilities
- Success/failure history

## 📊 Scaling to Hundreds of Servers

The fleet manager is designed to handle large-scale deployments:

```javascript
// Example: 500 servers
const registry = [];
for (let i = 0; i < 500; i++) {
  registry.push({
    name: `server-${i}`,
    transport: 'http',
    http: { endpoint: `https://mcp${i}.example.com` },
  });
}

const fleet = new MCPFleetManager(registry, {
  concurrency: 25,
  clientName: 'mega-fleet',
});

// Fan-out operation with controlled concurrency
const results = await fleet.listToolsAcross(undefined, {
  concurrency: 25,
  tolerateErrors: true,
});

console.log(`Success: ${Object.values(results).filter((r) => r.ok).length}/500`);
```

### Best Practices for Scale

1. **Lazy Connections**: Servers connect on-demand, not upfront
2. **Concurrency Limits**: Cap at 10-50 concurrent connections
3. **Error Tolerance**: Use `tolerateErrors: true` for wide scans
4. **Health Monitoring**: Regular health checks to identify issues
5. **Circuit Breakers**: Automatic failure isolation
6. **Resource Cleanup**: Always disconnect when done

## 🧪 Testing

```javascript
// Test HTTP transport
const httpClient = new MCPClient({
  transport: 'http',
  transportOptions: { endpoint: 'http://localhost:3000' },
});

await httpClient.initialize();
console.log('Server info:', httpClient.getServerInfo());
await httpClient.close();

// Test STDIO transport
const stdioClient = new MCPClient({
  transport: 'stdio',
  transportOptions: {
    command: 'node',
    args: ['./test-server.js'],
  },
});

await stdioClient.initialize();
const tools = await stdioClient.listTools();
console.log('Tools:', tools);
await stdioClient.close();
```

## 🐛 Debugging

Enable detailed logging:

```javascript
// Set logging level
await client.setLoggingLevel('debug');

// Monitor notifications
client.onNotification((notification) => {
  console.log('Notification:', notification);
});

// Check connection state
const info = client.getServerInfo();
console.log('Connected:', info.initialized);
console.log('Transport:', info.transportType);
```

## 📝 License

MIT License © 2025 TaskTitan

## 🤝 Contributing

This MCP client implementation follows the official MCP specification:

- Protocol Version: 2024-11-05
- Spec: https://modelcontextprotocol.io/

For issues or improvements, please refer to the TaskTitan project documentation.
