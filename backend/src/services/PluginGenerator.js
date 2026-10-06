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
import { PLUGIN_MANIFEST_CONTRACT, PLUGIN_TOOL_CONTRACT } from './pluginContract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to plugin development documentation (bundled with app - read-only is fine)
const PLUGIN_DEV_DOCS_PATH = path.join(__dirname, '../../plugins/docs/PLUGIN-DEVELOPMENT.md');

// Path to example plugins for context - use user data directory for ASAR compatibility
// This allows the AI to learn from user-installed plugins
const getExamplePluginsPath = () => PluginInstaller.pluginsDir;

/**
 * System prompts for different generation stages
 */
const SYSTEM_PROMPTS = {
  manifest: `You are an expert AGNT plugin developer. Your task is to generate a manifest.json for a plugin based on the user's description.

${PLUGIN_MANIFEST_CONTRACT}

IMPORTANT:
- Generate realistic, functional tool schemas
- Include appropriate error outputs (success, error fields)
- Use conditional parameters when actions have different requirements
- If the plugin needs external API access, include authRequired/authProvider

OUTPUT ONLY VALID JSON - NO MARKDOWN CODE BLOCKS, NO EXPLANATION, JUST THE JSON OBJECT.`,

  code: `You are an expert AGNT plugin developer. Your task is to generate the JavaScript implementation for a tool.

${PLUGIN_TOOL_CONTRACT}

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
