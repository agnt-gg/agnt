import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ToolConfig from '../tools/ToolConfig.js';
import PluginAssetLoader from './PluginAssetLoader.js';
import db from '../models/database/index.js';

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
    // Incremented on every reload(). Used as the per-reload generation token
    // for the reload-shim mechanism in _resolveModuleUrl. Node's ESM cache is
    // keyed by URL and never invalidates on its own, so cache-busting only the
    // entry point with ?v=Date.now() doesn't reach its static imports — the
    // shim system gives every file in the plugin's intra-module graph a fresh
    // URL on reload.
    this.reloadGeneration = 0;

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

    // Sweep stale reload shims from prior generations before we (potentially)
    // create new ones in this generation. Cheap no-op on first load.
    try {
      await this._cleanupReloadShims(pluginPath);
    } catch {}

    try {
      // Check if manifest exists
      await fs.access(manifestPath);

      // Read and parse manifest
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Validate manifest
      // PRD-057: ecosystem plugins may have agents/workflows/skills/widgets
      // instead of (or in addition to) tools. Require name + at least one
      // recognized asset array.
      if (!manifest.name) {
        console.warn(`[PluginManager] Invalid manifest for plugin ${pluginName}: missing name`);
        return;
      }
      const hasAnyAsset =
        (Array.isArray(manifest.tools) && manifest.tools.length > 0) ||
        (Array.isArray(manifest.agents) && manifest.agents.length > 0) ||
        (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) ||
        (Array.isArray(manifest.skills) && manifest.skills.length > 0) ||
        (Array.isArray(manifest.widgets) && manifest.widgets.length > 0);
      if (!hasAnyAsset) {
        console.warn(`[PluginManager] Plugin ${pluginName} has no tools/agents/workflows/skills/widgets`);
        return;
      }
      // Tool array is optional now, but if present must be an array
      if (manifest.tools && !Array.isArray(manifest.tools)) {
        console.warn(`[PluginManager] Plugin ${pluginName}: manifest.tools must be an array`);
        return;
      }
      manifest.tools = manifest.tools || [];

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

      // PRD-057: install ecosystem assets (agents, workflows, skills, widgets, tools).
      // Idempotent — re-running honors is_user_modified flags so we don't clobber
      // user customizations between app restarts. Even tool-only plugins are
      // walked so their tools land in installed_plugin_assets for the /assets
      // endpoint and uninstall accounting.
      const hasEcosystemAssets =
        (Array.isArray(manifest.agents) && manifest.agents.length > 0) ||
        (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) ||
        (Array.isArray(manifest.skills) && manifest.skills.length > 0) ||
        (Array.isArray(manifest.widgets) && manifest.widgets.length > 0) ||
        (Array.isArray(manifest.tools) && manifest.tools.length > 0);

      if (hasEcosystemAssets) {
        try {
          // Bind plugin assets to the first user (single-user / family-shared model
          // per CLAUDE.md). If multiple users exist they'll all see plugin assets
          // because they were installed for the system, not bound to one user.
          const owner = await new Promise((resolve, reject) => {
            db.get(
              'SELECT id FROM users ORDER BY created_at ASC LIMIT 1',
              [],
              (err, row) => (err ? reject(err) : resolve(row?.id || null))
            );
          });
          if (owner) {
            const summary = await PluginAssetLoader.installAssets(
              pluginName,
              manifest.version || '1.0.0',
              manifest,
              pluginPath,
              owner
            );
            if (summary.noop) {
              console.log(`[PluginManager] ${pluginName}: ecosystem assets already at v${manifest.version || '1.0.0'}`);
            } else {
              const counts = {
                agents: summary.installed.agents.length,
                workflows: summary.installed.workflows.length,
                skills: summary.installed.skills.length,
                widgets: summary.installed.widgets.length,
                tools: summary.installed.tools?.length || 0,
              };
              console.log(
                `[PluginManager] ${pluginName}: installed ${counts.agents} agents, ${counts.workflows} workflows, ${counts.skills} skills, ${counts.widgets} widgets, ${counts.tools} tools` +
                (summary.skipped.length ? ` (${summary.skipped.length} user-modified, kept)` : '') +
                (summary.deprecated.length ? ` (${summary.deprecated.length} deprecated)` : '')
              );
              if (summary.errors.length) {
                console.warn(`[PluginManager] ${pluginName}: asset install errors:`, summary.errors);
              }
            }
            this.plugins.get(pluginName).assetSummary = summary;
          } else {
            console.warn(`[PluginManager] ${pluginName}: no users in DB, skipping ecosystem-asset install`);
          }
        } catch (assetError) {
          console.error(`[PluginManager] ${pluginName}: ecosystem asset install failed:`, assetError);
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
            // Backfill `type` from the top-level manifest entry if the schema
            // didn't include it. The orchestrator's toolRegistry depends on
            // schema.type to derive the LLM function name.
            type: tool.schema?.type || tool.type,
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

    // Resolve to a file:// URL. On reload, this returns a shim that gives the
    // entire transitive intra-plugin import graph fresh URLs — necessary
    // because Node's ESM cache is keyed by URL and never invalidates.
    const toolUrl = await this._resolveModuleUrl(pluginData, toolDef.entryPoint);

    try {
      console.log(`[PluginManager] Loading tool ${toolType} from ${toolUrl}`);
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
      // Trigger files share the same reload-shim machinery as tools so their
      // transitive intra-plugin imports also get fresh URLs on reload.
      const triggerUrl = await this._resolveModuleUrl({ path: pluginPath }, entryPoint);

      console.log(`[PluginManager] Registering plugin trigger: ${toolType} from ${triggerUrl}`);

      // Load the trigger module
      const triggerModule = await import(triggerUrl);
      const triggerInstance = triggerModule.default;

      // Register into ToolConfig.triggers with the standard interface
      ToolConfig.triggers[toolType] = {
        // Setup function - called when workflow starts listening
        setup: async (engine, node) => {
          if (triggerInstance.setup) {
            // Auto-resolve auth for triggers that declare authProvider
            const toolSchema = this.getPluginToolSchema(toolType);
            if (toolSchema?.authProvider && engine.getAuth) {
              try {
                const token = await engine.getAuth(toolSchema.authProvider);
                if (!node.parameters) node.parameters = {};
                node.parameters.__auth = { token, provider: toolSchema.authProvider };
              } catch (authError) {
                console.warn(`[PluginManager] Auth failed for trigger ${toolType}:`, authError.message);
              }
            }
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
    // Bump first so loadPlugin/registerPluginTrigger see the new generation.
    this.reloadGeneration += 1;
    this.plugins.clear();
    this.toolToPlugin.clear();
    this.loadedTools.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Return the file:// URL to import for a plugin module. On first load
   * (generation 0), this is the real path with a timestamp cache-buster on
   * the entry. On reloads (generation > 0), the entry and its transitive
   * relative imports are mirrored as `*.__reload-<gen>.js` shim files inside
   * the plugin directory; each shim rewrites its `from './x'` imports to
   * point at the child shim. This gives every file in the intra-plugin
   * module graph a fresh URL, which is the only way to evict Node's ESM
   * module cache short of restarting the process.
   *
   * Bare imports (e.g. 'ws', 'fs/promises') are left alone — they resolve
   * through node_modules and aren't pinned by file:// caching.
   */
  async _resolveModuleUrl(pluginData, entryPoint) {
    const realPath = path.join(pluginData.path, entryPoint);
    if (this.reloadGeneration === 0) {
      return `file:///${realPath.replace(/\\/g, '/')}?v=${Date.now()}`;
    }
    const visited = new Map();
    let target = realPath;
    try {
      target = await this._createReloadShim(realPath, visited);
    } catch (err) {
      console.warn(`[PluginManager] Shim creation failed for ${realPath}, falling back to real path:`, err.message);
    }
    return `file:///${target.replace(/\\/g, '/')}?v=${this.reloadGeneration}`;
  }

  /**
   * Recursively produce a reload-shim copy of a plugin file. The shim lives
   * next to the original (so relative paths and node_modules resolution still
   * work) but rewrites every relative import to point at the shim version of
   * the dependency. Returns the original path on failure so the caller can
   * still import something, even if it won't be cache-busted.
   */
  async _createReloadShim(filePath, visited) {
    if (visited.has(filePath)) return visited.get(filePath);

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath) || '.js';
    const base = path.basename(filePath, ext);

    // Don't shim an existing shim — would create N×N copies on reload N.
    if (/\.__reload-\d+$/.test(base)) {
      visited.set(filePath, filePath);
      return filePath;
    }

    const shimName = `${base}.__reload-${this.reloadGeneration}${ext}`;
    const shimPath = path.join(dir, shimName);
    visited.set(filePath, shimPath);

    let src;
    try {
      src = await fs.readFile(filePath, 'utf-8');
    } catch {
      visited.set(filePath, filePath);
      return filePath;
    }

    // Matches:
    //   from './x' | from "./x"            (import .. from / export .. from)
    //   import './x' | import "./x"        (side-effect import)
    //   import('./x') | import( './x' )    (dynamic import)
    const importRegex = /(from\s+['"]|import\s+['"]|import\s*\(\s*['"])(\.\.?\/[^'"?]+)(['"])/g;

    const matches = [];
    let m;
    while ((m = importRegex.exec(src)) !== null) {
      matches.push({ full: m[0], prefix: m[1], relPath: m[2], suffix: m[3] });
    }

    for (const r of matches) {
      const resolved = await this._resolveRelativeImport(dir, r.relPath);
      if (!resolved) continue; // non-JS asset (e.g. .json) — leave the import as-is
      const childShim = await this._createReloadShim(resolved, visited);
      if (childShim === resolved) continue; // shim creation skipped/failed; leave import alone
      // Compute the path from the parent shim's directory (same as `dir`, since
      // shims live next to their originals) to the child shim. Using basename
      // here would drop any subdirectory (e.g. `./utils/foo.js` → `./foo.js`)
      // and produce a broken import.
      let childRel = path.relative(dir, childShim).replace(/\\/g, '/');
      if (!childRel.startsWith('./') && !childRel.startsWith('../')) {
        childRel = './' + childRel;
      }
      const newImport = `${r.prefix}${childRel}?v=${this.reloadGeneration}${r.suffix}`;
      // Use split/join instead of String.replace so a literal $ in the import
      // path can't trigger replacement-pattern substitution.
      src = src.split(r.full).join(newImport);
    }

    const header = `// AUTO-GENERATED reload shim (gen ${this.reloadGeneration}). Safe to delete when AGNT is stopped.\n`;
    try {
      await fs.writeFile(shimPath, header + src);
    } catch (err) {
      console.warn(`[PluginManager] Failed to write reload shim ${shimPath}:`, err.message);
      visited.set(filePath, filePath);
      return filePath;
    }
    return shimPath;
  }

  /**
   * Resolve a relative import path to an actual file on disk, honoring
   * extensionless imports and index files. Only resolves to JS/MJS so we
   * don't accidentally try to shim a JSON asset.
   */
  async _resolveRelativeImport(fromDir, relPath) {
    const base = path.resolve(fromDir, relPath);
    const ext = path.extname(base).toLowerCase();
    const candidates = [];
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      candidates.push(base);
    } else if (ext === '') {
      candidates.push(base + '.js', base + '.mjs', path.join(base, 'index.js'), path.join(base, 'index.mjs'));
    } else {
      // Non-JS asset (.json, .wasm, etc.) — don't shim.
      return null;
    }
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {}
    }
    return null;
  }

  /**
   * Delete leftover `*.__reload-<gen>.<ext>` files in a plugin dir whose
   * generation doesn't match the current one. Runs at the start of every
   * loadPlugin call so stale shims don't accumulate.
   */
  async _cleanupReloadShims(pluginPath) {
    const currentGen = this.reloadGeneration;
    const SHIM_RE = /\.__reload-(\d+)\.(?:js|mjs|cjs)$/;

    const walk = async (dir) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules and any other hidden/dot dirs — shims live next
          // to source files, never inside dependency trees.
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const match = entry.name.match(SHIM_RE);
        if (!match) continue;
        const shimGen = parseInt(match[1], 10);
        if (shimGen === currentGen) continue;
        try {
          await fs.unlink(full);
        } catch {}
      }
    };
    await walk(pluginPath);
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
