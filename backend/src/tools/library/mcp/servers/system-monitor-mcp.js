import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createInterface } from 'readline';

const execAsync = promisify(exec);

/**
 * System Monitor MCP Server
 * Provides tools for monitoring system resources and performance
 */
class SystemMonitorMCP {
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
            serverInfo: { name: 'system-monitor-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          };
          break;

        case 'tools/list':
          result = {
            tools: [
              {
                name: 'get_cpu_usage',
                description: 'Get current CPU usage information',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'get_memory_info',
                description: 'Get memory usage information',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'get_system_info',
                description: 'Get system information (OS, uptime, etc.)',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'list_processes',
                description: 'List running processes',
                inputSchema: {
                  type: 'object',
                  properties: {
                    limit: { type: 'number', description: 'Max number of processes to return', default: 20 },
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
    switch (name) {
      case 'get_cpu_usage':
        const cpus = os.cpus();
        const usage = cpus.map((cpu, i) => ({
          core: i,
          model: cpu.model,
          speed: cpu.speed,
          times: cpu.times,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }],
        };

      case 'get_memory_info':
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
                  used: `${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
                  free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
                  usagePercent: `${((usedMem / totalMem) * 100).toFixed(2)}%`,
                },
                null,
                2
              ),
            },
          ],
        };

      case 'get_system_info':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  platform: os.platform(),
                  arch: os.arch(),
                  hostname: os.hostname(),
                  uptime: `${(os.uptime() / 3600).toFixed(2)} hours`,
                  nodeVersion: process.version,
                  cpuCount: os.cpus().length,
                  totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
                },
                null,
                2
              ),
            },
          ],
        };

      case 'list_processes':
        const limit = args?.limit || 20;
        try {
          // Windows
          if (process.platform === 'win32') {
            const { stdout } = await execAsync('tasklist /FO CSV /NH');
            const processes = stdout
              .split('\n')
              .filter((line) => line.trim())
              .slice(0, limit)
              .map((line) => {
                const parts = line.split(',').map((p) => p.replace(/"/g, ''));
                return { name: parts[0], pid: parts[1], memory: parts[4] };
              });
            return {
              content: [{ type: 'text', text: JSON.stringify(processes, null, 2) }],
            };
          }
          // Unix/GNU/Linux/Mac
          const { stdout } = await execAsync(`ps aux | head -n ${limit + 1}`);
          return {
            content: [{ type: 'text', text: stdout }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error listing processes: ${err.message}` }],
          };
        }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new SystemMonitorMCP();
