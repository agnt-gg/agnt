#!/usr/bin/env node

/**
 * Provider Template Generator Script
 *
 * Generates a provider config entry for providerConfigs.js from CLI arguments.
 * After Improvement 3 (declarative registry), adding a new provider only requires
 * adding one config object — this script generates that object.
 *
 * Usage:
 *   node src/services/ai/scripts/generate-provider.js \
 *     --name "DeepInfra" \
 *     --key "deepinfra" \
 *     --url "https://api.deepinfra.com/v1/openai" \
 *     --fallback-models "meta-llama/Meta-Llama-3.1-70B-Instruct,mistralai/Mixtral-8x7B"
 *
 *   # Dry run (shows what would be generated)
 *   node src/services/ai/scripts/generate-provider.js --name "Test" --key "test" --url "http://localhost:8000/v1" --dry-run
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      parsed[key] = value;
    }
  }
  return parsed;
}

function validateInputs(opts) {
  const errors = [];

  if (!opts.name) errors.push('--name is required (e.g., "DeepInfra")');
  if (!opts.key) errors.push('--key is required (e.g., "deepinfra")');
  if (!opts.url) errors.push('--url is required (e.g., "https://api.deepinfra.com/v1/openai")');

  if (opts.url) {
    try {
      new URL(opts.url);
    } catch {
      errors.push(`--url is not a valid URL: ${opts.url}`);
    }
  }

  if (opts.key && !/^[a-z0-9-]+$/.test(opts.key)) {
    errors.push('--key must be lowercase alphanumeric with hyphens only');
  }

  // Check for duplicate keys
  try {
    const configPath = resolve(__dirname, '../providerConfigs.js');
    const configContent = readFileSync(configPath, 'utf-8');
    if (configContent.includes(`key: '${opts.key}'`)) {
      errors.push(`--key "${opts.key}" already exists in providerConfigs.js`);
    }
  } catch {
    // File not found — fine, we'll create it
  }

  return errors;
}

function generateConfig(opts) {
  const fallbackModels = opts['fallback-models']
    ? opts['fallback-models'].split(',').map((m) => m.trim())
    : ['default-model'];

  const supportsStreaming = opts['supports-streaming'] !== 'false';
  const supportsTools = opts['supports-tools'] !== 'false';
  const supportsVision = opts['supports-vision'] === 'true';

  const config = {
    key: opts.key,
    name: opts.name,
    baseURL: opts.url,
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming, supportsTools },
    },
    fallbackModels,
    compat: {},
    sdkOptions: {},
  };

  if (supportsVision) {
    config.capabilities.vision = { supportsStreaming: true };
  }

  return config;
}

function formatConfig(config) {
  const indent = '  ';
  const lines = [];

  lines.push(`${indent}// ─────────────────────────── ${config.name.toUpperCase()} ───────────────────────────`);
  lines.push(`${indent}{`);
  lines.push(`${indent}  key: '${config.key}',`);
  lines.push(`${indent}  name: '${config.name}',`);
  lines.push(`${indent}  baseURL: '${config.baseURL}',`);
  lines.push(`${indent}  sdkType: '${config.sdkType}',`);
  lines.push(`${indent}  authScheme: '${config.authScheme}',`);

  // Capabilities
  lines.push(`${indent}  capabilities: {`);
  lines.push(
    `${indent}    text: { supportsStreaming: ${config.capabilities.text.supportsStreaming}, supportsTools: ${config.capabilities.text.supportsTools} },`,
  );
  if (config.capabilities.vision) {
    lines.push(`${indent}    vision: { supportsStreaming: true },`);
  }
  lines.push(`${indent}  },`);

  // Fallback models
  const modelsStr = config.fallbackModels.map((m) => `'${m}'`).join(', ');
  lines.push(`${indent}  fallbackModels: [${modelsStr}],`);
  lines.push(`${indent}  compat: {},`);
  lines.push(`${indent}  sdkOptions: {},`);
  lines.push(`${indent}},`);

  return lines.join('\n');
}

// ─────────────────────────── MAIN ───────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args.help || Object.keys(args).length === 0) {
  console.log(`
Provider Template Generator
============================

Usage:
  node src/services/ai/scripts/generate-provider.js --name <name> --key <key> --url <baseURL> [options]

Required:
  --name              Provider display name (e.g., "DeepInfra")
  --key               Provider key (e.g., "deepinfra") — lowercase, alphanumeric + hyphens
  --url               Base URL (e.g., "https://api.deepinfra.com/v1/openai")

Optional:
  --fallback-models   Comma-separated fallback model IDs (e.g., "model-a,model-b")
  --supports-streaming true/false (default: true)
  --supports-tools    true/false (default: true)
  --supports-vision   true/false (default: false)
  --dry-run           Show generated config without writing to file
  --help              Show this help message
`);
  process.exit(0);
}

const errors = validateInputs(args);
if (errors.length > 0) {
  console.error('Validation errors:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

const config = generateConfig(args);
const formatted = formatConfig(config);

if (args['dry-run']) {
  console.log('\n--- DRY RUN: Generated provider config ---\n');
  console.log(formatted);
  console.log('\n--- To apply, run again without --dry-run ---\n');
} else {
  console.log('\nGenerated provider config:\n');
  console.log(formatted);
  console.log('\nTo add this provider:');
  console.log('  1. Open backend/src/services/ai/providerConfigs.js');
  console.log('  2. Add the config above to the PROVIDER_CONFIGS array (before the closing ];)');
  console.log('  3. That\'s it! ModelRoutes, LlmService, and ProviderRegistry auto-detect it.');
  console.log('');
}
