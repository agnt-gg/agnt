/**
 * pluginContract — what an AGNT plugin is, as text for a model and as pure
 * helpers. Deliberately dependency-free: the system-prompt builder imports
 * it, and must not drag the plugin installer (and its database bootstrap)
 * into every module that builds a prompt.
 */

/**
 * The plugin contract, stated once.
 *
 * Two readers need it: the one-shot generator (PluginGenerator.js), and the Plugin Forge chat
 * (orchestrator/system-prompts/plugin-forge-chat.js), which edits plugins file
 * by file. Kept here so the rules a generated plugin is written to and the
 * rules an edited one is checked against cannot drift apart.
 */
export const PLUGIN_MANIFEST_CONTRACT = `PLUGIN STRUCTURE REQUIREMENTS:
- name: kebab-case identifier (e.g., "notion-plugin", "weather-api-plugin")
- version: semantic version (always start with "1.0.0")
- description: clear, concise description of the plugin's functionality
- author: "AGNT User" (default)
- icon: appropriate icon name (e.g., "cloud", "database", "api", "code", "magic")
- tools: array of tool definitions with complete schemas

TOOL SCHEMA REQUIREMENTS:
Each tool in the tools array must have:
- type: unique kebab-case identifier (e.g., "notion-create-page")
- entryPoint: JavaScript filename (e.g., "./notion-api.js")
- schema: complete schema object with:
  - title: Human-readable name
  - category: One of "trigger", "action", "utility", "widget", "control", "custom"
  - type: Same as the tool type above
  - icon: Icon name for the tool
  - description: What the tool does
  - authRequired: "apiKey" or "oauth" if the tool needs a sign-in (set it together with authProvider)
  - authProvider: the sign-in id the tool uses (see SIGN-INS)
  - parameters: Object defining input parameters
  - outputs: Object defining output fields

SIGN-INS (the plugin must work for EVERYONE who installs it, not only its author):
Every authProvider a tool names must be ONE of these, or the marketplace refuses the plugin:
1. A shared AGNT sign-in. The live list: GET https://api.agnt.gg/auth/providers with NO
   Authorization header (it answers with exactly the shared ones). If the service is there
   ("google", "github", "slack", "notion", "stripe"...), use that id and declare nothing.
2. Otherwise, declare the sign-in in manifest.json so it ships inside the plugin:
   "auth": [{
     "id": "pipedrive", "name": "Pipedrive", "icon": "pipedrive",
     "type": "apikey", "keyLabel": "API token",
     "instructions": "Pipedrive -> Settings -> Personal preferences -> API",
     "helpUrl": "https://..."
   }]
   or, for OAuth (authorization code + PKCE; each user signs in themselves):
   { "id": "ga4", "name": "Google Analytics", "type": "oauth2",
     "authorizationUrl": "https://...", "tokenUrl": "https://...",
     "scopes": ["..."], "clientId": "<a PUBLIC client id, or omit it and the user supplies one>" }
   The id is lowercase [a-z0-9_-] and must NOT be a shared sign-in's id.
Never: put a key, token, password or client secret anywhere in the plugin (manifest or code);
ask for a key as a tool parameter; or create a sign-in on the AGNT server for a plugin
(a server sign-in is private to its creator, so nobody else could connect it).
In the Plugin Forge, install_plugin reports each sign-in as plugin, shared or unresolved.
Unresolved means only its author could connect it: fix it before calling the plugin done.

PARAMETER DEFINITION:
Each parameter should have:
- type: "string", "number", "boolean", "object", "array"
- inputType: "text", "textarea", "number", "select", "checkbox", "password", "codearea", "time", "readonly"
- description: What the parameter is for
- required: true/false (optional)
- options: Array of strings for "select" inputType
- default: Default value (optional)
- conditional: { field: "paramName", value: "value" } for conditional display (optional)

OUTPUT DEFINITION:
Each output should have:
- type: "string", "number", "boolean", "object", "array"
- description: What the output contains`;

export const PLUGIN_TOOL_CONTRACT = `TOOL CLASS STRUCTURE:
- Export a default class instance with an execute() method
- The execute method signature: async execute(params, inputData, workflowEngine)
- Return an object matching the schema outputs
- Use try/catch for comprehensive error handling
- Import dependencies at the top of the file using ES modules (import/export)

AVAILABLE CONTEXT IN execute():
- params: The resolved parameters from the workflow node
- inputData: Output from the previous node in the workflow
- workflowEngine.userId: Current user's ID
- workflowEngine.workflowId: Current workflow's ID

FOR TOOLS WITH A SIGN-IN (authRequired + authProvider in the schema):
AGNT resolves the connected key or OAuth token and hands it to the tool as
params.__auth.token, in chat, workflows and triggers alike. Read it there; import
nothing from AGNT. When it is missing, say which sign-in to connect:
\`\`\`javascript
const token = params.__auth?.token;
if (!token) {
  return { success: false, code: 'CONNECTION_REQUIRED', error: 'Connect Pipedrive in Settings -> Connections, then run this again.' };
}
const response = await fetch('https://api.pipedrive.com/v1/deals?api_token=' + encodeURIComponent(token));
\`\`\`

EXAMPLE TOOL STRUCTURE:
\`\`\`javascript
class MyTool {
  constructor() {
    this.name = 'my-tool-type';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[MyPlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Your implementation here
      const result = await this.doSomething(params);

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[MyPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async doSomething(params) {
    // Implementation
  }
}

export default new MyTool();
\`\`\``;

/**
 * Bump a semver version string by the given type
 */
export function bumpVersion(version, type) {
  const parts = (version || '1.0.0').split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return version;

  switch (type) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
    default:
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

/**
 * Compare old and new manifests to determine the appropriate version bump type
 * - Tools removed → major (breaking change)
 * - Tools added or tool schemas changed → minor (new feature / changed behavior)
 * - Everything else (descriptions, code-only) → patch
 */
export function determineVersionBump(oldManifest, newManifest) {
  const oldTools = oldManifest.tools || [];
  const newTools = newManifest.tools || [];

  const oldTypes = new Set(oldTools.map((t) => t.type));
  const newTypes = new Set(newTools.map((t) => t.type));

  // Tools removed → major
  const removed = [...oldTypes].filter((t) => !newTypes.has(t));
  if (removed.length > 0) return 'major';

  // Tools added → minor
  const added = [...newTypes].filter((t) => !oldTypes.has(t));
  if (added.length > 0) return 'minor';

  // Check if tool schemas changed (parameters or outputs)
  for (const newTool of newTools) {
    const oldTool = oldTools.find((t) => t.type === newTool.type);
    if (!oldTool) continue;

    const oldParams = JSON.stringify(oldTool.schema?.parameters || {});
    const newParams = JSON.stringify(newTool.schema?.parameters || {});
    const oldOutputs = JSON.stringify(oldTool.schema?.outputs || {});
    const newOutputs = JSON.stringify(newTool.schema?.outputs || {});

    if (oldParams !== newParams || oldOutputs !== newOutputs) return 'minor';
  }

  // Default: patch
  return 'patch';
}
