import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ToolConfig from '../tools/ToolConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PluginManager - Manages plugin discovery, loading, and tool registration
 *
 * ASAR-COMPATIBLE ARCHITECTURE:
 * Plugins are stored in the user data directory (outside app bundle)
 * This allows ASAR packaging for the main app while keeping plugins writable.
 *
 * Plugin Storage Location:
 * - Windows: %APPDATA%/AGNT/plugins/installed/
 * - macOS: ~/Library/Application Support/AGNT/plugins/installed/
 * - GNU/Linux: ~/.config/AGNT/plugins/installed/
 *
 * Each plugin has:
 *   - manifest.json: Contains tool schemas and metadata
 *   - package.json: NPM dependencies (auto-installed on first run)
 *   - Tool implementation files (e.g., discord-api.js)
 */

/**
 * Convert kebab-case name to Title Case display name
 * e.g., "discord-plugin" -> "Discord Plugin"
 */
function toDisplayName(name) {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get default user data path based on platform
 * This is a fallback when USER_DATA_PATH is not set
 */
function getDefaultUserDataPath() {
  const platform = process.platform;
  const appName = 'AGNT';

  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', appName);
  } else if (platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', appName);
  } else {
    return path.join(process.env.HOME || '', '.config', appName);
  }
}

class PluginManager {
  static instance = null;

  constructor() {
    this.plugins = new Map(); // pluginName -> plugin metadata
    this.toolToPlugin = new Map(); // toolType -> pluginName
    this.loadedTools = new Map(); // toolType -> loaded module
    this.initialized = false;

    // Use USER_DATA_PATH from environment (set by Electron main.js)
    // This ensures plugins are loaded from outside the ASAR archive
    const userDataPath = process.env.USER_DATA_PATH || getDefaultUserDataPath();
    this.pluginsDir = path.join(userDataPath, 'plugins', 'installed');
  }

  static getInstance() {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  /**
   * Initialize the plugin manager - scan and register all plugins
   */
  async initialize(validatedPluginNames) {
    if (this.initialized) {
      return;
    }

    console.log('[PluginManager] Initializing...');
    console.log(`[PluginManager] Plugins directory: ${this.pluginsDir}`);

    try {
      // Ensure plugins directory exists
      await this.ensurePluginsDirectory();

      // If we have pre-validated plugin names from PluginInstaller, load only those
      // This avoids a redundant directory scan + manifest read for each plugin
      if (validatedPluginNames && validatedPluginNames.length > 0) {
        console.log(`[PluginManager] Loading ${validatedPluginNames.length} pre-validated plugins`);
        await Promise.all(validatedPluginNames.map((name) => this.loadPlugin(name)));
      } else {
        // Fallback: scan directory if no pre-validated list provided
        await this.scanPlugins();
      }

      this.initialized = true;
      console.log(`[PluginManager] Initialized with ${this.plugins.size} plugins, ${this.toolToPlugin.size} tools`);
    } catch (error) {
      console.error('[PluginManager] Initialization error:', error);
      // Don't throw - allow app to continue without plugins
    }
  }

  /**
   * Ensure the plugins directory structure exists
   */
  async ensurePluginsDirectory() {
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });

      // Create registry.json if it doesn't exist
      const registryPath = path.join(this.pluginsDir, '..', 'registry.json');
      try {
        await fs.access(registryPath);
      } catch {
        await fs.writeFile(registryPath, JSON.stringify({ plugins: [] }, null, 2));
        console.log('[PluginManager] Created registry.json');
      }
    } catch (error) {
      console.error('[PluginManager] Error creating plugins directory:', error);
    }
  }

  /**
   * Scan the plugins directory for installed plugins
   */
  async scanPlugins() {
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter((e) => e.isDirectory());

      // Load all plugins in parallel for faster startup
      await Promise.all(pluginDirs.map((entry) => this.loadPlugin(entry.name)));
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[PluginManager] No plugins directory found, skipping plugin scan');
      } else {
        console.error('[PluginManager] Error scanning plugins:', error);
      }
    }
  }

  /**
   * Load a single plugin from its directory
   */
  async loadPlugin(pluginName) {
    const pluginPath = path.join(this.pluginsDir, pluginName);
    const manifestPath = path.join(pluginPath, 'manifest.json');

    try {
      // Check if manifest exists
      await fs.access(manifestPath);

      // Read and parse manifest
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Validate manifest
      if (!manifest.name || !manifest.tools || !Array.isArray(manifest.tools)) {
        console.warn(`[PluginManager] Invalid manifest for plugin ${pluginName}`);
        return;
      }

      // Validate that all tool entry points exist
      for (const tool of manifest.tools) {
        if (tool.entryPoint) {
          const toolPath = path.join(pluginPath, tool.entryPoint);
          try {
            await fs.access(toolPath);
          } catch {
            console.warn(`[PluginManager] ${pluginName}: Missing tool file ${tool.entryPoint} for tool ${tool.type}`);
            return;
          }
        }
      }

      // Check if dependencies are installed
      const packageJsonPath = path.join(pluginPath, 'package.json');
      const nodeModulesPath = path.join(pluginPath, 'node_modules');
      let dependenciesInstalled = true;

      try {
        // Read package.json to check for dependencies
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);

        const hasDependencies = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;

        if (hasDependencies) {
          try {
            await fs.access(nodeModulesPath);
          } catch {
            dependenciesInstalled = false;
            console.warn(`[PluginManager] Plugin ${pluginName} missing node_modules - run PluginInstaller first`);
          }
        }
      } catch (error) {
        // No package.json means no dependencies to install - assume ready
        dependenciesInstalled = true;
        console.log(`[PluginManager] No package.json for ${pluginName}, assuming no dependencies`);
      }

      // Register the plugin
      this.plugins.set(pluginName, {
        name: manifest.name,
        displayName: manifest.displayName || toDisplayName(manifest.name),
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        path: pluginPath,
        manifest,
        dependenciesInstalled,
      });

      // Register each tool from the plugin
      for (const tool of manifest.tools) {
        if (tool.type && tool.entryPoint) {
          this.toolToPlugin.set(tool.type, pluginName);
          console.log(`[PluginManager] Registered tool: ${tool.type} from plugin ${pluginName}`);

          // If this is a trigger tool, register it into ToolConfig.triggers
          if (tool.schema?.category === 'trigger') {
            await this.registerPluginTrigger(tool.type, pluginPath, tool.entryPoint);
          }
        }
      }

      console.log(`[PluginManager] Loaded plugin: ${pluginName} (${manifest.tools.length} tools)`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`[PluginManager] Plugin ${pluginName} missing manifest.json`);
      } else {
        console.error(`[PluginManager] Error loading plugin ${pluginName}:`, error);
      }
    }
  }

  /**
   * Get all tool schemas from plugins (for ToolRegistry)
   */
  getAllPluginSchemas() {
    const schemas = [];

    for (const [pluginName, pluginData] of this.plugins) {
      for (const tool of pluginData.manifest.tools) {
        if (tool.schema) {
          schemas.push({
            ...tool.schema,
            _plugin: pluginName,
            _entryPoint: tool.entryPoint,
            // Include icon: tool-specific first, then plugin manifest, then fallback
            icon: tool.schema?.icon || pluginData.manifest.icon || 'puzzle-piece',
          });
        }
      }
    }

    return schemas;
  }

  /**
   * Check if a tool type is provided by a plugin
   */
  hasPluginTool(toolType) {
    return this.toolToPlugin.has(toolType);
  }

  /**
   * Load and return a tool module from a plugin
   */
  async loadTool(toolType) {
    // Check if already loaded
    if (this.loadedTools.has(toolType)) {
      return this.loadedTools.get(toolType);
    }

    // Find which plugin provides this tool
    const pluginName = this.toolToPlugin.get(toolType);
    if (!pluginName) {
      throw new Error(`[PluginManager] No plugin found for tool type: ${toolType}`);
    }

    const pluginData = this.plugins.get(pluginName);
    if (!pluginData) {
      throw new Error(`[PluginManager] Plugin not found: ${pluginName}`);
    }

    // Check if dependencies are installed
    if (!pluginData.dependenciesInstalled) {
      throw new Error(`[PluginManager] Plugin ${pluginName} dependencies not installed`);
    }

    // Find the tool entry point
    const toolDef = pluginData.manifest.tools.find((t) => t.type === toolType);
    if (!toolDef || !toolDef.entryPoint) {
      throw new Error(`[PluginManager] Tool ${toolType} entry point not found in plugin ${pluginName}`);
    }

    // Construct the full path to the tool module
    const toolPath = path.join(pluginData.path, toolDef.entryPoint);

    // Convert to file:// URL for dynamic import on Windows
    const toolUrl = `file:///${toolPath.replace(/\\/g, '/')}`;

    try {
      console.log(`[PluginManager] Loading tool ${toolType} from ${toolPath}`);
      const toolModule = await import(toolUrl);

      // Cache the loaded module
      this.loadedTools.set(toolType, toolModule);

      return toolModule;
    } catch (error) {
      console.error(`[PluginManager] Error loading tool ${toolType}:`, error);
      throw error;
    }
  }

  /**
   * Get plugin info by name
   */
  getPlugin(pluginName) {
    return this.plugins.get(pluginName);
  }

  /**
   * Get all installed plugins
   */
  getAllPlugins() {
    return Array.from(this.plugins.values());
  }

  /**
   * Register a plugin trigger into ToolConfig.triggers
   * This allows the WorkflowEngine to use plugin-based triggers
   */
  async registerPluginTrigger(toolType, pluginPath, entryPoint) {
    try {
      // Construct the full path to the trigger module
      const triggerPath = path.join(pluginPath, entryPoint);
      const triggerUrl = `file:///${triggerPath.replace(/\\/g, '/')}`;

      console.log(`[PluginManager] Registering plugin trigger: ${toolType}`);

      // Load the trigger module
      const triggerModule = await import(triggerUrl);
      const triggerInstance = triggerModule.default;

      // Register into ToolConfig.triggers with the standard interface
      ToolConfig.triggers[toolType] = {
        // Setup function - called when workflow starts listening
        setup: async (engine, node) => {
          if (triggerInstance.setup) {
            await triggerInstance.setup(engine, node);
          }
        },
        // Validate function - checks if incoming data matches this trigger
        validate: (triggerData, node) => {
          if (triggerInstance.validate) {
            return triggerInstance.validate(triggerData, node);
          }
          return true;
        },
        // Process function - transforms trigger data into outputs
        process: async (inputData, engine) => {
          if (triggerInstance.process) {
            return await triggerInstance.process(inputData, engine);
          }
          return inputData;
        },
        // Teardown function - cleanup when workflow stops
        teardown: async () => {
          if (triggerInstance.teardown) {
            await triggerInstance.teardown();
          }
        },
        // Reference to the plugin instance
        _pluginInstance: triggerInstance,
      };

      console.log(`[PluginManager] Plugin trigger registered: ${toolType}`);
    } catch (error) {
      console.error(`[PluginManager] Error registering plugin trigger ${toolType}:`, error);
    }
  }

  /**
   * Get the schema for a specific plugin tool
   */
  getPluginToolSchema(toolType) {
    const pluginName = this.toolToPlugin.get(toolType);
    if (!pluginName) return null;

    const pluginData = this.plugins.get(pluginName);
    if (!pluginData) return null;

    const toolDef = pluginData.manifest.tools.find((t) => t.type === toolType);
    return toolDef?.schema || null;
  }

  /**
   * Reload all plugins (useful after installing new plugins)
   */
  async reload() {
    this.plugins.clear();
    this.toolToPlugin.clear();
    this.loadedTools.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Get statistics about loaded plugins
   */
  getStats() {
    return {
      totalPlugins: this.plugins.size,
      totalTools: this.toolToPlugin.size,
      loadedTools: this.loadedTools.size,
      plugins: Array.from(this.plugins.entries()).map(([name, data]) => ({
        name,
        displayName: data.displayName,
        version: data.version,
        tools: data.manifest.tools.length,
        dependenciesInstalled: data.dependenciesInstalled,
      })),
    };
  }
}

// Export singleton instance
export default PluginManager.getInstance();
