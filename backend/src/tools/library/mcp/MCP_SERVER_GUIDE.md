# Building a Comprehensive MCP Server

A complete guide to creating a Model Context Protocol (MCP) server that works with the TaskTitan MCP client.

## 📋 Table of Contents

1. [MCP Server Basics](#mcp-server-basics)
2. [Server Structure](#server-structure)
3. [Complete Example Server](#complete-example-server)
4. [Implementing All MCP Features](#implementing-all-mcp-features)
5. [Testing Your Server](#testing-your-server)
6. [Deployment](#deployment)

---

## 🎯 MCP Server Basics

### What is an MCP Server?

An MCP server is a JSON-RPC 2.0 server that provides:

- **Tools** - Functions that can be called (like APIs)
- **Resources** - Data sources that can be read (like files, databases)
- **Prompts** - Template prompts for LLMs
- **Roots** - File system roots (optional)
- **Sampling** - LLM generation capabilities (optional)

### Communication Methods

MCP servers can use two transport methods:

1. **HTTP/SSE (Server-Sent Events)** - For remote servers

   - POST to `/messages` for requests
   - GET to `/sse` for server→client notifications

2. **STDIO** - For local servers
   - Newline-delimited JSON over stdin/stdout
   - Spawned as child process

---

## 🏗️ Server Structure

### Minimal Server Structure

```javascript
// mcp-server.js
import express from 'express';
import { EventEmitter } from 'events';

class MCPServer {
  constructor() {
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.clients = new Map();
    this.events = new EventEmitter();
  }

  // Register a tool
  registerTool(name, description, inputSchema, handler) {
    this.tools.set(name, { name, description, inputSchema, handler });
  }

  // Register a resource
  registerResource(uri, name, mimeType, handler) {
    this.resources.set(uri, { uri, name, mimeType, handler });
  }

  // Register a prompt
  registerPrompt(name, description, arguments, handler) {
    this.prompts.set(name, { name, description, arguments, handler });
  }

  // Handle JSON-RPC request
  async handleRequest(request) {
    const { jsonrpc, id, method, params } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = await this.handleInitialize(params);
          break;
        case 'tools/list':
          result = await this.handleListTools();
          break;
        case 'tools/call':
          result = await this.handleCallTool(params);
          break;
        case 'resources/list':
          result = await this.handleListResources();
          break;
        case 'resources/read':
          result = await this.handleReadResource(params);
          break;
        case 'prompts/list':
          result = await this.handleListPrompts();
          break;
        case 'prompts/get':
          result = await this.handleGetPrompt(params);
          break;
        default:
          throw { code: -32601, message: `Method ${method} not found` };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: error.code || -32603,
          message: error.message || 'Internal error',
        },
      };
    }
  }

  // Start HTTP server
  startHTTP(port = 3001) {
    const app = express();
    app.use(express.json());

    // SSE endpoint for client connections
    app.get('/sse', (req, res) => {
      const clientId = Date.now().toString();

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      this.clients.set(clientId, res);

      // Send connection event
      res.write(`event: connection\n`);
      res.write(`data: ${JSON.stringify({ connectionId: clientId })}\n\n`);

      req.on('close', () => {
        this.clients.delete(clientId);
      });
    });

    // Messages endpoint for requests
    app.post('/messages', async (req, res) => {
      const response = await this.handleRequest(req.body);
      res.json(response);
    });

    app.listen(port, () => {
      console.log(`MCP Server running on http://localhost:${port}`);
    });
  }
}

export default MCPServer;
```

---

## 💻 Complete Example Server

Here's a fully functional MCP server with all features:

```javascript
// comprehensive-mcp-server.js
import express from 'express';
import { EventEmitter } from 'events';

class ComprehensiveMCPServer {
  constructor(options = {}) {
    this.serverName = options.name || 'comprehensive-mcp-server';
    this.serverVersion = options.version || '1.0.0';
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.clients = new Map();
    this.events = new EventEmitter();

    // Register built-in tools, resources, and prompts
    this.registerBuiltins();
  }

  registerBuiltins() {
    // ==================== TOOLS ====================

    // Calculator tools
    this.registerTool(
      'add',
      'Add two numbers together',
      {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
      async (args) => {
        const result = args.a + args.b;
        return {
          content: [
            {
              type: 'text',
              text: `${args.a} + ${args.b} = ${result}`,
            },
          ],
        };
      }
    );

    this.registerTool(
      'multiply',
      'Multiply two numbers',
      {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
      async (args) => {
        const result = args.a * args.b;
        return {
          content: [
            {
              type: 'text',
              text: `${args.a} × ${args.b} = ${result}`,
            },
          ],
        };
      }
    );

    // String manipulation tool
    this.registerTool(
      'reverse_string',
      'Reverse a string',
      {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to reverse' },
        },
        required: ['text'],
      },
      async (args) => {
        const reversed = args.text.split('').reverse().join('');
        return {
          content: [
            {
              type: 'text',
              text: reversed,
            },
          ],
        };
      }
    );

    // Search tool (example)
    this.registerTool(
      'search',
      'Search for information',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results', default: 10 },
        },
        required: ['query'],
      },
      async (args) => {
        // Simulate search results
        const results = [
          { title: `Result 1 for "${args.query}"`, url: 'https://example.com/1' },
          { title: `Result 2 for "${args.query}"`, url: 'https://example.com/2' },
        ];

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }
    );

    // ==================== RESOURCES ====================

    // Static data resource
    this.registerResource('data://config', 'Server Configuration', 'application/json', async () => ({
      uri: 'data://config',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          serverName: this.serverName,
          version: this.serverVersion,
          uptime: process.uptime(),
        },
        null,
        2
      ),
    }));

    // Dynamic data resource
    this.registerResource('data://stats', 'Server Statistics', 'application/json', async () => ({
      uri: 'data://stats',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          toolsRegistered: this.tools.size,
          resourcesRegistered: this.resources.size,
          promptsRegistered: this.prompts.size,
          activeClients: this.clients.size,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    }));

    // ==================== PROMPTS ====================

    this.registerPrompt(
      'greeting',
      'Generate a personalized greeting',
      [
        {
          name: 'name',
          description: 'Name of the person to greet',
          required: true,
        },
        {
          name: 'language',
          description: 'Language for the greeting',
          required: false,
        },
      ],
      async (args) => {
        const greetings = {
          english: `Hello, ${args.name}! Welcome!`,
          spanish: `¡Hola, ${args.name}! ¡Bienvenido!`,
          french: `Bonjour, ${args.name}! Bienvenue!`,
        };

        const language = (args.language || 'english').toLowerCase();
        const greeting = greetings[language] || greetings.english;

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: greeting,
              },
            },
          ],
        };
      }
    );

    this.registerPrompt(
      'code_review',
      'Generate a code review prompt',
      [
        {
          name: 'code',
          description: 'Code to review',
          required: true,
        },
        {
          name: 'language',
          description: 'Programming language',
          required: true,
        },
      ],
      async (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please review this ${args.language} code:\n\n${args.code}\n\nProvide feedback on:\n1. Code quality\n2. Best practices\n3. Potential bugs\n4. Suggestions for improvement`,
            },
          },
        ],
      })
    );
  }

  // ==================== TOOL METHODS ====================

  registerTool(name, description, inputSchema, handler) {
    this.tools.set(name, {
      name,
      description,
      inputSchema,
      handler,
    });
    console.log(`[MCP Server] Registered tool: ${name}`);
  }

  async handleListTools() {
    const tools = Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));

    return { tools };
  }

  async handleCallTool(params) {
    const { name, arguments: args } = params;

    const tool = this.tools.get(name);
    if (!tool) {
      throw { code: -32602, message: `Tool "${name}" not found` };
    }

    try {
      const result = await tool.handler(args || {});
      return result;
    } catch (error) {
      throw {
        code: -32603,
        message: `Tool execution failed: ${error.message}`,
      };
    }
  }

  // ==================== RESOURCE METHODS ====================

  registerResource(uri, name, mimeType, handler) {
    this.resources.set(uri, {
      uri,
      name,
      mimeType,
      handler,
    });
    console.log(`[MCP Server] Registered resource: ${uri}`);
  }

  async handleListResources() {
    const resources = Array.from(this.resources.values()).map(({ uri, name, mimeType }) => ({
      uri,
      name,
      mimeType,
    }));

    return { resources };
  }

  async handleReadResource(params) {
    const { uri } = params;

    const resource = this.resources.get(uri);
    if (!resource) {
      throw { code: -32602, message: `Resource "${uri}" not found` };
    }

    try {
      const contents = await resource.handler();
      return { contents: [contents] };
    } catch (error) {
      throw {
        code: -32603,
        message: `Resource read failed: ${error.message}`,
      };
    }
  }

  // ==================== PROMPT METHODS ====================

  registerPrompt(name, description, argumentsList, handler) {
    this.prompts.set(name, {
      name,
      description,
      arguments: argumentsList,
      handler,
    });
    console.log(`[MCP Server] Registered prompt: ${name}`);
  }

  async handleListPrompts() {
    const prompts = Array.from(this.prompts.values()).map(({ name, description, arguments: args }) => ({
      name,
      description,
      arguments: args,
    }));

    return { prompts };
  }

  async handleGetPrompt(params) {
    const { name, arguments: args } = params;

    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw { code: -32602, message: `Prompt "${name}" not found` };
    }

    try {
      const result = await prompt.handler(args || {});
      return result;
    } catch (error) {
      throw {
        code: -32603,
        message: `Prompt generation failed: ${error.message}`,
      };
    }
  }

  // ==================== INITIALIZATION ====================

  async handleInitialize(params) {
    console.log('[MCP Server] Client initialized:', params.clientInfo);

    return {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: this.serverName,
        version: this.serverVersion,
      },
      capabilities: {
        tools: {},
        resources: {
          subscribe: false,
          listChanged: false,
        },
        prompts: {},
      },
    };
  }

  // ==================== REQUEST HANDLING ====================

  async handleRequest(request) {
    const { jsonrpc, id, method, params } = request;

    console.log(`[MCP Server] Request: ${method}`, params ? JSON.stringify(params).substring(0, 100) : '');

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = await this.handleInitialize(params);
          break;
        case 'tools/list':
          result = await this.handleListTools();
          break;
        case 'tools/call':
          result = await this.handleCallTool(params);
          break;
        case 'resources/list':
          result = await this.handleListResources();
          break;
        case 'resources/read':
          result = await this.handleReadResource(params);
          break;
        case 'prompts/list':
          result = await this.handleListPrompts();
          break;
        case 'prompts/get':
          result = await this.handleGetPrompt(params);
          break;
        case 'ping':
          result = { status: 'pong' };
          break;
        default:
          throw { code: -32601, message: `Method ${method} not found` };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      console.error(`[MCP Server] Error handling ${method}:`, error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: error.code || -32603,
          message: error.message || 'Internal error',
        },
      };
    }
  }

  // ==================== HTTP SERVER ====================

  startHTTP(port = 3001) {
    const app = express();
    app.use(express.json());

    // CORS headers
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // SSE endpoint
    app.get('/sse', (req, res) => {
      const clientId = Date.now().toString();

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      this.clients.set(clientId, res);
      console.log(`[MCP Server] Client connected: ${clientId}`);

      // Send connection event
      res.write(`event: connection\n`);
      res.write(`data: ${JSON.stringify({ connectionId: clientId })}\n\n`);

      // Send authenticated event (for compatibility)
      res.write(`data: ${JSON.stringify({ isAuthenticated: true, id: clientId })}\n\n`);

      req.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[MCP Server] Client disconnected: ${clientId}`);
      });
    });

    // Messages endpoint
    app.post('/messages', async (req, res) => {
      const connectionId = req.headers['x-connection-id'];
      const response = await this.handleRequest(req.body);

      // Send response back through SSE if we have a connection ID
      if (connectionId && this.clients.has(connectionId)) {
        const clientRes = this.clients.get(connectionId);
        clientRes.write(`data: ${JSON.stringify(response)}\n\n`);
        // Also send via HTTP response for compatibility
        res.json({ status: 'sent via SSE' });
      } else {
        // Fallback to HTTP response if no SSE connection
        res.json(response);
      }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        server: this.serverName,
        version: this.serverVersion,
        uptime: process.uptime(),
      });
    });

    app.listen(port, () => {
      console.log(`\n🚀 MCP Server "${this.serverName}" running!`);
      console.log(`   HTTP: http://localhost:${port}`);
      console.log(`   SSE:  http://localhost:${port}/sse`);
      console.log(`\n📊 Registered:`);
      console.log(`   Tools:     ${this.tools.size}`);
      console.log(`   Resources: ${this.resources.size}`);
      console.log(`   Prompts:   ${this.prompts.size}`);
      console.log('');
    });
  }
}

// ==================== START SERVER ====================

const server = new ComprehensiveMCPServer({
  name: 'example-mcp-server',
  version: '1.0.0',
});

server.startHTTP(3001);

export default ComprehensiveMCPServer;
```

---

## 🧪 Testing Your Server

### 1. Start the Server

```bash
node comprehensive-mcp-server.js
```

### 2. Test with curl

```bash
# List tools
curl -X POST http://localhost:3001/messages \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# Call a tool
curl -X POST http://localhost:3001/messages \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "add",
      "arguments": {"a": 5, "b": 10}
    }
  }'
```

### 3. Test with TaskTitan

Add an MCP Client node to your workflow:

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "List Tools"
}
```

---

## 📦 Package.json

```json
{
  "name": "comprehensive-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "description": "A comprehensive MCP server example",
  "main": "comprehensive-mcp-server.js",
  "scripts": {
    "start": "node comprehensive-mcp-server.js",
    "dev": "nodemon comprehensive-mcp-server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

## 🚀 Deployment

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "comprehensive-mcp-server.js"]
```

```bash
# Build and run
docker build -t mcp-server .
docker run -p 3001:3001 mcp-server
```

### Environment Variables

```javascript
// Use environment variables for configuration
const PORT = process.env.PORT || 3001;
const SERVER_NAME = process.env.SERVER_NAME || 'mcp-server';

const server = new ComprehensiveMCPServer({
  name: SERVER_NAME,
  version: '1.0.0',
});

server.startHTTP(PORT);
```

---

## 🎓 Best Practices

### 1. Error Handling

Always wrap tool handlers in try-catch:

```javascript
this.registerTool('risky_operation', 'Might fail', schema, async (args) => {
  try {
    const result = await riskyOperation(args);
    return { content: [{ type: 'text', text: result }] };
  } catch (error) {
    throw {
      code: -32603,
      message: `Operation failed: ${error.message}`,
    };
  }
});
```

### 2. Input Validation

Validate inputs before processing:

```javascript
async (args) => {
  if (typeof args.a !== 'number' || typeof args.b !== 'number') {
    throw {
      code: -32602,
      message: 'Both a and b must be numbers',
    };
  }
  // Process...
};
```

### 3. Logging

Add comprehensive logging:

```javascript
console.log(`[${new Date().toISOString()}] Tool called: ${name}`);
console.log(`[${new Date().toISOString()}] Arguments:`, args);
```

### 4. Rate Limiting

Implement rate limiting for production:

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use('/messages', limiter);
```

---

## 📚 Additional Resources

- **MCP Specification**: https://modelcontextprotocol.io/
- **JSON-RPC 2.0**: https://www.jsonrpc.org/specification
- **Express.js**: https://expressjs.com/

---

**Last Updated:** October 15, 2025
**Version:** 1.0.0
