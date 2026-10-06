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
  - authRequired: "apiKey" or "oauth" if authentication needed (optional)
  - authProvider: Provider name for auth (optional, e.g., "notion", "openai")
  - parameters: Object defining input parameters
  - outputs: Object defining output fields

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

FOR AUTHENTICATED TOOLS:
To get API keys, use:
\`\`\`javascript
const AuthManagerModule = await import('../../../src/services/auth/AuthManager.js');
const AuthManager = AuthManagerModule.default;
const apiKey = await AuthManager.getApiKey(workflowEngine.userId, 'provider-name');
// or for OAuth:
const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'provider-name');
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
