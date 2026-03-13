# AGNT API Documentation

This document provides comprehensive documentation for all API endpoints in the AGNT backend system.

## Local API (http://localhost:3333/api/)

## Table of Contents (Local)

- [Authentication](#authentication)
- [Agent Routes](#agent-routes)
- [Async Tool Routes](#async-tool-routes)
- [Provider Auth Routes](#provider-auth-routes)
- [Content Output Routes](#content-output-routes)
- [Custom Provider Routes](#custom-provider-routes)
- [Custom Tool Routes](#custom-tool-routes)
- [Email Listener Routes](#email-listener-routes)
- [Execution Routes](#execution-routes)
- [Evolution / Insight Routes](#evolution--insight-routes)
- [Experiment Routes](#experiment-routes)
- [FileSystem Routes](#filesystem-routes)
- [Goal Routes](#goal-routes)
- [Layout Routes](#layout-routes)
- [MCP Routes](#mcp-routes)
- [Model Routes](#model-routes)
- [NPM Routes](#npm-routes)
- [Orchestrator Routes](#orchestrator-routes)
- [Plugin Routes](#plugin-routes)
- [Skill Routes](#skill-routes)
- [SkillForge Routes](#skillforge-routes)
- [Speech Routes](#speech-routes)
- [Stream Routes](#stream-routes)
- [Tool Schema Routes](#tool-schema-routes)
- [Tools Routes](#tools-routes)
- [User Routes](#user-routes)
- [Webhook Routes](#webhook-routes)
- [Widget Definition Routes](#widget-definition-routes)
- [Workflow Routes](#workflow-routes)

---

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

The authentication middleware (`authenticateToken`) will:

- Extract user information from the JWT token
- Set `req.user` with user data including `id`, `email`, and `auth_type`
- Store token and user data in session for backend operations
- Continue as unauthenticated if no valid token is provided

---

## Agent Routes

Base path: `/api/agents`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the agent service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Agents

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all agents for the authenticated user
- **Note**: Include trailing slash (`/api/agents/`) for best compatibility
- **Response**:

```json
{
  "agents": [
    {
      "id": "67b9bf15-a5c7-4153-936b-5959dc83b03c",
      "name": "Content Manager",
      "description": "Main content manager",
      "status": "active",
      "icon": "agent",
      "class": "worker",
      "category": "Content & Media",
      "assignedTools": [],
      "capabilities": [],
      "tasksCompleted": 0,
      "uptime": 0,
      "creditLimit": 0,
      "creditsUsed": 0,
      "workflows": 0,
      "lastActive": null,
      "successRate": null,
      "provider": "openai",
      "model": "gpt-4"
    }
  ]
}
```

**Important**: The response wraps agents in an `agents` array property, not a direct array.

### Save/Update Agent

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new agent or update an existing one
- **Body**:

```json
{
  "id": "optional-agent-id",
  "name": "Agent Name",
  "description": "Agent description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "id": "agent-id",
    "name": "Agent Name",
    "description": "Agent description",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Agent by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Description**: Retrieve a specific agent by ID
- **Response**:

```json
{
  "id": "agent-id",
  "name": "Agent Name",
  "description": "Agent description",
  "config": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Agent

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "name": "Updated Agent Name",
  "description": "Updated description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "id": "agent-id",
    "name": "Updated Agent Name",
    "description": "Updated description",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Agent

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Description**: Delete an agent by ID
- **Response**:

```json
{
  "success": true,
  "message": "Agent deleted successfully"
}
```

### Chat with Agent

**POST** `/:id/chat`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "message": "Your message here",
  "context": {}
}
```

- **Response**:

```json
{
  "response": "Agent response",
  "metadata": {}
}
```

### Stream Chat with Agent

**POST** `/:id/chat-stream`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "message": "Your message here",
  "context": {}
}
```

- **Response**: Server-sent events stream

### Get Agent Suggestions

**POST** `/:id/suggestions`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Agent ID
- **Body**:

```json
{
  "context": "Current context or partial message"
}
```

- **Response**:

```json
{
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}
```

---

## Async Tool Routes

Base path: `/api/async-tools`

### Get Queue Status

**GET** `/status`

- **Authentication**: Required
- **Description**: Get async tool queue statistics
- **Response**:

```json
{
  "success": true,
  "stats": {
    "pending": 0,
    "running": 2,
    "completed": 15,
    "failed": 1
  }
}
```

### Get Executions by Conversation

**GET** `/executions/:conversationId`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Get all async tool executions for a conversation
- **Response**:

```json
{
  "success": true,
  "executions": [
    {
      "executionId": "exec-id",
      "toolName": "tool-name",
      "status": "running|completed|failed|cancelled",
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": null
    }
  ]
}
```

### Get Running Executions

**GET** `/executions/:conversationId/running`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Get only running async tool executions for a conversation
- **Response**:

```json
{
  "success": true,
  "executions": []
}
```

### Get Execution Details

**GET** `/execution/:executionId`

- **Authentication**: Required
- **Parameters**:
  - `executionId` (path): Execution ID
- **Description**: Get details of a specific async tool execution
- **Response**:

```json
{
  "success": true,
  "execution": {
    "executionId": "exec-id",
    "toolName": "tool-name",
    "status": "completed",
    "result": {}
  }
}
```

- **Error** (404): Execution not found

### Cancel Execution

**POST** `/cancel/:executionId`

- **Authentication**: Required
- **Parameters**:
  - `executionId` (path): Execution ID
- **Description**: Cancel a running async tool execution
- **Response**:

```json
{
  "success": true,
  "message": "Async tool execution cancelled successfully"
}
```

### Cancel All Executions for Conversation

**POST** `/cancel-all/:conversationId`

- **Authentication**: Required
- **Parameters**:
  - `conversationId` (path): Conversation ID
- **Description**: Cancel all running async tools for a conversation (global stop)
- **Response**:

```json
{
  "success": true,
  "cancelled": 3
}
```

---

## Provider Auth Routes

Base path: `/api/providers`

All provider authentication is handled through a single unified router. The `:providerId` parameter identifies the provider (e.g., `claude-code`, `openai-codex`, `gemini-cli`, `openai`, `anthropic`, etc.). Local CLI providers use filesystem-backed credentials; remote providers proxy to agnt.gg.

**Auth Dispatcher** (`AuthDispatcher.js`) maps each provider's `authScheme` to an auth manager and a set of capabilities:

| Auth Scheme    | Local | Capabilities                                                          |
| -------------- | ----- | --------------------------------------------------------------------- |
| `claude-code`  | Yes   | status, connect-token, disconnect, refresh, oauth-pkce                |
| `codex`        | Yes   | status, disconnect, device-auth                                       |
| `gemini-cli`   | Yes   | status, connect-apikey, disconnect, refresh, oauth-loopback, set-auth-method, gcp-project |
| `bearer`       | No    | status, connect-apikey, disconnect                                    |
| `api-key`      | No    | status, connect-apikey, disconnect                                    |
| `query-param`  | No    | status, connect-apikey, disconnect                                    |

### Get Provider Auth Status

**GET** `/:providerId/auth/status`

- **Authentication**: None
- **Description**: Check whether credentials exist for this provider and whether its API is usable. For local CLI providers, checks filesystem credentials. For remote providers, returns basic info (use the connection health endpoint for remote status).
- **Response** (local provider):

```json
{
  "success": true,
  "available": true,
  "apiUsable": true,
  "hint": "Claude Code is connected and the Anthropic API is usable."
}
```

For `openai-codex`, also includes `codexWorkdir` and `toolRunner` fields.

- **Response** (remote provider):

```json
{
  "success": true,
  "available": false,
  "providerId": "openai",
  "local": false,
  "hint": "Use connection health endpoint for remote provider status."
}
```

### Get Provider Capabilities

**GET** `/:providerId/auth/capabilities`

- **Authentication**: None
- **Description**: Return the capabilities and metadata for a provider's auth scheme
- **Response**:

```json
{
  "success": true,
  "providerId": "claude-code",
  "providerName": "Claude Code",
  "local": true,
  "remote": false,
  "capabilities": ["status", "connect-token", "disconnect", "refresh", "oauth-pkce"]
}
```

### Connect Provider

**POST** `/:providerId/auth/connect`

- **Authentication**: None (local), Required (remote — proxied to agnt.gg)
- **Description**: Save credentials for a provider. Body varies by auth scheme.
- **Body** (claude-code — token):

```json
{
  "token": "sk-ant-..."
}
```

- **Body** (gemini-cli — API key):

```json
{
  "apiKey": "AIza..."
}
```

- **Body** (remote providers — proxied to agnt.gg):

```json
{
  "apiKey": "sk-..."
}
```

- **Response**:

```json
{
  "success": true
}
```

### Disconnect Provider

**POST** `/:providerId/auth/disconnect`

- **Authentication**: None (local), Required (remote)
- **Description**: Remove credentials for a provider. Local providers delete filesystem credentials; remote providers proxy to agnt.gg.
- **Response**:

```json
{
  "success": true
}
```

### Refresh Token

**POST** `/:providerId/auth/refresh`

- **Authentication**: None
- **Description**: Refresh the access token using the stored refresh token. Only supported for local providers with the `refresh` capability (claude-code, gemini-cli).
- **Response** (success):

```json
{
  "success": true,
  "refreshed": true,
  "available": true,
  "apiUsable": true
}
```

- **Error** (401 — claude-code specific): `{ "code": "REAUTH_REQUIRED" }` if refresh token is revoked
- **Error** (400): `{ "error": "Refresh not supported for this provider" }` if provider lacks `refresh` capability

### Start OAuth Flow

**GET** `/:providerId/auth/oauth/start`

- **Authentication**: None
- **Description**: Initiate an OAuth flow. For `claude-code`, starts Anthropic PKCE OAuth. For `gemini-cli`, starts Google loopback OAuth. Only supported for local providers.
- **Response**:

```json
{
  "success": true,
  "authUrl": "https://console.anthropic.com/oauth/authorize?...",
  "sessionId": "session-uuid"
}
```

### Exchange OAuth Code (claude-code PKCE)

**POST** `/:providerId/auth/oauth/exchange`

- **Authentication**: None
- **Description**: Submit the code#state string copied from Anthropic's callback page. Only supported for providers with `oauth-pkce` capability.
- **Body**:

```json
{
  "sessionId": "session-uuid",
  "codeState": "auth-code#state-value"
}
```

- **Response**:

```json
{
  "success": true
}
```

### Poll OAuth Status (gemini-cli loopback)

**GET** `/:providerId/auth/oauth/status?sessionId=...`

- **Authentication**: None
- **Parameters**:
  - `sessionId` (query, required): The session ID from the OAuth start endpoint
- **Description**: Poll the loopback OAuth session state. Only supported for providers with `oauth-loopback` capability.
- **Response**:

```json
{
  "success": true,
  "state": "pending|completed|expired|error"
}
```

### Start Device Auth (openai-codex)

**POST** `/:providerId/auth/device/start`

- **Authentication**: None
- **Description**: Start device login flow. Returns a URL and code the user enters in a browser. Only supported for providers with `device-auth` capability.
- **Response**:

```json
{
  "success": true,
  "sessionId": "session-uuid",
  "deviceUrl": "https://auth.openai.com/device",
  "deviceCode": "ABCD-1234",
  "state": "pending",
  "startedAt": "2024-01-01T00:00:00Z",
  "expiresAt": "2024-01-01T00:15:00Z",
  "hint": "Open the URL, enter the code, then return here. We will poll for completion."
}
```

### Poll Device Auth Status (openai-codex)

**GET** `/:providerId/auth/device/status?sessionId=...`

- **Authentication**: None
- **Parameters**:
  - `sessionId` (query, required): The session ID from the device start endpoint
- **Description**: Poll the device login session state. Only supported for providers with `device-auth` capability.
- **Response**:

```json
{
  "success": true,
  "state": "pending|completed|expired|error"
}
```

### Set Auth Method (gemini-cli)

**POST** `/:providerId/auth/set-auth-method`

- **Authentication**: None
- **Description**: Switch between API key and OAuth authentication methods. Only supported for providers with `set-auth-method` capability.
- **Body**:

```json
{
  "method": "api-key|oauth"
}
```

- **Response**:

```json
{
  "success": true
}
```

### Set GCP Project (gemini-cli)

**POST** `/:providerId/auth/gcp-project`

- **Authentication**: None
- **Description**: Set the Google Cloud Project ID (required for workspace/organization accounts). Only supported for providers with `gcp-project` capability.
- **Body**:

```json
{
  "projectId": "my-gcp-project"
}
```

- **Response**:

```json
{
  "success": true
}
```

---

## Content Output Routes

Base path: `/api/content-outputs`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the content output service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Content Outputs

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all content outputs for the authenticated user
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Save/Update Content Output

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new content output or update an existing one
- **Body**:

```json
{
  "id": "optional-output-id",
  "title": "Output Title",
  "content": "Content data",
  "workflowId": "workflow-id",
  "toolId": "tool-id"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Content Output by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Description**: Retrieve a specific content output by ID
- **Response**:

```json
{
  "id": "output-id",
  "title": "Output Title",
  "content": "Content data",
  "workflowId": "workflow-id",
  "toolId": "tool-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Content Output

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Body**:

```json
{
  "title": "Updated Title",
  "content": "Updated content data"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "Updated Title",
    "content": "Updated content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Rename Content Output

**PATCH** `/:id/rename`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Body**:

```json
{
  "title": "New Title"
}
```

- **Response**:

```json
{
  "success": true,
  "output": {
    "id": "output-id",
    "title": "New Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Content Output

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Content output ID
- **Description**: Delete a content output by ID
- **Response**:

```json
{
  "success": true,
  "message": "Content output deleted successfully"
}
```

### Get Content Outputs by Workflow

**GET** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Retrieve all content outputs for a specific workflow
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Get Content Outputs by Tool

**GET** `/tool/:toolId`

- **Authentication**: Required
- **Parameters**:
  - `toolId` (path): Tool ID
- **Description**: Retrieve all content outputs for a specific tool
- **Response**:

```json
[
  {
    "id": "output-id",
    "title": "Output Title",
    "content": "Content data",
    "workflowId": "workflow-id",
    "toolId": "tool-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

---

## Custom Provider Routes

Base path: `/api/custom-providers`

### Get All Custom Providers

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all custom providers for the authenticated user
- **Response**:

```json
{
  "success": true,
  "providers": [
    {
      "id": "provider-id",
      "provider_name": "Custom Provider",
      "base_url": "https://api.example.com",
      "api_key": "encrypted-key",
      "userId": "user-id",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### Create Custom Provider

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "provider_name": "Custom Provider",
  "base_url": "https://api.example.com",
  "api_key": "your-api-key"
}
```

- **Response**:

```json
{
  "success": true,
  "provider": {
    "id": "provider-id",
    "provider_name": "Custom Provider",
    "base_url": "https://api.example.com",
    "api_key": "encrypted-key",
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "message": "Custom provider created successfully"
}
```

### Get Custom Provider by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider ID
- **Description**: Retrieve a specific custom provider by ID
- **Response**:

```json
{
  "success": true,
  "provider": {
    "id": "provider-id",
    "provider_name": "Custom Provider",
    "base_url": "https://api.example.com",
    "api_key": "encrypted-key",
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Update Custom Provider

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider ID
- **Body**:

```json
{
  "provider_name": "Updated Provider Name",
  "base_url": "https://api.updated.com",
  "api_key": "new-api-key"
}
```

- **Response**:

```json
{
  "success": true,
  "provider": {
    "id": "provider-id",
    "provider_name": "Updated Provider Name",
    "base_url": "https://api.updated.com",
    "api_key": "encrypted-new-key",
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "message": "Custom provider updated successfully"
}
```

### Delete Custom Provider

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider ID
- **Description**: Delete a custom provider by ID
- **Response**:

```json
{
  "success": true,
  "message": "Custom provider deleted successfully"
}
```

### Get Provider Templates

**GET** `/templates`

- **Authentication**: None
- **Description**: Get pre-configured templates for common custom providers (e.g., Ollama, LM Studio, vLLM)
- **Response**:

```json
{
  "success": true,
  "templates": [
    {
      "name": "Ollama",
      "base_url": "http://localhost:11434/v1",
      "description": "Local Ollama instance"
    },
    {
      "name": "LM Studio",
      "base_url": "http://localhost:1234/v1",
      "description": "Local LM Studio instance"
    }
  ]
}
```

### Test Custom Provider Connection

**POST** `/test`

- **Authentication**: Required
- **Body**:

```json
{
  "base_url": "https://api.example.com",
  "api_key": "your-api-key"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Connection successful",
  "latency": 150,
  "models": ["model1", "model2"]
}
```

### Get Provider Models

**GET** `/:id/models`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Provider ID
- **Description**: Fetch available models from a custom provider
- **Response**:

```json
{
  "success": true,
  "models": [
    {
      "id": "model-id",
      "name": "Model Name",
      "description": "Model description",
      "context_length": 4096,
      "pricing": {
        "prompt": 0.001,
        "completion": 0.002
      }
    }
  ],
  "count": 1
}
```

---

## Custom Tool Routes

Base path: `/api/custom-tools`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the custom tool service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Custom Tools

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all custom tools for the authenticated user
- **Response**:

```json
[
  {
    "id": "tool-id",
    "name": "Custom Tool",
    "description": "Tool description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Save/Update Custom Tool

**POST** `/save`

- **Authentication**: Required
- **Description**: Create a new custom tool or update an existing one
- **Body**:

```json
{
  "id": "optional-tool-id",
  "name": "Custom Tool",
  "description": "Tool description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "id": "tool-id",
    "name": "Custom Tool",
    "description": "Tool description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Custom Tool by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Description**: Retrieve a specific custom tool by ID
- **Response**:

```json
{
  "id": "tool-id",
  "name": "Custom Tool",
  "description": "Tool description",
  "config": {},
  "userId": "user-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Custom Tool

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Body**:

```json
{
  "name": "Updated Tool Name",
  "description": "Updated description",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "id": "tool-id",
    "name": "Updated Tool Name",
    "description": "Updated description",
    "config": {},
    "userId": "user-id",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Custom Tool

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Tool ID
- **Description**: Delete a custom tool by ID
- **Response**:

```json
{
  "success": true,
  "message": "Custom tool deleted successfully"
}
```

---

## Email Listener Routes

Base path: `/api/email-listeners`

### Get Email Listeners

**GET** `/`

- **Authentication**: Required
- **Description**: Get all workflows with `receive-email` trigger nodes for the authenticated user
- **Response**:

```json
{
  "success": true,
  "listeners": [
    {
      "id": "workflow-id",
      "workflow_id": "workflow-id",
      "workflow_name": "Email Handler Workflow",
      "workflow_status": "active",
      "email_address": "workflow-123@agnt.gg",
      "email_config": "Built-in Email",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Execution Routes

Base path: `/api/executions`

### Get All Executions

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all executions for the authenticated user
- **Response**:

```json
[
  {
    "id": "execution-id",
    "type": "agent|workflow|tool",
    "status": "running|completed|failed",
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:05:00Z",
    "metadata": {}
  }
]
```

### Get Agent Activity Data

**POST** `/activity`

- **Authentication**: Required
- **Body**:

```json
{
  "agentId": "agent-id",
  "timeRange": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-02T00:00:00Z"
  }
}
```

- **Response**:

```json
{
  "activities": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "type": "chat|execution",
      "details": {}
    }
  ],
  "summary": {
    "totalChats": 10,
    "totalExecutions": 5
  }
}
```

### Get Execution Details

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution ID
- **Description**: Retrieve detailed information about a specific execution
- **Response**:

```json
{
  "id": "execution-id",
  "type": "agent|workflow|tool",
  "status": "running|completed|failed",
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-01T00:05:00Z",
  "input": {},
  "output": {},
  "logs": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "level": "info|error|debug",
      "message": "Log message"
    }
  ],
  "metadata": {}
}
```

### Get Agent Executions

**GET** `/agents/list`

- **Authentication**: Required
- **Description**: Get all agent/orchestrator execution traces
- **Response**:

```json
{
  "success": true,
  "runs": [
    {
      "id": "run-id",
      "agentId": "agent-id",
      "agentName": "Agent Name",
      "status": "completed|running|failed",
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z",
      "tokensUsed": 1500,
      "cost": 0.003
    }
  ]
}
```

### Get Agent Execution Details

**GET** `/agents/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution/run ID
- **Description**: Get detailed agent execution trace including messages and tool calls
- **Response**:

```json
{
  "success": true,
  "run": {
    "id": "run-id",
    "agentId": "agent-id",
    "status": "completed",
    "messages": [],
    "toolCalls": [],
    "tokensUsed": 1500,
    "cost": 0.003,
    "startedAt": "2024-01-01T00:00:00Z",
    "completedAt": "2024-01-01T00:05:00Z"
  }
}
```

### Delete Agent Execution

**DELETE** `/agents/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Execution/run ID
- **Description**: Delete a specific agent execution trace
- **Response**:

```json
{
  "success": true,
  "message": "Agent execution deleted"
}
```

### Clear Completed Agent Executions

**POST** `/agents/clear-completed`

- **Authentication**: Required
- **Description**: Clear all completed agent execution traces for the authenticated user
- **Response**:

```json
{
  "success": true,
  "cleared": 15
}
```

---

## Evolution / Insight Routes

Base path: `/api/insights`

The unified evolution system extracts actionable insights from agent chats, goal executions, and workflow runs. Insights can target agents, skills, workflows, or tools and are automatically generated when executions complete. The system also manages per-agent memory (facts, preferences, corrections learned from conversations).

### List Insights

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `targetType` (query, optional): Filter by target type (`agent`, `skill`, `workflow`, `tool`)
  - `targetId` (query, optional): Filter by target ID
  - `status` (query, optional): Filter by status (`pending`, `applied`, `rejected`)
  - `category` (query, optional): Filter by category (`memory`, `prompt_refinement`, `skill_recommendation`, `tool_preference`, `bottleneck`, `optimization`, `error_pattern`, `skill_candidate`)
  - `limit` (query, optional): Max results (default: 100)
- **Response**:

```json
{
  "success": true,
  "insights": [
    {
      "id": "insight-uuid",
      "user_id": "user-id",
      "source_type": "agent_chat|goal|workflow",
      "source_id": "execution-id",
      "target_type": "agent|skill|workflow|tool",
      "target_id": "agent-id",
      "category": "prompt_refinement",
      "title": "Insight title",
      "description": "Detailed description",
      "confidence": 0.85,
      "priority": "medium",
      "status": "pending",
      "source_context": {},
      "evidence": {},
      "applied_result": null,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Insight Stats

**GET** `/stats`

- **Authentication**: Required
- **Description**: Get aggregated insight counts grouped by status and target type
- **Response**:

```json
{
  "success": true,
  "statusCounts": { "pending": 12, "applied": 8, "rejected": 2 },
  "targetCounts": { "agent": 10, "skill": 5, "workflow": 7 }
}
```

### Get Insights by Target

**GET** `/target/:targetType/:targetId`

- **Authentication**: Required
- **Parameters**:
  - `targetType` (path): `agent`, `skill`, `workflow`, or `tool`
  - `targetId` (path): Target entity ID
  - `status` (query, optional): Filter by status
- **Description**: Get all insights targeting a specific entity (e.g., all insights for a particular agent)
- **Response**:

```json
{
  "success": true,
  "insights": [ ... ]
}
```

### Get Insights by Source

**GET** `/source/:sourceType/:sourceId`

- **Authentication**: Required
- **Parameters**:
  - `sourceType` (path): `agent_chat`, `goal`, or `workflow`
  - `sourceId` (path): Source execution ID
- **Description**: Get all insights generated from a specific execution (e.g., all insights extracted from a particular goal run)
- **Response**:

```json
{
  "success": true,
  "insights": [ ... ]
}
```

### Get Single Insight

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Response**:

```json
{
  "success": true,
  "insight": { ... }
}
```

- **Error** (404): Insight not found

### Apply Insight

**POST** `/:id/apply`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Apply an insight to its target entity. For agent prompt refinements, uses LLM to merge the improvement into the agent's system prompt. Provider/model override the user's defaults for the LLM call. The insight status is updated to `applied`.
- **Response**:

```json
{
  "success": true,
  "result": {
    "applied": true,
    "changes": { ... }
  }
}
```

### Reject Insight

**POST** `/:id/reject`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Description**: Mark an insight as rejected
- **Response**:

```json
{
  "success": true,
  "message": "Insight rejected"
}
```

### Delete Insight

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Insight ID
- **Response**:

```json
{
  "success": true,
  "deleted": true
}
```

### Trigger Periodic Rollup

**POST** `/rollup`

- **Authentication**: Required
- **Description**: Manually trigger tool usage rollup analysis. Extracts tool preference insights from recent execution history.
- **Response**:

```json
{
  "success": true,
  "count": 3,
  "insightIds": ["id-1", "id-2", "id-3"]
}
```

### Get Agent Memories

**GET** `/memory/:agentId`

- **Authentication**: Required
- **Parameters**:
  - `agentId` (path): Agent ID
  - `memoryType` (query, optional): Filter by type (`fact`, `preference`, `correction`)
- **Description**: Get all memories for an agent. Memories are facts, preferences, and corrections learned from conversations.
- **Response**:

```json
{
  "success": true,
  "memories": [
    {
      "id": "memory-uuid",
      "agent_id": "agent-id",
      "user_id": "user-id",
      "memory_type": "fact",
      "content": "User prefers TypeScript over JavaScript",
      "relevance_score": 0.9,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Add Agent Memory

**POST** `/memory/:agentId`

- **Authentication**: Required
- **Parameters**:
  - `agentId` (path): Agent ID
- **Body**:

```json
{
  "memoryType": "fact|preference|correction",
  "content": "User prefers concise answers"
}
```

- **Response**:

```json
{
  "success": true,
  "id": "memory-uuid"
}
```

### Update Agent Memory

**PUT** `/memory/entry/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Memory entry ID
- **Body**:

```json
{
  "content": "Updated memory content",
  "relevanceScore": 0.95,
  "memoryType": "preference"
}
```

- **Response**:

```json
{
  "success": true,
  "updated": true
}
```

### Delete Agent Memory

**DELETE** `/memory/entry/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Memory entry ID
- **Response**:

```json
{
  "success": true,
  "deleted": true
}
```

---

## Experiment Routes

Base path: `/api/experiments`

Manages A/B testing experiments, evaluation datasets, and benchmarks for the evolution system.

### Create Eval Dataset

**POST** `/datasets`

- **Authentication**: Required
- **Description**: Create an evaluation dataset (manual or synthetic)
- **Body**:

```json
{
  "name": "Dataset Name",
  "skillId": "skill-id",
  "category": "general",
  "source": "manual|synthetic|history|golden",
  "items": [
    {
      "input": "Test input",
      "expectedOutput": "Expected output",
      "metadata": {}
    }
  ],
  "splitConfig": {
    "train": 0.7,
    "test": 0.2,
    "validation": 0.1
  }
}
```

- **Response**:

```json
{
  "success": true,
  "datasetId": "dataset-uuid"
}
```

### List Datasets

**GET** `/datasets`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (query, optional): Filter by skill
  - `category` (query, optional): Filter by category
- **Response**:

```json
{
  "success": true,
  "datasets": [
    {
      "id": "dataset-id",
      "name": "Dataset Name",
      "skillId": "skill-id",
      "category": "general",
      "source": "manual",
      "itemCount": 100,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Generate Dataset

**POST** `/datasets/generate`

- **Authentication**: Required
- **Description**: Auto-generate a dataset from goal history, golden standards, or synthetically
- **Body**:

```json
{
  "skillId": "skill-id",
  "source": "history|golden|synthetic",
  "category": "general",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "datasetId": "dataset-uuid"
}
```

### Get Dataset with Splits

**GET** `/datasets/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Dataset ID
- **Response**:

```json
{
  "success": true,
  "dataset": {
    "id": "dataset-id",
    "name": "Dataset Name",
    "items": []
  },
  "splits": {
    "train": [],
    "test": [],
    "validation": []
  }
}
```

### Delete Dataset

**DELETE** `/datasets/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Dataset ID
- **Response**:

```json
{
  "success": true
}
```

### Get Benchmarks

**GET** `/benchmarks`

- **Authentication**: Required
- **Description**: List golden standard benchmarks available for experiments
- **Response**:

```json
{
  "success": true,
  "benchmarks": [
    {
      "id": "benchmark-id",
      "name": "Benchmark Name",
      "sourceGoalId": "goal-id",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Experiment

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "Experiment Name",
  "hypothesis": "Skill v2 will outperform v1 on accuracy",
  "type": "ab_test|benchmark|regression",
  "sourceGoalId": "goal-id",
  "benchmarkId": "benchmark-id",
  "skillId": "skill-id",
  "evalDatasetId": "dataset-id",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "experiment": {
    "id": "experiment-id",
    "name": "Experiment Name",
    "status": "created",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### List Experiments

**GET** `/`

- **Authentication**: Required
- **Parameters**:
  - `status` (query, optional): Filter by status
  - `limit` (query, optional): Max results (default: 50)
- **Response**:

```json
{
  "success": true,
  "experiments": [
    {
      "id": "experiment-id",
      "name": "Experiment Name",
      "status": "created|running|completed|failed",
      "type": "ab_test",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Experiment with Results

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Response**:

```json
{
  "success": true,
  "experiment": {
    "id": "experiment-id",
    "name": "Experiment Name",
    "status": "completed",
    "results": {},
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Run Experiment

**POST** `/:id/run`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Body** (optional):

```json
{
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Description**: Fire-and-forget experiment execution. Returns immediately while the experiment runs in the background.
- **Response**:

```json
{
  "success": true,
  "message": "Experiment run started"
}
```

### Delete Experiment

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Response**:

```json
{
  "success": true
}
```

### Get Experiment Runs

**GET** `/:id/runs`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Experiment ID
- **Description**: Get all run results for an experiment
- **Response**:

```json
{
  "success": true,
  "runs": [
    {
      "id": "run-id",
      "experimentId": "experiment-id",
      "status": "completed",
      "results": {},
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z"
    }
  ]
}
```

---

## FileSystem Routes

Base path: `/api/filesystem`

Provides a sandboxed file system for the built-in code editor. All file paths are relative to the configured workspace root. Path traversal outside the workspace is blocked (403).

### Get Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Returns the current workspace root directory and default root
- **Response**:

```json
{
  "workspaceRoot": "/home/user/.agnt/data/projects",
  "defaultRoot": "/home/user/.agnt/data/projects"
}
```

### Update Settings

**PUT** `/settings`

- **Authentication**: Required
- **Description**: Update the workspace root directory
- **Body**:

```json
{
  "workspaceRoot": "/path/to/new/workspace"
}
```

- **Response**:

```json
{
  "success": true,
  "workspaceRoot": "/path/to/new/workspace"
}
```

### Get Directory Tree

**GET** `/tree?dir=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `dir` (query, optional): Relative path within workspace (default: root)
- **Description**: Returns directory listing for the given relative path. Hidden files (dot-prefixed) are excluded. Directories are listed first.
- **Response**:

```json
{
  "items": [
    { "name": "src", "type": "directory", "path": "src" },
    { "name": "index.js", "type": "file", "path": "index.js" }
  ],
  "root": "/"
}
```

### Read File

**GET** `/file?path=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `path` (query, required): Relative file path within workspace
- **Description**: Returns the content of a file as UTF-8 text
- **Response**:

```json
{
  "content": "file contents here...",
  "path": "src/index.js"
}
```

- **Error** (404): File not found

### Write File

**POST** `/file`

- **Authentication**: Required
- **Description**: Create or overwrite a file. Parent directories are created automatically.
- **Body**:

```json
{
  "path": "src/index.js",
  "content": "console.log('hello');"
}
```

- **Response**:

```json
{
  "success": true,
  "path": "src/index.js"
}
```

### Create Directory

**POST** `/mkdir`

- **Authentication**: Required
- **Description**: Create a directory (recursive)
- **Body**:

```json
{
  "path": "src/components"
}
```

- **Response**:

```json
{
  "success": true,
  "path": "src/components"
}
```

### Rename / Move

**POST** `/rename`

- **Authentication**: Required
- **Description**: Rename or move a file or directory
- **Body**:

```json
{
  "oldPath": "src/old-name.js",
  "newPath": "src/new-name.js"
}
```

- **Response**:

```json
{
  "success": true,
  "oldPath": "src/old-name.js",
  "newPath": "src/new-name.js"
}
```

### Delete File or Directory

**DELETE** `/file?path=<relPath>`

- **Authentication**: Required
- **Parameters**:
  - `path` (query, required): Relative path within workspace
- **Description**: Delete a file or directory (recursive for directories)
- **Response**:

```json
{
  "success": true,
  "path": "src/old-file.js"
}
```

- **Error** (404): File not found

---

## Goal Routes

Base path: `/api/goals`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the goal service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Goals

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all goals for the authenticated user. Includes aggregated token usage from goal evaluations.
- **Response**:

```json
[
  {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active|paused|completed|validated|needs_review|failed",
    "priority": "low|medium|high",
    "task_count": 5,
    "completed_tasks": 3,
    "input_tokens": 15000,
    "output_tokens": 3200,
    "total_tokens": 18200,
    "estimated_cost": 0.045,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Create Goal

**POST** `/create`

- **Authentication**: Required
- **Body**:

```json
{
  "title": "Goal Title",
  "description": "Goal description",
  "priority": "low|medium|high",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "goal": {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active",
    "priority": "medium",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Execute Goal

**POST** `/:goalId/execute`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Start goal execution. Any failed or stuck tasks are reset to pending. The provider/model override the user's default settings for this execution and all downstream operations (task execution, evaluation, insight extraction, skill evolution).
- **Response**:

```json
{
  "message": "Goal execution started",
  "goalId": "goal-id",
  "status": "executing"
}
```

### Get Goal by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Retrieve a specific goal with tasks and aggregated token usage from evaluations and task executions
- **Response**:

```json
{
  "goal": {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active|paused|completed|validated|needs_review|failed",
    "priority": "low|medium|high",
    "config": {},
    "tasks": [],
    "total_duration": 120,
    "credits_used": 120,
    "input_tokens": 15000,
    "output_tokens": 3200,
    "total_tokens": 18200,
    "estimated_cost": 0.045,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Goal Status

**GET** `/:id/status`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Get the current status of a goal
- **Response**:

```json
{
  "goalId": "goal-id",
  "status": "active|paused|completed|failed",
  "progress": 75,
  "lastExecution": "2024-01-01T00:00:00Z",
  "nextExecution": "2024-01-01T01:00:00Z"
}
```

### Pause Goal

**POST** `/:id/pause`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Pause an active goal
- **Response**:

```json
{
  "success": true,
  "message": "Goal paused successfully"
}
```

### Resume Goal

**POST** `/:id/resume`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Resume a paused or failed goal. Failed/stuck tasks are reset to pending. Provider/model are forwarded to all downstream operations.
- **Response**:

```json
{
  "message": "Goal resumed"
}
```

### Delete Goal

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Delete a goal by ID
- **Response**:

```json
{
  "success": true,
  "message": "Goal deleted successfully"
}
```

### Execute Goal Autonomously (AGI Loop)

**POST** `/:goalId/execute-autonomous`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "maxIterations": 50,
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Trigger autonomous goal execution. The system iterates through execute → evaluate → re-plan cycles until the goal passes evaluation or reaches `maxIterations`. Provider/model are forwarded to task execution, evaluation, re-planning, insight extraction, and skill evolution. Broadcasts real-time `goal:iteration_*` events via WebSocket.
- **Response**:

```json
{
  "message": "Autonomous goal execution started",
  "goalId": "goal-id",
  "maxIterations": 50
}
```

### Get Iteration History

**GET** `/:goalId/iterations`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Description**: Get the full iteration history for an autonomous goal execution. Each iteration includes evaluation scores and re-planned task data.
- **Response**:

```json
{
  "success": true,
  "iterations": [
    {
      "iteration": 1,
      "action": "Description of action taken",
      "result": {},
      "evaluation": {},
      "evaluation_score": 65.5,
      "evaluation_passed": 0,
      "world_state_snapshot": {},
      "replanned_tasks": [],
      "duration_ms": 45000,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get World State

**GET** `/:goalId/world-state`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Description**: Get the current world state snapshot for a goal's autonomous execution
- **Response**:

```json
{
  "success": true,
  "worldState": {
    "goalId": "goal-id",
    "currentIteration": 5,
    "state": {},
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Revert to Iteration

**POST** `/:goalId/revert/:iteration`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
  - `iteration` (path): Iteration number to revert to
- **Description**: Revert the goal's execution state to a specific iteration
- **Response**:

```json
{
  "success": true,
  "revertedToIteration": 3,
  "worldState": {}
}
```

### Review Goal

**POST** `/:id/review`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Approve or reject a goal that is in `needs_review` status
- **Body**:

```json
{
  "status": "approved|rejected",
  "feedback": "Optional feedback message"
}
```

- **Response**:

```json
{
  "success": true,
  "goal": {
    "id": "goal-id",
    "status": "approved",
    "reviewedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Evaluate Goal

**POST** `/:id/evaluate`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body**:

```json
{
  "evaluation_type": "automatic",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Evaluate a completed goal using LLM-as-judge. Each task output is scored against its success criteria, then an overall evaluation is produced. Token usage is tracked and stored per evaluation. The goal status is set to `validated` (score ≥ 70%) or `needs_review`.
- **Response**:

```json
{
  "passed": true,
  "status": "validated",
  "scores": {
    "overall": 85,
    "taskScores": {}
  },
  "feedback": "Detailed evaluation feedback...",
  "input_tokens": 8000,
  "output_tokens": 1500,
  "total_tokens": 9500,
  "estimated_cost": 0.025
}
```

### Get Evaluation Report

**GET** `/:id/evaluation`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Get evaluation report for a goal
- **Response**:

```json
{
  "goalId": "goal-id",
  "evaluations": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "score": 85,
      "metrics": {},
      "recommendations": []
    }
  ]
}
```

### Save as Golden Standard

**POST** `/:id/golden-standard`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body**:

```json
{
  "name": "Golden Standard Name",
  "description": "Description of the golden standard"
}
```

- **Response**:

```json
{
  "success": true,
  "goldenStandard": {
    "id": "golden-standard-id",
    "name": "Golden Standard Name",
    "description": "Description",
    "sourceGoalId": "goal-id",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Golden Standards

**GET** `/golden-standards/list`

- **Authentication**: Required
- **Description**: Retrieve all golden standards
- **Response**:

```json
{
  "goldenStandards": [
    {
      "id": "golden-standard-id",
      "name": "Golden Standard Name",
      "description": "Description",
      "sourceGoalId": "goal-id",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Layout Routes

Base path: `/api/layouts`

Manages per-user widget layout pages for the dashboard. Each page stores a grid layout of widgets.

### Get All Layouts

**GET** `/`

- **Authentication**: Required
- **Description**: Get all layout pages for the authenticated user
- **Response**:

```json
{
  "pages": [
    {
      "id": "uuid",
      "user_id": "user-id",
      "page_id": "dashboard",
      "page_name": "Dashboard",
      "page_icon": "fas fa-th",
      "page_order": 0,
      "route": "/dashboard",
      "layout_data": "[...]",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Layout

**POST** `/`

- **Authentication**: Required
- **Description**: Create a new layout page
- **Body**:

```json
{
  "page_id": "my-page",
  "page_name": "My Page",
  "page_icon": "fas fa-th",
  "page_order": 1,
  "route": "/my-page",
  "layout_data": "[]"
}
```

- **Response** (201):

```json
{
  "message": "Layout created",
  "id": "uuid",
  "page_id": "my-page"
}
```

### Update Layout

**PUT** `/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Update a layout page (upserts if not found)
- **Body**:

```json
{
  "page_name": "Updated Name",
  "page_icon": "fas fa-chart-bar",
  "page_order": 2,
  "route": "/updated-page",
  "layout_data": "[...]"
}
```

- **Response**:

```json
{
  "message": "Layout updated",
  "page_id": "my-page"
}
```

### Delete Layout

**DELETE** `/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Delete a layout page
- **Response**:

```json
{
  "message": "Layout deleted",
  "page_id": "my-page"
}
```

### Reset Layout

**POST** `/reset/:pageId`

- **Authentication**: Required
- **Parameters**:
  - `pageId` (path): Page identifier
- **Description**: Reset a page to default layout
- **Body**:

```json
{
  "layout_data": "[]"
}
```

- **Response**:

```json
{
  "message": "Layout reset",
  "page_id": "my-page"
}
```

---

## MCP Routes

Base path: `/api/mcp`

### Get All MCP Servers

**GET** `/servers`

- **Authentication**: Required
- **Description**: Retrieve all MCP servers for the authenticated user
- **Response**:

```json
{
  "success": true,
  "servers": [
    {
      "name": "server-name",
      "description": "Server description",
      "url": "https://server-url.com",
      "status": "active|inactive",
      "config": {}
    }
  ]
}
```

### Add MCP Server

**POST** `/servers`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "server-name",
  "description": "Server description",
  "url": "https://server-url.com",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "server": {
    "name": "server-name",
    "description": "Server description",
    "url": "https://server-url.com",
    "status": "active",
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Update MCP Server

**PUT** `/servers/:name`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Body**:

```json
{
  "description": "Updated description",
  "url": "https://updated-url.com",
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "server": {
    "name": "server-name",
    "description": "Updated description",
    "url": "https://updated-url.com",
    "status": "active",
    "config": {},
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete MCP Server

**DELETE** `/servers/:name`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Delete an MCP server by name
- **Response**:

```json
{
  "success": true,
  "message": "MCP server deleted successfully"
}
```

### Get Server Capabilities

**GET** `/servers/:name/capabilities`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Get capabilities of a specific MCP server
- **Response**:

```json
{
  "success": true,
  "capabilities": {
    "tools": ["tool1", "tool2"],
    "resources": ["resource1", "resource2"],
    "prompts": ["prompt1", "prompt2"]
  }
}
```

### Test MCP Server Connection

**POST** `/servers/:name/test`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Server name
- **Description**: Test connection to an MCP server
- **Response**:

```json
{
  "success": true,
  "message": "Connection successful",
  "latency": 150,
  "capabilities": {
    "tools": ["tool1", "tool2"],
    "resources": ["resource1", "resource2"]
  }
}
```

---

## Model Routes

Base path: `/api/models`

### Get Models by Provider

**GET** `/:provider/models`

- **Authentication**: Required (except for hardcoded/static-model providers and CLI providers which use local auth)
- **Parameters**:
  - `provider` (path): Provider name (openai, anthropic, gemini, grokai, groq, deepseek, openrouter, togetherai, cerebras, kimi, minimax, zai, openai-codex, claude-code, gemini-cli)
  - `category` (query): Filter by category (optional)
  - `useCache` (query): Use cached models (default: true)
  - `format` (query): Response format - 'names' or 'full' (default: 'names')
- **Description**: Fetch available models from a specific provider
- **Response**:

```json
{
  "success": true,
  "models": [
    {
      "id": "model-id",
      "name": "Model Name",
      "description": "Model description",
      "context_length": 4096,
      "pricing": {
        "prompt": 0.001,
        "completion": 0.002
      }
    }
  ],
  "cached": true,
  "count": 1
}
```

### Refresh Models Cache

**POST** `/:provider/models/refresh`

- **Authentication**: Required
- **Parameters**:
  - `provider` (path): Provider name
- **Description**: Refresh the models cache for a specific provider
- **Response**:

```json
{
  "success": true,
  "models": ["model1", "model2"],
  "count": 2,
  "message": "Provider models cache refreshed successfully"
}
```

### Get OpenRouter Models (Legacy)

**GET** `/models`

- **Authentication**: Required
- **Description**: Legacy endpoint for OpenRouter models (backward compatibility)
- **Response**: Same as `/:provider/models` for openrouter

### Refresh OpenRouter Models (Legacy)

**POST** `/models/refresh`

- **Authentication**: Required
- **Description**: Legacy endpoint for refreshing OpenRouter models
- **Response**: Same as `/:provider/models/refresh` for openrouter

### Get Provider Metadata (All Models)

**GET** `/:provider/metadata`

- **Authentication**: None
- **Parameters**:
  - `provider` (path): Provider name
- **Description**: Get metadata for all models from a specific provider
- **Response**:

```json
{
  "success": true,
  "provider": "openai",
  "metadata": {
    "gpt-4": {
      "contextLength": 128000,
      "maxOutput": 4096,
      "inputCost": 0.03,
      "outputCost": 0.06,
      "reasoning": false
    }
  }
}
```

### Get Model Metadata (Single Model)

**GET** `/:provider/metadata/:modelId`

- **Authentication**: None
- **Parameters**:
  - `provider` (path): Provider name
  - `modelId` (path): Model ID
  - `inputTokens` (query, optional): Input token count for cost estimate
  - `outputTokens` (query, optional): Output token count for cost estimate
- **Description**: Get metadata for a specific model, optionally with cost estimate
- **Response**:

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-4",
  "metadata": {
    "contextLength": 128000,
    "maxOutput": 4096,
    "inputCost": 0.03,
    "outputCost": 0.06
  },
  "reasoning": false,
  "cost": {
    "inputCost": 0.0015,
    "outputCost": 0.003,
    "totalCost": 0.0045
  }
}
```

### Get Provider Health

**GET** `/provider-health`

- **Authentication**: None
- **Description**: Get cached provider health status for all configured providers
- **Response**:

```json
{
  "success": true,
  "healthy": 8,
  "unhealthy": 1,
  "total": 9,
  "providers": {
    "openai": { "status": "healthy", "latency": 150 },
    "anthropic": { "status": "healthy", "latency": 200 },
    "gemini": { "status": "error", "error": "Invalid API key" }
  }
}
```

### Check Provider Health (Live)

**POST** `/provider-health/check`

- **Authentication**: Conditional (may need API keys)
- **Description**: Run live health checks against all configured providers. More expensive than the cached GET endpoint.
- **Response**:

```json
{
  "success": true,
  "healthy": 8,
  "unhealthy": 1,
  "total": 9,
  "providers": {
    "openai": { "status": "healthy", "latency": 150 },
    "anthropic": { "status": "healthy", "latency": 200 }
  }
}
```

### Get Model Categories

**GET** `/models/categories`

- **Authentication**: None
- **Description**: Get available model categories
- **Response**:

```json
{
  "success": true,
  "categories": [
    {
      "id": "all",
      "name": "All Models",
      "description": "All available models"
    },
    {
      "id": "programming",
      "name": "Programming",
      "description": "Models optimized for code generation and programming tasks"
    },
    {
      "id": "creative",
      "name": "Creative",
      "description": "Models optimized for creative writing and content generation"
    },
    {
      "id": "reasoning",
      "name": "Reasoning",
      "description": "Models optimized for logical reasoning and problem solving"
    }
  ]
}
```

---

## NPM Routes

Base path: `/api/npm`

### Search MCP Servers

**GET** `/search`

- **Authentication**: Required
- **Parameters**:
  - `q` (query): Search query
  - `limit` (query): Maximum results (optional)
- **Description**: Search for MCP servers on NPM
- **Response**:

```json
{
  "success": true,
  "packages": [
    {
      "name": "package-name",
      "version": "1.0.0",
      "description": "Package description",
      "author": "Author Name",
      "keywords": ["mcp", "server"],
      "downloads": 1000
    }
  ]
}
```

### Get Popular Servers

**GET** `/popular`

- **Authentication**: Required
- **Description**: Get popular MCP servers from NPM
- **Response**:

```json
{
  "success": true,
  "packages": [
    {
      "name": "popular-package",
      "version": "1.0.0",
      "description": "Popular package description",
      "downloads": 10000,
      "rating": 4.5
    }
  ]
}
```

### Get Package Details

**GET** `/package/:packageName`

- **Authentication**: Required
- **Parameters**:
  - `packageName` (path): NPM package name
- **Description**: Get detailed information about a specific NPM package
- **Response**:

```json
{
  "success": true,
  "package": {
    "name": "package-name",
    "version": "1.0.0",
    "description": "Package description",
    "author": "Author Name",
    "license": "MIT",
    "repository": "https://github.com/user/repo",
    "dependencies": {},
    "downloads": {
      "lastWeek": 1000,
      "lastMonth": 5000,
      "total": 50000
    },
    "readme": "README content"
  }
}
```

### Test Package

**POST** `/test`

- **Authentication**: Required
- **Body**:

```json
{
  "packageName": "package-name",
  "version": "1.0.0"
}
```

- **Response**:

```json
{
  "success": true,
  "testResults": {
    "compatible": true,
    "issues": [],
    "recommendations": []
  }
}
```

---

## Orchestrator Routes

Base path: `/api/orchestrator`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the orchestrator service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Universal Chat

**POST** `/chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Universal chat endpoint that handles agent, workflow, tool, and goal interactions
- **Response**: Server-sent events stream

### Agent Chat

**POST** `/agent-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `agentId` (string): Agent ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific agent
- **Response**: Server-sent events stream

### Workflow Chat

**POST** `/workflow-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `workflowId` (string): Workflow ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific workflow
- **Response**: Server-sent events stream

### Tool Chat

**POST** `/tool-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `toolId` (string): Tool ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific tool
- **Response**: Server-sent events stream

### Goal Chat

**POST** `/goal-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `goalId` (string): Goal ID
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Description**: Chat with a specific goal
- **Response**: Server-sent events stream

### Code Chat

**POST** `/code-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Code-focused chat with streaming. Uses code-specialized system prompts and tools.
- **Response**: Server-sent events stream

### Widget Chat

**POST** `/widget-chat`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments (max 20MB each)
- **Description**: Widget-specific chat with streaming. Used for creating and editing custom dashboard widgets.
- **Response**: Server-sent events stream

### Get Suggestions

**POST** `/suggestions`

- **Authentication**: Required
- **Body**:

```json
{
  "context": "Current context or partial message",
  "type": "agent|workflow|tool|goal"
}
```

- **Response**:

```json
{
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}
```

---

## Plugin Routes

Base path: `/api/plugins`

### Get Installed Plugins

**GET** `/installed`

- **Authentication**: None
- **Description**: Get list of installed plugins with their status
- **Response**:

```json
{
  "success": true,
  "plugins": [
    {
      "name": "plugin-name",
      "version": "1.0.0",
      "description": "Plugin description",
      "status": "active|inactive|error",
      "tools": ["tool1", "tool2"]
    }
  ],
  "stats": {
    "total": 5,
    "active": 3,
    "inactive": 2
  }
}
```

### Get Installed Plugin Details

**GET** `/installed/:name`

- **Authentication**: None
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get details of a specific installed plugin
- **Response**:

```json
{
  "success": true,
  "plugin": {
    "name": "plugin-name",
    "version": "1.0.0",
    "description": "Plugin description",
    "isValid": true,
    "tools": [
      {
        "type": "tool-type",
        "title": "Tool Title",
        "description": "Tool description",
        "category": "action"
      }
    ]
  }
}
```

### Get Plugin Source Code

**GET** `/installed/:name/source`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get source code of an installed plugin
- **Response**:

```json
{
  "success": true,
  "files": {
    "manifest.json": "{...}",
    "package.json": "{...}",
    "index.js": "console.log('hello');"
  }
}
```

### Get Plugin Package

**GET** `/installed/:name/package`

- **Authentication**: Required
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Get the plugin as a packaged .agnt file (base64 encoded)
- **Response**:

```json
{
  "success": true,
  "data": "base64-encoded-package-data",
  "size": 1024000,
  "fileName": "plugin-name.agnt"
}
```

### Get Marketplace Plugins

**GET** `/marketplace`

- **Authentication**: None
- **Description**: Get list of available plugins from the marketplace
- **Response**:

```json
{
  "plugins": [
    {
      "name": "marketplace-plugin",
      "version": "1.0.0",
      "description": "Marketplace plugin description",
      "author": "Author Name",
      "downloads": 1000,
      "rating": 4.5
    }
  ]
}
```

### Install Plugin from Marketplace

**POST** `/install`

- **Authentication**: None
- **Body**:

```json
{
  "name": "plugin-name",
  "version": "latest"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Plugin installed successfully",
  "plugin": {
    "name": "plugin-name",
    "version": "1.0.0"
  }
}
```

### Install Plugin from File

**POST** `/install-file`

- **Authentication**: None
- **Body**:

```json
{
  "name": "plugin-name",
  "fileData": "base64-encoded-file-data",
  "fileName": "plugin.agnt"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Plugin installed successfully",
  "plugin": {
    "name": "plugin-name",
    "version": "1.0.0"
  }
}
```

### Uninstall Plugin

**DELETE** `/:name`

- **Authentication**: None
- **Parameters**:
  - `name` (path): Plugin name
- **Description**: Uninstall a plugin
- **Response**:

```json
{
  "success": true,
  "message": "Plugin uninstalled successfully"
}
```

### Get Plugin Tools

**GET** `/tools`

- **Authentication**: None
- **Description**: Get all tools provided by plugins
- **Response**:

```json
{
  "success": true,
  "tools": [
    {
      "type": "tool-type",
      "title": "Tool Title",
      "description": "Tool description",
      "category": "action",
      "icon": "tool-icon",
      "plugin": "plugin-name"
    }
  ],
  "count": 1
}
```

### Generate Plugin with AI

**POST** `/generate`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Natural language description of the plugin",
  "provider": "openai",
  "model": "gpt-4",
  "options": {}
}
```

- **Response**: Server-sent events stream with generation progress

### Regenerate Plugin File

**POST** `/regenerate-file`

- **Authentication**: Required
- **Body**:

```json
{
  "fileName": "index.js",
  "instructions": "Update the file to...",
  "currentManifest": {},
  "currentCode": {},
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "content": "Generated file content"
}
```

### Regenerate Entire Plugin

**POST** `/regenerate`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Updated plugin description",
  "currentManifest": {},
  "currentCode": {},
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**: Server-sent events stream with regeneration progress

### Build Generated Plugin

**POST** `/build-generated`

- **Authentication**: Required
- **Body**:

```json
{
  "manifest": {},
  "toolCode": {},
  "packageJson": {},
  "installAfterBuild": true
}
```

- **Response**:

```json
{
  "success": true,
  "pluginName": "generated-plugin",
  "outputFile": "/path/to/plugin.agnt",
  "installed": true,
  "installResult": {
    "success": true
  }
}
```

### Reload Plugins

**POST** `/reload`

- **Authentication**: None
- **Description**: Reload all plugins (useful after manual changes)
- **Response**:

```json
{
  "success": true,
  "message": "Plugins reloaded",
  "stats": {
    "total": 5,
    "active": 3
  },
  "orchestratorReload": {
    "success": true
  },
  "workflowProcessReload": {
    "success": true
  }
}
```

---

## Skill Routes

Base path: `/api/skills`

Manage reusable agent skills — named instruction sets that can be assigned to agents.

### Get All Skills

**GET** `/`

- **Authentication**: Required
- **Description**: Get all skills for the authenticated user
- **Response**:

```json
{
  "skills": [
    {
      "id": "skill-uuid",
      "name": "Code Reviewer",
      "description": "Reviews code for quality and security",
      "instructions": "When reviewing code...",
      "icon": "fas fa-code",
      "category": "development",
      "allowed_tools": "[\"code-search\",\"file-read\"]",
      "license": "",
      "compatibility": "",
      "metadata": "",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Skill by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Response**:

```json
{
  "skill": { ... }
}
```

- **Error** (404): Skill not found

### Create Skill

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "skill": {
    "name": "Code Reviewer",
    "description": "Reviews code for quality and security",
    "instructions": "When reviewing code, focus on...",
    "icon": "fas fa-code",
    "category": "development",
    "allowedTools": ["code-search", "file-read"]
  }
}
```

- **Response** (201):

```json
{
  "skill": { ... },
  "skillId": "skill-uuid"
}
```

### Update Skill

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Body**:

```json
{
  "skill": {
    "name": "Updated Name",
    "description": "Updated description",
    "instructions": "Updated instructions..."
  }
}
```

- **Response**:

```json
{
  "skill": { ... }
}
```

### Delete Skill

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Response**:

```json
{
  "message": "Skill deleted"
}
```

- **Error** (404): Skill not found

### Export Skill as Markdown

**GET** `/:id/export`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Skill ID
- **Description**: Export a skill as a `.SKILL.md` file with YAML frontmatter and markdown body
- **Response**: `text/markdown` file download

### Import Skill from Markdown

**POST** `/import`

- **Authentication**: Required
- **Content-Type**: `text/plain`
- **Description**: Import a skill from SKILL.md content (YAML frontmatter + markdown body)
- **Body**: Raw text content of a `.SKILL.md` file

```
---
name: "My Skill"
description: "Skill description"
category: "general"
icon: "fas fa-puzzle-piece"
allowed-tools:
  - code-search
  - file-read
---

Instructions for the skill go here...
```

- **Response** (201):

```json
{
  "skill": { ... },
  "skillId": "skill-uuid"
}
```

---

## SkillForge Routes

Base path: `/api/skillforge`

SkillForge is the skill evolution subsystem within the unified evolution engine. It analyzes goal execution traces via the TraceAnalyzer, extracts patterns and anti-patterns, evolves skills with improved instructions, and tracks performance over time using a Skill Evolution Score (SES). Runs automatically after goal completion when `autoAnalyze` is enabled, or can be triggered manually.

### Get Eligible Goals

**GET** `/eligible-goals`

- **Authentication**: Required
- **Description**: List completed goals that are available for skill forging/analysis
- **Response**:

```json
{
  "success": true,
  "goals": [
    {
      "id": "goal-id",
      "title": "Goal Title",
      "status": "completed",
      "completedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Analyze Goal Trace

**POST** `/analyze/:goalId`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Analyze a goal's execution trace using LLM-as-judge to extract patterns, anti-patterns, and a reusable skill candidate. Provider/model override the user's defaults for the LLM analysis call.
- **Response**:

```json
{
  "success": true,
  "analysis": {
    "patterns": [],
    "antipatterns": [],
    "insights": [],
    "skillCandidate": {}
  }
}
```

### Evolve Skill

**POST** `/evolve/:goalId`

- **Authentication**: Required
- **Parameters**:
  - `goalId` (path): Goal ID
- **Body** (optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

- **Description**: Full analysis and skill evolution — analyzes the goal trace, creates or updates a skill with merged instructions, and records the evolution with SES tracking. Provider/model are forwarded to trace analysis and skill instruction merging.
- **Response**:

```json
{
  "success": true,
  "result": {
    "skillId": "skill-id",
    "previousVersion": 1,
    "newVersion": 2,
    "sesDelta": 0.15,
    "improvements": []
  }
}
```

### Get All Evaluations

**GET** `/evaluations`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): Max results (default: 50)
- **Description**: List all skill evaluations for the authenticated user
- **Response**:

```json
{
  "success": true,
  "evaluations": [
    {
      "id": "eval-id",
      "skillId": "skill-id",
      "score": 85,
      "sesDelta": 0.12,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Evaluations for Skill

**GET** `/evaluations/:skillId`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get all evaluations for a specific skill
- **Response**:

```json
{
  "success": true,
  "evaluations": [
    {
      "id": "eval-id",
      "skillId": "skill-id",
      "score": 85,
      "sesDelta": 0.12,
      "version": 2,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Leaderboard

**GET** `/leaderboard`

- **Authentication**: Required
- **Parameters**:
  - `limit` (query, optional): Max results (default: 20)
- **Description**: Get top skills ranked by average SES delta
- **Response**:

```json
{
  "success": true,
  "leaderboard": [
    {
      "skillId": "skill-id",
      "skillName": "Code Reviewer",
      "avgSesDelta": 0.25,
      "totalEvolutions": 8,
      "currentVersion": 5
    }
  ]
}
```

### Get Skill Version History

**GET** `/skill/:skillId/versions`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get the version history for a skill's evolution
- **Response**:

```json
{
  "success": true,
  "versions": [
    {
      "version": 3,
      "sesDelta": 0.15,
      "changes": "Improved error handling patterns",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Skill Lineage

**GET** `/skill/:skillId/lineage`

- **Authentication**: Required
- **Parameters**:
  - `skillId` (path): Skill ID
- **Description**: Get the full evolutionary lineage of a skill — every ancestor, mutation, and stats
- **Response**:

```json
{
  "success": true,
  "lineage": [
    {
      "version": 1,
      "parentGoalId": "goal-id",
      "sesDelta": 0.0,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "stats": {
    "totalEvolutions": 5,
    "avgSesDelta": 0.18,
    "bestVersion": 4
  }
}
```

### Get Aggregate Stats

**GET** `/stats`

- **Authentication**: Required
- **Description**: Get aggregate SkillForge statistics for the user
- **Response**:

```json
{
  "success": true,
  "stats": {
    "totalSkills": 12,
    "totalEvolutions": 45,
    "totalEvaluations": 120,
    "avgSesDelta": 0.15,
    "topSkill": "Code Reviewer"
  }
}
```

### Get SkillForge Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Get SkillForge configuration settings
- **Response**:

```json
{
  "success": true,
  "settings": {
    "autoAnalyze": false,
    "evaluationThreshold": 0.7,
    "maxVersions": 50
  }
}
```

### Update SkillForge Settings

**POST** `/settings`

- **Authentication**: Required
- **Body**:

```json
{
  "autoAnalyze": true,
  "evaluationThreshold": 0.8,
  "maxVersions": 100
}
```

- **Response**:

```json
{
  "success": true,
  "settings": {
    "autoAnalyze": true,
    "evaluationThreshold": 0.8,
    "maxVersions": 100
  }
}
```

---

## Speech Routes

Base path: `/api/speech`

### Transcribe Audio

**POST** `/transcribe`

- **Authentication**: None
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `audio` (file): Audio file to transcribe (max 10MB)
- **Description**: Transcribe audio file to text using Whisper
- **Response**:

```json
{
  "success": true,
  "transcript": "Transcribed text from audio"
}
```

### Get Speech Service Status

**GET** `/status`

- **Authentication**: None
- **Description**: Get Whisper service status
- **Response**:

```json
{
  "success": true,
  "status": "ready|loading|error",
  "model": "whisper-1",
  "initialized": true
}
```

### Initialize Speech Service

**POST** `/initialize`

- **Authentication**: None
- **Description**: Initialize Whisper service (download model if needed)
- **Response**:

```json
{
  "success": true,
  "message": "Whisper service initialized successfully"
}
```

---

## Stream Routes

Base path: `/api/streams`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the stream service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Start Tool Forge Stream

**POST** `/start-tool-forge-stream`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `prompt` (string): Tool generation prompt
  - `files` (file[]): Optional file attachments
- **Response**: Server-sent events stream

### Cancel Tool Forge Stream

**POST** `/cancel-tool-forge-stream`

- **Authentication**: Required
- **Body**:

```json
{
  "streamId": "stream-id"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Stream cancelled"
}
```

### Start Chat Stream

**POST** `/start-chat-stream`

- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `message` (string): Chat message
  - `files` (file[]): Optional file attachments
- **Response**: Server-sent events stream

### Cancel Chat Stream

**POST** `/cancel-chat-stream`

- **Authentication**: Required
- **Body**:

```json
{
  "streamId": "stream-id"
}
```

- **Response**:

```json
{
  "success": true,
  "message": "Stream cancelled"
}
```

### Generate Tool

**POST** `/generate-tool`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Tool description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "tool": {
    "name": "Generated Tool",
    "description": "Tool description",
    "config": {}
  }
}
```

### Generate Workflow

**POST** `/generate-workflow`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Workflow description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "name": "Generated Workflow",
    "description": "Workflow description",
    "nodes": [],
    "edges": []
  }
}
```

### Generate Agent

**POST** `/generate-agent`

- **Authentication**: Required
- **Body**:

```json
{
  "description": "Agent description",
  "provider": "openai",
  "model": "gpt-4"
}
```

- **Response**:

```json
{
  "success": true,
  "agent": {
    "name": "Generated Agent",
    "description": "Agent description",
    "config": {}
  }
}
```

---

## Tool Schema Routes

Base path: `/api/tool-schemas`

### Get All Tool Schemas

**GET** `/schemas`

- **Authentication**: None
- **Description**: Get all tool schemas organized by category
- **Response**:

```json
{
  "triggers": [
    {
      "type": "trigger-type",
      "title": "Trigger Title",
      "description": "Trigger description",
      "schema": {}
    }
  ],
  "actions": [
    {
      "type": "action-type",
      "title": "Action Title",
      "description": "Action description",
      "schema": {}
    }
  ],
  "utilities": [
    {
      "type": "utility-type",
      "title": "Utility Title",
      "description": "Utility description",
      "schema": {}
    }
  ]
}
```

### Get Tool Schema by Type

**GET** `/schemas/:toolType`

- **Authentication**: None
- **Parameters**:
  - `toolType` (path): Tool type
- **Description**: Get schema for a specific tool
- **Response**:

```json
{
  "type": "tool-type",
  "title": "Tool Title",
  "description": "Tool description",
  "schema": {
    "properties": {},
    "required": []
  }
}
```

### Get Schemas by Category

**GET** `/schemas/category/:category`

- **Authentication**: None
- **Parameters**:
  - `category` (path): Category name (triggers, actions, utilities, etc.)
- **Description**: Get schemas by category
- **Response**:

```json
[
  {
    "type": "tool-type",
    "title": "Tool Title",
    "description": "Tool description",
    "schema": {}
  }
]
```

### Get Registry Statistics

**GET** `/stats`

- **Authentication**: None
- **Description**: Get registry statistics
- **Response**:

```json
{
  "totalTools": 50,
  "categories": {
    "triggers": 10,
    "actions": 25,
    "utilities": 15
  },
  "lastUpdated": "2024-01-01T00:00:00Z"
}
```

### Get Tool Metadata

**GET** `/metadata/:toolType`

- **Authentication**: None
- **Parameters**:
  - `toolType` (path): Tool type
- **Description**: Get metadata for a specific tool (includes source info)
- **Response**:

```json
{
  "type": "tool-type",
  "source": "builtin|plugin|custom",
  "plugin": "plugin-name",
  "version": "1.0.0",
  "author": "Author Name",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Reload Registry

**POST** `/reload`

- **Authentication**: None
- **Description**: Reload the registry (useful for development)
- **Response**:

```json
{
  "success": true,
  "message": "Tool registry reloaded successfully",
  "stats": {
    "totalTools": 50,
    "categories": {
      "triggers": 10,
      "actions": 25,
      "utilities": 15
    }
  }
}
```

---

## Tools Routes

Base path: `/api/tools`

### Get Orchestrator Tools

**GET** `/orchestrator-tools`

- **Authentication**: None
- **Description**: Get all orchestrator tools (native, registry, and plugin tools)
- **Response**:

```json
{
  "tools": [
    {
      "id": "tool-name",
      "name": "Tool Name",
      "title": "Tool Title",
      "description": "Tool description",
      "category": "Data & Knowledge",
      "is_builtin": true,
      "is_plugin": false,
      "plugin_name": null
    }
  ]
}
```

### Get Workflow Tools

**GET** `/workflow-tools`

- **Authentication**: Required
- **Description**: Get all tools for the workflow designer including plugins and custom tools
- **Response**:

```json
{
  "triggers": [
    {
      "type": "trigger-type",
      "title": "Trigger Title",
      "description": "Trigger description",
      "icon": "trigger-icon",
      "isPlugin": false
    }
  ],
  "actions": [
    {
      "type": "action-type",
      "title": "Action Title",
      "description": "Action description",
      "icon": "action-icon",
      "isPlugin": false
    }
  ],
  "utilities": [
    {
      "type": "utility-type",
      "title": "Utility Title",
      "description": "Utility description",
      "icon": "utility-icon",
      "isPlugin": false
    }
  ],
  "widgets": [],
  "controls": [],
  "custom": [
    {
      "id": "custom-tool-id",
      "name": "Custom Tool",
      "description": "Custom tool description"
    }
  ]
}
```

### Get Plugin Tools Only

**GET** `/plugins-only`

- **Authentication**: None
- **Description**: Get only plugin tools (for real-time updates)
- **Response**:

```json
{
  "success": true,
  "plugins": {
    "triggers": [
      {
        "type": "plugin-trigger",
        "title": "Plugin Trigger",
        "description": "Description",
        "icon": "puzzle-piece",
        "isPlugin": true,
        "pluginName": "plugin-name"
      }
    ],
    "actions": [],
    "utilities": [],
    "widgets": [],
    "controls": [],
    "custom": []
  },
  "totalCount": 1
}
```

---

## User Routes

Base path: `/api/users`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the user service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get User Stats

**GET** `/user-stats`

- **Authentication**: Required
- **Description**: Get user statistics
- **Response**:

```json
{
  "agents": 5,
  "workflows": 10,
  "tools": 3,
  "goals": 2,
  "executions": 100,
  "storageUsed": "1.2GB"
}
```

### Get User Settings

**GET** `/settings`

- **Authentication**: Required
- **Description**: Get user settings
- **Response**:

```json
{
  "theme": "dark",
  "language": "en",
  "notifications": {
    "email": true,
    "push": false
  },
  "preferences": {}
}
```

### Update User Settings

**PUT** `/settings`

- **Authentication**: Required
- **Body**:

```json
{
  "theme": "light",
  "language": "es",
  "notifications": {
    "email": false,
    "push": true
  }
}
```

- **Response**:

```json
{
  "success": true,
  "settings": {
    "theme": "light",
    "language": "es",
    "notifications": {
      "email": false,
      "push": true
    }
  }
}
```

### Sync Token

**POST** `/sync-token`

- **Authentication**: Required
- **Description**: Sync user token across services
- **Response**:

```json
{
  "success": true,
  "message": "Token synced successfully"
}
```

### Get Token Status

**GET** `/token-status`

- **Authentication**: None
- **Description**: Get current token status
- **Response**:

```json
{
  "valid": true,
  "expiresIn": 3600,
  "refreshRequired": false
}
```

### Get Connection Health

**GET** `/connection-health`

- **Authentication**: Required
- **Description**: Get health status of all provider connections
- **Response**:

```json
{
  "success": true,
  "data": {
    "overall": "healthy|degraded",
    "healthyConnections": 51,
    "totalConnections": 52,
    "timestamp": "2026-01-01T15:42:40.838Z",
    "providers": [
      {
        "provider": "openai",
        "status": "healthy",
        "lastChecked": "2026-01-01T15:42:39.786Z",
        "details": {}
      },
      {
        "provider": "anthropic",
        "status": "healthy",
        "lastChecked": "2026-01-01T15:42:37.303Z",
        "details": {}
      },
      {
        "provider": "twitter",
        "status": "error",
        "lastChecked": "2026-01-01T15:42:40.643Z",
        "error": "Failed to retrieve access token from remote auth service."
      }
    ]
  }
}
```

**Important**:

- The response wraps data in a `data` object, not at the root level.
- Provider status values are `"healthy"` or `"error"` (not `"connected"`).
- Each provider object has a `provider` field (lowercase provider name), not `name` or `id`.
- Failed providers include an `error` field instead of `details`.

### Get Single Provider Health

**GET** `/connection-health/:providerId`

- **Authentication**: Required
- **Parameters**:
  - `providerId` (path): Provider ID
- **Description**: Get health status of a specific provider
- **Response**:

```json
{
  "id": "openai",
  "name": "OpenAI",
  "status": "connected",
  "lastCheck": "2024-01-01T00:00:00Z",
  "latency": 150,
  "details": {}
}
```

### Get Connection Health Stream

**GET** `/connection-health-stream`

- **Authentication**: Required (via token query parameter)
- **Parameters**:
  - `token` (query): JWT token
- **Description**: Get real-time connection health updates via SSE
- **Response**: Server-sent events stream

---

## Webhook Routes

Base path: `/api/webhooks`

### Get All Webhooks

**GET** `/`

- **Authentication**: Required
- **Description**: Get all webhooks for the authenticated user
- **Response**:

```json
{
  "success": true,
  "webhooks": [
    {
      "id": "webhook-id",
      "workflowId": "workflow-id",
      "url": "https://example.com/webhook",
      "secret": "webhook-secret",
      "events": ["trigger"],
      "active": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Webhook by Workflow ID

**GET** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Get webhook associated with a specific workflow
- **Response**:

```json
{
  "success": true,
  "webhook": {
    "id": "webhook-id",
    "workflowId": "workflow-id",
    "url": "https://example.com/webhook",
    "secret": "webhook-secret",
    "events": ["trigger"],
    "active": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Webhook by Workflow ID

**DELETE** `/workflow/:workflowId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Delete webhook associated with a specific workflow
- **Response**:

```json
{
  "success": true,
  "message": "Webhook deleted successfully"
}
```

---

## Widget Definition Routes

Base path: `/api/widget-definitions`

Manage custom widget definitions for the dashboard. Widgets are user-created HTML/JS components that can be placed on layout pages.

### Get All Widget Definitions

**GET** `/`

- **Authentication**: Required
- **Description**: Get all widget definitions for the user (including shared ones)
- **Response**:

```json
{
  "widgets": [
    {
      "id": "cw_abc123def456",
      "user_id": "user-id",
      "name": "System Monitor",
      "description": "Displays system metrics",
      "icon": "fas fa-chart-line",
      "category": "monitoring",
      "widget_type": "html",
      "source_code": "<div>...</div>",
      "config": {},
      "data_bindings": [],
      "default_size": { "cols": 4, "rows": 3 },
      "min_size": { "cols": 2, "rows": 2 },
      "useThemeStyles": true,
      "is_shared": 0,
      "is_published": 0,
      "version": "1.0.0",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Widget Definition by ID

**GET** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Response**:

```json
{
  "widget": { ... }
}
```

- **Error** (404): Widget definition not found

### Create Widget Definition

**POST** `/`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "My Widget",
  "description": "A custom widget",
  "icon": "fas fa-puzzle-piece",
  "category": "custom",
  "widget_type": "html",
  "source_code": "<div>Hello World</div>",
  "config": {},
  "data_bindings": [],
  "default_size": { "cols": 4, "rows": 3 },
  "min_size": { "cols": 2, "rows": 2 },
  "useThemeStyles": true
}
```

- **Response** (201):

```json
{
  "message": "Widget definition created",
  "id": "cw_abc123def456",
  "widget": { ... }
}
```

### Update Widget Definition

**PUT** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Description**: Partial update — only provided fields are changed
- **Body**:

```json
{
  "name": "Updated Name",
  "source_code": "<div>Updated</div>",
  "is_shared": true,
  "useThemeStyles": false
}
```

- **Response**:

```json
{
  "message": "Widget definition updated",
  "id": "cw_abc123def456"
}
```

### Delete Widget Definition

**DELETE** `/:widgetId`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Response**:

```json
{
  "message": "Widget definition deleted",
  "id": "cw_abc123def456"
}
```

### Duplicate Widget Definition

**POST** `/:widgetId/duplicate`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID to duplicate
- **Description**: Create a copy of an existing widget definition with " (copy)" appended to the name
- **Response** (201):

```json
{
  "message": "Widget duplicated",
  "id": "cw_newid123456"
}
```

### Export Widget Definition

**GET** `/:widgetId/export`

- **Authentication**: Required
- **Parameters**:
  - `widgetId` (path): Widget definition ID
- **Description**: Export a widget definition as a portable JSON object
- **Response**:

```json
{
  "export": {
    "_format": "agnt-widget",
    "_version": "1.0.0",
    "name": "My Widget",
    "description": "A custom widget",
    "icon": "fas fa-puzzle-piece",
    "category": "custom",
    "widget_type": "html",
    "source_code": "<div>Hello World</div>",
    "config": {},
    "data_bindings": [],
    "default_size": { "cols": 4, "rows": 3 },
    "min_size": { "cols": 2, "rows": 2 },
    "exported_at": "2024-01-01T00:00:00Z"
  }
}
```

### Import Widget Definition

**POST** `/import`

- **Authentication**: Required
- **Description**: Import a widget definition from an exported JSON object
- **Body**:

```json
{
  "widget_data": {
    "_format": "agnt-widget",
    "_version": "1.0.0",
    "name": "Imported Widget",
    "source_code": "<div>Imported</div>",
    ...
  }
}
```

- **Response** (201): Same as Create Widget Definition

---

## Workflow Routes

Base path: `/api/workflows`

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the workflow service is running
- **Response**:

```json
{
  "status": "OK"
}
```

### Get All Workflows

**GET** `/`

- **Authentication**: Required
- **Description**: Retrieve all workflows for the authenticated user
- **Response**:

```json
[
  {
    "id": "workflow-id",
    "name": "Workflow Name",
    "description": "Workflow description",
    "status": "active|inactive",
    "nodes": [],
    "edges": [],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Save Workflow

**POST** `/save`

- **Authentication**: Required
- **Body**:

```json
{
  "name": "Workflow Name",
  "description": "Workflow description",
  "nodes": [],
  "edges": [],
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "Workflow Name",
    "description": "Workflow description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Workflow by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Retrieve a specific workflow by ID
- **Response**:

```json
{
  "id": "workflow-id",
  "name": "Workflow Name",
  "description": "Workflow description",
  "status": "active|inactive",
  "nodes": [],
  "edges": [],
  "config": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Update Workflow

**PUT** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Body**:

```json
{
  "name": "Updated Workflow Name",
  "description": "Updated description",
  "nodes": [],
  "edges": [],
  "config": {}
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "Updated Workflow Name",
    "description": "Updated description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Delete Workflow

**DELETE** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Delete a workflow by ID
- **Response**:

```json
{
  "success": true,
  "message": "Workflow deleted successfully"
}
```

### Rename Workflow

**PUT** `/:id/name`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Body**:

```json
{
  "name": "New Workflow Name"
}
```

- **Response**:

```json
{
  "success": true,
  "workflow": {
    "id": "workflow-id",
    "name": "New Workflow Name",
    "description": "Workflow description",
    "status": "inactive",
    "nodes": [],
    "edges": [],
    "config": {},
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Get Workflow Status

**GET** `/:id/status`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Fetch the current state of a workflow
- **Response**:

```json
{
  "workflowId": "workflow-id",
  "status": "active|inactive|error",
  "lastExecution": "2024-01-01T00:00:00Z",
  "executionCount": 10,
  "errorCount": 0,
  "state": {}
}
```

### Start Workflow

**POST** `/:id/start`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Activate a workflow
- **Response**:

```json
{
  "success": true,
  "message": "Workflow activated successfully",
  "workflowId": "workflow-id"
}
```

### Stop Workflow

**POST** `/:id/stop`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Workflow ID
- **Description**: Deactivate a workflow
- **Response**:

```json
{
  "success": true,
  "message": "Workflow deactivated successfully",
  "workflowId": "workflow-id"
}
```

### Get All Workflows Summary

**GET** `/summary`

- **Authentication**: Required
- **Description**: Retrieve a lightweight summary of all workflows for the authenticated user (no full workflow_data)
- **Response**:

```json
[
  {
    "id": "workflow-id",
    "name": "Workflow Name",
    "status": "active",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

### Analyze Dependencies

**POST** `/analyze-dependencies`

- **Authentication**: Required
- **Description**: Analyze node dependencies within a workflow
- **Body**: Workflow data with nodes and edges
- **Response**: Dependency analysis result

### List Workflow Versions

**GET** `/:workflowId/versions`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `limit` (query, optional): Max versions to return (default: 50)
  - `offset` (query, optional): Pagination offset (default: 0)
  - `checkpointsOnly` (query, optional): If `"true"`, only return checkpoint versions
- **Description**: List the version history for a workflow
- **Response**:

```json
{
  "success": true,
  "versions": [
    {
      "version_number": 5,
      "source": "chat",
      "change_description": "Added new API node",
      "is_checkpoint": false,
      "checkpoint_name": null,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Specific Version

**GET** `/:workflowId/versions/:versionId`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `versionId` (path): Version number
- **Description**: Get the full data for a specific workflow version
- **Response**:

```json
{
  "success": true,
  "version": {
    "version_number": 3,
    "workflow_state": { ... },
    "source": "manual",
    "change_description": "Checkpoint before refactor",
    "is_checkpoint": true,
    "checkpoint_name": "Pre-refactor",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

- **Error** (404): Version not found

### Revert to Version

**POST** `/:workflowId/revert`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Revert a workflow to a previous version. Broadcasts `workflow:reverted` via WebSocket.
- **Body**:

```json
{
  "versionId": 3
}
```

- **Response**:

```json
{
  "success": true,
  "revertedToVersion": 3,
  "workflowState": { ... }
}
```

### Create Checkpoint

**POST** `/:workflowId/checkpoint`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Save a named checkpoint of the current workflow state
- **Body**:

```json
{
  "name": "Before big changes",
  "currentWorkflowState": { ... }
}
```

- **Response**:

```json
{
  "success": true,
  "versionNumber": 6,
  "checkpointName": "Before big changes"
}
```

### Compare Versions

**GET** `/:workflowId/versions/compare?versionA=1&versionB=3`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
  - `versionA` (query, required): First version number
  - `versionB` (query, required): Second version number
- **Description**: Get a diff between two workflow versions
- **Response**:

```json
{
  "success": true,
  "diff": {
    "nodesAdded": [],
    "nodesRemoved": [],
    "nodesModified": [],
    "edgesAdded": [],
    "edgesRemoved": []
  }
}
```

### Version Storage Stats

**GET** `/:workflowId/versions/stats`

- **Authentication**: Required
- **Parameters**:
  - `workflowId` (path): Workflow ID
- **Description**: Get storage statistics for a workflow's version history
- **Response**:

```json
{
  "success": true,
  "stats": {
    "totalVersions": 12,
    "checkpoints": 3,
    "totalSizeBytes": 45678,
    "oldestVersion": "2024-01-01T00:00:00Z",
    "newestVersion": "2024-03-01T00:00:00Z"
  }
}
```

---

## Direct Server Routes

These endpoints are defined directly in `server.js`, not in route files.

### Health Check

**GET** `/api/health`

- **Authentication**: None
- **Description**: Global health check endpoint
- **Response**:

```json
{
  "status": "OK"
}
```

### Get App Version

**GET** `/api/version`

- **Authentication**: None
- **Description**: Get the current application version (reads from package.json)
- **Response**:

```json
{
  "version": "0.5.0"
}
```

### Check for Updates

**GET** `/api/updates/check`

- **Authentication**: None
- **Description**: Check for application updates (proxies to agnt.gg)
- **Response**: Proxied response from update server

---

## WebSocket / Socket.IO

AGNT uses Socket.IO for real-time bidirectional communication.

### Connection

```javascript
const socket = io('http://localhost:3333');
socket.emit('authenticate', { userId: 'user-id' });
```

### Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `authenticate` | Client → Server | Authenticate the socket connection |
| `authenticated` | Server → Client | Confirmation of successful authentication |
| `disconnect` | Bidirectional | Client disconnected |
| `workflow:reverted` | Server → Client | Broadcast when a workflow version is reverted |
| `PLUGIN_INSTALLED` | Server → Client | Broadcast when a plugin is installed |

Real-time updates are broadcast via the `global.io` object throughout the backend.

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Authentication required or invalid
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

---

## Rate Limiting

Some endpoints may have rate limiting applied. Check the `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers in responses.

---

## Pagination

List endpoints that return multiple items support pagination via query parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `sort`: Sort field
- `order`: Sort order (asc, desc)

Example: `GET /api/agents?page=2&limit=10&sort=createdAt&order=desc`

---

## File Uploads

Endpoints that accept file uploads use `multipart/form-data` content type and typically have the following limits:

- Maximum file size: 20MB (varies by endpoint)
- Supported formats: Varies by endpoint (images, documents, audio, etc.)

---

## Server-Sent Events (SSE)

Streaming endpoints use Server-Sent Events for real-time updates. Connect using EventSource in JavaScript or any SSE client.

Example:

```javascript
const eventSource = new EventSource('/api/orchestrator/chat', {
  headers: {
    Authorization: 'Bearer your-token',
  },
});

eventSource.onmessage = function (event) {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

---

## WebSocket Support

Some endpoints may support WebSocket connections for real-time bidirectional communication. Check endpoint documentation for WebSocket availability.

---

## Remote API (https://api.agnt.gg/)

## Table of Contents (Remote)

- [Remote Authentication](#remote-authentication)
- [Remote Agent Routes](#remote-agent-routes)
- [Remote Auth Routes](#remote-auth-routes)
- [Remote Content Output Routes](#remote-content-output-routes)
- [Remote Custom Tool Routes](#remote-custom-tool-routes)
- [Remote Email Routes](#remote-email-routes)
- [Remote Execution Routes](#remote-execution-routes)
- [Remote Lifetime Promo Routes](#remote-lifetime-promo-routes)
- [Remote Marketplace Routes](#remote-marketplace-routes)
- [Remote Onboarding Routes](#remote-onboarding-routes)
- [Remote Referral Routes](#remote-referral-routes)
- [Remote Stream Routes](#remote-stream-routes)
- [Remote User Routes](#remote-user-routes)
- [Remote Waitlist Routes](#remote-waitlist-routes)
- [Remote Webhook Routes](#remote-webhook-routes)
- [Remote Workflow Routes](#remote-workflow-routes)

---

## Remote Authentication

Remote endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

---

## Remote Agent Routes

Base path: `https://api.agnt.gg/agents` (Internal: `AgentRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check if the agent service is running

### Get All Agents

**GET** `/`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve all agents for the authenticated user

### Save Agent

**POST** `/save`

- **Authentication**: Required (rate limited)
- **Description**: Create a new agent or update an existing one

### Get Agent by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve a specific agent by ID

### Update Agent

**PUT** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update an existing agent

### Delete Agent

**DELETE** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete an agent by ID

---

## Remote Auth Routes

Base path: `https://api.agnt.gg/auth` (Internal: `AuthRoutes.js`)

### Get All Providers

**GET** `/providers`

- **Authentication**: Required (rate limited)
- **Description**: Get all auth providers

### Create Provider

**POST** `/providers`

- **Authentication**: Required (rate limited)
- **Description**: Create a new auth provider

### Update Provider

**PUT** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update an existing provider

### Delete Provider

**DELETE** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete a provider

### Get Provider by ID

**GET** `/providers/:id`

- **Authentication**: Required (rate limited)
- **Description**: Get details of a specific provider

### Store API Key

**POST** `/apikeys/:providerId`

- **Authentication**: Required (rate limited)
- **Description**: Store an API key for a provider

### Retrieve API Key

**GET** `/apikeys/:providerId`

- **Authentication**: Required (rate limited)
- **Description**: Retrieve an API key for a provider

### Connect Provider (OAuth)

**GET** `/connect/:provider`

- **Authentication**: Required (rate limited)
- **Description**: Initiate OAuth connection for a provider

### Disconnect Provider

**POST** `/disconnect/:provider`

- **Authentication**: Required (rate limited)
- **Description**: Disconnect an OAuth provider

### Handle Callback

**POST** `/callback`

- **Authentication**: Required (rate limited)
- **Description**: Handle OAuth callback

### Local Callback

**GET** `/callback/:provider`

- **Authentication**: None
- **Description**: Handle local OAuth callback

### Zapier Callback

**POST** `/callback/zapier`

- **Authentication**: None
- **Description**: Handle Zapier webhook callback

### Get Connected Apps

**GET** `/connected`

- **Authentication**: Required (rate limited)
- **Description**: Get list of connected applications

### Get Valid Token

**GET** `/valid-token`

- **Authentication**: Required (rate limited)
- **Description**: Check if the current token is valid

### Get Google Search Keys

**GET** `/google-search-keys`

- **Authentication**: Required (rate limited)
- **Description**: Get Google search configuration keys

---

## Remote Content Output Routes

Base path: `https://api.agnt.gg/content-outputs` (Internal: `ContentOutputRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None
- **Description**: Check service health

### Get All Content Outputs

**GET** `/`

- **Authentication**: Required (rate limited)
- **Description**: List all content outputs

### Save Content Output

**POST** `/save`

- **Authentication**: Required (rate limited)
- **Description**: Create or update content output

### Get Content Output by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Get specific content output

### Update Content Output

**PUT** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Update existing content output

### Delete Content Output

**DELETE** `/:id`

- **Authentication**: Required (rate limited)
- **Description**: Delete content output

### Get by Workflow

**GET** `/workflow/:workflowId`

- **Authentication**: Required (rate limited)
- **Description**: Get outputs for a specific workflow

### Get by Tool

**GET** `/tool/:toolId`

- **Authentication**: Required (rate limited)
- **Description**: Get outputs for a specific tool

---

## Remote Custom Tool Routes

Base path: `https://api.agnt.gg/custom-tools` (Internal: `CustomToolRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Get All

**GET** `/`

- **Authentication**: Required (rate limited)

### Save

**POST** `/save`

- **Authentication**: Required (rate limited)

### Get by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)

### Update

**PUT** `/:id`

- **Authentication**: Required (rate limited)

### Delete

**DELETE** `/:id`

- **Authentication**: Required (rate limited)

---

## Remote Email Routes

Base path: `https://api.agnt.gg/email` (Internal: `EmailRoutes.js`)

### Initialize

**POST** `/initialize`

- **Authentication**: Required (rate limited)

### Cleanup

**POST** `/cleanup`

- **Authentication**: Required (rate limited)

### Poll Emails

**GET** `/poll`

- **Authentication**: Required (rate limited)

### Send Email

**POST** `/send`

- **Authentication**: Required (rate limited)

### Send Feedback

**POST** `/send-feedback`

- **Authentication**: Required (rate limited)

### Send Enterprise Inquiry

**POST** `/send-enterprise-inquiry`

- **Authentication**: Required (rate limited)

### Confirm Processed

**POST** `/confirm-processed`

- **Authentication**: Required (rate limited)

---

## Remote Execution Routes

Base path: `https://api.agnt.gg/executions` (Internal: `ExecutionRoutes.js`)

### Get Executions

**GET** `/`

- **Authentication**: Required (rate limited)

### Get Activity Data

**POST** `/activity`

- **Authentication**: Required (rate limited)

### Get Details

**GET** `/:id`

- **Authentication**: Required (rate limited)

---

## Remote Lifetime Promo Routes

Base path: `https://api.agnt.gg/promo/lifetime` (Internal: `LifetimePromoRoutes.js`)

### Get Status

**GET** `/status`

- **Authentication**: None

### Create Checkout

**POST** `/checkout`

- **Authentication**: Required

### Get My Purchase

**GET** `/my-purchase`

- **Authentication**: Required

---

## Remote Marketplace Routes

Base path: `https://api.agnt.gg/marketplace` (Internal: `MarketplaceRoutes.js`)

### Get All Items

**GET** `/items`

- **Authentication**: None

### Get Featured Items

**GET** `/items/featured`

- **Authentication**: None

### Get Item Details

**GET** `/items/:id`

- **Authentication**: None

### Get Item Reviews

**GET** `/items/:id/reviews`

- **Authentication**: None

### Get Item Versions

**GET** `/items/:id/versions`

- **Authentication**: None

### Install Item

**POST** `/items/:id/install`

- **Authentication**: Required (rate limited)

### Purchase Item

**POST** `/items/:id/purchase`

- **Authentication**: Required (rate limited)

### Update Installed Item

**POST** `/items/:id/update`

- **Authentication**: Required (rate limited)

### Publish

**POST** `/publish`

- **Authentication**: Required (rate limited)

### Update Listing

**PUT** `/items/:id`

- **Authentication**: Required (rate limited)

### Unpublish Listing

**PUT** `/items/:id/unpublish`

- **Authentication**: Required (rate limited)

### Republish Listing

**PUT** `/items/:id/republish`

- **Authentication**: Required (rate limited)

### My Purchases

**GET** `/my-purchases`

- **Authentication**: Required (rate limited)

### My Earnings

**GET** `/my-earnings`

- **Authentication**: Required (rate limited)

### Stripe Connect

**POST** `/stripe/connect`

- **Authentication**: Required (rate limited)

---

## Remote Onboarding Routes

Base path: `https://api.agnt.gg/onboarding` (Internal: `OnboardingRoutes.js`)

### Get Progress

**GET** `/progress`

- **Authentication**: Required (rate limited)

### Complete Onboarding

**POST** `/complete`

- **Authentication**: Required (rate limited)

### Analytics

**GET** `/analytics`

- **Authentication**: Required (rate limited)

### Unsubscribe

**GET/POST** `/unsubscribe`

- **Authentication**: None

---

## Remote Referral Routes

Base path: `https://api.agnt.gg/referrals` (Internal: `ReferralRoutes.js`)

### Get Count

**GET** `/count`

- **Authentication**: None

### Create Referral

**POST** `/create`

- **Authentication**: None

### Get Network Score

**GET** `/network-score/:email`

- **Authentication**: None

### Verify Code

**GET** `/verify/:code`

- **Authentication**: None

### Get Leaderboard

**GET** `/leaderboard`

- **Authentication**: None

### Process Referral

**POST** `/referral`

- **Authentication**: None

### Update Pseudonym

**POST** `/update-pseudonym`

- **Authentication**: Required (JWT header)

### Get Commission Summary

**GET** `/commissions/summary`

- **Authentication**: Required (rate limited)

---

## Remote Stream Routes

Base path: `https://api.agnt.gg/streams` (Internal: `StreamRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Start Tool Forge Stream

**POST** `/start-tool-forge-stream`

- **Authentication**: Required (rate limited, supports file upload)

### Start Chat Stream

**POST** `/start-chat-stream`

- **Authentication**: Required (rate limited, supports file upload)

### Generate Tool

**POST** `/generate-tool`

- **Authentication**: Required (rate limited)

---

## Remote User Routes

Base path: `https://api.agnt.gg/users` (Internal: `UserRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Register

**POST** `/register`

- **Authentication**: None

### Login

**POST** `/login`

- **Authentication**: None

### Get Profile

**GET** `/profile`

- **Authentication**: Required (rate limited)

### Update Profile

**PUT** `/profile`

- **Authentication**: Required (rate limited)

### Subscription Status

**GET** `/subscription/status`

- **Authentication**: Required (No rate limit)

### Create Subscription

**POST** `/subscription/create`

- **Authentication**: Required (No rate limit)

---

## Remote Waitlist Routes

Base path: `https://api.agnt.gg/waitlist` (Internal: `WaitlistRoutes.js`)

### Get Count

**GET** `/count`

- **Authentication**: None

### Join Waitlist

**POST** `/join`

- **Authentication**: None

---

## Remote Webhook Routes

Base path: `https://api.agnt.gg/webhooks` (Internal: `WebhookRoutes.js`)

### Register Webhook

**POST** `/register`

- **Authentication**: None (Internal Service Call, rate limited)

### Poll Webhooks

**GET** `/poll`

- **Authentication**: None (Internal Service Call, rate limited)

### Webhook Handler

**ALL** `/:workflowId`

- **Authentication**: None
- **Description**: Catch-all for incoming webhooks

---

## Remote Workflow Routes

Base path: `https://api.agnt.gg/workflows` (Internal: `WorkflowRoutes.js`)

### Health Check

**GET** `/health`

- **Authentication**: None

### Get All Workflows

**GET** `/`

- **Authentication**: Required (rate limited)

### Save Workflow

**POST** `/save`

- **Authentication**: Required (rate limited)

### Get Workflow by ID

**GET** `/:id`

- **Authentication**: Required (rate limited)

### Start Workflow

**POST** `/:id/start`

- **Authentication**: Required (rate limited)

### Stop Workflow

**POST** `/:id/stop`

- **Authentication**: Required (rate limited)

---

_This documentation covers all API endpoints as of v0.5.0. For the most up-to-date information, please refer to the source code in `backend/src/routes/`._
