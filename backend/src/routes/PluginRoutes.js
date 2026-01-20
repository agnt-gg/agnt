import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import PluginInstaller from '../plugins/PluginInstaller.js';
import PluginManager from '../plugins/PluginManager.js';
import WorkflowProcessBridge from '../workflow/WorkflowProcessBridge.js';
import { reloadPluginTools as reloadOrchestratorPluginTools } from '../services/orchestrator/tools.js';
import PluginGenerator from '../services/PluginGenerator.js';
import { authenticateToken } from './Middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Helper function to reload plugins across all processes
 * Ensures all reloads complete before returning
 * @returns {Promise<{success: boolean, mainProcess: boolean, orchestrator: boolean, workflowProcess: boolean}>}
 */
async function reloadAllPlugins() {
  const results = {
    success: true,
    mainProcess: false,
    orchestrator: false,
    workflowProcess: false,
  };

  // Reload main process plugin manager
  try {
    await PluginManager.reload();
    results.mainProcess = true;
    console.log('[PluginRoutes] Main process plugin reload: success');
  } catch (error) {
    console.error('[PluginRoutes] Main process plugin reload failed:', error.message);
    results.success = false;
  }

  // Reload orchestrator and workflow process in parallel, but wait for both
  const [orchestratorResult, workflowResult] = await Promise.allSettled([
    reloadOrchestratorPluginTools(),
    WorkflowProcessBridge.reloadPlugins(),
  ]);

  // Process orchestrator result
  if (orchestratorResult.status === 'fulfilled') {
    results.orchestrator = true;
    console.log('[PluginRoutes] Orchestrator plugin reload: success', orchestratorResult.value);
  } else {
    console.warn('[PluginRoutes] Orchestrator plugin reload failed:', orchestratorResult.reason?.message);
  }

  // Process workflow result
  if (workflowResult.status === 'fulfilled') {
    results.workflowProcess = true;
    console.log('[PluginRoutes] Workflow process plugin reload: success', workflowResult.value);
  } else {
    console.warn('[PluginRoutes] Workflow process plugin reload failed:', workflowResult.reason?.message);
  }

  return results;
}

/**
 * Plugin API Routes
 *
 * Provides endpoints for managing plugins:
 * - List installed plugins
 * - List available plugins from marketplace
 * - Install/uninstall plugins
 * - Get plugin details
 */

// ============================================================================
// INSTALLED PLUGINS
// ============================================================================

/**
 * GET /api/plugins/installed
 * Get list of installed plugins with their status
 */
router.get('/installed', async (req, res) => {
  try {
    const installed = await PluginInstaller.getInstalledPlugins();
    const stats = PluginManager.getStats();

    res.json({
      success: true,
      plugins: installed,
      stats: stats,
    });
  } catch (error) {
    console.error('[PluginRoutes] Error getting installed plugins:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/plugins/installed/:name
 * Get details of a specific installed plugin
 */
router.get('/installed/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const manifest = PluginManager.getPluginManifest(name);

    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: `Plugin '${name}' not found`,
      });
    }

    const isValid = await PluginInstaller.validatePlugin(name);

    res.json({
      success: true,
      plugin: {
        ...manifest,
        isValid,
        tools: manifest.tools?.map((t) => ({
          type: t.type,
          title: t.schema?.title,
          description: t.schema?.description,
          category: t.schema?.category,
        })),
      },
    });
  } catch (error) {
    console.error('[PluginRoutes] Error getting plugin details:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/plugins/installed/:name/source
 * Get source code of an installed plugin
 */
router.get('/installed/:name/source', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    // Use PluginInstaller's pluginsDir for ASAR compatibility
    const pluginPath = path.join(PluginInstaller.pluginsDir, name);

    try {
      await fs.access(pluginPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Plugin not found' });
    }

    const files = {};

    // Read manifest
    try {
      files['manifest.json'] = await fs.readFile(path.join(pluginPath, 'manifest.json'), 'utf-8');
    } catch {}

    // Read package.json
    try {
      files['package.json'] = await fs.readFile(path.join(pluginPath, 'package.json'), 'utf-8');
    } catch {}

    // Read other files
    const entries = await fs.readdir(pluginPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !['manifest.json', 'package.json', 'package-lock.json'].includes(entry.name) && !entry.name.startsWith('.')) {
        files[entry.name] = await fs.readFile(path.join(pluginPath, entry.name), 'utf-8');
      }
    }

    res.json({ success: true, files });
  } catch (error) {
    console.error('[PluginRoutes] Error getting plugin source:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/plugins/installed/:name/package
 * Get the plugin as a packaged .agnt file (base64 encoded) for publishing to marketplace
 */
router.get('/installed/:name/package', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    // Use PluginInstaller's pluginsDir for ASAR compatibility
    const pluginPath = path.join(PluginInstaller.pluginsDir, name);

    // Check if plugin exists
    try {
      await fs.access(pluginPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Plugin not found' });
    }

    // Check if there's already a built .agnt file in dist
    // Use parent of pluginsDir for builds (user data directory)
    const distDir = path.join(PluginInstaller.pluginsDir, '..', 'plugin-builds');
    const existingPackage = path.join(distDir, `${name}.agnt`);

    let packageBuffer;

    try {
      // Try to use existing package
      await fs.access(existingPackage);
      packageBuffer = await fs.readFile(existingPackage);
      console.log(`[PluginRoutes] Using existing package: ${existingPackage}`);
    } catch {
      // Need to build the package
      console.log(`[PluginRoutes] Building package for plugin: ${name}`);

      // Create dist directory if needed
      await fs.mkdir(distDir, { recursive: true });

      // Get list of files to include
      const filesToInclude = [];
      const entries = await fs.readdir(pluginPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files and package-lock.json
        if (entry.name.startsWith('.') || entry.name === 'package-lock.json') {
          continue;
        }

        if (entry.isFile()) {
          filesToInclude.push(entry.name);
        } else if (entry.isDirectory() && entry.name === 'node_modules') {
          // Include node_modules if it exists
          filesToInclude.push('node_modules');
        }
      }

      // Create tar.gz archive
      const tar = await import('tar');
      const outputFile = path.join(distDir, `${name}.agnt`);

      await tar.create(
        {
          gzip: true,
          file: outputFile,
          cwd: pluginPath,
          prefix: name,
        },
        filesToInclude
      );

      packageBuffer = await fs.readFile(outputFile);
      console.log(`[PluginRoutes] Built package: ${outputFile} (${packageBuffer.length} bytes)`);
    }

    // Return base64 encoded package data
    const base64Data = packageBuffer.toString('base64');

    res.json({
      success: true,
      data: base64Data,
      size: packageBuffer.length,
      fileName: `${name}.agnt`,
    });
  } catch (error) {
    console.error('[PluginRoutes] Error getting plugin package:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// MARKETPLACE
// ============================================================================

/**
 * GET /api/plugins/marketplace
 * Get list of available plugins from the marketplace
 */
router.get('/marketplace', async (req, res) => {
  try {
    const available = await PluginInstaller.getAvailablePlugins();
    res.json(available);
  } catch (error) {
    console.error('[PluginRoutes] Error fetching marketplace:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// INSTALL / UNINSTALL
// ============================================================================

/**
 * POST /api/plugins/install
 * Install a plugin from the marketplace
 *
 * Body: { name: string, version?: string }
 */
router.post('/install', async (req, res) => {
  try {
    const { name, version = 'latest' } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Plugin name is required',
      });
    }

    console.log(`[PluginRoutes] Installing plugin: ${name}@${version}`);

    const result = await PluginInstaller.installFromMarketplace(name, version);

    if (result.success) {
      // Reload all plugin processes and wait for completion
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;
    }

    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error installing plugin:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/plugins/install-file
 * Install a plugin from an uploaded file
 *
 * Body: { name: string, fileData: string (base64) }
 */
router.post('/install-file', async (req, res) => {
  try {
    const { name, fileData, fileName } = req.body;

    if (!name || !fileData) {
      return res.status(400).json({
        success: false,
        error: 'Plugin name and fileData are required',
      });
    }

    // Save base64 data to temp file
    const tempPath = path.join(PluginInstaller.tempDir, fileName || `${name}.tar.gz`);
    const buffer = Buffer.from(fileData, 'base64');
    await fs.writeFile(tempPath, buffer);

    // Install from file
    const result = await PluginInstaller.installFromFile(tempPath, name);

    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch {}

    if (result.success) {
      // Reload all plugin processes and wait for completion
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;
    }

    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error installing plugin from file:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/plugins/:name
 * Uninstall a plugin
 */
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;

    console.log(`[PluginRoutes] Uninstalling plugin: ${name}`);

    const result = await PluginInstaller.uninstallPlugin(name);

    if (result.success) {
      // Reload all plugin processes and wait for completion
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;
    }

    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error uninstalling plugin:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// PLUGIN TOOLS
// ============================================================================

/**
 * GET /api/plugins/tools
 * Get all tools provided by plugins
 */
router.get('/tools', async (req, res) => {
  try {
    const schemas = PluginManager.getAllPluginSchemas();

    res.json({
      success: true,
      tools: schemas.map((s) => ({
        type: s.type,
        title: s.title,
        description: s.description,
        category: s.category,
        icon: s.icon,
        plugin: s._plugin,
      })),
      count: schemas.length,
    });
  } catch (error) {
    console.error('[PluginRoutes] Error getting plugin tools:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// AI PLUGIN GENERATION
// ============================================================================

/**
 * POST /api/plugins/generate
 * Generate a plugin using AI from a natural language description
 * Streams progress events as the plugin is generated
 *
 * Body: { description: string, provider?: string, model?: string, options?: object }
 */
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { description, provider, model, options = {} } = req.body;
    const userId = req.user.id;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: 'Plugin description is required',
      });
    }

    if (!provider || !model) {
      return res.status(400).json({
        success: false,
        error: 'AI provider and model are required',
      });
    }

    console.log(`[PluginRoutes] Generating plugin for user ${userId}`);
    console.log(`[PluginRoutes] Provider: ${provider}, Model: ${model}`);

    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const generator = new PluginGenerator(userId);

      // Step 1: Generate manifest
      sendEvent('progress', { step: 'manifest', status: 'generating' });
      const manifest = await generator.generateManifest(description, provider, model);
      sendEvent('manifest', manifest);

      // Step 2: Generate code for each tool
      const toolCode = {};
      for (const tool of manifest.tools) {
        const fileName = tool.entryPoint.replace('./', '');
        sendEvent('progress', { step: 'code', tool: tool.type, status: 'generating' });
        toolCode[fileName] = await generator.generateToolCode(tool, manifest, provider, model);
        sendEvent('code', { file: fileName, code: toolCode[fileName] });
      }

      // Step 3: Generate package.json
      sendEvent('progress', { step: 'package', status: 'generating' });
      const packageJson = await generator.generatePackageJson(manifest, toolCode, provider, model);
      sendEvent('package', packageJson);

      // Complete
      sendEvent('complete', { success: true });
      res.end();
    } catch (genError) {
      console.error('[PluginRoutes] Generation error:', genError);
      sendEvent('error', { error: genError.message });
      res.end();
    }
  } catch (error) {
    console.error('[PluginRoutes] Error in generate route:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/plugins/regenerate-file
 * Regenerate a specific file with AI based on instructions
 *
 * Body: { fileName: string, instructions: string, currentManifest: object, currentCode: object, provider: string, model: string }
 */
router.post('/regenerate-file', authenticateToken, async (req, res) => {
  try {
    const { fileName, instructions, currentManifest, currentCode, provider, model } = req.body;
    const userId = req.user.id;

    if (!fileName || !instructions) {
      return res.status(400).json({
        success: false,
        error: 'fileName and instructions are required',
      });
    }

    if (!provider || !model) {
      return res.status(400).json({
        success: false,
        error: 'AI provider and model are required',
      });
    }

    console.log(`[PluginRoutes] Regenerating file ${fileName} for user ${userId}`);

    const generator = new PluginGenerator(userId);
    const content = await generator.regenerateFile(fileName, instructions, currentManifest, currentCode, provider, model);

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    console.error('[PluginRoutes] Error regenerating file:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/plugins/build-generated
 * Build and optionally install a generated plugin
 *
 * Body: { manifest: object, toolCode: object, packageJson: object, installAfterBuild?: boolean }
 */
router.post('/build-generated', authenticateToken, async (req, res) => {
  try {
    const { manifest, toolCode, packageJson, installAfterBuild = true } = req.body;
    const userId = req.user.id;

    if (!manifest || !toolCode) {
      return res.status(400).json({
        success: false,
        error: 'manifest and toolCode are required',
      });
    }

    const pluginName = manifest.name;
    if (!pluginName) {
      return res.status(400).json({
        success: false,
        error: 'Plugin name is required in manifest',
      });
    }

    console.log(`[PluginRoutes] Building generated plugin: ${pluginName}`);

    // Create temp directory for the plugin
    const tempPluginDir = path.join(PluginInstaller.tempDir, `generated-${pluginName}-${Date.now()}`);
    await fs.mkdir(tempPluginDir, { recursive: true });

    try {
      // Write manifest.json
      await fs.writeFile(path.join(tempPluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Write tool code files
      for (const [fileName, code] of Object.entries(toolCode)) {
        await fs.writeFile(path.join(tempPluginDir, fileName), code);
      }

      // Write package.json if provided
      if (packageJson) {
        await fs.writeFile(path.join(tempPluginDir, 'package.json'), JSON.stringify(packageJson, null, 2));
      }

      // Install dependencies if package.json has dependencies
      if (packageJson?.dependencies && Object.keys(packageJson.dependencies).length > 0) {
        console.log(`[PluginRoutes] Installing dependencies for ${pluginName}...`);
        try {
          execSync('npm install --production --no-audit --no-fund', {
            cwd: tempPluginDir,
            stdio: 'pipe',
          });
          console.log(`[PluginRoutes] Dependencies installed for ${pluginName}`);
        } catch (npmError) {
          console.warn(`[PluginRoutes] npm install warning:`, npmError.message);
          // Continue anyway - some plugins may work without all deps
        }
      }

      // Build the .agnt package
      // Use parent of pluginsDir for builds (user data directory)
      const distDir = path.join(PluginInstaller.pluginsDir, '..', 'plugin-builds');
      await fs.mkdir(distDir, { recursive: true });

      const outputFile = path.join(distDir, `${pluginName}.agnt`);

      // Get list of files to include
      const filesToInclude = ['manifest.json'];
      if (packageJson) filesToInclude.push('package.json');

      // Add all .js files
      const files = await fs.readdir(tempPluginDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          filesToInclude.push(file);
        }
      }

      // Add node_modules if exists
      try {
        await fs.access(path.join(tempPluginDir, 'node_modules'));
        filesToInclude.push('node_modules');
      } catch {
        // No node_modules
      }

      // Create tar.gz archive
      const tar = await import('tar');
      await tar.create(
        {
          gzip: true,
          file: outputFile,
          cwd: tempPluginDir,
          prefix: pluginName,
        },
        filesToInclude
      );

      console.log(`[PluginRoutes] Built plugin package: ${outputFile}`);

      // Install if requested
      let installResult = null;
      let reloadResults = null;
      if (installAfterBuild) {
        console.log(`[PluginRoutes] Installing generated plugin: ${pluginName}`);
        installResult = await PluginInstaller.installFromFile(outputFile, pluginName);

        if (installResult.success) {
          // Reload all plugin processes and wait for completion
          reloadResults = await reloadAllPlugins();
          installResult.reloadStatus = reloadResults;
        }
      }

      // Clean up temp directory
      await fs.rm(tempPluginDir, { recursive: true, force: true });

      res.json({
        success: true,
        pluginName,
        outputFile,
        installed: installAfterBuild ? installResult?.success : false,
        installResult,
        reloadStatus: reloadResults,
      });
    } catch (buildError) {
      // Clean up on error
      try {
        await fs.rm(tempPluginDir, { recursive: true, force: true });
      } catch {}
      throw buildError;
    }
  } catch (error) {
    console.error('[PluginRoutes] Error building generated plugin:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// PLUGIN RELOAD
// ============================================================================

/**
 * POST /api/plugins/reload
 * Reload all plugins (useful after manual changes)
 */
router.post('/reload', async (req, res) => {
  try {
    console.log('[PluginRoutes] Reloading plugins...');

    // Re-initialize plugins first (discovers new plugins from filesystem)
    await PluginInstaller.initializePlugins();

    // Reload all plugin processes and wait for completion
    const reloadResults = await reloadAllPlugins();
    const stats = PluginManager.getStats();

    res.json({
      success: true,
      message: 'Plugins reloaded',
      stats: stats,
      reloadStatus: reloadResults,
    });
  } catch (error) {
    console.error('[PluginRoutes] Error reloading plugins:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
