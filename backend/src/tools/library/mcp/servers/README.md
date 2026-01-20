# Local MCP Servers Library

This directory contains ready-to-use MCP servers that run locally via STDIO transport.

## 📦 Available Servers

### 1. File System Manager (`filesystem-mcp.js`)

**Purpose**: Manage local files and directories

**Tools:**

- `list_directory` - List files in a directory
- `read_file` - Read file contents
- `write_file` - Write content to file
- `delete_file` - Delete a file or directory
- `get_file_info` - Get file information (size, dates, permissions)

**Usage:**

```json
{
  "name": "filesystem-manager",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["src/tools/library/mcp/servers/filesystem-mcp.js"],
    "cwd": "C:\\Users\\Studio\\Documents\\DevelopmentProjects\\TaskTitan\\source\\backend"
  }
}
```

**Example Tool Call:**

```javascript
// List files in a directory
{
  "name": "list_directory",
  "arguments": {
    "path": "C:\\Users\\Studio\\Documents"
  }
}

// Read a file
{
  "name": "read_file",
  "arguments": {
    "path": "C:\\Users\\Studio\\Documents\\test.txt"
  }
}
```

---

### 2. System Monitor (`system-monitor-mcp.js`)

**Purpose**: Monitor system resources and performance

**Tools:**

- `get_cpu_usage` - Get current CPU usage information
- `get_memory_info` - Get memory usage information
- `get_system_info` - Get system information (OS, uptime, etc.)
- `list_processes` - List running processes

**Usage:**

```json
{
  "name": "system-monitor",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["src/tools/library/mcp/servers/system-monitor-mcp.js"],
    "cwd": "C:\\Users\\Studio\\Documents\\DevelopmentProjects\\TaskTitan\\source\\backend"
  }
}
```

**Example Tool Call:**

```javascript
// Get memory info
{
  "name": "get_memory_info",
  "arguments": {}
}

// List top 10 processes
{
  "name": "list_processes",
  "arguments": {
    "limit": 10
  }
}
```

---

### 3. Git Operations (`git-operations-mcp.js`)

**Purpose**: Perform Git operations on local repositories

**Tools:**

- `git_status` - Get repository status
- `git_commit` - Commit changes with a message
- `git_log` - View commit history
- `git_branch` - List or create branches
- `git_diff` - Show changes in working directory

**Usage:**

```json
{
  "name": "git-operations",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["src/tools/library/mcp/servers/git-operations-mcp.js"],
    "cwd": "C:\\Users\\Studio\\Documents\\DevelopmentProjects\\TaskTitan\\source\\backend"
  }
}
```

**Example Tool Call:**

```javascript
// Get repository status
{
  "name": "git_status",
  "arguments": {
    "repository": "C:\\Users\\Studio\\Documents\\MyProject"
  }
}

// Commit changes
{
  "name": "git_commit",
  "arguments": {
    "repository": "C:\\Users\\Studio\\Documents\\MyProject",
    "message": "Add new feature"
  }
}
```

---

## 🚀 Quick Start

### 1. Test a Server Directly

```bash
# Test with echo
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node filesystem-mcp.js

# Test listing tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node filesystem-mcp.js
```

### 2. Use with TaskTitan

The servers are already configured in `backend/mcp.json`. Use the MCP Client action in your workflows:

```javascript
// In a workflow node
{
  "operation": "Use Server",
  "serverName": "filesystem-manager",
  "action": "Call Tool",
  "toolName": "list_directory",
  "toolArgs": "{\"path\": \"C:\\\\Users\\\\Studio\\\\Documents\"}"
}
```

### 3. Discover Available Servers

```javascript
// In a workflow node
{
  "operation": "List Servers"
}
```

---

## 🔧 Creating Your Own Server

Use the minimal template:

```javascript
import { createInterface } from 'readline';

class MyMCPServer {
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
            serverInfo: { name: 'my-server', version: '1.0.0' },
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
        return {
          content: [{ type: 'text', text: `Result: ${args.input}` }],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new MyMCPServer();
```

Then add to `backend/mcp.json`:

```json
{
  "name": "my-server",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["src/tools/library/mcp/servers/my-server.js"],
    "cwd": "C:\\Users\\Studio\\Documents\\DevelopmentProjects\\TaskTitan\\source\\backend"
  }
}
```

---

## 📚 Additional Resources

- **STDIO_SERVER_IDEAS.md** - More server ideas and examples
- **MCP_SERVER_GUIDE.md** - Complete guide to building MCP servers
- **USAGE_GUIDE.md** - How to use MCP servers in workflows

---

## 🔒 Security Notes

1. **File System Access**: The filesystem server has full access to the file system. Be careful with paths.
2. **Command Execution**: Git operations execute shell commands. Validate inputs.
3. **Process Management**: System monitor can list all processes. Consider privacy implications.

---

## 💡 Tips

1. **Error Handling**: All servers include error handling and return proper JSON-RPC errors
2. **Logging**: Use `console.error()` for logs (goes to stderr, not stdout)
3. **Testing**: Test servers individually before adding to workflows
4. **Paths**: Use absolute paths for reliability, especially on Windows

---

**Last Updated:** October 16, 2025
**Version:** 1.0.0
