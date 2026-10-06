import express from 'express';
import crypto from 'node:crypto';
import { computeIntegrity, integrityMatches } from '../../plugins/lib/validate-core.js';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import PluginInstaller from '../plugins/PluginInstaller.js';
import PluginManager from '../plugins/PluginManager.js';
import PluginAccounts from '../plugins/PluginAccountStore.js';
import { pluginAccountBoundary, accountPluginMutation } from '../plugins/pluginAccountRoutes.js';
import PluginAssetLoader from '../plugins/PluginAssetLoader.js';
import { bundleSelection } from '../plugins/PluginBundler.js';
import { packageInstalledPlugin } from '../plugins/packageInstalledPlugin.js';
import reloadAllPlugins from '../plugins/reloadAllPlugins.js';
import { authenticateToken } from './Middleware.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import { requireAuthHeader } from '../utils/authGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(authenticateToken, pluginAccountBoundary);

/**
 * Plugin API Routes
 *
 * Provides endpoints for managing plugins:
 * - List installed plugins
 * - List available plugins from marketplace
 * - Install/uninstall plugins
 * - Get plugin details
 *
 * reloadAllPlugins() used to be defined here, which meant only an HTTP request
 * could reach it. It now lives in ../plugins/reloadAllPlugins.js so the
 * background update scheduler can reload the running processes too.
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
    const installed = await PluginAccounts.filter(await PluginInstaller.getInstalledPlugins(), req.user.userId);
    const stats = { totalPlugins: installed.length };

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
    const plugin = PluginManager.getPlugin(name);

    if (!plugin) {
      return res.status(404).json({
        success: false,
        error: `Plugin '${name}' not found`,
      });
    }

    const isValid = await PluginInstaller.validatePlugin(name);
    const manifest = plugin.manifest || {};

    res.json({
      success: true,
      plugin: {
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        isValid,
        tools: (manifest.tools || []).map((t) => ({
          type: t.type,
          title: t.schema?.title,
          description: t.schema?.description,
          category: t.schema?.category,
          schema: t.schema,
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

    // Read top-level files
    const entries = await fs.readdir(pluginPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !['manifest.json', 'package.json', 'package-lock.json'].includes(entry.name) && !entry.name.startsWith('.')) {
        files[entry.name] = await fs.readFile(path.join(pluginPath, entry.name), 'utf-8');
      }
    }

    // ecosystem assets: also read ecosystem-asset subdirectories so the Plugin Builder
    // can browse/edit bundled agents/workflows/skills/widgets/tools. Without
    // this, ecosystem plugins look empty in the editor.
    const assetDirs = ['agents', 'workflows', 'skills', 'widgets', 'tools'];
    for (const dir of assetDirs) {
      const dirPath = path.join(pluginPath, dir);
      try {
        const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const e of dirEntries) {
          if (!e.isFile() || e.name.startsWith('.')) continue;
          const rel = `${dir}/${e.name}`;
          files[rel] = await fs.readFile(path.join(dirPath, e.name), 'utf-8');
        }
      } catch {
        // Directory doesn't exist for this plugin — skip silently
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

    // Always build fresh from the installed folder: a cached archive would
    // publish whatever version was packed first. The whole folder is packed,
    // so tools in subfolders (tools/, lib/) ship with the plugin.
    const distDir = path.join(PluginInstaller.pluginsDir, '..', 'plugin-builds');
    const outputFile = path.join(distDir, `${name}.agnt`);
    const packageBuffer = await packageInstalledPlugin(pluginPath, name, outputFile);
    console.log(`[PluginRoutes] Built package: ${outputFile} (${packageBuffer.length} bytes)`);

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
router.post('/install', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name, version = 'latest' } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Plugin name is required',
      });
    }

    console.log(`[PluginRoutes] Installing plugin: ${name}@${version}`);

    // The token reaches the marketplace only if a paid package refuses the
    // download; free packages never trigger a capability request.
    // An existing host package can be activated for this account without replacing
    // code another account already uses. Paid downloads still go through verification.
    const existing = PluginManager.getPlugin(name);
    const listing = (await PluginInstaller.getAvailablePlugins()).plugins?.find(p => p.name === name);
    let result;
    const installedRecord = (await PluginInstaller.getInstalledPlugins()).find(p => p.name === name);
    const reusable = existing && listing && listing.integrity && installedRecord?.integrity === listing.integrity && existing.version === listing.version;
    if (reusable) {
      if (Number(listing.price) > 0) {
        // Prove this account's own paid download entitlement before activating
        // an archive already cached by somebody else. Never inherit their purchase.
        const proofFile = path.join(PluginInstaller.tempDir, crypto.randomUUID() + '.agnt');
        try {
          await PluginInstaller.fetchMarketplaceArchive(listing, proofFile, { authToken: req.headers.authorization || null });
          if (!integrityMatches(listing.integrity, await computeIntegrity(proofFile))) throw new Error('Package integrity mismatch');
        } finally { await fs.unlink(proofFile).catch(() => {}); }
      }
      result = { success: true, pluginName: name, version: existing.version };
    } else {
      if ((await PluginAccounts.owners(name)).some(owner => owner !== req.user.userId)) {
        return res.status(409).json({ success: false, error: 'This package is in use by another account; it cannot be replaced by this install.' });
      }
      result = await PluginInstaller.installFromMarketplace(name, version, {
        authToken: req.headers.authorization || null,
      });
    }

    if (result.success) {
      await PluginAccounts.add(name, req.user.userId);
      // Reload all plugin processes and wait for completion
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;

      // Broadcast plugin installed event to all connected clients
      broadcastToUser(req.user.userId, RealtimeEvents.PLUGIN_INSTALLED, {
        name,
        version,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error installing plugin:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/plugins/install-file
 * Install a plugin from an uploaded file
 *
 * Body: { name: string, fileData: string (base64) }
 */
router.post('/install-file', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name, fileData, fileName } = req.body;

    if (!name || !fileData) {
      return res.status(400).json({
        success: false,
        error: 'Plugin name and fileData are required',
      });
    }

    // Save base64 data to temp file
    const tempPath = path.join(PluginInstaller.tempDir, `${crypto.randomUUID()}-${path.basename(fileName || `${name}.tar.gz`)}`);
    const buffer = Buffer.from(fileData, 'base64');
    await fs.writeFile(tempPath, buffer);

    // Install from file
    const result = await PluginInstaller.installFromFile(tempPath, name);

    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch {}

    if (result.success) {
      await PluginAccounts.add(name, req.user.userId);
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
}));

/**
 * DELETE /api/plugins/:name?mode=clean|purge|detach
 * ecosystem assets: Uninstall a plugin in one of three asset-handling modes.
 *   - clean (default): preserve user-modified assets as orphans
 *   - purge: delete all plugin-installed assets regardless of modification
 *   - detach: keep all assets, just unregister the plugin
 */
router.delete('/:name', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name } = req.params;
    const mode = (req.query.mode || 'clean').toString();

    console.log(`[PluginRoutes] Uninstalling plugin: ${name} (mode=${mode})`);

    // Walk + clean up the ecosystem assets first
    let assetResult = null;
    try {
      assetResult = await PluginAssetLoader.uninstallAssets(name, mode, req.user.userId);
    } catch (assetErr) {
      console.error('[PluginRoutes] Asset uninstall error:', assetErr);
      return res.status(400).json({ success: false, error: assetErr.message });
    }

    const others = (await PluginAccounts.owners(name)).filter(owner => owner !== req.user.userId);
    const result = others.length ? { success: true, name } : await PluginInstaller.uninstallPlugin(name);
    if (result.success) await PluginAccounts.remove(name, req.user.userId);
    if (assetResult) result.assetResult = assetResult;

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
}));

/**
 * GET /api/plugins/:name/assets
 * ecosystem assets: Inspect what ecosystem assets a plugin currently owns. Useful for
 * the uninstall confirmation modal so the user can see what will be deleted
 * vs preserved.
 */
router.get('/:name/assets', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const db = (await import('../models/database/index.js')).default;
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT a.asset_type, a.asset_slug, a.local_id, a.installed_at, a.deprecated_at,
                CASE a.asset_type
                  WHEN 'agent' THEN (SELECT is_user_modified FROM agents WHERE id = a.local_id)
                  WHEN 'workflow' THEN (SELECT is_user_modified FROM workflows WHERE id = a.local_id)
                  WHEN 'skill' THEN (SELECT is_user_modified FROM skills WHERE id = a.local_id)
                  WHEN 'widget' THEN (SELECT is_user_modified FROM widget_definitions WHERE id = a.local_id)
                  WHEN 'tool' THEN 0
                END AS is_user_modified
         FROM installed_plugin_assets a WHERE plugin_name = ? AND user_id = ?
         ORDER BY a.asset_type, a.asset_slug`,
        [name, req.user.userId],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });
    res.json({ success: true, assets: rows });
  } catch (error) {
    console.error('[PluginRoutes] /assets error:', error);
    res.status(500).json({ success: false, error: error.message });
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
    const schemas = await PluginAccounts.filter(PluginManager.getAllPluginSchemas(), req.user.userId, row => row._plugin);

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
// PLUGIN FORGE: BUILD AND INSTALL A DRAFT
// ============================================================================

/**
 * POST /api/plugins/build-generated
 * Build and optionally install a generated plugin
 *
 * Body: { manifest: object, toolCode: object, packageJson: object, installAfterBuild?: boolean }
 */
router.post('/build-generated', authenticateToken, accountPluginMutation(async (req, res) => {
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

      // ecosystem assets: source endpoint can return ecosystem-asset paths like
      // "agents/koder-kai.json", so ensure the parent dir exists before writing
      // each file. Without this, a flat fs.writeFile fails with ENOENT.
      for (const [fileName, code] of Object.entries(toolCode)) {
        const target = path.resolve(tempPluginDir, fileName);
        // File names arrive from the Plugin Forge draft, which a model edits.
        // Every file must land inside this plugin's own directory.
        if (!target.startsWith(path.resolve(tempPluginDir) + path.sep)) {
          throw Object.assign(new Error(`Invalid plugin file name: ${fileName}`), { status: 400 });
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, code);
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

      // Add top-level .js files
      const files = await fs.readdir(tempPluginDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          filesToInclude.push(file);
        }
      }

      // ecosystem assets: include ecosystem-asset directories so packs with agents,
      // workflows, skills, widgets, or tools round-trip correctly through the
      // regenerate → build flow.
      for (const dir of ['agents', 'workflows', 'skills', 'widgets', 'tools']) {
        try {
          await fs.access(path.join(tempPluginDir, dir));
          filesToInclude.push(dir);
        } catch {}
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
          await PluginAccounts.add(pluginName, req.user.userId);
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
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  }
}));

// ============================================================================
// ecosystem assets: BUNDLE-AS-PLUGIN AUTHORING
// ============================================================================

/**
 * POST /api/plugins/bundle-from-assets
 * Body: {
 *   pluginName: string,
 *   version: string,
 *   description?: string,
 *   author?: string,
 *   icon?: string,
 *   selection: { agentIds?: [], workflowIds?: [], skillIds?: [], widgetIds?: [] },
 *   install?: boolean   // if true, also install on this instance
 * }
 *
 * Returns a base64 .agnt archive plus the generated manifest.
 */
router.post('/bundle-from-assets', authenticateToken, accountPluginMutation(async (req, res) => {
  try {
    const { pluginName, version = '1.0.0', description, author, icon, selection = {}, install = false } = req.body || {};
    if (!pluginName) {
      return res.status(400).json({ success: false, error: 'pluginName is required' });
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginName)) {
      return res.status(400).json({ success: false, error: 'pluginName must be kebab-case (a-z, 0-9, hyphens)' });
    }

    const tempDir = path.join(PluginInstaller.tempDir, `bundle-${pluginName}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    let archivePath;
    try {
      const { manifest } = await bundleSelection({
        pluginName,
        version,
        description,
        author,
        icon,
        selection,
        outDir: tempDir,
        userId: req.user.userId,
      });

      // Write a minimal package.json so PluginInstaller's ensureModuleType is happy
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: pluginName, version, type: 'module' }, null, 2)
      );

      // Build the .agnt tarball
      const distDir = path.join(PluginInstaller.pluginsDir, '..', 'plugin-builds');
      await fs.mkdir(distDir, { recursive: true });
      archivePath = path.join(distDir, `${pluginName}.agnt`);

      const filesToInclude = ['manifest.json', 'package.json'];
      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && ['agents', 'workflows', 'skills', 'widgets', 'tools'].includes(e.name)) {
          filesToInclude.push(e.name);
        }
      }

      const tar = await import('tar');
      await tar.create(
        { gzip: true, file: archivePath, cwd: tempDir, prefix: pluginName },
        filesToInclude
      );

      const archiveBuf = await fs.readFile(archivePath);

      let installResult = null;
      let reloadResults = null;
      if (install) {
        installResult = await PluginInstaller.installFromFile(archivePath, pluginName);
        if (installResult.success) {
          await PluginAccounts.add(pluginName, req.user.userId);
          reloadResults = await reloadAllPlugins();
          installResult.reloadStatus = reloadResults;
          broadcastToUser(req.user.userId, RealtimeEvents.PLUGIN_INSTALLED, {
            name: pluginName,
            version,
            timestamp: new Date().toISOString(),
          });
        }
      }

      res.json({
        success: true,
        manifest,
        fileName: `${pluginName}.agnt`,
        size: archiveBuf.length,
        data: archiveBuf.toString('base64'),
        installed: install ? !!installResult?.success : false,
        installResult,
      });
    } finally {
      // Clean up the temp build directory (keep the final .agnt in plugin-builds)
      try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
    }
  } catch (error) {
    console.error('[PluginRoutes] bundle-from-assets error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}));

/**
 * POST /api/plugins/install-file/check-auth
 * ecosystem assets: Inspect an .agnt archive's manifest and return the list of
 * authProvider declarations across its tools so the install UI can prompt
 * the user to configure missing providers before completing extraction.
 *
 * Body: { fileData: string (base64) }
 */
router.post('/install-file/check-auth', authenticateToken, accountPluginMutation(async (req, res) => {
  try {
    const { fileData } = req.body || {};
    if (!fileData) return res.status(400).json({ success: false, error: 'fileData is required' });

    const tempPath = path.join(PluginInstaller.tempDir, `auth-check-${Date.now()}.agnt`);
    await fs.mkdir(PluginInstaller.tempDir, { recursive: true });
    await fs.writeFile(tempPath, Buffer.from(fileData, 'base64'));

    // Extract just the manifest into a scratch directory and inspect it
    const scratch = path.join(PluginInstaller.tempDir, `auth-check-${Date.now()}-extract`);
    await fs.mkdir(scratch, { recursive: true });
    try {
      const tar = await import('tar');
      await tar.extract({ file: tempPath, cwd: scratch, strip: 1 });
      const manifestRaw = await fs.readFile(path.join(scratch, 'manifest.json'), 'utf-8');
      const manifest = JSON.parse(manifestRaw);
      const providers = new Set();
      for (const tool of manifest.tools || []) {
        if (tool?.schema?.authProvider) providers.add(tool.schema.authProvider);
      }
      res.json({
        success: true,
        pluginName: manifest.name,
        version: manifest.version,
        requiredAuthProviders: Array.from(providers),
        assetCounts: {
          tools: (manifest.tools || []).length,
          agents: (manifest.agents || []).length,
          workflows: (manifest.workflows || []).length,
          skills: (manifest.skills || []).length,
          widgets: (manifest.widgets || []).length,
        },
      });
    } finally {
      try { await fs.rm(scratch, { recursive: true, force: true }); } catch {}
      try { await fs.unlink(tempPath); } catch {}
    }
  } catch (error) {
    console.error('[PluginRoutes] check-auth error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}));

// ============================================================================
// PLUGIN RELOAD
// ============================================================================

// ============================================================================
// PRE-INSTALL INSPECTION (trust system Layer 1)
// ============================================================================

/**
 * GET /api/plugins/inspect/:name
 * Download + scan a marketplace package WITHOUT installing it. Returns the
 * disclosure report the install-consent modal renders: integrity state,
 * detected capabilities (with file:line evidence), declared permissions,
 * undeclared diff, and the trust tier the plugin would receive.
 */
router.get('/inspect/:name', requireAuthHeader, async (req, res) => {
  try {
    const { name } = req.params;
    const report = await PluginInstaller.inspectMarketplacePlugin(name, {
      authToken: req.headers.authorization || null,
    });
    res.json(report);
  } catch (error) {
    console.error('[PluginRoutes] Error inspecting plugin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});// ============================================================================
// GITHUB ESCAPE HATCH (trust system W4)
// ============================================================================

/**
 * POST /api/plugins/install-github
 * Body: { name, repo: "owner/repo", mode?, asset?, subdir?, ref?,
 *         confirmRedirect?, acceptedPermissions? }
 * Pull a plugin directly from GitHub through the same staged/validated/
 * permission-gated install path. Returns { requiresConfirmation } on a
 * moved repo and { requiresConsent } on permission escalation.
 */
router.post('/install-github', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name, repo, mode, asset, subdir, ref, confirmRedirect, acceptedPermissions } = req.body || {};
    if (!name || !repo) {
      return res.status(400).json({ success: false, error: 'name and repo are required' });
    }
    const result = await PluginInstaller.installFromGitHub(name, { repo, mode, asset, subdir, ref, confirmRedirect, acceptedPermissions });
    if (result.success) {
      await PluginAccounts.add(name, req.user.userId);
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;
      broadcastToUser(req.user.userId, RealtimeEvents.PLUGIN_INSTALLED, { name, version: result.version, source: 'github', timestamp: new Date().toISOString() });
    }
    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] GitHub install error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}));

// ============================================================================
// UPDATE STATUS & POLICY
// ============================================================================

// There is deliberately no route for update-settings. Whether to check for
// updates is not a question a user can answer better than the program can, so
// the scheduler simply runs. update-settings.json remains as a file-only
// escape hatch; exposing it over HTTP is what put a checkbox on the screen.

/**
 * GET /api/plugins/update-status
 * The last background pass's summary: { checkedAt, updatesAvailable,
 * autoUpdated, blockedOnConsent, notified }, or status: null if the scheduler
 * has never run.
 *
 * The scheduler wrote this file from the day it shipped; no route served it
 * and no client read it. So `notify` — the DEFAULT policy — notified nobody,
 * and an auto-update refused for requesting new permissions was reported only
 * to a console nobody tails. This is the endpoint that makes those visible.
 */
router.get('/update-status', requireAuthHeader, async (req, res) => {
  try {
    if (!PluginInstaller.updateScheduler) {
      const { default: UpdateScheduler } = await import('../plugins/UpdateScheduler.js');
      PluginInstaller.updateScheduler = new UpdateScheduler(PluginInstaller);
    }
    const status = await PluginInstaller.updateScheduler.getStatus();
    const owned = new Set(await PluginAccounts.names(req.user.userId));
    if (status) for (const key of Object.keys(status)) if (Array.isArray(status[key])) status[key] = status[key].filter(p => owned.has(typeof p === 'string' ? p : p.name));
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/plugins/update-policy/:name  { policy: 'auto'|'pinned' }
 * Per-plugin update policy, stored on the registry entry (merge semantics
 * preserve it across installs/updates).
 *
 * Binary on purpose. The third value, 'notify', asked the user to choose
 * between two kinds of silence — it recorded the finding to a file nothing
 * read — and it was the default, which is why nothing ever updated. 'pinned'
 * is the only opt-out, and it now lives in a per-plugin overflow menu instead
 * of a dropdown on every row.
 */
router.post('/update-policy/:name', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name } = req.params;
    const { policy } = req.body || {};
    if (!['auto', 'pinned'].includes(policy)) {
      return res.status(400).json({ success: false, error: "policy must be 'auto' or 'pinned'" });
    }
    const fsp = await import('fs/promises');
    const registry = JSON.parse(await fsp.readFile(PluginInstaller.registryPath, 'utf-8'));
    const entry = (registry.plugins || []).find((p) => p.name === name);
    if (!entry) return res.status(404).json({ success: false, error: `Plugin '${name}' is not installed` });
    entry.updatePolicy = policy;
    await PluginInstaller.writeRegistryAtomic(registry);
    res.json({ success: true, name, policy });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}));

// ============================================================================
// UPDATES (trust system Layer 3)
// ============================================================================

/**
 * GET /api/plugins/updates
 * Compare every installed plugin's version against the marketplace catalog.
 * Non-semver installed versions ('local', 'latest', 'unknown') surface as
 * status "unknown-version" — never compared, never auto-updated over.
 */
router.get('/updates', async (req, res) => {
  try {
    const result = await PluginInstaller.checkForUpdates();
    const owned = new Set(await PluginAccounts.names(req.user.userId));
    for (const key of Object.keys(result)) if (Array.isArray(result[key])) result[key] = result[key].filter(p => owned.has(typeof p === 'string' ? p : p.name));
    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error checking for updates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/plugins/update/:name
 * Update a single plugin via the staged-install path (stage → validate →
 * permission-diff gate → atomic swap). An update that requests NEW
 * permissions returns { requiresConsent: true, permissionDiff } and changes
 * nothing on disk until re-called with { acceptedPermissions: true }.
 *
 * Body: { acceptedPermissions?: boolean }
 */
router.post('/update/:name', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    const { name } = req.params;
    const { acceptedPermissions = false } = req.body || {};

    console.log(`[PluginRoutes] Updating plugin: ${name}`);
    const result = await PluginInstaller.updatePlugin(name, {
      acceptedPermissions,
      authToken: req.headers.authorization || null,
    });

    if (result.success) {
      await PluginAccounts.add(name, req.user.userId);
      // Reload all plugin processes and wait for completion
      const reloadResults = await reloadAllPlugins();
      result.reloadStatus = reloadResults;

      broadcastToUser(req.user.userId, RealtimeEvents.PLUGIN_INSTALLED, {
        name,
        version: result.version,
        updated: true,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (error) {
    console.error('[PluginRoutes] Error updating plugin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}));

/**
 * POST /api/plugins/reload
 * Reload all plugins (useful after manual changes)
 */
router.post('/reload', requireAuthHeader, accountPluginMutation(async (req, res) => {
  try {
    console.log('[PluginRoutes] Reloading plugins...');

    // Re-initialize plugins first (discovers new plugins from filesystem)
    await PluginInstaller.initializePlugins();

    // Reload all plugin processes and wait for completion
    const reloadResults = await reloadAllPlugins();
    const stats = { totalPlugins: (await PluginAccounts.names(req.user.userId)).length };

    // Re-sync registry.json from current manifest data so /installed list
    // matches what's actually on disk (manual edits to manifest.json/version
    // were previously invisible because the list reads from this file).
    try {
      await PluginInstaller.syncRegistryFromInstalled();
    } catch (syncErr) {
      console.warn('[PluginRoutes] Registry sync after reload failed:', syncErr.message);
    }

    // Notify connected clients so the Plugins UI re-fetches without a manual
    // refresh. Reuses plugin:installed since the frontend already handles it.
    broadcastToUser(req.user.userId, RealtimeEvents.PLUGIN_INSTALLED, {
      reloaded: true,
      timestamp: new Date().toISOString(),
    });

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
}));

export default router;
