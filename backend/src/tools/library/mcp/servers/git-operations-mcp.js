import { exec } from 'child_process';
import { promisify } from 'util';
import { createInterface } from 'readline';

const execAsync = promisify(exec);

/**
 * Git Operations MCP Server
 * Provides tools for performing Git operations on local repositories
 */
class GitOperationsMCP {
  constructor() {
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
            serverInfo: { name: 'git-operations-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          };
          break;

        case 'tools/list':
          result = {
            tools: [
              {
                name: 'git_status',
                description: 'Get repository status',
                inputSchema: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Repository path (defaults to current directory)' },
                  },
                },
              },
              {
                name: 'git_commit',
                description: 'Commit changes with a message',
                inputSchema: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Repository path' },
                    message: { type: 'string', description: 'Commit message' },
                  },
                  required: ['message'],
                },
              },
              {
                name: 'git_log',
                description: 'View commit history',
                inputSchema: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Repository path' },
                    limit: { type: 'number', description: 'Number of commits to show', default: 10 },
                  },
                },
              },
              {
                name: 'git_branch',
                description: 'List or create branches',
                inputSchema: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Repository path' },
                    create: { type: 'boolean', description: 'Create new branch', default: false },
                    name: { type: 'string', description: 'Branch name (for creation)' },
                  },
                },
              },
              {
                name: 'git_diff',
                description: 'Show changes in working directory',
                inputSchema: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Repository path' },
                    staged: { type: 'boolean', description: 'Show staged changes', default: false },
                  },
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
    const cwd = args?.repository || process.cwd();

    try {
      switch (name) {
        case 'git_status':
          const { stdout: status } = await execAsync('git status --porcelain', { cwd });
          return {
            content: [{ type: 'text', text: status || 'Working tree clean' }],
          };

        case 'git_commit':
          if (!args?.message) {
            throw new Error('Commit message is required');
          }
          await execAsync('git add -A', { cwd });
          const { stdout: commitResult } = await execAsync(`git commit -m "${args.message}"`, { cwd });
          return {
            content: [{ type: 'text', text: commitResult }],
          };

        case 'git_log':
          const limit = args?.limit || 10;
          const { stdout: log } = await execAsync(`git log --oneline -n ${limit}`, { cwd });
          return {
            content: [{ type: 'text', text: log }],
          };

        case 'git_branch':
          if (args?.create && args?.name) {
            await execAsync(`git checkout -b ${args.name}`, { cwd });
            return {
              content: [{ type: 'text', text: `Created and switched to branch: ${args.name}` }],
            };
          }
          const { stdout: branches } = await execAsync('git branch', { cwd });
          return {
            content: [{ type: 'text', text: branches }],
          };

        case 'git_diff':
          const diffCmd = args?.staged ? 'git diff --staged' : 'git diff';
          const { stdout: diff } = await execAsync(diffCmd, { cwd });
          return {
            content: [{ type: 'text', text: diff || 'No changes' }],
          };

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Git error: ${err.message}` }],
      };
    }
  }
}

new GitOperationsMCP();
