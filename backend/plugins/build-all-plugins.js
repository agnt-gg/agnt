#!/usr/bin/env node

/**
 * AGNT Build All Plugins Script
 *
 * Builds all plugins in the dev/ folder to .agnt packages.
 * Each plugin gets its dependencies installed and packaged with node_modules.
 *
 * Usage:
 *   node build-all-plugins.js
 *
 * Output:
 *   plugin-builds/<plugin-name>.agnt for each plugin
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGINS_DIR = path.join(__dirname, 'dev');
const BUILD_SCRIPT = path.join(__dirname, 'build-plugin.js');

async function buildAllPlugins() {
  console.log(`\n🔧 AGNT Build All Plugins\n`);
  console.log(`📁 Source: ${PLUGINS_DIR}`);
  console.log(`📜 Build script: ${BUILD_SCRIPT}\n`);

  // Check if dev directory exists
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.error(`❌ Plugins directory not found: ${PLUGINS_DIR}`);
    process.exit(1);
  }

  // Get all plugin directories
  const plugins = fs.readdirSync(PLUGINS_DIR).filter((item) => {
    const itemPath = path.join(PLUGINS_DIR, item);
    const isDirectory = fs.statSync(itemPath).isDirectory();
    const hasManifest = fs.existsSync(path.join(itemPath, 'manifest.json'));
    return isDirectory && hasManifest;
  });

  if (plugins.length === 0) {
    console.error(`❌ No plugins found in ${PLUGINS_DIR}`);
    console.error(`   Plugins must have a manifest.json file`);
    process.exit(1);
  }

  console.log(`📦 Found ${plugins.length} plugins to build:\n`);
  plugins.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
  console.log(`\n${'='.repeat(60)}\n`);

  const results = {
    success: [],
    failed: [],
  };

  for (let i = 0; i < plugins.length; i++) {
    const pluginName = plugins[i];
    const progress = `[${i + 1}/${plugins.length}]`;

    console.log(`${progress} Building ${pluginName}...`);

    try {
      execSync(`node "${BUILD_SCRIPT}" ${pluginName}`, {
        cwd: __dirname,
        stdio: 'inherit',
      });
      results.success.push(pluginName);
    } catch (error) {
      console.error(`\n❌ Failed to build ${pluginName}: ${error.message}\n`);
      results.failed.push(pluginName);
    }

    console.log(`\n${'='.repeat(60)}\n`);
  }

  // Summary
  console.log(`\n📊 BUILD SUMMARY\n`);
  console.log(`✅ Successful: ${results.success.length}`);
  results.success.forEach((p) => console.log(`   - ${p}`));

  if (results.failed.length > 0) {
    console.log(`\n❌ Failed: ${results.failed.length}`);
    results.failed.forEach((p) => console.log(`   - ${p}`));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n🎉 Build complete! ${results.success.length}/${plugins.length} plugins built successfully.\n`);

  if (results.failed.length > 0) {
    process.exit(1);
  }
}

buildAllPlugins();
