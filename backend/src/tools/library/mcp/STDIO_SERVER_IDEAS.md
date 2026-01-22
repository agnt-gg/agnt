# STDIO MCP Server Ideas - Local System Control

A collection of practical MCP server ideas that use STDIO transport to control local system resources.

## 🎯 What Can STDIO Control?

STDIO transport spawns a local Node.js process that can:

- **File System**: Read, write, watch files and directories
- **System Commands**: Execute shell commands, scripts
- **Process Management**: Start, stop, monitor processes
- **System Info**: CPU, memory, disk usage
- **Network**: Local network operations, port scanning
- **Clipboard**: Read/write clipboard content
- **Notifications**: System notifications
- **Audio**: Play sounds, control volume
- **Window Management**: Control application windows (OS-specific)
- **Database**: SQLite, local databases
- **Hardware**: USB devices, serial ports (with appropriate libraries)

---

## 💡 MCP Server Ideas

### 1. File System Manager MCP Server

**Purpose**: Manage local files and directories with advanced operations.

**Tools:**

- `list_directory` - List files with filters
- `read_file` - Read file contents
- `write_file` - Write to file
- `delete_file` - Delete file/directory
- `move_file` - Move/rename files
- `search_files` - Search by name/content
- `watch_directory` - Monitor for changes
- `get_file_info` - Size, dates, permissions
- `create_backup` - Backup files/folders
- `compress_files` - Create zip archives

**Example Implementation:**

```javascript
// filesystem-mcp-server.js
import fs from 'fs/promises';
import path from 'path';
import { watch } from 'fs';
import { createInterface } from 'readline';

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
                name: 'search_files',
                description: 'Search for files by name pattern',
                inputSchema: {
                  type: 'object',
                  properties: {
                    directory: { type: 'string' },
                    pattern: { type: 'string', description: 'Glob pattern' },
                  },
                  required: ['directory', 'pattern'],
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

      case 'search_files':
        // Implement glob search
        const results = await this.searchFiles(args.directory, args.pattern);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async searchFiles(dir, pattern) {
    // Simple implementation - could use glob library
    const files = await fs.readdir(dir, { recursive: true });
    const regex = new RegExp(pattern.replace('*', '.*'));
    return files.filter((f) => regex.test(f));
  }
}

new FileSystemMCPServer();
```

**Configuration:**

```json
{
  "name": "filesystem-manager",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["./filesystem-mcp-server.js"],
    "cwd": "/path/to/server"
  }
}
```

---

### 2. System Monitor MCP Server

**Purpose**: Monitor system resources and performance.

**Tools:**

- `get_cpu_usage` - Current CPU usage
- `get_memory_info` - RAM usage
- `get_disk_info` - Disk space
- `list_processes` - Running processes
- `kill_process` - Stop a process
- `get_network_stats` - Network usage
- `get_system_info` - OS, uptime, etc.

**Example:**

```javascript
// system-monitor-mcp.js
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class SystemMonitorMCP {
  // ... (similar structure to above)

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

      case 'list_processes':
        // Windows
        if (process.platform === 'win32') {
          const { stdout } = await execAsync('tasklist /FO CSV /NH');
          const processes = stdout
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              const parts = line.split(',').map((p) => p.replace(/"/g, ''));
              return { name: parts[0], pid: parts[1], memory: parts[4] };
            });
          return {
            content: [{ type: 'text', text: JSON.stringify(processes, null, 2) }],
          };
        }
        // Unix/GNU/Linux/Mac
        const { stdout } = await execAsync('ps aux');
        return {
          content: [{ type: 'text', text: stdout }],
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
                },
                null,
                2
              ),
            },
          ],
        };
    }
  }
}

new SystemMonitorMCP();
```

---

### 3. Clipboard Manager MCP Server

**Purpose**: Read and write clipboard content.

**Tools:**

- `read_clipboard` - Get clipboard text
- `write_clipboard` - Set clipboard text
- `clipboard_history` - Recent clipboard items
- `clear_clipboard` - Clear clipboard

**Example:**

```javascript
// clipboard-mcp.js
import clipboardy from 'clipboardy';

class ClipboardMCP {
  constructor() {
    this.history = [];
    this.maxHistory = 50;
    this.setupStdio();
  }

  async executeTool(name, args) {
    switch (name) {
      case 'read_clipboard':
        const text = await clipboardy.read();
        return {
          content: [{ type: 'text', text }],
        };

      case 'write_clipboard':
        await clipboardy.write(args.text);
        this.history.unshift({ text: args.text, timestamp: Date.now() });
        if (this.history.length > this.maxHistory) {
          this.history.pop();
        }
        return {
          content: [{ type: 'text', text: 'Clipboard updated' }],
        };

      case 'clipboard_history':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(this.history, null, 2),
            },
          ],
        };

      case 'clear_clipboard':
        await clipboardy.write('');
        return {
          content: [{ type: 'text', text: 'Clipboard cleared' }],
        };
    }
  }
}
```

**Dependencies:**

```json
{
  "dependencies": {
    "clipboardy": "^3.0.0"
  }
}
```

---

### 4. Git Operations MCP Server

**Purpose**: Perform Git operations on local repositories.

**Tools:**

- `git_status` - Get repo status
- `git_commit` - Commit changes
- `git_push` - Push to remote
- `git_pull` - Pull from remote
- `git_branch` - List/create branches
- `git_log` - View commit history
- `git_diff` - Show changes

**Example:**

```javascript
// git-mcp.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class GitMCP {
  async executeTool(name, args) {
    const cwd = args.repository || process.cwd();

    switch (name) {
      case 'git_status':
        const { stdout } = await execAsync('git status --porcelain', { cwd });
        return {
          content: [{ type: 'text', text: stdout || 'Working tree clean' }],
        };

      case 'git_commit':
        await execAsync(`git add -A`, { cwd });
        const result = await execAsync(`git commit -m "${args.message}"`, { cwd });
        return {
          content: [{ type: 'text', text: result.stdout }],
        };

      case 'git_log':
        const limit = args.limit || 10;
        const log = await execAsync(`git log --oneline -n ${limit}`, { cwd });
        return {
          content: [{ type: 'text', text: log.stdout }],
        };

      case 'git_branch':
        if (args.create) {
          await execAsync(`git checkout -b ${args.name}`, { cwd });
          return {
            content: [{ type: 'text', text: `Created branch: ${args.name}` }],
          };
        }
        const branches = await execAsync('git branch', { cwd });
        return {
          content: [{ type: 'text', text: branches.stdout }],
        };
    }
  }
}
```

---

### 5. Database Manager MCP Server

**Purpose**: Manage local SQLite databases.

**Tools:**

- `execute_query` - Run SQL query
- `list_tables` - Show all tables
- `describe_table` - Table schema
- `backup_database` - Create backup
- `import_csv` - Import CSV data

**Example:**

```javascript
// database-mcp.js
import Database from 'better-sqlite3';

class DatabaseMCP {
  constructor() {
    this.connections = new Map();
    this.setupStdio();
  }

  getConnection(dbPath) {
    if (!this.connections.has(dbPath)) {
      this.connections.set(dbPath, new Database(dbPath));
    }
    return this.connections.get(dbPath);
  }

  async executeTool(name, args) {
    const db = this.getConnection(args.database);

    switch (name) {
      case 'execute_query':
        const stmt = db.prepare(args.query);
        const results = args.query.trim().toLowerCase().startsWith('select') ? stmt.all() : stmt.run();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };

      case 'list_tables':
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tables, null, 2),
            },
          ],
        };

      case 'describe_table':
        const schema = db.prepare(`PRAGMA table_info(${args.table})`).all();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(schema, null, 2),
            },
          ],
        };
    }
  }
}
```

**Dependencies:**

```json
{
  "dependencies": {
    "better-sqlite3": "^9.0.0"
  }
}
```

---

### 6. Screenshot & Screen Capture MCP Server

**Purpose**: Capture screenshots and screen recordings.

**Tools:**

- `take_screenshot` - Capture screen
- `capture_window` - Capture specific window
- `start_recording` - Start screen recording
- `stop_recording` - Stop recording
- `list_displays` - Available displays

**Example:**

```javascript
// screenshot-mcp.js
import screenshot from 'screenshot-desktop';
import fs from 'fs/promises';

class ScreenshotMCP {
  async executeTool(name, args) {
    switch (name) {
      case 'take_screenshot':
        const img = await screenshot({ format: 'png' });
        const filename = args.filename || `screenshot-${Date.now()}.png`;
        await fs.writeFile(filename, img);
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot saved: ${filename}`,
            },
          ],
        };

      case 'list_displays':
        const displays = await screenshot.listDisplays();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(displays, null, 2),
            },
          ],
        };
    }
  }
}
```

---

## 🚀 Quick Start Template

Here's a minimal STDIO MCP server template:

```javascript
// minimal-mcp-server.js
import { createInterface } from 'readline';

class MinimalMCP {
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
            serverInfo: { name: 'my-mcp-server', version: '1.0.0' },
            capabilities: { tools: {} },
          };
          break;

        case 'tools/list':
          result = { tools: this.getTools() };
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

  getTools() {
    return [
      {
        name: 'my_tool',
        description: 'Does something useful',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input parameter' },
          },
          required: ['input'],
        },
      },
    ];
  }

  async executeTool(name, args) {
    switch (name) {
      case 'my_tool':
        // Do something with args.input
        return {
          content: [{ type: 'text', text: `Result: ${args.input}` }],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new MinimalMCP();
```

---

## 📦 Common Dependencies

```json
{
  "dependencies": {
    "clipboardy": "^3.0.0",
    "screenshot-desktop": "^1.15.0",
    "better-sqlite3": "^9.0.0",
    "node-notifier": "^10.0.1",
    "systeminformation": "^5.21.0",
    "chokidar": "^3.5.3",
    "glob": "^10.3.10"
  }
}
```

---

## 🔧 Testing Your STDIO Server

```bash
# Test with echo
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node your-server.js

# Test with TaskTitan
# Add to mcp.json:
{
  "servers": [
    {
      "name": "my-server",
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["./my-server.js"],
        "cwd": "/path/to/server"
      }
    }
  ]
}
```

---

## 💡 Best Practices

1. **Always validate inputs** - Check args before executing
2. **Handle errors gracefully** - Return proper JSON-RPC errors
3. **Use async/await** - For all I/O operations
4. **Log to stderr** - Keep stdout for JSON-RPC only
5. **Clean up resources** - Close connections, files, etc.
6. **Security** - Validate file paths, sanitize commands
7. **Performance** - Cache connections, use streams for large files

---

## 🎯 More Ideas

- **Audio Player** - Play/pause/stop audio files
- **Video Processor** - Convert, compress videos
- **Image Editor** - Resize, crop, filter images
- **PDF Generator** - Create PDFs from HTML/Markdown
- **Email Client** - Send/receive emails
- **Calendar Manager** - Manage local calendar events
- **Password Manager** - Secure password storage
- **Backup Manager** - Automated backups
- **Log Analyzer** - Parse and analyze log files
- **Network Scanner** - Scan local network
- **USB Device Manager** - Detect and manage USB devices
- **Printer Manager** - Print documents
- **Bluetooth Manager** - Manage Bluetooth devices
- **Window Manager** - Control application windows
- **Keyboard/Mouse Automation** - Automate inputs

---

**Last Updated:** October 16, 2025
**Version:** 1.0.0
