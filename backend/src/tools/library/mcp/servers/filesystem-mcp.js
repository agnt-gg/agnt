import fs from 'fs/promises';
import path from 'path';
import { createInterface } from 'readline';

/**
 * File System Manager MCP Server
 * Provides tools for managing local files and directories
 */
class FileSystemMCPServer {
  constructor() {
    this.watchers = new Map();
    this.setupStdio();
  }

  setupStdio() {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (err) {
        console.error('Error:', err.message);
      }
    });
  }

  async handleRequest(request) {
    const { jsonrpc, id, method, params } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'filesystem-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          };
          break;

        case 'tools/list':
          result = {
            tools: [
              {
                name: 'list_directory',
                description: 'List files in a directory',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'Directory path' },
                    recursive: { type: 'boolean', default: false },
                  },
                  required: ['path'],
                },
              },
              {
                name: 'read_file',
                description: 'Read file contents',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'File path' },
                  },
                  required: ['path'],
                },
              },
              {
                name: 'write_file',
                description: 'Write content to file',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['path', 'content'],
                },
              },
              {
                name: 'delete_file',
                description: 'Delete a file or directory',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                  },
                  required: ['path'],
                },
              },
              {
                name: 'get_file_info',
                description: 'Get file information (size, dates, permissions)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                  },
                  required: ['path'],
                },
              },
            ],
          };
          break;

        case 'tools/call':
          result = await this.executeTool(params.name, params.arguments);
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

  async executeTool(name, args) {
    switch (name) {
      case 'list_directory':
        const files = await fs.readdir(args.path, { withFileTypes: true });
        const fileList = files.map((f) => ({
          name: f.name,
          type: f.isDirectory() ? 'directory' : 'file',
          path: path.join(args.path, f.name),
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(fileList, null, 2) }],
        };

      case 'read_file':
        const content = await fs.readFile(args.path, 'utf-8');
        return {
          content: [{ type: 'text', text: content }],
        };

      case 'write_file':
        await fs.writeFile(args.path, args.content, 'utf-8');
        return {
          content: [{ type: 'text', text: `File written: ${args.path}` }],
        };

      case 'delete_file':
        const stats = await fs.stat(args.path);
        if (stats.isDirectory()) {
          await fs.rm(args.path, { recursive: true });
        } else {
          await fs.unlink(args.path);
        }
        return {
          content: [{ type: 'text', text: `Deleted: ${args.path}` }],
        };

      case 'get_file_info':
        const info = await fs.stat(args.path);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  size: info.size,
                  created: info.birthtime,
                  modified: info.mtime,
                  accessed: info.atime,
                  isDirectory: info.isDirectory(),
                  isFile: info.isFile(),
                },
                null,
                2
              ),
            },
          ],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new FileSystemMCPServer();
