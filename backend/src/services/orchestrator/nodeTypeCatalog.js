import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOOL_LIBRARY_PATH = path.join(__dirname, '../../tools/toolLibrary.json');

// Category key in the toolLibrary.json file -> user-facing category key in the output.
const BUILTIN_CATEGORY_MAP = [
  { libraryKey: 'triggers', outputKey: 'Triggers', nodeCategory: 'trigger' },
  { libraryKey: 'actions', outputKey: 'Actions', nodeCategory: 'action' },
  { libraryKey: 'utilities', outputKey: 'Utilities', nodeCategory: 'utility' },
  { libraryKey: 'widgets', outputKey: 'Widgets', nodeCategory: 'widgets' },
  { libraryKey: 'controls', outputKey: 'Controls', nodeCategory: 'control' },
  { libraryKey: 'custom', outputKey: 'Custom', nodeCategory: 'custom' },
];

/**
 * Load every node type (built-in + plugin) grouped by display category.
 *
 * Returns:
 *   {
 *     categories: { Triggers: [...], Actions: [...], ... },  // full schemas
 *     flat:       [...],                                      // same entries flattened
 *   }
 *
 * Each entry carries the full parameter and output schema, so callers that need
 * the compact list must project the fields they want themselves.
 */
export async function loadAllNodeTypes() {
  const rawToolLibrary = await fs.readFile(TOOL_LIBRARY_PATH, 'utf-8');
  const toolLibraryData = JSON.parse(rawToolLibrary);

  const categories = {};

  for (const { libraryKey, outputKey, nodeCategory } of BUILTIN_CATEGORY_MAP) {
    const tools = toolLibraryData[libraryKey];
    if (!Array.isArray(tools)) continue;
    categories[outputKey] = tools.map((tool) => ({
      type: tool.type,
      title: tool.title,
      description: tool.description,
      icon: tool.icon,
      category: nodeCategory,
      parameters: tool.parameters || {},
      outputs: tool.outputs || {},
    }));
  }

  // Load plugin tools from PluginManager, if available.
  try {
    const PluginManager = (await import('../../plugins/PluginManager.js')).default;
    if (!PluginManager.initialized) {
      await PluginManager.initialize();
    }

    const pluginSchemas = PluginManager.getAllPluginSchemas();

    for (const schema of pluginSchemas) {
      const category = schema.category || 'action';
      const outputKey = category.charAt(0).toUpperCase() + category.slice(1) + 's';

      const pluginTool = {
        type: schema.type,
        title: schema.title || schema.type,
        description: schema.description || '',
        icon: schema.icon || 'puzzle',
        category,
        parameters: schema.parameters || {},
        outputs: schema.outputs || {},
        isPlugin: true,
        pluginName: schema._plugin,
      };

      if (!categories[outputKey]) {
        categories[outputKey] = [];
      }
      categories[outputKey].push(pluginTool);
    }
  } catch (pluginError) {
    console.error('[nodeTypeCatalog] Error loading plugin tools:', pluginError);
    // Continue without plugin tools — built-ins are still usable.
  }

  const flat = Object.values(categories).flat();
  return { categories, flat };
}

/**
 * Look up a single node type by its `type` identifier. Returns the full schema
 * entry, or null if not found.
 */
export async function findNodeTypeByType(type) {
  const { flat } = await loadAllNodeTypes();
  return flat.find((tool) => tool.type === type) || null;
}
