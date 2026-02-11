import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PluginInstaller - Handles plugin installation from marketplace
 *
 * ASAR-COMPATIBLE ARCHITECTURE:
 * Plugins are stored OUTSIDE the app bundle in the user data directory.
 * This allows ASAR packaging for the main app while keeping plugins writable.
 *
 * Plugin Storage Location:
 * - Windows: %APPDATA%/AGNT/plugins/
 * - macOS: ~/Library/Application Support/AGNT/plugins/
 * - GNU/Linux: ~/.config/AGNT/plugins/
 *
 * Plugin Distribution Model (VSCode Extension style):
 * 1. Plugins are distributed as source code only (no node_modules)
 * 2. Users download lightweight .agnt packages (gzipped tar archives)
 * 3. Dependencies are installed via npm on the target machine
 * 4. Native modules are compiled for the exact runtime environment
 *
 * Benefits:
 * - ASAR can be enabled for main app (faster startup, code protection)
 * - No native dependency conflicts (Sharp, etc.)
 * - Always compatible with user's Node.js/Electron version
 * - Plugins persist across app updates
 * - Smaller download sizes
 *
 * Supported file formats:
 * - .agnt (recommended - branded AGNT plugin format)
 * - .tar.gz (legacy support)
 * - .tgz (legacy support)
 */
class PluginInstaller {
  constructor() {
    // Use USER_DATA_PATH from environment (set by Electron main.js)
    // This ensures plugins are stored outside the ASAR archive
    const userDataPath = process.env.USER_DATA_PATH || this.getDefaultUserDataPath();

    this.pluginsDir = path.join(userDataPath, 'plugins', 'installed');
    this.tempDir = path.join(userDataPath, 'plugins', '.temp');
    this.registryPath = path.join(userDataPath, 'plugins', 'registry.json');

    // Use APP_PATH from Electron if available (works in both dev and packaged mode)
    // In packaged mode, __dirname points inside ASAR which utilityProcess can't read
    // APP_PATH = desktop/ folder (where main.js is)
    // Fallback: go up 3 levels from src/plugins/ to desktop/
    const appPath = process.env.APP_PATH || path.join(__dirname, '../../..');

    // UNPACKED_PATH points to app.asar.unpacked in packaged mode (outside ASAR)
    // This is needed because utilityProcess.fork() can't read from ASAR archives
    // In dev mode, UNPACKED_PATH is the same as APP_PATH
    const unpackedPath = process.env.UNPACKED_PATH || appPath;

    // Marketplace config stays in app bundle (read-only is fine)
    this.marketplacePath = path.join(appPath, 'backend', 'plugins', 'marketplace.json');
    this.marketplaceUrl = process.env.PLUGIN_MARKETPLACE_URL || 'https://agnt.gg/api/plugins';

    // Bundled .agnt plugin files directory (for installing default plugins on first run)
    // Uses UNPACKED_PATH because utilityProcess can't read from ASAR
    this.bundledPluginsDir = path.join(unpackedPath, 'backend', 'plugins', 'plugin-builds');

    // DEBUG: Log all paths on construction
    console.log('[PluginInstaller] === PATH DEBUG ===');
    console.log(`[PluginInstaller] __dirname: ${__dirname}`);
    console.log(`[PluginInstaller] process.env.APP_PATH: ${process.env.APP_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] process.env.UNPACKED_PATH: ${process.env.UNPACKED_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] process.env.USER_DATA_PATH: ${process.env.USER_DATA_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] Resolved appPath: ${appPath}`);
    console.log(`[PluginInstaller] Resolved unpackedPath: ${unpackedPath}`);
    console.log(`[PluginInstaller] Resolved userDataPath: ${userDataPath}`);
    console.log(`[PluginInstaller] pluginsDir (user): ${this.pluginsDir}`);
    console.log(`[PluginInstaller] bundledPluginsDir (.agnt files): ${this.bundledPluginsDir}`);
    console.log('[PluginInstaller] === END PATH DEBUG ===');
  }

  /**
   * Get default user data path based on platform
   * This is a fallback when USER_DATA_PATH is not set (e.g., running outside Electron)
   */
  getDefaultUserDataPath() {
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

  /**
   * Initialize plugins on startup
   * Installs bundled .agnt plugins and validates all plugins
   */
  async initializePlugins() {
    console.log('[PluginInstaller] Initializing plugins...');
    console.log(`[PluginInstaller] Plugins directory: ${this.pluginsDir}`);
    console.log(`[PluginInstaller] Bundled plugins directory: ${this.bundledPluginsDir}`);

    try {
      // Ensure directories exist
      await fs.mkdir(this.pluginsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });

      // Install bundled .agnt plugins on first run
      await this.installBundledPlugins();

      // Get list of installed plugins
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      if (pluginDirs.length === 0) {
        console.log('[PluginInstaller] No plugins installed');
        return { success: true, plugins: [] };
      }

      console.log(`[PluginInstaller] Found ${pluginDirs.length} installed plugins`);

      const validPlugins = [];
      const invalidPlugins = [];

      // Validate all plugins in parallel for faster startup
      const validationResults = await Promise.all(
        pluginDirs.map(async (pluginName) => {
          const isValid = await this.validatePlugin(pluginName);
          return { pluginName, isValid };
        })
      );

      for (const { pluginName, isValid } of validationResults) {
        if (isValid) {
          validPlugins.push(pluginName);
        } else {
          invalidPlugins.push(pluginName);
        }
      }

      if (invalidPlugins.length > 0) {
        console.warn(`[PluginInstaller] Invalid plugins (missing node_modules): ${invalidPlugins.join(', ')}`);
        console.warn('[PluginInstaller] Re-download these plugins from the marketplace');
      }

      console.log(`[PluginInstaller] ${validPlugins.length} plugins ready`);
      return { success: true, plugins: validPlugins, invalid: invalidPlugins };
    } catch (error) {
      console.error('[PluginInstaller] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Install bundled .agnt plugins on first run
   * Scans plugin-builds/ for .agnt files and installs any that aren't already installed
   * This properly extracts, validates, and registers plugins in the user data directory
   */
  async installBundledPlugins() {
    try {
      // Check if bundled plugins directory exists
      const bundledExists = await fs.access(this.bundledPluginsDir).then(() => true).catch(() => false);
      if (!bundledExists) {
        console.log(`[PluginInstaller] No bundled plugins directory found at: ${this.bundledPluginsDir}`);
        return;
      }

      // Find all .agnt files
      const entries = await fs.readdir(this.bundledPluginsDir);
      const agntFiles = entries.filter((f) => f.endsWith('.agnt'));

      if (agntFiles.length === 0) {
        console.log('[PluginInstaller] No bundled .agnt plugin files found');
        return;
      }

      console.log(`[PluginInstaller] Found ${agntFiles.length} bundled .agnt plugin files`);

      let installedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const agntFile of agntFiles) {
        // Extract plugin name from filename (e.g., "discord-plugin.agnt" -> "discord-plugin")
        const pluginName = agntFile.replace('.agnt', '');
        const agntPath = path.join(this.bundledPluginsDir, agntFile);
        const pluginPath = path.join(this.pluginsDir, pluginName);

        // Check if plugin already exists AND is valid (has manifest and required files)
        const existsInUserData = await fs.access(pluginPath).then(() => true).catch(() => false);
        if (existsInUserData) {
          // Verify the plugin is actually complete by checking for manifest
          const manifestExists = await fs.access(path.join(pluginPath, 'manifest.json')).then(() => true).catch(() => false);

          if (manifestExists) {
            // Also check if node_modules exists for plugins that need it
            const packageJsonPath = path.join(pluginPath, 'package.json');
            const nodeModulesPath = path.join(pluginPath, 'node_modules');

            let needsReinstall = false;
            try {
              const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
              const hasDeps = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;

              if (hasDeps) {
                const nodeModulesExists = await fs.access(nodeModulesPath).then(() => true).catch(() => false);
                if (!nodeModulesExists) {
                  console.log(`[PluginInstaller] ${pluginName}: exists but missing node_modules, reinstalling...`);
                  needsReinstall = true;
                }
              }
            } catch {
              // No package.json means no deps needed
            }

            if (!needsReinstall) {
              skippedCount++;
              continue;
            }
          } else {
            console.log(`[PluginInstaller] ${pluginName}: exists but incomplete (no manifest), reinstalling...`);
          }

          // Remove incomplete plugin before reinstalling
          try {
            await fs.rm(pluginPath, { recursive: true, force: true });
          } catch {}
        }

        try {
          console.log(`[PluginInstaller] Installing bundled plugin: ${pluginName}`);
          const result = await this.installFromFile(agntPath, pluginName);

          if (result.success) {
            installedCount++;
            console.log(`[PluginInstaller] Successfully installed: ${pluginName}`);
          } else {
            failedCount++;
            console.error(`[PluginInstaller] Failed to install ${pluginName}: ${result.error}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`[PluginInstaller] Error installing ${pluginName}:`, error.message);
        }
      }

      console.log(`[PluginInstaller] Bundled plugins: ${installedCount} installed, ${skippedCount} already existed, ${failedCount} failed`);
    } catch (error) {
      console.error('[PluginInstaller] Error installing bundled plugins:', error.message);
    }
  }

  /**
   * Recursively copy a directory (skips node_modules and other unnecessary files)
   * @deprecated Use installFromFile with .agnt packages instead
   */
  async copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules - dependencies will be installed via npm on user's machine
      // Skip other unnecessary directories/files
      if (entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.DS_Store' ||
          entry.name === '.npm-cache') {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Validate a plugin has all required files and install dependencies if needed
   */
  async validatePlugin(pluginName) {
    const pluginPath = path.join(this.pluginsDir, pluginName);
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const nodeModulesPath = path.join(pluginPath, 'node_modules');

    try {
      // Check manifest exists
      await fs.access(manifestPath);

      // Read manifest to check for dependencies
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

      // Check if plugin has tools defined
      if (!manifest.tools || manifest.tools.length === 0) {
        console.warn(`[PluginInstaller] ${pluginName}: No tools defined in manifest`);
        return false;
      }

      // Validate that all tool entry points exist
      for (const tool of manifest.tools) {
        if (tool.entryPoint) {
          const toolPath = path.join(pluginPath, tool.entryPoint);
          try {
            await fs.access(toolPath);
          } catch {
            console.warn(`[PluginInstaller] ${pluginName}: Missing tool file ${tool.entryPoint} for tool ${tool.type}`);
            return false;
          }
        }
      }

      // Check if dependencies need to be installed
      let hasDependencies = false;
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        hasDependencies = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;
      } catch {
        // No package.json - no dependencies needed
      }

      // If plugin has dependencies, ensure they are installed
      if (hasDependencies) {
        try {
          await fs.access(nodeModulesPath);
          const contents = await fs.readdir(nodeModulesPath);
          if (contents.length === 0) {
            console.log(`[PluginInstaller] ${pluginName}: node_modules is empty, installing dependencies...`);
            await this.installDependencies(pluginPath, pluginName);
          }
        } catch {
          console.log(`[PluginInstaller] ${pluginName}: Missing node_modules, installing dependencies...`);
          await this.installDependencies(pluginPath, pluginName);
        }
      }

      console.log(`[PluginInstaller] ${pluginName}: Valid ✓`);
      return true;
    } catch (error) {
      console.warn(`[PluginInstaller] ${pluginName}: Invalid - ${error.message}`);
      return false;
    }
  }

  /**
   * Install a plugin from the marketplace
   * Downloads pre-built package with node_modules included
   */
  async installFromMarketplace(pluginName, version = 'latest') {
    console.log(`[PluginInstaller] Installing ${pluginName}@${version} from marketplace...`);

    const pluginPath = path.join(this.pluginsDir, pluginName);
    const tempFile = path.join(this.tempDir, `${pluginName}.tar.gz`);

    try {
      // Get plugin info from registry to find downloadUrl
      const registry = await this.getMarketplaceRegistry();
      const pluginInfo = registry.plugins?.find((p) => p.name === pluginName);

      if (!pluginInfo) {
        throw new Error(`Plugin '${pluginName}' not found in marketplace registry`);
      }

      let downloadUrl = pluginInfo.downloadUrl;

      // Handle file:// protocol for local plugins
      if (downloadUrl.startsWith('file://')) {
        const localPath = path.join(__dirname, '../../plugins', downloadUrl.replace('file://', ''));
        console.log(`[PluginInstaller] Installing from local file: ${localPath}`);

        // Copy local file to temp
        await fs.copyFile(localPath, tempFile);
      } else {
        // Download from remote URL
        console.log(`[PluginInstaller] Downloading from: ${downloadUrl}`);

        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }

        // Save to temp file
        const fileStream = createWriteStream(tempFile);
        await pipeline(response.body, fileStream);
      }

      console.log(`[PluginInstaller] Plugin package ready at: ${tempFile}`);

      // Remove existing plugin if present
      try {
        await fs.rm(pluginPath, { recursive: true, force: true });
      } catch {
        // Doesn't exist, that's fine
      }

      // Create plugin directory
      await fs.mkdir(pluginPath, { recursive: true });

      // Extract tar.gz
      await this.extractTarGz(tempFile, pluginPath);
      console.log(`[PluginInstaller] Extracted to: ${pluginPath}`);

      // Clean up temp file
      await fs.unlink(tempFile);

      // Auto-fix: Ensure package.json has "type": "module" for ES6 imports
      await this.ensureModuleType(pluginPath, pluginName);

      // Validate the installed plugin
      const isValid = await this.validatePlugin(pluginName);
      if (!isValid) {
        throw new Error('Plugin validation failed after installation');
      }

      // Update registry
      await this.updateRegistry(pluginName, version, 'installed');

      console.log(`[PluginInstaller] ${pluginName} installed successfully!`);
      return { success: true, pluginName, version };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install ${pluginName}:`, error);

      // Clean up on failure
      try {
        await fs.unlink(tempFile);
      } catch {}
      try {
        await fs.rm(pluginPath, { recursive: true, force: true });
      } catch {}

      return { success: false, error: error.message };
    }
  }

  /**
   * Install a plugin from a local .agnt, .tar.gz, or .zip file
   */
  async installFromFile(filePath, pluginName) {
    console.log(`[PluginInstaller] Installing ${pluginName} from file: ${filePath}`);

    const pluginPath = path.join(this.pluginsDir, pluginName);

    try {
      // Remove existing plugin if present
      try {
        await fs.rm(pluginPath, { recursive: true, force: true });
      } catch {}

      // Create plugin directory
      await fs.mkdir(pluginPath, { recursive: true });

      // Extract based on file extension
      // .agnt files are gzipped tar archives (same as .tar.gz)
      if (filePath.endsWith('.agnt') || filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz')) {
        await this.extractTarGz(filePath, pluginPath);
      } else if (filePath.endsWith('.zip')) {
        await this.extractZip(filePath, pluginPath);
      } else {
        throw new Error('Unsupported file format. Use .agnt, .tar.gz, .tgz, or .zip');
      }

      // Validate
      const isValid = await this.validatePlugin(pluginName);
      if (!isValid) {
        throw new Error('Plugin validation failed');
      }

      // Update registry
      await this.updateRegistry(pluginName, 'local', 'installed');

      console.log(`[PluginInstaller] ${pluginName} installed from file!`);
      return { success: true, pluginName };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install from file:`, error);

      // Clean up on failure
      try {
        await fs.rm(pluginPath, { recursive: true, force: true });
      } catch {}

      return { success: false, error: error.message };
    }
  }

  /**
   * Extract a tar.gz file
   * Uses the 'tar' package for reliable extraction
   * Fixed to properly handle subdirectories within plugins
   * Handles Windows long paths with multiple fallback methods
   */
  async extractTarGz(tarPath, destPath) {
    console.log(`[PluginInstaller] Extracting: ${tarPath}`);
    console.log(`[PluginInstaller] Destination: ${destPath}`);

    // Method 1: Try using the tar npm package
    try {
      const { extract: tarExtract } = await import('tar');

      await tarExtract({
        file: tarPath,
        cwd: destPath,
        strip: 1, // Remove the top-level directory (e.g., discord-plugin/)
        preservePaths: true,
        filter: () => true,
        onwarn: (code, message) => {
          console.warn(`[PluginInstaller] Tar warning (${code}): ${message}`);
        },
      });

      // Verify extraction worked by checking for manifest
      const manifestPath = path.join(destPath, 'manifest.json');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      if (manifestExists) {
        console.log(`[PluginInstaller] Extraction successful (tar package)`);
        return;
      } else {
        console.warn(`[PluginInstaller] Tar extraction completed but manifest not found, trying fallback...`);
      }
    } catch (tarError) {
      console.error(`[PluginInstaller] Tar package extraction failed:`, tarError.message);
    }

    // Method 2: Fallback to system tar command (works better on Windows with long paths)
    try {
      const { execSync } = await import('child_process');
      console.log(`[PluginInstaller] Trying system tar command...`);

      // On Windows, use tar with --force-local to handle Windows paths
      const tarCmd = process.platform === 'win32'
        ? `tar -xzf "${tarPath}" -C "${destPath}" --strip-components=1 --force-local`
        : `tar -xzf "${tarPath}" -C "${destPath}" --strip-components=1`;

      execSync(tarCmd, { stdio: 'pipe', windowsHide: true });

      // Verify extraction
      const manifestPath = path.join(destPath, 'manifest.json');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      if (manifestExists) {
        console.log(`[PluginInstaller] Extraction successful (system tar)`);
        return;
      }
    } catch (sysError) {
      console.error(`[PluginInstaller] System tar extraction failed:`, sysError.message);
    }

    // Method 3: Fallback to PowerShell on Windows
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        console.log(`[PluginInstaller] Trying PowerShell extraction...`);

        // First decompress .gz, then extract .tar
        const tempTarPath = tarPath.replace(/\.(agnt|tar\.gz|tgz)$/, '.tar');

        // Use PowerShell to decompress and extract
        const psScript = `
          $ErrorActionPreference = 'Stop'
          $gzPath = '${tarPath.replace(/\\/g, '\\\\')}'
          $destPath = '${destPath.replace(/\\/g, '\\\\')}'

          # Read gzip file and decompress
          $gzStream = [System.IO.File]::OpenRead($gzPath)
          $decompStream = New-Object System.IO.Compression.GZipStream($gzStream, [System.IO.Compression.CompressionMode]::Decompress)

          # Create temp tar file
          $tarPath = [System.IO.Path]::GetTempFileName() + '.tar'
          $tarStream = [System.IO.File]::Create($tarPath)
          $decompStream.CopyTo($tarStream)
          $tarStream.Close()
          $decompStream.Close()
          $gzStream.Close()

          # Extract tar using tar command
          tar -xf $tarPath -C $destPath --strip-components=1
          Remove-Item $tarPath -Force
        `;

        execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
          stdio: 'pipe',
          windowsHide: true,
        });

        // Verify extraction
        const manifestPath = path.join(destPath, 'manifest.json');
        const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
        if (manifestExists) {
          console.log(`[PluginInstaller] Extraction successful (PowerShell)`);
          return;
        }
      } catch (psError) {
        console.error(`[PluginInstaller] PowerShell extraction failed:`, psError.message);
      }
    }

    throw new Error('All extraction methods failed. Please check if tar is installed and the plugin package is valid.');
  }

  /**
   * Extract a zip file (using built-in or simple implementation)
   */
  async extractZip(zipPath, destPath) {
    // For zip files, we'll use a simple approach that works without external deps
    // In production, you might want to use a library like 'adm-zip' bundled with the app
    throw new Error('ZIP extraction requires additional setup. Use .tar.gz format instead.');
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(pluginName) {
    const pluginPath = path.join(this.pluginsDir, pluginName);

    try {
      await fs.rm(pluginPath, { recursive: true, force: true });
      await this.updateRegistry(pluginName, null, 'uninstalled');
      console.log(`[PluginInstaller] Uninstalled: ${pluginName}`);
      return { success: true };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to uninstall ${pluginName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update the plugin registry
   */
  async updateRegistry(pluginName, version, action) {
    try {
      let registry = { plugins: [] };

      // Try to read existing registry
      try {
        const content = await fs.readFile(this.registryPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Validate it has plugins array
        if (parsed && Array.isArray(parsed.plugins)) {
          registry = parsed;
        } else {
          console.warn('[PluginInstaller] Registry file corrupted, rebuilding from installed plugins');
          registry = await this.rebuildRegistry();
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist - that's fine, use default empty registry
          console.log('[PluginInstaller] Registry file not found, creating new one');
        } else {
          // Other error (parse error, etc.) - try to rebuild from filesystem
          console.warn('[PluginInstaller] Error reading registry, rebuilding:', error.message);
          registry = await this.rebuildRegistry();
        }
      }

      console.log(`[PluginInstaller] Updating registry: ${action} ${pluginName}, current plugins: ${registry.plugins.map(p => p.name).join(', ')}`);

      if (action === 'installed') {
        // Remove existing entry if present
        registry.plugins = registry.plugins.filter((p) => p.name !== pluginName);
        // Add new entry
        registry.plugins.push({
          name: pluginName,
          version: version,
          installedAt: new Date().toISOString(),
          enabled: true,
        });
      } else if (action === 'uninstalled') {
        registry.plugins = registry.plugins.filter((p) => p.name !== pluginName);
      }

      console.log(`[PluginInstaller] Writing registry with plugins: ${registry.plugins.map(p => p.name).join(', ')}`);
      await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2));
    } catch (error) {
      console.error('[PluginInstaller] Failed to update registry:', error);
      throw error; // Re-throw so caller knows something went wrong
    }
  }

  /**
   * Rebuild registry from installed plugin directories
   */
  async rebuildRegistry() {
    const registry = { plugins: [] };
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = path.join(this.pluginsDir, entry.name, 'manifest.json');
          try {
            await fs.access(manifestPath);
            registry.plugins.push({
              name: entry.name,
              version: 'unknown',
              installedAt: new Date().toISOString(),
              enabled: true,
            });
          } catch {
            // No manifest, not a valid plugin
          }
        }
      }
      console.log(`[PluginInstaller] Rebuilt registry with ${registry.plugins.length} plugins`);
    } catch (error) {
      console.error('[PluginInstaller] Error rebuilding registry:', error);
    }
    return registry;
  }

  /**
   * Get marketplace registry (combines remote AND local)
   * Fetches from both remote marketplace API and local marketplace.json,
   * merging them together with remote taking priority for duplicates
   */
  async getMarketplaceRegistry() {
    const allPlugins = new Map(); // Use Map to dedupe by name, remote takes priority

    // 1. Load local marketplace.json first (lower priority)
    try {
      console.log('[PluginInstaller] Loading local marketplace.json...');
      const content = await fs.readFile(this.marketplacePath, 'utf-8');
      const localRegistry = JSON.parse(content);
      const localPlugins = localRegistry.plugins || [];
      console.log(`[PluginInstaller] Found ${localPlugins.length} plugins in local marketplace`);

      for (const plugin of localPlugins) {
        allPlugins.set(plugin.name, { ...plugin, source: 'local' });
      }
    } catch (error) {
      console.warn('[PluginInstaller] Failed to load local marketplace:', error.message);
    }

    // 2. Fetch from remote marketplace API (higher priority, overwrites local)
    try {
      console.log('[PluginInstaller] Fetching plugins from remote marketplace API...');
      const response = await fetch('https://api.agnt.gg/marketplace/items?type=plugin');

      if (response.ok) {
        const data = await response.json();
        const remoteItems = data.items || [];
        console.log(`[PluginInstaller] Fetched ${remoteItems.length} plugins from remote marketplace`);

        // Transform marketplace API format to plugin registry format
        for (const item of remoteItems) {
          // Parse metadata if it's a string
          const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata || {};
          // Get manifest from metadata (contains icon, tools, etc.)
          const manifest = metadata.manifest || {};

          const plugin = {
            name: item.asset_id,
            displayName: item.title,
            version: item.current_version,
            description: item.description,
            author: item.publisher_pseudonym || manifest.author || 'Unknown',
            homepage: metadata.homepage || manifest.homepage || '',
            downloadUrl: metadata.downloadUrl || '',
            size: metadata.size || 0,
            tags: item.tags || [],
            category: item.category,
            // Icon priority: manifest icon > metadata icon > preview_image > default
            icon: manifest.icon || metadata.icon || item.preview_image || 'custom',
            // Tools from manifest
            tools: manifest.tools || metadata.tools || [],
            source: 'remote',
          };

          // Remote overwrites local if same name exists
          allPlugins.set(plugin.name, plugin);
        }
      }
    } catch (error) {
      console.warn('[PluginInstaller] Remote marketplace unavailable:', error.message);
    }

    const plugins = Array.from(allPlugins.values());
    console.log(`[PluginInstaller] Total plugins available: ${plugins.length} (combined from local + remote)`);

    return { plugins };
  }

  /**
   * Get list of available plugins from marketplace
   */
  async getAvailablePlugins() {
    try {
      // Use local registry first
      const registry = await this.getMarketplaceRegistry();
      return {
        success: true,
        plugins: registry.plugins || [],
      };
    } catch (error) {
      console.error('[PluginInstaller] Failed to fetch available plugins:', error);
      return { success: false, error: error.message, plugins: [] };
    }
  }

  /**
   * Get list of installed plugins with full data from marketplace (single source of truth)
   */
  async getInstalledPlugins() {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const registry = JSON.parse(content);
      const registryPlugins = registry.plugins || [];

      // Get marketplace data as the single source of truth for plugin metadata
      const marketplaceRegistry = await this.getMarketplaceRegistry();
      const marketplacePlugins = marketplaceRegistry.plugins || [];

      // Enrich each installed plugin with data from marketplace
      const enrichedPlugins = await Promise.all(
        registryPlugins.map(async (plugin) => {
          // First try to get data from marketplace (single source of truth)
          const marketplacePlugin = marketplacePlugins.find((p) => p.name === plugin.name);

          if (marketplacePlugin) {
            // Use marketplace data as the source of truth
            return {
              ...plugin,
              displayName: marketplacePlugin.displayName || this.toDisplayName(marketplacePlugin.name),
              description: marketplacePlugin.description || '',
              author: marketplacePlugin.author || '',
              homepage: marketplacePlugin.homepage || '',
              icon: marketplacePlugin.icon || 'custom',
              size: marketplacePlugin.size || 0,
              tools: marketplacePlugin.tools || [],
            };
          }

          // Fallback to manifest for plugins not in marketplace (manually installed)
          try {
            const manifestPath = path.join(this.pluginsDir, plugin.name, 'manifest.json');
            const manifestContent = await fs.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent);

            return {
              ...plugin,
              displayName: manifest.displayName || this.toDisplayName(manifest.name),
              description: manifest.description || '',
              author: manifest.author || '',
              homepage: manifest.homepage || '',
              icon: manifest.icon || 'custom',
              size: manifest.size || 0,
              tools: manifest.tools || [],
            };
          } catch (error) {
            // If manifest can't be read, return registry data only
            console.warn(`[PluginInstaller] Could not read manifest for ${plugin.name}:`, error.message);
            return {
              ...plugin,
              displayName: this.toDisplayName(plugin.name),
              description: '',
              author: '',
              icon: 'custom',
              size: 0,
              tools: [],
            };
          }
        })
      );

      return enrichedPlugins;
    } catch {
      return [];
    }
  }

  /**
   * Ensure plugin package.json has "type": "module" for ES6 imports
   */
  async ensureModuleType(pluginPath, pluginName) {
    const packageJsonPath = path.join(pluginPath, 'package.json');

    try {
      // Check if package.json exists
      await fs.access(packageJsonPath);

      // Read and parse package.json
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // Auto-fix: ensure type: "module" is set
      if (!packageJson.type || packageJson.type !== 'module') {
        packageJson.type = 'module';
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(`[PluginInstaller] Auto-fixed: Added "type": "module" to ${pluginName}`);
      }
    } catch (error) {
      // If package.json doesn't exist, create a minimal one with type: module
      if (error.code === 'ENOENT') {
        const minimalPackageJson = {
          name: pluginName,
          version: '1.0.0',
          type: 'module',
          description: 'AGNT Plugin',
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2));
        console.log(`[PluginInstaller] Created package.json with "type": "module" for ${pluginName}`);
      } else {
        console.warn(`[PluginInstaller] Could not ensure module type for ${pluginName}:`, error.message);
      }
    }
  }

  /**
   * Install dependencies for a plugin using npm (async/non-blocking)
   * Handles native module compilation for the target platform
   */
  async installDependencies(pluginPath, pluginName) {
    const { spawn } = await import('child_process');

    console.log(`[PluginInstaller] Installing dependencies for ${pluginName}...`);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--production', '--no-audit', '--no-fund', `--platform=${process.platform}`, `--arch=${process.arch}`];

    try {
      await this.runNpmCommand(npmCommand, args, pluginPath, pluginName);
      console.log(`[PluginInstaller] Dependencies installed successfully for ${pluginName}`);

      // Special handling for Sharp and other native modules
      await this.handleNativeModules(pluginPath, pluginName);
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install dependencies for ${pluginName}:`, error.message);

      // Try alternative installation methods
      await this.tryAlternativeInstall(pluginPath, pluginName, error);
    }
  }

  /**
   * Run npm command asynchronously (non-blocking, enables parallel installs)
   */
  runNpmCommand(command, args, cwd, pluginName, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');

      const child = spawn(command, args, {
        cwd,
        stdio: 'pipe',
        windowsHide: true,
        shell: true,
        env: {
          ...process.env,
          npm_config_target: process.version,
          npm_config_runtime: 'node',
          npm_config_cache: path.join(cwd, '.npm-cache'),
        },
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `npm exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Get the Electron version from the main package.json
   * This is needed to rebuild native modules for the correct Electron ABI
   */
  async getElectronVersion() {
    try {
      // Try to get from process.versions first (if running in Electron)
      if (process.versions.electron) {
        return process.versions.electron;
      }

      // Otherwise read from package.json
      const mainPackageJsonPath = path.join(__dirname, '../../../package.json');
      const packageJson = JSON.parse(await fs.readFile(mainPackageJsonPath, 'utf-8'));
      const electronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;

      if (electronVersion) {
        // Remove ^ or ~ prefix if present
        return electronVersion.replace(/^[\^~]/, '');
      }

      return null;
    } catch (error) {
      console.warn('[PluginInstaller] Could not determine Electron version:', error.message);
      return null;
    }
  }

  /**
   * Handle native modules - ALWAYS rebuild for Electron runtime
   * This is critical because plugins run in Electron's Node.js, not system Node.js
   */
  async handleNativeModules(pluginPath, pluginName) {
    const { execSync } = await import('child_process');
    const packageJsonPath = path.join(pluginPath, 'package.json');

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const dependencies = packageJson.dependencies || {};

      // List of native modules that need Electron-specific compilation
      const nativeModules = ['sharp', 'canvas', 'sqlite3', 'bcrypt', 'node-gyp', 'better-sqlite3', 'onnxruntime-node'];
      const installedNativeModules = nativeModules.filter((mod) => dependencies[mod]);

      if (installedNativeModules.length === 0) {
        console.log(`[PluginInstaller] No native modules found in ${pluginName}`);
        return;
      }

      console.log(`[PluginInstaller] Found native modules in ${pluginName}: ${installedNativeModules.join(', ')}`);

      // Get Electron version for rebuilding
      const electronVersion = await this.getElectronVersion();

      if (electronVersion) {
        console.log(`[PluginInstaller] Rebuilding native modules for Electron ${electronVersion}...`);
        await this.rebuildForElectron(pluginPath, pluginName, installedNativeModules, electronVersion);
      } else {
        console.log(`[PluginInstaller] Electron version not found, rebuilding for current Node.js...`);
        await this.rebuildForNode(pluginPath, pluginName, installedNativeModules);
      }
    } catch (error) {
      console.warn(`[PluginInstaller] Could not check for native modules in ${pluginName}:`, error.message);
    }
  }

  /**
   * Rebuild native modules specifically for Electron runtime
   * Uses npm rebuild with Electron target (most reliable method)
   */
  async rebuildForElectron(pluginPath, pluginName, modules, electronVersion) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    // Rebuild all modules in parallel
    await Promise.all(
      modules.map(async (module) => {
        try {
          console.log(`[PluginInstaller] Rebuilding ${module} for Electron ${electronVersion}...`);
          await this.runNpmCommand(
            npmCommand,
            ['rebuild', module, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`, '--dist-url=https://electronjs.org/headers'],
            pluginPath,
            pluginName,
            180000
          );
          console.log(`[PluginInstaller] Successfully rebuilt ${module} for Electron`);
        } catch (rebuildError) {
          console.error(`[PluginInstaller] Failed to rebuild ${module} for Electron:`, rebuildError.message);

          // Try reinstalling the module with Electron flags
          try {
            console.log(`[PluginInstaller] Trying to reinstall ${module} with Electron flags...`);
            await this.runNpmCommand(npmCommand, ['uninstall', module], pluginPath, pluginName, 60000);
            await this.runNpmCommand(
              npmCommand,
              ['install', module, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`, '--dist-url=https://electronjs.org/headers'],
              pluginPath,
              pluginName,
              180000
            );
            console.log(`[PluginInstaller] Successfully reinstalled ${module} for Electron`);
          } catch (reinstallError) {
            console.error(`[PluginInstaller] All methods failed for ${module}. Plugin may not work correctly.`);
          }
        }
      })
    );
  }

  /**
   * Fallback: Rebuild native modules for current Node.js (non-Electron)
   */
  async rebuildForNode(pluginPath, pluginName, modules) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    // Rebuild all modules in parallel
    await Promise.all(
      modules.map(async (module) => {
        try {
          console.log(`[PluginInstaller] Rebuilding ${module} for Node.js...`);
          await this.runNpmCommand(
            npmCommand,
            ['rebuild', module, `--platform=${process.platform}`, `--arch=${process.arch}`],
            pluginPath,
            pluginName,
            120000
          );
          console.log(`[PluginInstaller] Successfully rebuilt ${module}`);
        } catch (rebuildError) {
          console.warn(`[PluginInstaller] Failed to rebuild ${module}, but continuing...`);
        }
      })
    );
  }

  /**
   * Try alternative installation methods if the primary method fails
   */
  async tryAlternativeInstall(pluginPath, pluginName, originalError) {
    console.log(`[PluginInstaller] Trying alternative installation methods for ${pluginName}...`);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    try {
      // Method 1: Clear npm cache and try again
      console.log(`[PluginInstaller] Clearing npm cache and retrying...`);
      await this.runNpmCommand(npmCommand, ['cache', 'clean', '--force'], pluginPath, pluginName, 60000);
      await this.runNpmCommand(npmCommand, ['install', '--production', '--no-audit', '--no-fund'], pluginPath, pluginName, 300000);

      console.log(`[PluginInstaller] Alternative installation succeeded for ${pluginName}`);
      return;
    } catch (altError) {
      console.error(`[PluginInstaller] Alternative installation also failed for ${pluginName}`);

      // Method 2: Try with --ignore-scripts flag (for problematic native modules)
      try {
        console.log(`[PluginInstaller] Trying installation with --ignore-scripts...`);
        await this.runNpmCommand(npmCommand, ['install', '--production', '--no-audit', '--no-fund', '--ignore-scripts'], pluginPath, pluginName, 300000);

        console.log(`[PluginInstaller] Installation with --ignore-scripts succeeded for ${pluginName}`);
        console.warn(`[PluginInstaller] Note: Native modules may not work properly for ${pluginName}`);
        return;
      } catch (finalError) {
        console.error(`[PluginInstaller] All installation methods failed for ${pluginName}`);
        throw new Error(`Dependency installation failed: ${originalError.message}`);
      }
    }
  }

  /**
   * Convert kebab-case name to Title Case display name
   * e.g., "discord-plugin" -> "Discord Plugin"
   */
  toDisplayName(name) {
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ============================================================================
  // BACKWARD COMPATIBILITY - Keep old method names working
  // ============================================================================

  /**
   * @deprecated Use initializePlugins() instead
   */
  async installAllPlugins() {
    console.log('[PluginInstaller] installAllPlugins() is deprecated, using initializePlugins()');
    return await this.initializePlugins();
  }

  /**
   * @deprecated Use installFromMarketplace() instead
   */
  async installPlugin(pluginName) {
    console.log('[PluginInstaller] installPlugin() is deprecated');
    // Just validate existing plugin, don't try npm install
    const isValid = await this.validatePlugin(pluginName);
    return isValid ? 'valid' : 'invalid';
  }
}

// Export singleton instance
export default new PluginInstaller();
