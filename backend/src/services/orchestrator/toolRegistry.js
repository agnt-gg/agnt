import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import PluginManager from '../../plugins/PluginManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.pluginTools = new Map(); // Separate map for plugin tools
    this._isInitialized = false;
    this._initializationPromise = null;
  }

  async _initialize() {
    if (this._isInitialized) return;

    console.log('[Orchestrator ToolRegistry] Initializing...');
    const toolLibraryPath = path.join(__dirname, '../../tools/toolLibrary.json');
    try {
      const rawToolLibrary = await fs.readFile(toolLibraryPath, 'utf-8');
      const toolLibraryData = JSON.parse(rawToolLibrary);

      const toolCategoriesToLoad = ['actions', 'utilities', 'custom'];

      for (const category of toolCategoriesToLoad) {
        if (toolLibraryData[category] && Array.isArray(toolLibraryData[category])) {
          for (const toolDef of toolLibraryData[category]) {
            await this._loadAndRegisterTool(toolDef);
          }
        }
      }

      // Load plugin tools
      await this._loadPluginTools();

      this._isInitialized = true;
      console.log(`[Orchestrator ToolRegistry] Initialized with ${this.tools.size} library tools and ${this.pluginTools.size} plugin tools.`);
    } catch (error) {
      console.error('[Orchestrator ToolRegistry] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Load tools from installed plugins via PluginManager
   */
  async _loadPluginTools() {
    try {
      // Ensure PluginManager is initialized
      if (!PluginManager.initialized) {
        await PluginManager.initialize();
      }

      const pluginSchemas = PluginManager.getAllPluginSchemas();
      console.log(`[Orchestrator ToolRegistry] Loading ${pluginSchemas.length} plugin tools...`);

      for (const schema of pluginSchemas) {
        const toolType = schema.type;
        const pluginName = schema._plugin;

        // Convert plugin schema to OpenAPI format for orchestrator
        const openApiSchema = this._pluginSchemaToOpenApi(schema);

        // Create a wrapper that will lazy-load the tool implementation when needed
        const preparedTool = {
          type: toolType,
          description: schema.description,
          // Lazy-load implementation - will be loaded on first execute
          implementation: {
            execute: async (params, inputData, workflowEngine) => {
              // Load the actual tool module from the plugin
              const toolModule = await PluginManager.loadTool(toolType);
              if (toolModule && toolModule.default && typeof toolModule.default.execute === 'function') {
                return await toolModule.default.execute(params, inputData, workflowEngine);
              } else if (toolModule && typeof toolModule.execute === 'function') {
                return await toolModule.execute(params, inputData, workflowEngine);
              } else {
                throw new Error(`Plugin tool ${toolType} does not have an execute function`);
              }
            },
          },
          openApiSchema,
          authConfig: {
            authRequired: schema.authRequired || false,
            authProvider: schema.authProvider || null,
          },
          isPlugin: true,
          pluginName: pluginName,
        };

        this.pluginTools.set(toolType, preparedTool);
        console.log(`[Orchestrator ToolRegistry] ✓ Registered plugin tool: ${toolType} from ${pluginName}`);
      }
    } catch (error) {
      console.error('[Orchestrator ToolRegistry] Failed to load plugin tools:', error);
      // Don't throw - plugin loading failure shouldn't break the orchestrator
    }
  }

  /**
   * Convert plugin schema format to OpenAPI function calling format
   */
  _pluginSchemaToOpenApi(schema) {
    const properties = {};
    const required = [];

    if (schema.parameters) {
      for (const [paramName, paramDef] of Object.entries(schema.parameters)) {
        properties[paramName] = {
          type: paramDef.type || 'string',
          description: paramDef.description || '',
        };

        if (paramDef.default !== undefined) {
          properties[paramName].default = paramDef.default;
        }

        if (paramDef.options && Array.isArray(paramDef.options)) {
          properties[paramName].enum = paramDef.options;
        }

        if (paramDef.items) {
          properties[paramName].items = paramDef.items;
        }

        // Add to required if no default and not explicitly optional
        if (paramDef.default === undefined && paramDef.required !== false) {
          required.push(paramName);
        }
      }
    }

    return {
      type: 'function',
      function: {
        name: schema.type.replace(/-/g, '_'), // Convert to underscore format for LLM
        description: schema.description || `Plugin tool: ${schema.type}`,
        parameters: {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        },
      },
    };
  }

  /**
   * Reload plugin tools (called when plugins are installed/uninstalled)
   */
  async reloadPluginTools() {
    await this.ensureInitialized();
    console.log('[Orchestrator ToolRegistry] Reloading plugin tools...');
    this.pluginTools.clear();
    await this._loadPluginTools();
    console.log(`[Orchestrator ToolRegistry] Reloaded ${this.pluginTools.size} plugin tools.`);
    return {
      success: true,
      pluginToolCount: this.pluginTools.size,
    };
  }

  async _loadAndRegisterTool(toolDef) {
    const toolType = toolDef.type;
    if (!toolType) {
      return;
    }

    // Define categories to search (matching NodeExecutor and WorkflowEngine pattern)
    const categories = ['actions', 'triggers', 'controls', 'utilities', 'widgets', 'custom', 'mcp'];

    let implementation = null;
    let loadedFrom = null;
    let lastError = null;

    // Try each category subdirectory
    for (const category of categories) {
      try {
        const toolModulePath = path.join(__dirname, `../../tools/library/${category}/${toolType}.js`);
        await fs.access(toolModulePath);

        const toolModuleUrl = pathToFileURL(toolModulePath);
        const toolModule = (await import(toolModuleUrl.href)).default;

        if (toolModule && typeof toolModule.execute === 'function') {
          implementation = toolModule;
          loadedFrom = category;
          console.log(`✓ Loaded ${toolType} from ${category}/`);
          break;
        }
      } catch (error) {
        lastError = error;
        // Continue to next category
        continue;
      }
    }

    // If not found in any category, return silently (tool may not be migrated yet)
    if (!implementation) {
      if (lastError && lastError.code !== 'ENOENT') {
        console.warn(`Could not load tool '${toolType}':`, lastError.message);
      }
      return;
    }

    const openApiSchema = this._createOpenApiSchema(toolDef);

    const preparedTool = {
      type: toolType,
      description: toolDef.description,
      implementation,
      openApiSchema,
      authConfig: {
        authRequired: toolDef.authRequired,
        authProvider: toolDef.authProvider,
      },
    };

    this.tools.set(toolType, preparedTool);
  }

  _createOpenApiSchema(toolDef) {
    const properties = {};
    const required = [];
    const VALID_JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

    if (toolDef.parameters) {
      for (const [paramName, paramDef] of Object.entries(toolDef.parameters)) {
        let type = paramDef.type || 'string';
        if (!VALID_JSON_SCHEMA_TYPES.has(type)) {
          console.warn(
            `[ToolRegistry] Invalid schema type '${type}' for parameter '${paramName}' in tool '${toolDef.type}'. Defaulting to 'string'.`
          );
          type = 'string';
        }

        properties[paramName] = {
          type: type,
          description: paramDef.description || '',
        };

        if (type === 'array') {
          // OpenAI requires array properties to have an 'items' schema.
          // We'll default to string if not specified in toolLibrary.json
          properties[paramName].items = paramDef.items || { type: 'string' };
        }

        if (paramDef.default !== undefined) {
          properties[paramName].default = paramDef.default;
        }
        if (paramDef.options && Array.isArray(paramDef.options)) {
          properties[paramName].enum = paramDef.options;
        }

        // CRITICAL FIX: Only add to required if:
        // 1. No default value
        // 2. NOT conditional (conditional params are optional by definition)
        // 3. NOT explicitly marked as optional
        if (paramDef.default === undefined && !paramDef.conditional && paramDef.required !== false) {
          required.push(paramName);
        }
      }
    }

    return {
      type: 'function',
      function: {
        name: toolDef.type.replace(/-/g, '_'),
        description: toolDef.description,
        parameters: {
          type: 'object',
          properties,
          required,
          // Add strict validation to prevent extra properties
          additionalProperties: false,
        },
      },
    };
  }

  async ensureInitialized() {
    if (this._isInitialized) return;
    if (!this._initializationPromise) {
      this._initializationPromise = this._initialize();
    }
    return this._initializationPromise;
  }

  /**
   * Get a tool by type (checks both library tools and plugin tools)
   */
  getTool(toolType) {
    // First check library tools
    if (this.tools.has(toolType)) {
      return this.tools.get(toolType);
    }
    // Then check plugin tools
    if (this.pluginTools.has(toolType)) {
      return this.pluginTools.get(toolType);
    }
    // Also check with underscore conversion (LLM uses underscores)
    const dashType = toolType.replace(/_/g, '-');
    if (this.pluginTools.has(dashType)) {
      return this.pluginTools.get(dashType);
    }
    return null;
  }

  /**
   * Get a plugin tool specifically
   */
  getPluginTool(toolType) {
    if (this.pluginTools.has(toolType)) {
      return this.pluginTools.get(toolType);
    }
    // Also check with underscore conversion
    const dashType = toolType.replace(/_/g, '-');
    if (this.pluginTools.has(dashType)) {
      return this.pluginTools.get(dashType);
    }
    return null;
  }

  /**
   * Get all library tools (not including plugins)
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Get all plugin tools
   */
  getAllPluginTools() {
    return Array.from(this.pluginTools.values());
  }

  /**
   * Get all tools (library + plugins)
   */
  getAllToolsIncludingPlugins() {
    return [...Array.from(this.tools.values()), ...Array.from(this.pluginTools.values())];
  }

  /**
   * Get OpenAPI schemas for library tools only
   */
  getOpenApiSchemas() {
    return Array.from(this.tools.values()).map((tool) => tool.openApiSchema);
  }

  /**
   * Get OpenAPI schemas for plugin tools only
   */
  getPluginOpenApiSchemas() {
    return Array.from(this.pluginTools.values()).map((tool) => tool.openApiSchema);
  }

  /**
   * Get all OpenAPI schemas (library + plugins)
   */
  getAllOpenApiSchemas() {
    const librarySchemas = Array.from(this.tools.values()).map((tool) => tool.openApiSchema);
    const pluginSchemas = Array.from(this.pluginTools.values()).map((tool) => tool.openApiSchema);
    return [...librarySchemas, ...pluginSchemas];
  }
}

const toolRegistry = new ToolRegistry();
export default toolRegistry;
