import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import SchemaValidator from './SchemaValidator.js';
import PluginManager from '../plugins/PluginManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ToolRegistry {
  static instance = null;

  constructor() {
    this.schemas = new Map();
    this.initialized = false;
    this.toolLibraryJson = null;
    this.validator = new SchemaValidator();
  }

  static getInstance() {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('Initializing ToolRegistry...');

    try {
      // Load toolLibrary.json as fallback source
      await this.loadToolLibraryJson();

      // Scan and load tool schemas from individual files
      await this.loadToolSchemas();

      this.initialized = true;
      console.log(`ToolRegistry initialized with ${this.schemas.size} tools`);
    } catch (error) {
      console.error('Error initializing ToolRegistry:', error);
      throw error;
    }
  }

  async loadToolLibraryJson() {
    try {
      const jsonPath = path.join(__dirname, 'toolLibrary.json');
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      this.toolLibraryJson = JSON.parse(jsonContent);
      console.log('Loaded toolLibrary.json as fallback source');
    } catch (error) {
      console.error('Error loading toolLibrary.json:', error);
      throw new Error('Failed to load toolLibrary.json fallback');
    }
  }

  async loadToolSchemas() {
    const libraryPath = path.join(__dirname, 'library');

    // Define all category subdirectories to scan
    const categories = ['actions', 'triggers', 'controls', 'utilities', 'widgets', 'custom', 'mcp'];

    try {
      // Load tools from each category subdirectory
      for (const category of categories) {
        const categoryPath = path.join(__dirname, 'library', category);

        try {
          const files = await fs.readdir(categoryPath);
          const jsFiles = files.filter((file) => file.endsWith('.js') && file !== 'BaseAction.js' && file !== 'BaseTrigger.js');

          for (const file of jsFiles) {
            const toolType = file.replace('.js', '');
            await this.loadToolSchema(toolType, file, category);
          }

          if (jsFiles.length > 0) {
            console.log(`✓ Loaded ${jsFiles.length} tools from ${category}/ subdirectory`);
          }
        } catch (categoryError) {
          // Silently skip if category directory doesn't exist
          if (categoryError.code !== 'ENOENT') {
            console.log(`Note: ${category}/ directory not found or empty`);
          }
        }
      }

      // Load plugin tool schemas
      await this.loadPluginSchemas();
    } catch (error) {
      console.error('Error scanning library directory:', error);
      throw error;
    }
  }

  /**
   * Load tool schemas from installed plugins
   */
  async loadPluginSchemas() {
    try {
      // Get all plugin schemas from PluginManager
      const pluginSchemas = PluginManager.getAllPluginSchemas();

      if (pluginSchemas.length === 0) {
        console.log('[ToolRegistry] No plugin schemas to load');
        return;
      }

      console.log(`[ToolRegistry] Loading ${pluginSchemas.length} plugin tool schemas...`);

      for (const schema of pluginSchemas) {
        // Validate the schema
        const validation = this.validator.validate(schema);
        if (!validation.valid) {
          console.error(`[ToolRegistry] Plugin schema validation failed for ${schema.type}:`, validation.errors);
          continue;
        }

        // Store the schema with metadata
        this.schemas.set(schema.type, {
          schema,
          source: 'plugin',
          toolType: schema.type,
          category: schema.category,
          validated: true,
          plugin: schema._plugin,
        });

        console.log(`[ToolRegistry] ✓ Loaded plugin tool: ${schema.type} from ${schema._plugin}`);
      }

      console.log(`[ToolRegistry] Plugin schemas loaded successfully`);
    } catch (error) {
      console.error('[ToolRegistry] Error loading plugin schemas:', error);
      // Don't throw - allow app to continue without plugin tools
    }
  }

  async loadToolSchema(toolType, filename, subdirectory = 'library') {
    try {
      // Dynamically import the tool module from category subdirectory
      const categories = ['actions', 'triggers', 'controls', 'utilities', 'widgets', 'custom', 'mcp'];
      const modulePath = categories.includes(subdirectory) ? `./library/${subdirectory}/${filename}` : `./library/${filename}`;
      const toolModule = await import(modulePath);

      let schema = null;
      let source = 'fallback';

      // Check if the tool has a static schema property
      if (toolModule.default?.constructor?.schema) {
        schema = toolModule.default.constructor.schema;
        source = 'file';
        console.log(`✓ Loaded schema for ${toolType} from file`);
      } else {
        // Fallback to toolLibrary.json
        schema = this.findSchemaInJson(toolType);
        if (schema) {
          console.log(`○ Using fallback schema for ${toolType} from toolLibrary.json`);
        } else {
          console.warn(`⚠ No schema found for ${toolType} in file or JSON`);
          return;
        }
      }

      // Validate the schema
      const validation = this.validator.validate(schema);
      if (!validation.valid) {
        console.error(`Schema validation failed for ${toolType}:`, validation.errors);
        throw new Error(`Invalid schema for ${toolType}: ${validation.errors.join(', ')}`);
      }

      // Store the schema with metadata
      this.schemas.set(toolType, {
        schema,
        source,
        toolType,
        category: schema.category,
        validated: true,
      });
    } catch (error) {
      console.error(`Error loading schema for ${toolType}:`, error);
      // Don't throw - allow other tools to load
    }
  }

  findSchemaInJson(toolType) {
    // Search through all categories in toolLibrary.json
    const categories = ['triggers', 'actions', 'utilities', 'widgets', 'controls', 'custom'];

    for (const category of categories) {
      const items = this.toolLibraryJson[category] || [];
      const found = items.find((item) => item.type === toolType);
      if (found) {
        return found;
      }
    }

    return null;
  }

  getSchema(toolType) {
    if (!this.initialized) {
      throw new Error('ToolRegistry not initialized. Call initialize() first.');
    }

    const entry = this.schemas.get(toolType);
    return entry ? entry.schema : null;
  }

  getAllSchemas() {
    if (!this.initialized) {
      throw new Error('ToolRegistry not initialized. Call initialize() first.');
    }

    const result = {
      triggers: [],
      actions: [],
      utilities: [],
      widgets: [],
      controls: [],
      custom: [],
      plugins: [], // Add plugins category
    };

    for (const [toolType, entry] of this.schemas.entries()) {
      const category = entry.category;
      // Plugin tools go to plugins category
      if (entry.source === 'plugin') {
        result.plugins.push(entry.schema);
      } else if (result[category]) {
        result[category].push(entry.schema);
      }
    }

    return result;
  }

  getSchemasByCategory(category) {
    if (!this.initialized) {
      throw new Error('ToolRegistry not initialized. Call initialize() first.');
    }

    const schemas = [];
    for (const [toolType, entry] of this.schemas.entries()) {
      if (entry.category === category) {
        schemas.push(entry.schema);
      }
    }

    return schemas;
  }

  getSchemaMetadata(toolType) {
    if (!this.initialized) {
      throw new Error('ToolRegistry not initialized. Call initialize() first.');
    }

    return this.schemas.get(toolType);
  }

  hasSchema(toolType) {
    return this.schemas.has(toolType);
  }

  getStats() {
    const stats = {
      total: this.schemas.size,
      bySource: { file: 0, fallback: 0 },
      byCategory: {},
    };

    for (const [toolType, entry] of this.schemas.entries()) {
      stats.bySource[entry.source]++;

      if (!stats.byCategory[entry.category]) {
        stats.byCategory[entry.category] = 0;
      }
      stats.byCategory[entry.category]++;
    }

    return stats;
  }

  async reload() {
    this.schemas.clear();
    this.initialized = false;
    await this.initialize();
  }
}

export default ToolRegistry;
