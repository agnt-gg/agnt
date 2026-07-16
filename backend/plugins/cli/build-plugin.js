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
 *   node cli/build-plugin.js <plugin-name>      # a folder name inside ./dev (bundled-plugin / contributor path)
 *   node cli/build-plugin.js <path-to-folder>   # any folder on disk (your own plugin — no repo changes needed)
 *
 * Examples:
 *   node cli/build-plugin.js discord-plugin             # → ./dev/discord-plugin
 *   node cli/build-plugin.js ./dev/discord-plugin       # explicit relative path
 *   node cli/build-plugin.js ~/my-weather-plugin        # a folder anywhere on disk
 *   node cli/build-plugin.js /abs/path/to/my-plugin     # absolute path
 *
 * Output:
 *   plugin-builds/<name>.agnt   (<name> is taken from the manifest "name", falling back to the folder name)
 *
 * Note: .agnt files are gzipped tar archives (same as .tar.gz) with a custom extension
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import tar from 'tar';
import {
  validateManifestAssets,
  scanCapabilities,
  diffCapabilities,
  normalizePermissions,
  computeIntegrity,
  verifyArchive,
} from '../lib/validate-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGINS_DIR = path.join(__dirname, '../dev');
const DIST_DIR = path.join(__dirname, '../plugin-builds');

/**
 * Resolve the build argument to an absolute plugin folder.
 *
 * Backward-compatible: a bare name like "discord-plugin" still resolves to
 * ./dev/discord-plugin. But the argument may ALSO be a path to a plugin folder
 * anywhere on disk — so authors can build their own plugins without placing the
 * source inside this repo (see START-HERE-PLUGINS.md).
 *
 * An argument is treated as a literal path (not a dev/ name) when it:
 *   - is absolute, or
 *   - contains a path separator (/ or \), or
 *   - starts with "." (./ or ../), or
 *   - starts with "~" (home expansion).
 * Otherwise it is treated as a folder name inside ./dev.
 *
 * As a final fallback, if ./dev/<arg> does not exist but <arg> resolved against
 * the current working directory does (and has a manifest.json), the cwd-relative
 * folder wins — so `node cli/build-plugin.js my-plugin` also works when run from a
 * directory that directly contains my-plugin/.
 */
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolvePluginPath(arg) {
  const expanded = expandHome(arg);
  const looksLikePath =
    path.isAbsolute(expanded) ||
    expanded.includes('/') ||
    expanded.includes('\\') ||
    expanded.startsWith('.');

  if (looksLikePath) {
    return path.resolve(expanded);
  }

  // Bare name: prefer ./dev/<name> (original behavior).
  const devPath = path.join(PLUGINS_DIR, expanded);
  if (fs.existsSync(path.join(devPath, 'manifest.json'))) {
    return devPath;
  }

  // Fallback: a folder of that name directly under the current working dir.
  const cwdPath = path.resolve(process.cwd(), expanded);
  if (fs.existsSync(path.join(cwdPath, 'manifest.json'))) {
    return cwdPath;
  }

  // Default to the dev path so the existing "not found + list dev/" error fires.
  return devPath;
}

async function buildPlugin(arg) {
  const pluginPath = resolvePluginPath(arg);
  const manifestPath = path.join(pluginPath, 'manifest.json');
  const packageJsonPath = path.join(pluginPath, 'package.json');
  const nodeModulesPath = path.join(pluginPath, 'node_modules');

  console.log(`\n🔧 Building plugin from: ${pluginPath}\n`);

  // Validate plugin exists
  if (!fs.existsSync(pluginPath)) {
    console.error(`❌ Plugin folder not found: ${pluginPath}`);
    console.error(`\nPass a folder name inside ./dev, or a path to a plugin folder anywhere on disk.`);
    if (fs.existsSync(PLUGINS_DIR)) {
      console.error(`\nAvailable plugins in ./dev:`);
      const plugins = fs.readdirSync(PLUGINS_DIR).filter((f) => fs.statSync(path.join(PLUGINS_DIR, f)).isDirectory());
      plugins.forEach((p) => console.error(`  - ${p}`));
    }
    process.exit(1);
  }

  // Validate manifest.json exists
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ manifest.json not found in ${pluginPath}`);
    process.exit(1);
  }

  // Read manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));  // Output name comes from the manifest "name" (preferred) or the folder name —
  // NOT the raw CLI argument, which may be an absolute path.
  const pluginName = (manifest.name && String(manifest.name).trim()) || path.basename(pluginPath);
  const isOfficialSource = path.dirname(pluginPath) === path.resolve(PLUGINS_DIR);

  console.log(`📦 Plugin: ${manifest.name} v${manifest.version}`);
  console.log(`📝 Description: ${manifest.description || 'No description'}`);
  console.log(`🔧 Tools: ${manifest.tools?.map((t) => t.type).join(', ') || 'None'}`);

  // trust system: validation now lives in the shared core
  // (validate-core.js) — the exact tool/asset checks previously inlined here.
  // The installer's staged-install path and the future doctor/publish gate
  // call the SAME code (the "one core, many callers" rule).
  const report = await validateManifestAssets(pluginPath);
  for (const w of report.warnings) console.warn(`⚠️  ${w}`);
  if (!report.valid) {
    for (const e of report.errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
  for (const kind of ['agents', 'workflows', 'skills', 'widgets']) {
    const arr = manifest[kind];
    if (Array.isArray(arr) && arr.length > 0) {
      console.log(`📦 ${kind[0].toUpperCase() + kind.slice(1)}: ${arr.map((e) => e.slug).join(', ')}`);
    }
  }

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
  }  // trust system Layer 1: deterministic capability scan. Official bundled
  // sources fail closed; external/community sources remain warn-grade during
  // the compatibility window.
  console.log(`\n🔍 Scanning capabilities (first-party source only)...`);
  const scan = await scanCapabilities(pluginPath);
  const detected = Object.keys(scan.capabilities);
  const declared = normalizePermissions(manifest.permissions);
  const capDiff = diffCapabilities(manifest.permissions, scan.capabilities);
  const hasStructuredPermissions =
    manifest.permissions &&
    !Array.isArray(manifest.permissions) &&
    Array.isArray(manifest.permissions.capabilities) &&
    Array.isArray(manifest.permissions.domains);
  console.log(`   Detected: ${detected.length ? detected.join(', ') : '(none)'}`);
  console.log(`   Declared: ${declared.length ? declared.join(', ') : '(none)'}`);
  if (!hasStructuredPermissions) {
    const message = 'manifest.json must contain structured permissions.capabilities and permissions.domains arrays';
    if (isOfficialSource) {
      console.error(`❌ Official plugin disclosure gate: ${message}`);
      process.exit(1);
    }
    console.warn(`⚠️  ${message}`);
  }
  if (capDiff.undeclared.length > 0) {
    const log = isOfficialSource ? console.error : console.warn;
    log(`${isOfficialSource ? '❌ Official plugin disclosure gate' : '⚠️  Undeclared capabilities'}:`);
    for (const cap of capDiff.undeclared) {
      const first = scan.capabilities[cap][0];
      log(`     - ${cap}  (e.g. ${first.file}:${first.line})`);
    }
    if (isOfficialSource) process.exit(1);
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

    // trust system: verify the produced archive is readable and self-consistent,
    // then print its SRI integrity hash (what stamp-integrity.js records).
    console.log(`\n🔍 Verifying package contents...`);
    const archiveReport = await verifyArchive(outputFile);
    if (!archiveReport.valid) {
      console.error(`❌ Post-build archive verification failed: ${archiveReport.error}`);
      process.exit(1);
    }
    console.log(`   ${archiveReport.entries.length} files/directories included`);
    const integrity = await computeIntegrity(outputFile);
    console.log(`🔐 Integrity (SRI): ${integrity}`);
    console.log(`   (bundled catalog: copy the .agnt into marketplace-default/ then run cli/stamp-integrity.js)`);

    // trust system W2: optional signing (node cli/sign-plugin.js --keygen first)
    if (process.argv.includes('--sign')) {
      try {
        const { loadOrExplainKey, signBuffer } = await import('./sign-plugin.js');
        const os = await import('os');
        const keyPath =
          process.env.USER_DATA_PATH
            ? path.join(process.env.USER_DATA_PATH, 'publisher-key.json')
            : path.join(process.env.APPDATA || os.homedir(), 'AGNT', 'publisher-key.json');
        const key = loadOrExplainKey(keyPath);
        if (!key) {
          console.warn(`⚠️  --sign requested but no key at ${keyPath}. Run: node cli/sign-plugin.js --keygen`);
        } else {
          const signature = signBuffer(fs.readFileSync(outputFile), key.privateKey);
          console.log(`✍️  Signature (Ed25519): ${signature}`);
          console.log(`   Include in publish payload asset_data: { "signature": "...", "publisherKeyId": "<registered key id>" }`);
        }
      } catch (signErr) {
        console.warn(`⚠️  Signing failed (build still OK): ${signErr.message}`);
      }
    }

    // trust system W3: OPT-IN provenance workflow scaffold (--scaffold). Never
    // writes into the author's source dir by default — the default build
    // must not touch the user's files or change their process in any way.
    if (process.argv.includes('--scaffold')) {
      try {
        const wfDir = path.join(pluginPath, '.github', 'workflows');
        const wfFile = path.join(wfDir, 'publish-plugin.yml');
        const template = path.join(__dirname, 'templates', 'publish-plugin.yml');
        if (!fs.existsSync(wfFile) && fs.existsSync(template)) {
          fs.mkdirSync(wfDir, { recursive: true });
          fs.copyFileSync(template, wfFile);
          console.log(`🤖 Scaffolded provenance workflow → .github/workflows/publish-plugin.yml`);
        }
      } catch (scErr) {
        console.warn(`⚠️  Workflow scaffold failed (build still OK): ${scErr.message}`);
      }
    }

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
  node cli/build-plugin.js <plugin-name>      # a folder inside ./dev (bundled-plugin / contributor path)
  node cli/build-plugin.js <path-to-folder>   # any folder on disk (your own plugin — no repo changes needed)

Examples:
  node cli/build-plugin.js discord-plugin
  node cli/build-plugin.js ./dev/discord-plugin
  node cli/build-plugin.js ~/my-weather-plugin
  node cli/build-plugin.js /abs/path/to/my-plugin

Available plugins in ./dev:`);

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
