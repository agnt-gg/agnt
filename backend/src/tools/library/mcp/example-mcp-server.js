import express from 'express';

/**
 * Working MCP Server Example
 * Sends responses back through SSE connection
 */
class WorkingMCPServer {
  constructor(options = {}) {
    this.serverName = options.name || 'working-mcp-server';
    this.serverVersion = options.version || '1.0.0';
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.clients = new Map();

    this.registerBuiltins();
  }

  registerBuiltins() {
    // Add tool
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
          content: [{ type: 'text', text: `Result: ${result}` }],
        };
      }
    );

    // Multiply tool
    this.registerTool(
      'multiply',
      'Multiply two numbers',
      {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
      },
      async (args) => {
        const result = args.a * args.b;
        return {
          content: [{ type: 'text', text: `Result: ${result}` }],
        };
      }
    );

    // Config resource
    this.registerResource('data://config', 'Server Config', 'application/json', async () => ({
      uri: 'data://config',
      mimeType: 'application/json',
      text: JSON.stringify({ server: this.serverName, version: this.serverVersion }, null, 2),
    }));

    // Greeting prompt
    this.registerPrompt('greeting', 'Generate greeting', [{ name: 'name', description: 'Name to greet', required: true }], async (args) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Hello, ${args.name}!` },
        },
      ],
    }));
  }

  registerTool(name, description, inputSchema, handler) {
    this.tools.set(name, { name, description, inputSchema, handler });
    console.log(`✅ Registered tool: ${name}`);
  }

  registerResource(uri, name, mimeType, handler) {
    this.resources.set(uri, { uri, name, mimeType, handler });
    console.log(`✅ Registered resource: ${uri}`);
  }

  registerPrompt(name, description, argumentsList, handler) {
    this.prompts.set(name, { name, description, arguments: argumentsList, handler });
    console.log(`✅ Registered prompt: ${name}`);
  }

  async handleRequest(request) {
    const { jsonrpc, id, method, params } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: this.serverName, version: this.serverVersion },
            capabilities: {
              tools: {},
              resources: { subscribe: false, listChanged: false },
              prompts: {},
            },
          };
          break;

        case 'tools/list':
          result = {
            tools: Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          };
          break;

        case 'tools/call':
          const tool = this.tools.get(params.name);
          if (!tool) throw { code: -32602, message: `Tool "${params.name}" not found` };
          result = await tool.handler(params.arguments || {});
          break;

        case 'resources/list':
          result = {
            resources: Array.from(this.resources.values()).map(({ uri, name, mimeType }) => ({
              uri,
              name,
              mimeType,
            })),
          };
          break;

        case 'resources/read':
          const resource = this.resources.get(params.uri);
          if (!resource) throw { code: -32602, message: `Resource "${params.uri}" not found` };
          const contents = await resource.handler();
          result = { contents: [contents] };
          break;

        case 'prompts/list':
          result = {
            prompts: Array.from(this.prompts.values()).map(({ name, description, arguments: args }) => ({
              name,
              description,
              arguments: args,
            })),
          };
          break;

        case 'prompts/get':
          const prompt = this.prompts.get(params.name);
          if (!prompt) throw { code: -32602, message: `Prompt "${params.name}" not found` };
          result = await prompt.handler(params.arguments || {});
          break;

        case 'ping':
          result = { status: 'pong' };
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

  startHTTP(port = 3001) {
    const app = express();
    app.use(express.json());

    // CORS
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Connection-ID');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
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
      console.log(`\n🔌 Client connected: ${clientId}`);

      // Send connection event
      res.write(`event: connection\n`);
      res.write(`data: ${JSON.stringify({ connectionId: clientId })}\n\n`);

      // Send auth event
      res.write(`data: ${JSON.stringify({ isAuthenticated: true, id: clientId })}\n\n`);

      req.on('close', () => {
        this.clients.delete(clientId);
        console.log(`❌ Client disconnected: ${clientId}`);
      });
    });

    // Messages endpoint - CRITICAL: Send responses via SSE!
    app.post('/messages', async (req, res) => {
      const connectionId = req.headers['x-connection-id'];
      const request = req.body;

      console.log(`\n📨 Request from ${connectionId}: ${request.method}`);

      const response = await this.handleRequest(request);

      // IMPORTANT: Send response through SSE, not HTTP!
      if (connectionId && this.clients.has(connectionId)) {
        const clientRes = this.clients.get(connectionId);
        console.log(`📤 Sending response via SSE to ${connectionId}`);
        clientRes.write(`data: ${JSON.stringify(response)}\n\n`);
        res.json({ status: 'sent via SSE' });
      } else {
        console.log(`⚠️  No SSE connection for ${connectionId}, sending via HTTP`);
        res.json(response);
      }
    });

    app.listen(port, () => {
      console.log(`\n🚀 MCP Server "${this.serverName}" v${this.serverVersion}`);
      console.log(`   URL: http://localhost:${port}/sse`);
      console.log(`\n📊 Registered:`);
      console.log(`   Tools:     ${this.tools.size}`);
      console.log(`   Resources: ${this.resources.size}`);
      console.log(`   Prompts:   ${this.prompts.size}\n`);
    });
  }
}

// Start server
const server = new WorkingMCPServer({
  name: 'example-mcp-server',
  version: '1.0.0',
});

server.startHTTP(3001);
