# MCP Client - Complete Usage Guide

A comprehensive guide to using the MCP (Model Context Protocol) client in TaskTitan workflows.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Three Operation Modes](#three-operation-modes)
3. [Common Use Cases](#common-use-cases)
4. [Parameter Reference](#parameter-reference)
5. [Examples](#examples)
6. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Step 1: Add MCP Client Node to Workflow

1. Open your workflow in TaskTitan
2. Click "Add Node" → "Actions" → "MCP Client"
3. Connect it to your trigger or previous node

### Step 2: Choose Your Mode and Action

The MCP Client has **3 modes** of operation:

- **Single Server** - Connect to one MCP server
- **Fleet Operations** - Execute across multiple servers
- **Discover Servers** - Find available MCP servers

**IMPORTANT - Understanding Server Info vs List Actions:**

**"Get Server Info"** returns `serverCapabilities` which shows:

- `tools: {}` - Means "server supports tools" (NOT the actual tools!)
- `resources: {...}` - Means "server supports resources" (NOT the actual resources!)
- `prompts: {}` - Means "server supports prompts" (NOT the actual prompts!)

These are just **capability flags** (yes/no), NOT the actual content!

**To see the ACTUAL tools/resources/prompts, use:**

- **"List Tools"** - Returns array of actual tools with names and schemas
- **"List Resources"** - Returns array of actual resources with URIs
- **"List Prompts"** - Returns array of actual prompts with names

---

## 🎯 Three Operation Modes

### Mode 1: Single Server (Most Common)

**Use this when:** You want to connect to one MCP server and use its tools/resources.

**Required Parameters:**

- `mode`: "Single Server"
- `serverUrl`: URL of the MCP server (e.g., `http://localhost:3001/sse`)
- `action`: What to do (List Tools, Call Tool, etc.)

**Example - List Available Tools:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "List Tools"
}
```

**Example - Call a Tool:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Call Tool",
  "toolName": "add",
  "toolArgs": "{\"a\": 5, \"b\": 10}"
}
```

### Mode 2: Fleet Operations

**Use this when:** You want to execute the same operation across multiple MCP servers simultaneously.

**Required Parameters:**

- `mode`: "Fleet Operations"
- `serverUrl`: Single URL, OR
- `serverNames`: Comma-separated URLs or server names
- `fleetAction`: What to do across all servers
- `concurrency`: Max simultaneous connections (default: 20)

**Example - List Tools Across Multiple Servers:**

```json
{
  "mode": "Fleet Operations",
  "serverNames": "http://localhost:3001/sse, http://localhost:3002/sse",
  "fleetAction": "List Tools Across",
  "concurrency": 10
}
```

**Example - Call Same Tool on Multiple Servers:**

```json
{
  "mode": "Fleet Operations",
  "serverNames": "http://localhost:3001/sse, http://localhost:3002/sse",
  "fleetAction": "Call Tool Across",
  "toolName": "search",
  "toolArgs": "{\"query\": \"hello\"}",
  "concurrency": 5
}
```

### Mode 3: Discover Servers

**Use this when:** You want to find all available MCP servers from configuration files.

**Optional Parameters:**

- `mode`: "Discover Servers"
- `baseUrls`: Additional URLs to check for `.well-known/mcp.json`

**Example:**

```json
{
  "mode": "Discover Servers",
  "baseUrls": "https://api.example.com, https://mcp.example.org"
}
```

---

## 💡 Common Use Cases

### Use Case 1: Call a Calculator Tool

**Scenario:** You have an MCP server with math tools and want to add two numbers.

**Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Call Tool",
  "toolName": "add",
  "toolArgs": "{\"a\": 6, \"b\": 12}"
}
```

**Output:**

```json
{
  "success": true,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "18"
      }
    ]
  }
}
```

### Use Case 2: Search Across Multiple Servers

**Scenario:** You have 3 MCP servers and want to search all of them for "AI news".

**Configuration:**

```json
{
  "mode": "Fleet Operations",
  "serverNames": "http://server1.com/sse, http://server2.com/sse, http://server3.com/sse",
  "fleetAction": "Call Tool Across",
  "toolName": "search",
  "toolArgs": "{\"query\": \"AI news\"}",
  "concurrency": 3
}
```

**Output:**

```json
{
  "success": true,
  "result": {
    "http://server1.com/sse": {
      "ok": true,
      "data": { "results": [...] }
    },
    "http://server2.com/sse": {
      "ok": true,
      "data": { "results": [...] }
    },
    "http://server3.com/sse": {
      "ok": false,
      "error": "Connection timeout"
    }
  },
  "summary": {
    "total": 3,
    "successful": 2,
    "failed": 1
  }
}
```

### Use Case 3: Read a Resource

**Scenario:** Your MCP server provides access to files/data as resources.

**Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Read Resource",
  "resourceUri": "file:///data/config.json"
}
```

### Use Case 4: Use a Prompt Template

**Scenario:** Your MCP server has prompt templates you want to use.

**Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Get Prompt",
  "promptName": "greeting",
  "promptArgs": "{\"name\": \"Alice\", \"language\": \"Spanish\"}"
}
```

---

## 📖 Parameter Reference

### Common Parameters (All Modes)

| Parameter | Type   | Required | Description                                                |
| --------- | ------ | -------- | ---------------------------------------------------------- |
| `mode`    | String | Yes\*    | "Single Server", "Fleet Operations", or "Discover Servers" |

\*Note: If omitted, defaults to "Single Server" for backward compatibility.

### Single Server Mode Parameters

| Parameter    | Type   | Required | Description                                           |
| ------------ | ------ | -------- | ----------------------------------------------------- |
| `serverUrl`  | String | Yes\*\*  | URL of MCP server (e.g., `http://localhost:3001/sse`) |
| `serverName` | String | No\*\*   | Name of discovered server (alternative to URL)        |
| `action`     | String | Yes      | What to do (see Actions table below)                  |

\*\*Choose either `serverUrl` OR `serverName`

#### Available Actions

| Action                 | Description                   | Additional Parameters      |
| ---------------------- | ----------------------------- | -------------------------- |
| `Get Server Info`      | Get server capabilities       | None                       |
| `List Tools`           | List all available tools      | None                       |
| `Call Tool`            | Execute a specific tool       | `toolName`, `toolArgs`     |
| `List Resources`       | List all resources            | None                       |
| `Read Resource`        | Read a specific resource      | `resourceUri`              |
| `Subscribe Resource`   | Subscribe to resource updates | `resourceUri`              |
| `Unsubscribe Resource` | Unsubscribe from resource     | `resourceUri`              |
| `List Prompts`         | List all prompt templates     | None                       |
| `Get Prompt`           | Get a specific prompt         | `promptName`, `promptArgs` |
| `List Roots`           | List file system roots        | None                       |

#### Action-Specific Parameters

| Parameter     | Type        | Used With                           | Description              | Example                   |
| ------------- | ----------- | ----------------------------------- | ------------------------ | ------------------------- |
| `toolName`    | String      | Call Tool                           | Name of tool to execute  | `"add"`                   |
| `toolArgs`    | JSON String | Call Tool                           | Tool arguments as JSON   | `"{\"a\": 5, \"b\": 10}"` |
| `resourceUri` | String      | Read/Subscribe/Unsubscribe Resource | URI of resource          | `"file:///data.json"`     |
| `promptName`  | String      | Get Prompt                          | Name of prompt template  | `"greeting"`              |
| `promptArgs`  | JSON String | Get Prompt                          | Prompt arguments as JSON | `"{\"name\": \"Alice\"}"` |

### Fleet Operations Mode Parameters

| Parameter     | Type        | Required    | Description                              |
| ------------- | ----------- | ----------- | ---------------------------------------- |
| `serverUrl`   | String      | No\*        | Single server URL                        |
| `serverNames` | String      | No\*        | Comma-separated URLs or names            |
| `fleetAction` | String      | Yes         | What to do across servers                |
| `concurrency` | Number      | No          | Max concurrent connections (default: 20) |
| `toolName`    | String      | Conditional | Required for "Call Tool Across"          |
| `toolArgs`    | JSON String | Conditional | Required for "Call Tool Across"          |

\*Provide either `serverUrl` OR `serverNames`. If neither provided, uses all discovered servers.

#### Available Fleet Actions

| Fleet Action            | Description                      |
| ----------------------- | -------------------------------- |
| `Health Check`          | Check if servers are responding  |
| `List Tools Across`     | Get tools from all servers       |
| `List Resources Across` | Get resources from all servers   |
| `List Prompts Across`   | Get prompts from all servers     |
| `Call Tool Across`      | Execute same tool on all servers |

### Discover Servers Mode Parameters

| Parameter  | Type   | Required | Description                                              |
| ---------- | ------ | -------- | -------------------------------------------------------- |
| `baseUrls` | String | No       | Comma-separated URLs to check for `.well-known/mcp.json` |

---

## 📝 Examples

### Example 1: Basic Tool Call

**Goal:** Add two numbers using a calculator MCP server.

**Node Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Call Tool",
  "toolName": "add",
  "toolArgs": "{\"a\": 100, \"b\": 50}"
}
```

**Expected Output:**

```json
{
  "success": true,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "150"
      }
    ]
  },
  "serverInfo": {
    "initialized": true,
    "transportType": "http"
  }
}
```

### Example 2: List All Available Tools

**Goal:** See what tools an MCP server provides.

**Node Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "List Tools"
}
```

**Expected Output:**

```json
{
  "success": true,
  "result": [
    {
      "name": "add",
      "description": "Add two numbers",
      "inputSchema": {
        "type": "object",
        "properties": {
          "a": { "type": "number" },
          "b": { "type": "number" }
        }
      }
    },
    {
      "name": "multiply",
      "description": "Multiply two numbers",
      "inputSchema": { ... }
    }
  ]
}
```

### Example 3: Health Check Multiple Servers

**Goal:** Check if multiple MCP servers are online.

**Node Configuration:**

```json
{
  "mode": "Fleet Operations",
  "serverNames": "http://localhost:3001/sse, http://localhost:3002/sse, http://localhost:3003/sse",
  "fleetAction": "Health Check",
  "concurrency": 10
}
```

**Expected Output:**

```json
{
  "success": true,
  "result": {
    "http://localhost:3001/sse": {
      "ok": true,
      "data": {
        "initialized": true,
        "serverInfo": { "name": "calculator", "version": "1.0.0" }
      }
    },
    "http://localhost:3002/sse": {
      "ok": true,
      "data": { ... }
    },
    "http://localhost:3003/sse": {
      "ok": false,
      "error": "Connection refused"
    }
  },
  "summary": {
    "total": 3,
    "successful": 2,
    "failed": 1
  }
}
```

### Example 4: Using Variables from Previous Nodes

**Goal:** Use output from a previous node as input to MCP tool.

**Previous Node Output:**

```json
{
  "number1": 25,
  "number2": 75
}
```

**MCP Client Configuration:**

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "Call Tool",
  "toolName": "add",
  "toolArgs": "{\"a\": {{previousNode.number1}}, \"b\": {{previousNode.number2}}}"
}
```

---

## 🔧 Troubleshooting

### Problem: "Unknown mode: undefined"

**Cause:** The `mode` parameter is missing.

**Solution:** Add `"mode": "Single Server"` to your configuration.

### Problem: "Method initialize not found"

**Cause:** The MCP server doesn't support the standard initialization handshake.

**Solution:** This is now handled automatically. The client will continue without the handshake. No action needed.

### Problem: "Unknown server state: http://..."

**Cause:** (Fixed in latest version) Fleet operations couldn't find the server.

**Solution:** Update to the latest version. The client now automatically registers URLs as temporary servers.

### Problem: Tool call returns error

**Cause:** Invalid tool arguments or tool doesn't exist.

**Solution:**

1. First, use `"action": "List Tools"` to see available tools
2. Check the tool's `inputSchema` for required parameters
3. Ensure `toolArgs` is valid JSON

### Problem: Connection timeout

**Cause:** MCP server is not running or URL is incorrect.

**Solution:**

1. Verify the server is running: `curl http://localhost:3001/sse`
2. Check the URL is correct (including `/sse` endpoint)
3. Ensure no firewall is blocking the connection

### Problem: "toolArgs is not valid JSON"

**Cause:** The `toolArgs` parameter contains invalid JSON.

**Solution:** Ensure proper JSON formatting:

- ✅ Correct: `"{\"a\": 5, \"b\": 10}"`
- ❌ Wrong: `"{a: 5, b: 10}"` (missing quotes around keys)
- ❌ Wrong: `"{'a': 5, 'b': 10}"` (single quotes instead of double)

---

## 🎓 Best Practices

### 1. Always List Tools First

Before calling a tool, list available tools to see what's available:

```json
{
  "mode": "Single Server",
  "serverUrl": "http://localhost:3001/sse",
  "action": "List Tools"
}
```

### 2. Use Variables for Dynamic Values

Instead of hardcoding values, use variables from previous nodes:

```json
{
  "toolArgs": "{\"query\": \"{{trigger.searchTerm}}\"}"
}
```

### 3. Handle Errors Gracefully

Use conditional logic in your workflow to handle failures:

```json
// Check if MCP call was successful
if (mcpNode.success) {
  // Process result
} else {
  // Handle error
}
```

### 4. Set Appropriate Concurrency

For fleet operations, adjust concurrency based on your needs:

- **Low (5-10)**: When servers are slow or you want to be gentle
- **Medium (10-20)**: Default, good for most cases
- **High (20-50)**: When you need speed and servers can handle it

### 5. Use Descriptive Node Names

Name your MCP nodes clearly:

- ✅ "Calculate Total Price"
- ✅ "Search All Databases"
- ❌ "MCP Client"
- ❌ "Node 1"

---

## 📚 Additional Resources

- **Full Documentation**: See `README.md` in the same directory
- **MCP Specification**: https://modelcontextprotocol.io/
- **TaskTitan Docs**: https://docs.tasktitan.com

---

## 🆘 Need Help?

If you're still having issues:

1. Check the console logs for detailed error messages
2. Verify your MCP server is running and accessible
3. Test the server directly with curl: `curl http://localhost:3001/sse`
4. Review the examples in this guide
5. Check the README.md for advanced usage

---

**Last Updated:** October 15, 2025
**Version:** 1.0.0
