# MCP Client 🔌

## Id

`mcp-client`

## Description

Connects to Model Context Protocol (MCP) servers to access tools, resources, and prompts. Supports real-time communication via SSE/WebSocket and provides comprehensive MCP server interaction capabilities.

## Tags

mcp, client, tools, resources, prompts, api, sse, websocket

## Input Parameters

### Required

- **serverUrl** (string): MCP server URL endpoint
- **action** (string): Action to perform (`List Tools`, `Call Tool`, `List Resources`, `Get Resource`, `List Prompts`, `Get Prompt`)

### Optional

- **toolName** (string): Tool name for Call Tool action
- **toolArgs** (string): JSON arguments for tool calls
- **resourceUri** (string): Resource URI for Get Resource action
- **promptName** (string): Prompt name for Get Prompt action
- **promptArgs** (string): Arguments for prompt execution

## Output Format

- **success** (boolean): Whether the MCP operation was successful
- **tools** (array): Available tools from MCP server
- **resources** (array): Available resources from MCP server
- **prompts** (array): Available prompts from MCP server
- **result** (object): Operation result including tool responses or resource data
- **error** (string|null): Error message if the operation failed
