# AGNT API Documentation

This document provides comprehensive documentation for all API endpoints in the AGNT backend system.

## Local API (http://localhost:3333/api/)

## Table of Contents (Local)

- [Authentication](#authentication)
- [Agent Routes](#agent-routes)
- [Content Output Routes](#content-output-routes)
- [Custom Provider Routes](#custom-provider-routes)
- [Custom Tool Routes](#custom-tool-routes)
- [Execution Routes](#execution-routes)
- [Goal Routes](#goal-routes)
- [MCP Routes](#mcp-routes)
- [Model Routes](#model-routes)
- [NPM Routes](#npm-routes)
- [Orchestrator Routes](#orchestrator-routes)
- [Plugin Routes](#plugin-routes)
- [Speech Routes](#speech-routes)
- [Stream Routes](#stream-routes)
- [Tool Schema Routes](#tool-schema-routes)
- [Tools Routes](#tools-routes)
- [User Routes](#user-routes)
- [Webhook Routes](#webhook-routes)
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
- **Description**: Retrieve all goals for the authenticated user
- **Response**:

```json
[
  {
    "id": "goal-id",
    "title": "Goal Title",
    "description": "Goal description",
    "status": "active|paused|completed|failed",
    "priority": "low|medium|high",
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
- **Body**:

```json
{
  "executionConfig": {}
}
```

- **Response**:

```json
{
  "success": true,
  "executionId": "execution-id",
  "message": "Goal execution started"
}
```

### Get Goal by ID

**GET** `/:id`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Description**: Retrieve a specific goal by ID
- **Response**:

```json
{
  "id": "goal-id",
  "title": "Goal Title",
  "description": "Goal description",
  "status": "active|paused|completed|failed",
  "priority": "low|medium|high",
  "config": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
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
- **Description**: Resume a paused goal
- **Response**:

```json
{
  "success": true,
  "message": "Goal resumed successfully"
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

### Evaluate Goal

**POST** `/:id/evaluate`

- **Authentication**: Required
- **Parameters**:
  - `id` (path): Goal ID
- **Body**:

```json
{
  "evaluationCriteria": {}
}
```

- **Response**:

```json
{
  "success": true,
  "evaluation": {
    "score": 85,
    "metrics": {},
    "recommendations": []
  }
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

- **Authentication**: Required (except for hardcoded providers)
- **Parameters**:
  - `provider` (path): Provider name (openrouter, anthropic, openai, gemini, grokai, groq, togetherai, cerebras, deepseek)
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

_This documentation covers all API endpoints as of the current version. For the most up-to-date information, please refer to the source code or contact the development team._
