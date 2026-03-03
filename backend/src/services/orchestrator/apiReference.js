/**
 * AGNT API Reference for Widget Forge
 *
 * Pre-parsed, compact API reference that the widget forge LLM can query
 * to build widgets that interact with the AGNT backend.
 */

const BOILERPLATE = `// ── AGNT API Helper ──
// Drop this into your widget <script> to call any AGNT endpoint.
const API = 'http://localhost:${process.env.PORT || 3333}/api';
function getToken() { try { return localStorage.getItem('token') || null; } catch(e) { return null; } }
function headers() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json', 'Accept': 'application/json' }; }

// Usage examples:
// const res = await fetch(API + '/agents/', { headers: headers() });
// const data = await res.json();
//
// const res = await fetch(API + '/workflows/save', {
//   method: 'POST', headers: headers(),
//   body: JSON.stringify({ name: 'My Workflow', nodes: [], edges: [] })
// });`;

const SECTIONS = {
  agents: {
    title: 'Agents',
    basePath: '/api/agents',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /                        List all agents → { agents: [...] }',
      'POST   /save                    Create or update agent',
      'GET    /:id                     Get agent by ID',
      'PUT    /:id                     Update agent',
      'DELETE /:id                     Delete agent',
      'POST   /:id/chat               Chat with agent (JSON response)',
      'POST   /:id/chat-stream         Chat with agent (SSE stream)',
      'POST   /:id/suggestions         Get agent suggestions',
    ],
    detail: `Base path: /api/agents — Auth: Bearer token required (except /health)

GET /
  Response: { agents: [{ id, name, description, status, icon, class, category, assignedTools, capabilities, tasksCompleted, uptime, creditLimit, creditsUsed, workflows, lastActive, successRate, provider, model }] }
  Note: Response wraps agents in an "agents" array property, not a direct array.

POST /save
  Body: { id?, name, description, config }
  Response: { success, agent: { id, name, description, config, createdAt, updatedAt } }

GET /:id
  Response: { id, name, description, config, createdAt, updatedAt }

PUT /:id
  Body: { name?, description?, config? }
  Response: { success, agent }

DELETE /:id
  Response: { success, message }

POST /:id/chat
  Body: { message, context? }
  Response: { response, metadata }

POST /:id/chat-stream
  Body: { message, context? }
  Response: Server-sent events stream

POST /:id/suggestions
  Body: { context }
  Response: { suggestions: [string] }`,
  },

  executions: {
    title: 'Executions',
    basePath: '/api/executions',
    overview: [
      'GET    /                        List all executions',
      'POST   /activity                Get agent activity data',
      'GET    /:id                     Get execution details',
    ],
    detail: `Base path: /api/executions — Auth: Bearer token required

GET /
  Response: [{ id, type: "agent|workflow|tool", status: "running|completed|failed", startTime, endTime, metadata }]

POST /activity
  Body: { agentId, timeRange: { start, end } }
  Response: { activities: [{ timestamp, type, details }], summary: { totalChats, totalExecutions } }

GET /:id
  Response: { id, type, status, startTime, endTime, input, output, logs: [{ timestamp, level, message }], metadata }`,
  },

  workflows: {
    title: 'Workflows',
    basePath: '/api/workflows',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /                        List all workflows',
      'POST   /save                    Create/save workflow',
      'GET    /:id                     Get workflow by ID',
      'PUT    /:id                     Update workflow',
      'DELETE /:id                     Delete workflow',
      'PUT    /:id/name               Rename workflow',
      'GET    /:id/status             Get workflow status',
      'POST   /:id/start              Activate workflow',
      'POST   /:id/stop               Deactivate workflow',
    ],
    detail: `Base path: /api/workflows — Auth: Bearer token required (except /health)

GET /
  Response: [{ id, name, description, status: "active|inactive", nodes, edges, createdAt, updatedAt }]

POST /save
  Body: { name, description, nodes, edges, config }
  Response: { success, workflow }

GET /:id
  Response: { id, name, description, status, nodes, edges, config, createdAt, updatedAt }

PUT /:id
  Body: { name?, description?, nodes?, edges?, config? }
  Response: { success, workflow }

DELETE /:id
  Response: { success, message }

PUT /:id/name
  Body: { name }
  Response: { success, workflow }

GET /:id/status
  Response: { workflowId, status: "active|inactive|error", lastExecution, executionCount, errorCount, state }

POST /:id/start
  Response: { success, message, workflowId }

POST /:id/stop
  Response: { success, message, workflowId }`,
  },

  goals: {
    title: 'Goals',
    basePath: '/api/goals',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /                        List all goals',
      'POST   /create                  Create a goal',
      'POST   /:goalId/execute        Execute a goal',
      'GET    /:id                     Get goal by ID',
      'GET    /:id/status             Get goal status',
      'POST   /:id/pause              Pause goal',
      'POST   /:id/resume             Resume goal',
      'DELETE /:id                     Delete goal',
      'POST   /:id/evaluate           Evaluate goal',
      'GET    /:id/evaluation         Get evaluation report',
      'POST   /:id/golden-standard    Save as golden standard',
      'GET    /golden-standards/list   List golden standards',
    ],
    detail: `Base path: /api/goals — Auth: Bearer token required (except /health)

GET /
  Response: [{ id, title, description, status: "active|paused|completed|failed", priority: "low|medium|high", createdAt, updatedAt }]

POST /create
  Body: { title, description, priority, config }
  Response: { success, goal }

POST /:goalId/execute
  Body: { executionConfig? }
  Response: { success, executionId, message }

GET /:id
  Response: { id, title, description, status, priority, config, createdAt, updatedAt }

GET /:id/status
  Response: { goalId, status, progress (0-100), lastExecution, nextExecution }

POST /:id/pause | POST /:id/resume
  Response: { success, message }

DELETE /:id
  Response: { success, message }

POST /:id/evaluate
  Body: { evaluationCriteria? }
  Response: { success, evaluation: { score, metrics, recommendations } }

GET /:id/evaluation
  Response: { goalId, evaluations: [{ timestamp, score, metrics, recommendations }] }

POST /:id/golden-standard
  Body: { name, description }
  Response: { success, goldenStandard: { id, name, description, sourceGoalId, createdAt } }

GET /golden-standards/list
  Response: { goldenStandards: [...] }`,
  },

  tools: {
    title: 'Tools',
    basePath: '/api/tools',
    overview: [
      'GET    /orchestrator-tools      All orchestrator tools (no auth)',
      'GET    /workflow-tools          All workflow designer tools',
      'GET    /plugins-only            Plugin tools only (no auth)',
    ],
    detail: `Base path: /api/tools — Auth: varies by endpoint

GET /orchestrator-tools (no auth)
  Response: { tools: [{ id, name, title, description, category, is_builtin, is_plugin, plugin_name }] }

GET /workflow-tools (auth required)
  Response: { triggers: [...], actions: [...], utilities: [...], widgets: [], controls: [], custom: [{ id, name, description }] }

GET /plugins-only (no auth)
  Response: { success, plugins: { triggers, actions, utilities, widgets, controls, custom }, totalCount }`,
  },

  'custom-tools': {
    title: 'Custom Tools',
    basePath: '/api/custom-tools',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /                        List all custom tools',
      'POST   /save                    Create/update custom tool',
      'GET    /:id                     Get custom tool by ID',
      'PUT    /:id                     Update custom tool',
      'DELETE /:id                     Delete custom tool',
    ],
    detail: `Base path: /api/custom-tools — Auth: Bearer token required (except /health)

GET /
  Response: [{ id, name, description, config, userId, createdAt, updatedAt }]

POST /save
  Body: { id?, name, description, config }
  Response: { success, tool }

GET /:id
  Response: { id, name, description, config, userId, createdAt, updatedAt }

PUT /:id
  Body: { name?, description?, config? }
  Response: { success, tool }

DELETE /:id
  Response: { success, message }`,
  },

  'content-outputs': {
    title: 'Content Outputs',
    basePath: '/api/content-outputs',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /                        List all content outputs',
      'POST   /save                    Create/update content output',
      'GET    /:id                     Get content output by ID',
      'PUT    /:id                     Update content output',
      'PATCH  /:id/rename             Rename content output',
      'DELETE /:id                     Delete content output',
      'GET    /workflow/:workflowId   Get outputs by workflow',
      'GET    /tool/:toolId           Get outputs by tool',
    ],
    detail: `Base path: /api/content-outputs — Auth: Bearer token required (except /health)

GET /
  Response: [{ id, title, content, workflowId, toolId, createdAt, updatedAt }]

POST /save
  Body: { id?, title, content, workflowId?, toolId? }
  Response: { success, output }

GET /:id
  Response: { id, title, content, workflowId, toolId, createdAt, updatedAt }

PUT /:id
  Body: { title?, content? }
  Response: { success, output }

PATCH /:id/rename
  Body: { title }
  Response: { success, output }

DELETE /:id
  Response: { success, message }

GET /workflow/:workflowId
  Response: [{ id, title, content, workflowId, toolId, createdAt, updatedAt }]

GET /tool/:toolId
  Response: [{ id, title, content, workflowId, toolId, createdAt, updatedAt }]`,
  },

  user: {
    title: 'User',
    basePath: '/api/users',
    overview: [
      'GET    /health                  Health check (no auth)',
      'GET    /user-stats              Get user statistics',
      'GET    /settings                Get user settings',
      'PUT    /settings                Update user settings',
      'POST   /sync-token              Sync auth token',
      'GET    /token-status            Get token validity (no auth)',
      'GET    /connection-health       All provider health statuses',
      'GET    /connection-health/:id   Single provider health',
      'GET    /connection-health-stream SSE health stream',
    ],
    detail: `Base path: /api/users — Auth: Bearer token required (except /health, /token-status)

GET /user-stats
  Response: { agents, workflows, tools, goals, executions, storageUsed }

GET /settings
  Response: { theme, language, notifications: { email, push }, preferences }

PUT /settings
  Body: { theme?, language?, notifications?, preferences? }
  Response: { success, settings }

GET /token-status (no auth)
  Response: { valid, expiresIn, refreshRequired }

GET /connection-health
  Response: { success, data: { overall: "healthy|degraded", healthyConnections, totalConnections, timestamp, providers: [{ provider, status: "healthy|error", lastChecked, details?, error? }] } }
  Note: Data is wrapped in a "data" object. Provider status is "healthy" or "error".

GET /connection-health/:providerId
  Response: { id, name, status: "connected", lastCheck, latency, details }

GET /connection-health-stream
  Query: token=<jwt-token>
  Response: Server-sent events stream with real-time health updates`,
  },

  models: {
    title: 'Models',
    basePath: '/api/models',
    overview: [
      'GET    /:provider/models         Get models by provider',
      'POST   /:provider/models/refresh Refresh models cache',
      'GET    /models                    Get OpenRouter models (legacy)',
      'POST   /models/refresh           Refresh OpenRouter cache (legacy)',
      'GET    /models/categories        Get model categories (no auth)',
    ],
    detail: `Base path: /api/models — Auth: Bearer token required (except /models/categories)

GET /:provider/models
  Providers: openrouter, anthropic, openai, gemini, grokai, groq, togetherai, cerebras, deepseek
  Query: category? (filter), useCache? (default true), format? ("names"|"full", default "names")
  Response: { success, models: [{ id, name, description, context_length, pricing: { prompt, completion } }], cached, count }

POST /:provider/models/refresh
  Response: { success, models, count, message }

GET /models/categories (no auth)
  Response: { success, categories: [{ id, name, description }] }
  Categories: all, programming, creative, reasoning`,
  },

  plugins: {
    title: 'Plugins',
    basePath: '/api/plugins',
    overview: [
      'GET    /installed               List installed plugins',
      'GET    /installed/:name         Plugin details',
      'GET    /installed/:name/source  Plugin source code',
      'GET    /installed/:name/package Plugin .agnt file (base64)',
      'GET    /marketplace             Marketplace plugins',
      'POST   /install                 Install from marketplace',
      'POST   /install-file            Install from file upload',
      'DELETE /:name                   Uninstall plugin',
      'GET    /tools                   All plugin tools',
      'POST   /generate                AI generate plugin (SSE)',
      'POST   /regenerate-file         Regenerate a plugin file',
      'POST   /build-generated         Build generated plugin',
      'POST   /reload                  Reload all plugins',
    ],
    detail: `Base path: /api/plugins — Auth: varies (many endpoints have no auth)

GET /installed (no auth)
  Response: { success, plugins: [{ name, version, description, status: "active|inactive|error", tools }], stats: { total, active, inactive } }

GET /installed/:name (no auth)
  Response: { success, plugin: { name, version, description, isValid, tools: [{ type, title, description, category }] } }

GET /installed/:name/source (auth required)
  Response: { success, files: { "manifest.json": "...", "package.json": "...", "index.js": "..." } }

GET /marketplace (no auth)
  Response: { plugins: [{ name, version, description, author, downloads, rating }] }

POST /install (no auth)
  Body: { name, version? }
  Response: { success, message, plugin: { name, version } }

POST /install-file (no auth)
  Body: { name, fileData (base64), fileName }
  Response: { success, message, plugin }

DELETE /:name (no auth)
  Response: { success, message }

GET /tools (no auth)
  Response: { success, tools: [{ type, title, description, category, icon, plugin }], count }

POST /reload (no auth)
  Response: { success, message, stats, orchestratorReload, workflowProcessReload }`,
  },

  webhooks: {
    title: 'Webhooks',
    basePath: '/api/webhooks',
    overview: [
      'GET    /                        List all webhooks',
      'GET    /workflow/:workflowId   Get webhook by workflow',
      'DELETE /workflow/:workflowId   Delete webhook by workflow',
    ],
    detail: `Base path: /api/webhooks — Auth: Bearer token required

GET /
  Response: { success, webhooks: [{ id, workflowId, url, secret, events, active, createdAt }] }

GET /workflow/:workflowId
  Response: { success, webhook: { id, workflowId, url, secret, events, active, createdAt } }

DELETE /workflow/:workflowId
  Response: { success, message }`,
  },

  'custom-providers': {
    title: 'Custom Providers',
    basePath: '/api/custom-providers',
    overview: [
      'GET    /                        List custom providers',
      'POST   /                        Create custom provider',
      'GET    /:id                     Get provider by ID',
      'PUT    /:id                     Update provider',
      'DELETE /:id                     Delete provider',
      'POST   /test                    Test provider connection',
      'GET    /:id/models             Get provider models',
    ],
    detail: `Base path: /api/custom-providers — Auth: Bearer token required

GET /
  Response: { success, providers: [{ id, provider_name, base_url, api_key (encrypted), userId, createdAt, updatedAt }], count }

POST /
  Body: { provider_name, base_url, api_key }
  Response: { success, provider, message }

GET /:id
  Response: { success, provider }

PUT /:id
  Body: { provider_name?, base_url?, api_key? }
  Response: { success, provider, message }

DELETE /:id
  Response: { success, message }

POST /test
  Body: { base_url, api_key }
  Response: { success, message, latency, models }

GET /:id/models
  Response: { success, models: [{ id, name, description, context_length, pricing }], count }`,
  },

  'widget-definitions': {
    title: 'Widget Definitions',
    basePath: '/api/widget-definitions',
    overview: [
      'GET    /                        List all widgets',
      'GET    /:widgetId              Get widget by ID',
      'POST   /                        Create widget',
      'PUT    /:widgetId              Update widget',
      'DELETE /:widgetId              Delete widget',
      'POST   /:widgetId/duplicate    Duplicate widget',
      'GET    /:widgetId/export       Export widget',
      'POST   /import                  Import widget',
    ],
    detail: `Base path: /api/widget-definitions — Auth: Bearer token required

GET /
  Response: Array of widget definition objects

GET /:widgetId
  Response: Widget definition object: { id, name, description, icon, category, widget_type, source_code, config, default_size, min_size, created_by, created_at, updated_at }

POST /
  Body: { name, description, icon, category, widget_type, source_code, config, default_size, min_size }
  Response: { success, widget }

PUT /:widgetId
  Body: { name?, description?, icon?, category?, widget_type?, source_code?, config?, default_size?, min_size? }
  Response: { success, widget }

DELETE /:widgetId
  Response: { success, message }

POST /:widgetId/duplicate
  Response: { success, widget (new copy) }

GET /:widgetId/export
  Response: Downloadable widget export data

POST /import
  Response: { success, widget (imported) }`,
  },

  mcp: {
    title: 'MCP Servers',
    basePath: '/api/mcp',
    overview: [
      'GET    /servers                  List MCP servers',
      'POST   /servers                  Add MCP server',
      'PUT    /servers/:name           Update MCP server',
      'DELETE /servers/:name           Delete MCP server',
      'GET    /servers/:name/capabilities  Server capabilities',
      'POST   /servers/:name/test      Test server connection',
    ],
    detail: `Base path: /api/mcp — Auth: Bearer token required

GET /servers
  Response: { success, servers: [{ name, description, url, status: "active|inactive", config }] }

POST /servers
  Body: { name, description, url, config }
  Response: { success, server }

PUT /servers/:name
  Body: { description?, url?, config? }
  Response: { success, server }

DELETE /servers/:name
  Response: { success, message }

GET /servers/:name/capabilities
  Response: { success, capabilities: { tools, resources, prompts } }

POST /servers/:name/test
  Response: { success, message, latency, capabilities }`,
  },

  'tool-schemas': {
    title: 'Tool Schemas',
    basePath: '/api/tool-schemas',
    overview: [
      'GET    /schemas                  All tool schemas by category (no auth)',
      'GET    /schemas/:toolType       Schema for specific tool (no auth)',
      'GET    /schemas/category/:cat   Schemas by category (no auth)',
      'GET    /stats                    Registry statistics (no auth)',
      'GET    /metadata/:toolType      Tool metadata (no auth)',
      'POST   /reload                  Reload registry (no auth)',
    ],
    detail: `Base path: /api/tool-schemas — Auth: None (all endpoints public)

GET /schemas
  Response: { triggers: [{ type, title, description, schema }], actions: [...], utilities: [...] }

GET /schemas/:toolType
  Response: { type, title, description, schema: { properties, required } }

GET /schemas/category/:category
  Categories: triggers, actions, utilities
  Response: [{ type, title, description, schema }]

GET /stats
  Response: { totalTools, categories: { triggers, actions, utilities }, lastUpdated }

GET /metadata/:toolType
  Response: { type, source: "builtin|plugin|custom", plugin, version, author, createdAt }

POST /reload
  Response: { success, message, stats }`,
  },

  speech: {
    title: 'Speech',
    basePath: '/api/speech',
    overview: [
      'POST   /transcribe              Transcribe audio (no auth)',
      'GET    /status                   Whisper service status (no auth)',
      'POST   /initialize              Initialize Whisper (no auth)',
    ],
    detail: `Base path: /api/speech — Auth: None

POST /transcribe
  Content-Type: multipart/form-data
  Body: audio file (max 10MB)
  Response: { success, transcript }

GET /status
  Response: { success, status: "ready|loading|error", model, initialized }

POST /initialize
  Response: { success, message }`,
  },

  streams: {
    title: 'Streams',
    basePath: '/api/streams',
    overview: [
      'GET    /health                  Health check (no auth)',
      'POST   /start-tool-forge-stream Tool forge generation (SSE)',
      'POST   /cancel-tool-forge-stream Cancel tool forge stream',
      'POST   /start-chat-stream       Start chat stream (SSE)',
      'POST   /cancel-chat-stream      Cancel chat stream',
      'POST   /generate-tool           Generate a tool',
      'POST   /generate-workflow       Generate a workflow',
      'POST   /generate-agent          Generate an agent',
    ],
    detail: `Base path: /api/streams — Auth: Bearer token required (except /health)

POST /start-tool-forge-stream
  Content-Type: multipart/form-data
  Body: prompt (string), files? (file[])
  Response: Server-sent events stream

POST /cancel-tool-forge-stream
  Body: { streamId }
  Response: { success, message }

POST /start-chat-stream
  Content-Type: multipart/form-data
  Body: message (string), files? (file[])
  Response: Server-sent events stream

POST /cancel-chat-stream
  Body: { streamId }
  Response: { success, message }

POST /generate-tool
  Body: { description, provider, model }
  Response: { success, tool: { name, description, config } }

POST /generate-workflow
  Body: { description, provider, model }
  Response: { success, workflow: { name, description, nodes, edges } }

POST /generate-agent
  Body: { description, provider, model }
  Response: { success, agent: { name, description, config } }`,
  },

  npm: {
    title: 'NPM (MCP Server Search)',
    basePath: '/api/npm',
    overview: [
      'GET    /search                   Search MCP servers on NPM',
      'GET    /popular                  Popular MCP servers',
      'GET    /package/:packageName    Package details',
      'POST   /test                     Test package compatibility',
    ],
    detail: `Base path: /api/npm — Auth: Bearer token required

GET /search
  Query: q (search query), limit? (max results)
  Response: { success, packages: [{ name, version, description, author, keywords, downloads }] }

GET /popular
  Response: { success, packages: [{ name, version, description, downloads, rating }] }

GET /package/:packageName
  Response: { success, package: { name, version, description, author, license, repository, dependencies, downloads: { lastWeek, lastMonth, total }, readme } }

POST /test
  Body: { packageName, version }
  Response: { success, testResults: { compatible, issues, recommendations } }`,
  },
};

// Valid section names for the tool enum
const SECTION_NAMES = Object.keys(SECTIONS);

/**
 * Build a compact overview of all API sections
 */
function getOverview() {
  let out = `AGNT API Reference — Overview
Base URL: http://localhost:${process.env.PORT || 3333}/api
Auth: Bearer token — get from localStorage.getItem('token')

${BOILERPLATE}

────────────────────────────────────────────
`;

  for (const [key, section] of Object.entries(SECTIONS)) {
    out += `\n── ${section.title} (${section.basePath}) ──\n`;
    for (const line of section.overview) {
      out += `  ${line}\n`;
    }
  }

  out += `\n────────────────────────────────────────────
Call get_agnt_api with a section name for full endpoint details.
Available sections: ${SECTION_NAMES.join(', ')}`;

  return out;
}

/**
 * Get detailed reference for a specific API section
 */
function getSectionDetail(section) {
  const data = SECTIONS[section];
  if (!data) {
    return `Unknown section: "${section}". Available sections: ${SECTION_NAMES.join(', ')}`;
  }

  return `── ${data.title} API ── (${data.basePath})

${data.detail}

────────────────────────────────────────────
API Helper (drop into your widget <script>):

${BOILERPLATE}`;
}

export { getOverview, getSectionDetail, SECTION_NAMES };
