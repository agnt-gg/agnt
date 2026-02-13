/**
 * PluginGenerator - AI-powered plugin generation service
 *
 * Uses the global AI provider to generate complete AGNT plugins from natural language descriptions.
 * Generates manifest.json, tool implementation code, and package.json.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLlmClient } from './ai/LlmService.js';
import { createLlmAdapter } from './orchestrator/llmAdapters.js';
import PluginInstaller from '../plugins/PluginInstaller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to plugin development documentation (bundled with app - read-only is fine)
const PLUGIN_DEV_DOCS_PATH = path.join(__dirname, '../../plugins/PLUGIN-DEVELOPMENT.md');

// Path to example plugins for context - use user data directory for ASAR compatibility
// This allows the AI to learn from user-installed plugins
const getExamplePluginsPath = () => PluginInstaller.pluginsDir;

/**
 * System prompts for different generation stages
 */
const SYSTEM_PROMPTS = {
  manifest: `You are an expert AGNT plugin developer. Your task is to generate a manifest.json for a plugin based on the user's description.

PLUGIN STRUCTURE REQUIREMENTS:
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
- description: What the output contains

IMPORTANT:
- Generate realistic, functional tool schemas
- Include appropriate error outputs (success, error fields)
- Use conditional parameters when actions have different requirements
- If the plugin needs external API access, include authRequired/authProvider

OUTPUT ONLY VALID JSON - NO MARKDOWN CODE BLOCKS, NO EXPLANATION, JUST THE JSON OBJECT.`,

  code: `You are an expert AGNT plugin developer. Your task is to generate the JavaScript implementation for a tool.

TOOL CLASS STRUCTURE:
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
\`\`\`

IMPORTANT:
- Use ES modules (import/export), not CommonJS (require)
- Always include error handling
- Log important operations with a [PluginName] prefix
- Return objects matching the schema outputs exactly
- For HTTP requests, use fetch() or import axios

OUTPUT ONLY VALID JAVASCRIPT CODE - NO MARKDOWN CODE BLOCKS, NO EXPLANATION, JUST THE CODE.`,

  packageJson: `You are an expert Node.js developer. Your task is to generate a package.json for an AGNT plugin.

Based on the tool code provided, identify any npm dependencies that need to be installed.

COMMON DEPENDENCIES TO LOOK FOR:
- axios: HTTP client for API requests
- node-fetch: Fetch API for Node.js (if using fetch in older Node)
- discord.js: Discord bot library
- @notionhq/client: Notion API client
- stripe: Stripe payment processing
- @slack/web-api: Slack API client
- googleapis: Google APIs
- twitter-api-v2: Twitter API client
- openai: OpenAI API client

PACKAGE.JSON STRUCTURE:
{
  "name": "plugin-name",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "package-name": "^version"
  }
}

IMPORTANT:
- Only include dependencies that are actually imported in the code
- Use "type": "module" for ES modules support
- Use latest stable versions with ^ prefix
- If no external dependencies are needed, return an object with empty dependencies: {}

OUTPUT ONLY VALID JSON - NO MARKDOWN CODE BLOCKS, NO EXPLANATION, JUST THE JSON OBJECT.`,
};

/**
 * Bump a semver version string by the given type
 */
function bumpVersion(version, type) {
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
function determineVersionBump(oldManifest, newManifest) {
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

class PluginGenerator {
  constructor(userId) {
    this.userId = userId;
    this.pluginDevDocs = null;
    this.examplePluginCode = null;
  }

  /**
   * Load plugin development documentation for context
   */
  async loadContext() {
    try {
      this.pluginDevDocs = await fs.readFile(PLUGIN_DEV_DOCS_PATH, 'utf-8');
    } catch (error) {
      console.warn('[PluginGenerator] Could not load plugin dev docs:', error.message);
      this.pluginDevDocs = '';
    }

    // Load an example plugin for code context (from user-installed plugins)
    try {
      const discordApiPath = path.join(getExamplePluginsPath(), 'discord-plugin', 'discord-api.js');
      this.examplePluginCode = await fs.readFile(discordApiPath, 'utf-8');
    } catch (error) {
      console.warn('[PluginGenerator] Could not load example plugin:', error.message);
      this.examplePluginCode = '';
    }
  }

  /**
   * Generate a complete plugin from natural language description
   */
  async generatePlugin(description, provider, model, options = {}) {
    console.log(`[PluginGenerator] Generating plugin for user ${this.userId}`);
    console.log(`[PluginGenerator] Provider: ${provider}, Model: ${model}`);
    console.log(`[PluginGenerator] Description: ${description.substring(0, 100)}...`);

    await this.loadContext();

    // Step 1: Generate manifest.json
    const manifest = await this.generateManifest(description, provider, model);

    // Step 2: Generate tool implementation code for each tool
    const toolCode = {};
    for (const tool of manifest.tools) {
      const fileName = tool.entryPoint.replace('./', '');
      toolCode[fileName] = await this.generateToolCode(tool, manifest, provider, model);
    }

    // Step 3: Generate package.json
    const packageJson = await this.generatePackageJson(manifest, toolCode, provider, model);

    return { manifest, toolCode, packageJson };
  }

  /**
   * Generate manifest.json from description
   */
  async generateManifest(description, provider, model) {
    console.log('[PluginGenerator] Generating manifest...');

    const client = await createLlmClient(provider, this.userId);

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.manifest,
      },
      {
        role: 'user',
        content: `Generate a manifest.json for the following plugin:

${description}

Remember: Output ONLY valid JSON, no markdown, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const manifestJson = this.extractJSON(response);

    console.log('[PluginGenerator] Manifest generated:', manifestJson.name);
    return manifestJson;
  }

  /**
   * Generate tool implementation code
   */
  async generateToolCode(tool, manifest, provider, model) {
    console.log(`[PluginGenerator] Generating code for tool: ${tool.type}`);

    const client = await createLlmClient(provider, this.userId);

    let contextInfo = '';
    if (this.examplePluginCode) {
      contextInfo = `\n\nHere's an example of a working AGNT plugin tool for reference:\n\n${this.examplePluginCode}`;
    }

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.code + contextInfo,
      },
      {
        role: 'user',
        content: `Generate the JavaScript implementation for this tool:

PLUGIN NAME: ${manifest.name}
TOOL TYPE: ${tool.type}
TOOL SCHEMA:
${JSON.stringify(tool.schema, null, 2)}

The tool should:
1. Implement all the actions/functionality described in the schema
2. Handle all parameters defined in the schema
3. Return outputs matching the schema outputs
4. Include proper error handling

Remember: Output ONLY valid JavaScript code, no markdown code blocks, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const code = this.extractCode(response);

    console.log(`[PluginGenerator] Code generated for: ${tool.type}`);
    return code;
  }

  /**
   * Generate package.json based on code dependencies
   */
  async generatePackageJson(manifest, toolCode, provider, model) {
    console.log('[PluginGenerator] Generating package.json...');

    const client = await createLlmClient(provider, this.userId);

    // Combine all tool code for analysis
    const allCode = Object.values(toolCode).join('\n\n---\n\n');

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.packageJson,
      },
      {
        role: 'user',
        content: `Analyze the following plugin code and generate a package.json with the required dependencies:

PLUGIN NAME: ${manifest.name}
PLUGIN VERSION: ${manifest.version}

TOOL CODE:
${allCode}

Remember: Output ONLY valid JSON, no markdown, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const packageJson = this.extractJSON(response);

    // Ensure required fields
    packageJson.name = manifest.name;
    packageJson.version = manifest.version;
    packageJson.type = 'module';

    console.log('[PluginGenerator] Package.json generated');
    return packageJson;
  }

  /**
   * Regenerate an entire plugin from instructions + current state
   * Returns { manifest, toolCode, packageJson } same shape as generatePlugin
   */
  async regeneratePlugin(instructions, currentManifest, currentCode, currentPackageJson, provider, model) {
    console.log(`[PluginGenerator] Regenerating plugin for user ${this.userId}`);
    console.log(`[PluginGenerator] Provider: ${provider}, Model: ${model}`);
    console.log(`[PluginGenerator] Instructions: ${instructions.substring(0, 100)}...`);

    await this.loadContext();

    // Step 1: Regenerate manifest
    const manifest = await this.regenerateManifest(instructions, currentManifest, provider, model);

    // Step 2: Regenerate tool code for each tool in the new manifest
    const toolCode = {};
    for (const tool of manifest.tools) {
      const fileName = tool.entryPoint.replace('./', '');
      const existingCode = currentCode[fileName] || '';
      toolCode[fileName] = await this.regenerateToolCode(tool, manifest, instructions, existingCode, provider, model);
    }

    // Step 3: Regenerate package.json
    const packageJson = await this.regeneratePackageJson(manifest, toolCode, instructions, currentPackageJson, provider, model);

    return { manifest, toolCode, packageJson };
  }

  /**
   * Regenerate manifest.json from current manifest + instructions
   */
  async regenerateManifest(instructions, currentManifest, provider, model, conversationHistory = []) {
    console.log('[PluginGenerator] Regenerating manifest...');

    const client = await createLlmClient(provider, this.userId);

    // Build conversation context from previous regeneration instructions
    const historyContext = conversationHistory.length > 0
      ? `\n\nPrevious modification requests (for context of what has already been changed):\n${conversationHistory.map((h) => `- ${h}`).join('\n')}\n`
      : '';

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.manifest,
      },
      {
        role: 'user',
        content: `Here is the current manifest.json for this plugin:

${JSON.stringify(currentManifest, null, 2)}
${historyContext}
CRITICAL: Return this manifest EXACTLY as-is, with ONLY the minimal changes needed to fulfill these instructions:
${instructions}

Do NOT rename the plugin. Do NOT rewrite descriptions. Do NOT change tool types, parameters, or outputs unless the instructions EXPLICITLY ask for it. Copy everything else verbatim. Only touch what the instructions specifically ask to change.

Output ONLY valid JSON, no markdown, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const manifestJson = this.extractJSON(response);

    console.log('[PluginGenerator] Manifest regenerated:', manifestJson.name);
    return manifestJson;
  }

  /**
   * Regenerate tool code from current code + instructions
   */
  async regenerateToolCode(tool, manifest, instructions, existingCode, provider, model, conversationHistory = []) {
    console.log(`[PluginGenerator] Regenerating code for tool: ${tool.type}`);

    const client = await createLlmClient(provider, this.userId);

    let contextInfo = '';
    if (this.examplePluginCode) {
      contextInfo = `\n\nHere's an example of a working AGNT plugin tool for reference:\n\n${this.examplePluginCode}`;
    }

    // Build conversation context from previous regeneration instructions
    const historyContext = conversationHistory.length > 0
      ? `\n\nPrevious modification requests (for context of what has already been changed):\n${conversationHistory.map((h) => `- ${h}`).join('\n')}\n`
      : '';

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.code + contextInfo,
      },
      {
        role: 'user',
        content: `Here is the CURRENT code for tool "${tool.type}" that you MUST preserve:

${existingCode || '(No existing code - generate from scratch)'}

PLUGIN NAME: ${manifest.name}
TOOL TYPE: ${tool.type}
TOOL SCHEMA:
${JSON.stringify(tool.schema, null, 2)}
${historyContext}
CRITICAL: Return the code above EXACTLY as-is, with ONLY the minimal changes needed to fulfill these instructions:
${instructions}

Do NOT refactor, reformat, rename variables, rewrite logic, or "improve" anything. Keep ALL existing code, structure, comments, and style identical. Only add/modify the specific lines the instructions ask for. If the instructions don't mention a particular function or section, leave it COMPLETELY untouched.

Output ONLY valid JavaScript code, no markdown code blocks, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const code = this.extractCode(response);

    console.log(`[PluginGenerator] Code regenerated for: ${tool.type}`);
    return code;
  }

  /**
   * Regenerate package.json from new code + instructions
   */
  async regeneratePackageJson(manifest, toolCode, instructions, currentPackageJson, provider, model) {
    console.log('[PluginGenerator] Regenerating package.json...');

    const client = await createLlmClient(provider, this.userId);

    const allCode = Object.values(toolCode).join('\n\n---\n\n');

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.packageJson,
      },
      {
        role: 'user',
        content: `Here is the current package.json:

${JSON.stringify(currentPackageJson, null, 2)}

And here is the updated tool code:

${allCode}

CRITICAL: Return this package.json EXACTLY as-is. Only add new dependencies if the updated code imports new packages, or remove dependencies if their imports were removed. Do NOT change versions of existing dependencies. Do NOT add, remove, or modify anything else.

Output ONLY valid JSON, no markdown, no explanation.`,
      },
    ];

    const response = await this.callLLM(client, model, messages, provider);
    const packageJson = this.extractJSON(response);

    packageJson.name = manifest.name;
    packageJson.version = manifest.version;
    packageJson.type = 'module';

    console.log('[PluginGenerator] Package.json regenerated');
    return packageJson;
  }

  /**
   * Regenerate a specific file with instructions
   */
  async regenerateFile(fileName, instructions, currentManifest, currentCode, provider, model) {
    console.log(`[PluginGenerator] Regenerating file: ${fileName}`);

    const client = await createLlmClient(provider, this.userId);

    if (fileName === 'manifest.json') {
      const messages = [
        {
          role: 'system',
          content: SYSTEM_PROMPTS.manifest,
        },
        {
          role: 'user',
          content: `Here is the current manifest.json:

${JSON.stringify(currentManifest, null, 2)}

Please modify it according to these instructions:
${instructions}

Remember: Output ONLY valid JSON, no markdown, no explanation.`,
        },
      ];

      const response = await this.callLLM(client, model, messages, provider);
      return this.extractJSON(response);
    } else if (fileName === 'package.json') {
      const allCode = Object.values(currentCode).join('\n\n---\n\n');

      const messages = [
        {
          role: 'system',
          content: SYSTEM_PROMPTS.packageJson,
        },
        {
          role: 'user',
          content: `Here is the current code:

${allCode}

Please generate/update the package.json according to these instructions:
${instructions}

Remember: Output ONLY valid JSON, no markdown, no explanation.`,
        },
      ];

      const response = await this.callLLM(client, model, messages, provider);
      const packageJson = this.extractJSON(response);
      packageJson.name = currentManifest.name;
      packageJson.version = currentManifest.version;
      packageJson.type = 'module';
      return packageJson;
    } else {
      // It's a code file
      const currentFileCode = currentCode[fileName] || '';
      const tool = currentManifest.tools.find((t) => t.entryPoint === `./${fileName}`);

      const messages = [
        {
          role: 'system',
          content: SYSTEM_PROMPTS.code,
        },
        {
          role: 'user',
          content: `Here is the current code for ${fileName}:

${currentFileCode}

Tool schema:
${tool ? JSON.stringify(tool.schema, null, 2) : 'Not found'}

Please modify the code according to these instructions:
${instructions}

Remember: Output ONLY valid JavaScript code, no markdown code blocks, no explanation.`,
        },
      ];

      const response = await this.callLLM(client, model, messages, provider);
      return this.extractCode(response);
    }
  }

  /**
   * Call the LLM with the given messages
   */
  async callLLM(client, model, messages, provider) {
    // Defensive check: ensure a client instance is available
    if (!client) {
      throw new Error(`LLM client not initialized for provider "${provider}"`);
    }

    try {
      // Use the unified adapter system
      const adapter = await createLlmAdapter(provider, client, model);

      // The adapter expects tools, but we don't need tools for generation here
      const result = await adapter.call(messages, []);

      // Extract content
      if (result.responseMessage && result.responseMessage.content) {
        if (typeof result.responseMessage.content === 'string') {
          return result.responseMessage.content;
        } else if (Array.isArray(result.responseMessage.content)) {
          // Handle Anthropic/multi-modal content blocks
          return result.responseMessage.content.map((block) => block.text || '').join('');
        }
      }

      return '';
    } catch (error) {
      console.error('[PluginGenerator] LLM call failed:', error);
      throw new Error(`LLM call failed: ${error.message}`);
    }
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks)
   */
  extractJSON(response) {
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }

    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }

    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('[PluginGenerator] Failed to parse JSON:', jsonStr.substring(0, 200));
      throw new Error(`Invalid JSON response from LLM: ${error.message}`);
    }
  }

  /**
   * Extract code from LLM response (handles markdown code blocks)
   */
  extractCode(response) {
    let code = response.trim();

    // Remove markdown code blocks if present
    if (code.startsWith('```javascript') || code.startsWith('```js')) {
      code = code.replace(/^```(?:javascript|js)\n?/, '');
    } else if (code.startsWith('```')) {
      code = code.slice(3);
    }

    if (code.endsWith('```')) {
      code = code.slice(0, -3);
    }

    return code.trim();
  }
}

export default PluginGenerator;
export { bumpVersion, determineVersionBump };
