#!/usr/bin/env node

/**
 * AGNT Plugin Build Script
 *
 * Builds complete plugins WITH node_modules included.
 * This ensures plugins work immediately without requiring npm on the user's machine.
 *
 * Build process:
 * 1. Validates plugin structure and manifest
 * 2. Runs npm install if dependencies exist and node_modules is missing
 * 3. Creates a .agnt package with source code AND node_modules
 *
 * Usage:
 *   node build-plugin.js <plugin-name>
 *   node build-plugin.js discord-plugin
 *
 * Output:
 *   plugin-builds/<plugin-name>.agnt
 *
 * Note: .agnt files are gzipped tar archives (same as .tar.gz) with a custom extension
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import tar from 'tar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGINS_DIR = path.join(__dirname, 'dev');
const DIST_DIR = path.join(__dirname, 'plugin-builds');

async function buildPlugin(pluginName) {
  console.log(`\n🔧 Building plugin: ${pluginName}\n`);

  const pluginPath = path.join(PLUGINS_DIR, pluginName);
  const manifestPath = path.join(pluginPath, 'manifest.json');
  const packageJsonPath = path.join(pluginPath, 'package.json');
  const nodeModulesPath = path.join(pluginPath, 'node_modules');

  // Validate plugin exists
  if (!fs.existsSync(pluginPath)) {
    console.error(`❌ Plugin not found: ${pluginPath}`);
    console.error(`\nAvailable plugins:`);
    const plugins = fs.readdirSync(PLUGINS_DIR).filter((f) => fs.statSync(path.join(PLUGINS_DIR, f)).isDirectory());
    plugins.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  // Validate manifest.json exists
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ manifest.json not found in ${pluginPath}`);
    process.exit(1);
  }

  // Read manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`📦 Plugin: ${manifest.name} v${manifest.version}`);
  console.log(`📝 Description: ${manifest.description || 'No description'}`);
  console.log(`🔧 Tools: ${manifest.tools?.map((t) => t.type).join(', ') || 'None'}`);

  // Check if package.json exists (has dependencies)
  let hasDependencies = false;
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Auto-fix: ensure type: "module" is set for ES6 imports
    if (!packageJson.type || packageJson.type !== 'module') {
      packageJson.type = 'module';
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log(`✅ Auto-fixed: Added "type": "module" to package.json`);
    }

    hasDependencies = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;

    if (hasDependencies) {
      console.log(`\n📦 Plugin has dependencies:`);
      console.log(`   ${Object.keys(packageJson.dependencies).join(', ')}`);

      // Install dependencies if node_modules doesn't exist or is empty
      const nodeModulesExists = fs.existsSync(nodeModulesPath);
      const nodeModulesEmpty = nodeModulesExists && fs.readdirSync(nodeModulesPath).length === 0;

      if (!nodeModulesExists || nodeModulesEmpty) {
        console.log(`\n📥 Installing dependencies...`);
        try {
          execSync('npm install --production', {
            cwd: pluginPath,
            stdio: 'inherit',
          });
          console.log(`✅ Dependencies installed`);
        } catch (error) {
          console.error(`❌ Failed to install dependencies:`, error.message);
          process.exit(1);
        }
      } else {
        console.log(`✅ node_modules already exists`);
      }
    } else {
      console.log(`\n📦 No dependencies declared`);
    }
  }

  // Create dist directory
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Get list of files to include
  const filesToInclude = [];

  // Always include manifest.json
  filesToInclude.push('manifest.json');

  // Include package.json if exists
  if (fs.existsSync(packageJsonPath)) {
    filesToInclude.push('package.json');
  }

  // Include all files and directories INCLUDING node_modules
  const allItems = fs.readdirSync(pluginPath).filter((item) => {
    const isManifest = item === 'manifest.json';
    const isPackageJson = item === 'package.json';
    const isNpmCache = item === '.npm-cache';
    const isGitDir = item === '.git';
    const isDSStore = item === '.DS_Store';
    const isPackageLock = item === 'package-lock.json';

    // Skip these files/directories (but NOT node_modules)
    if (isManifest || isPackageJson || isNpmCache || isGitDir || isDSStore || isPackageLock) {
      return false;
    }

    return true;
  });
  filesToInclude.push(...allItems);

  console.log(`\n📁 Files to include:`);
  filesToInclude.forEach((f) => {
    if (f === 'node_modules') {
      const nmCount = fs.readdirSync(path.join(pluginPath, 'node_modules')).length;
      console.log(`  - ${f}/ (${nmCount} packages)`);
    } else {
      console.log(`  - ${f}`);
    }
  });

  // Create .agnt package (gzipped tar with custom extension)
  const outputFile = path.join(DIST_DIR, `${pluginName}.agnt`);
  console.log(`\n📦 Creating package: ${outputFile}`);

  try {
    await tar.create(
      {
        gzip: true,
        file: outputFile,
        cwd: pluginPath,
        prefix: pluginName,
      },
      filesToInclude
    );

    // Get file size
    const stats = fs.statSync(outputFile);
    const sizeKB = (stats.size / 1024).toFixed(1);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const sizeDisplay = stats.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

    console.log(`\n✅ Build complete!`);
    console.log(`📦 Output: ${outputFile}`);
    console.log(`📊 Size: ${sizeDisplay}`);

    // Verify the package
    console.log(`\n🔍 Verifying package contents...`);
    const contents = [];
    await tar.list({
      file: outputFile,
      onentry: (entry) => contents.push(entry.path),
    });
    console.log(`   ${contents.length} files/directories included`);

    console.log(`\n🚀 Ready for distribution!`);
    console.log(`   Upload to: https://agnt.gg/api/plugins/publish`);
    console.log(`   Or share the .agnt file directly\n`);
  } catch (error) {
    console.error(`❌ Failed to create package:`, error.message);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
AGNT Plugin Build Script

Usage:
  node build-plugin.js <plugin-name>

Examples:
  node build-plugin.js discord-plugin
  node build-plugin.js stripe-plugin

Available plugins:`);

  if (fs.existsSync(PLUGINS_DIR)) {
    const plugins = fs.readdirSync(PLUGINS_DIR).filter((f) => {
      const stat = fs.statSync(path.join(PLUGINS_DIR, f));
      return stat.isDirectory();
    });
    plugins.forEach((p) => console.log(`  - ${p}`));
  }
  process.exit(0);
}

buildPlugin(args[0]);
