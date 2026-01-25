import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAvailableToolSchemas } from '../services/orchestrator/tools.js';
import toolRegistry from '../services/orchestrator/toolRegistry.js';
import ToolRegistry from '../tools/ToolRegistry.js';
import PluginManager from '../plugins/PluginManager.js';
import CustomToolModel from '../models/CustomToolModel.js';
import { authenticateToken } from './Middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Cache for toolLibrary.json to avoid disk reads on every request
let toolLibraryCache = null;
let toolLibraryCacheTime = 0;
const TOOL_LIBRARY_CACHE_TTL = 60000; // 1 minute cache TTL

/**
 * Get toolLibrary.json from cache or disk
 * Caches the result to avoid repeated file reads
 */
async function getToolLibrary() {
  const now = Date.now();
  if (toolLibraryCache && (now - toolLibraryCacheTime) < TOOL_LIBRARY_CACHE_TTL) {
    return toolLibraryCache;
  }

  const toolLibraryPath = path.join(__dirname, '../tools/toolLibrary.json');
  const toolLibraryContent = await fs.readFile(toolLibraryPath, 'utf-8');
  toolLibraryCache = JSON.parse(toolLibraryContent);
  toolLibraryCacheTime = now;

  return toolLibraryCache;
}

/**
 * Invalidate toolLibrary cache (call when plugins change)
 */
export function invalidateToolLibraryCache() {
  toolLibraryCache = null;
  toolLibraryCacheTime = 0;
}

// Get all orchestrator tools (both native, registry, and plugin tools)
router.get('/orchestrator-tools', async (req, res) => {
  try {
    const toolSchemas = await getAvailableToolSchemas();

    // Get plugin tool names for identification
    await toolRegistry.ensureInitialized();
    const pluginTools = toolRegistry.getAllPluginTools();
    const pluginToolNames = new Set(pluginTools.map((t) => t.type.replace(/-/g, '_')));

    // Transform tool schemas to frontend format
    const tools = toolSchemas.map((schema) => {
      const toolName = schema.function.name;
      const isPlugin = pluginToolNames.has(toolName);
      const pluginTool = isPlugin ? pluginTools.find((t) => t.type.replace(/-/g, '_') === toolName) : null;

      return {
        id: toolName,
        name: toolName.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        title: toolName.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        description: schema.function.description,
        category: isPlugin ? 'Plugins' : categorizeToolByName(toolName),
        is_builtin: !isPlugin,
        is_plugin: isPlugin,
        plugin_name: pluginTool?.pluginName || null,
      };
    });

    res.json({ tools });
  } catch (error) {
    console.error('Error fetching orchestrator tools:', error);
    res.status(500).json({ error: 'Failed to fetch orchestrator tools' });
  }
});

/**
 * GET /api/tools/workflow-tools
 * Get all tools for the workflow designer (ToolSidebar) including plugins and custom tools
 * Returns tools in the format expected by toolLibrary.json
 */
router.get('/workflow-tools', authenticateToken, async (req, res) => {
  try {
    // Load toolLibrary.json from cache (avoids disk read on every request)
    const toolLibrary = await getToolLibrary();

    console.log('[ToolsRoutes] Loaded toolLibrary.json:', {
      triggers: toolLibrary.triggers?.length || 0,
      actions: toolLibrary.actions?.length || 0,
      utilities: toolLibrary.utilities?.length || 0,
      widgets: toolLibrary.widgets?.length || 0,
      controls: toolLibrary.controls?.length || 0,
      custom: toolLibrary.custom?.length || 0,
    });

    // Get plugin tools from PluginManager
    let pluginSchemas = [];
    try {
      pluginSchemas = PluginManager.getAllPluginSchemas();
      console.log(`[ToolsRoutes] Loaded ${pluginSchemas.length} plugin schemas`);
    } catch (pluginError) {
      console.warn('[ToolsRoutes] Could not load plugin schemas:', pluginError.message);
    }

    // Get custom tools from database
    let customToolsFromDb = [];
    try {
      if (req.user?.userId) {
        customToolsFromDb = await CustomToolModel.findAllByUserId(req.user.userId);
        console.log(`[ToolsRoutes] Loaded ${customToolsFromDb.length} custom tools from database`);
      }
    } catch (dbError) {
      console.warn('[ToolsRoutes] Could not load custom tools from database:', dbError.message);
    }

    // Transform plugin tools to match the toolLibrary.json format
    // and integrate them into their respective categories
    const pluginsByCategory = {
      triggers: [],
      actions: [],
      utilities: [],
      widgets: [],
      controls: [],
      custom: [],
    };

    // Process plugin tools and categorize them
    for (const pluginSchema of pluginSchemas) {
      // Map plugin category to toolLibrary category
      const category = mapPluginCategory(pluginSchema.category);

      // Add plugin metadata to the schema
      // IMPORTANT: Set icon AFTER spread to ensure it's not overwritten by undefined
      const enrichedSchema = {
        ...pluginSchema,
        isPlugin: true,
        pluginName: pluginSchema._plugin,
      };
      // Explicitly set icon after spread to avoid undefined overwrite
      enrichedSchema.icon = pluginSchema.icon || 'puzzle-piece';

      if (pluginsByCategory[category]) {
        pluginsByCategory[category].push(enrichedSchema);
      } else {
        // Default to actions if category not recognized
        pluginsByCategory.actions.push(enrichedSchema);
      }
    }

    // Merge plugins and custom tools into their respective categories from toolLibrary
    const result = {
      triggers: [...(toolLibrary.triggers || []), ...pluginsByCategory.triggers],
      actions: [...(toolLibrary.actions || []), ...pluginsByCategory.actions],
      utilities: [...(toolLibrary.utilities || []), ...pluginsByCategory.utilities],
      widgets: [...(toolLibrary.widgets || []), ...pluginsByCategory.widgets],
      controls: [...(toolLibrary.controls || []), ...pluginsByCategory.controls],
      custom: [...(toolLibrary.custom || []), ...pluginsByCategory.custom, ...customToolsFromDb],
    };

    console.log('[ToolsRoutes] Returning workflow tools:', {
      triggers: result.triggers.length,
      actions: result.actions.length,
      utilities: result.utilities.length,
      widgets: result.widgets.length,
      controls: result.controls.length,
      custom: result.custom.length,
      pluginCount: pluginSchemas.length,
      customToolsFromDb: customToolsFromDb.length,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching workflow tools:', error);
    res.status(500).json({ error: 'Failed to fetch workflow tools' });
  }
});

/**
 * GET /api/tools/plugins-only
 * Get only plugin tools (for real-time updates)
 */
router.get('/plugins-only', async (req, res) => {
  try {
    const pluginSchemas = PluginManager.getAllPluginSchemas();

    // Transform to frontend format with category mapping
    const pluginsByCategory = {
      triggers: [],
      actions: [],
      utilities: [],
      widgets: [],
      controls: [],
      custom: [],
    };

    for (const schema of pluginSchemas) {
      const category = mapPluginCategory(schema.category);
      const enrichedSchema = {
        ...schema,
        isPlugin: true,
        pluginName: schema._plugin,
        icon: schema.icon || 'puzzle-piece', // Ensure icon is available for ToolSidebar
      };

      if (pluginsByCategory[category]) {
        pluginsByCategory[category].push(enrichedSchema);
      } else {
        pluginsByCategory.actions.push(enrichedSchema);
      }
    }

    res.json({
      success: true,
      plugins: pluginsByCategory,
      totalCount: pluginSchemas.length,
    });
  } catch (error) {
    console.error('Error fetching plugin tools:', error);
    res.status(500).json({ error: 'Failed to fetch plugin tools' });
  }
});

// Helper function to categorize tools
function categorizeToolByName(toolName) {
  if (toolName.includes('web_') || toolName.includes('search') || toolName.includes('scrape')) {
    return 'Data & Knowledge';
  }
  if (toolName.includes('execute_') || toolName.includes('shell') || toolName.includes('javascript')) {
    return 'Productivity';
  }
  if (toolName.includes('file_')) {
    return 'Automation';
  }
  if (toolName.includes('agnt_')) {
    return 'Automation';
  }
  if (toolName.includes('email') || toolName.includes('send_')) {
    return 'Communication';
  }
  if (toolName.includes('discord') || toolName.includes('slack') || toolName.includes('telegram')) {
    return 'Communication';
  }
  return 'Automation'; // Default category
}

/**
 * Map plugin category to toolLibrary category
 */
function mapPluginCategory(pluginCategory) {
  if (!pluginCategory) return 'actions';

  const categoryMap = {
    trigger: 'triggers',
    triggers: 'triggers',
    action: 'actions',
    actions: 'actions',
    utility: 'utilities',
    utilities: 'utilities',
    widget: 'widgets',
    widgets: 'widgets',
    control: 'controls',
    controls: 'controls',
    custom: 'custom',
  };

  return categoryMap[pluginCategory.toLowerCase()] || 'actions';
}

export default router;
