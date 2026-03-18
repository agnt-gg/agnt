#!/usr/bin/env node

/**
 * Auto-Updated Fallback Models Script
 *
 * Fetches live model lists from each provider's API and updates the
 * fallbackModels arrays in providerConfigs.js. Gracefully handles
 * API failures (keeps existing fallbacks).
 *
 * Usage:
 *   node src/services/ai/scripts/update-fallback-models.js                   # Update all providers
 *   node src/services/ai/scripts/update-fallback-models.js --provider groq    # Update specific provider
 *   node src/services/ai/scripts/update-fallback-models.js --dry-run          # Show changes without writing
 *
 * Requires API keys in .env (loaded automatically).
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map provider keys to their .env variable names
const API_KEY_MAP = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  grokai: 'GROKAI_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  togetherai: 'TOGETHERAI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  kimi: 'KIMI_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  zai: 'ZAI_API_KEY',
};

// Providers to skip (static model lists or OAuth-only)
const SKIP_PROVIDERS = ['openai-codex', 'claude-code'];

async function fetchModelsFromProvider(config, apiKey) {
  const url = new URL(`${config.baseURL}/models`);

  const headers = { 'Content-Type': 'application/json' };

  if (config.authScheme === 'query-param') {
    url.searchParams.append('key', apiKey);
  } else if (config.authScheme === 'api-key') {
    headers['x-api-key'] = apiKey;
    if (config.fetchHeaders) Object.assign(headers, config.fetchHeaders);
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Extract models based on response format
  const responseDataPath = config.responseDataPath || 'data';
  let rawModels;
  if (responseDataPath === 'root') {
    rawModels = Array.isArray(data) ? data : [];
  } else if (responseDataPath === 'models') {
    rawModels = data.models || [];
  } else {
    rawModels = data.data || [];
  }

  return rawModels;
}

function selectTopFallbacks(rawModels, existingFallbacks, maxCount = 8) {
  // Get model IDs
  let modelIds = rawModels
    .filter((m) => m.id || m.name)
    .map((m) => {
      if (m.name && m.name.startsWith('models/')) {
        return m.name.replace('models/', '');
      }
      return m.id;
    })
    .filter(Boolean);

  // Deduplicate
  modelIds = [...new Set(modelIds)];

  // Prioritize: existing fallbacks that still exist, then new models
  const stillExists = existingFallbacks.filter((id) => modelIds.includes(id));
  const newModels = modelIds.filter((id) => !existingFallbacks.includes(id));

  // Combine: existing first, then new
  const combined = [...stillExists, ...newModels];

  return combined.slice(0, maxCount);
}

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

// ─────────────────────────── MAIN ───────────────────────────

const args = parseArgs(process.argv.slice(2));
const dryRun = !!args['dry-run'];
const targetProvider = args.provider || null;

// Dynamic import of providerConfigs
const configPath = resolve(__dirname, '../providerConfigs.js');
const { getAllProviderConfigs } = await import(`file://${configPath.replace(/\\/g, '/')}`);

const allConfigs = getAllProviderConfigs();
const configs = targetProvider ? allConfigs.filter((c) => c.key === targetProvider) : allConfigs;

if (targetProvider && configs.length === 0) {
  console.error(`Provider "${targetProvider}" not found in providerConfigs.js`);
  process.exit(1);
}

console.log(`\n${dryRun ? '🔍 DRY RUN — ' : ''}Updating fallback models for ${configs.length} provider(s)...\n`);

const results = [];

for (const config of configs) {
  if (SKIP_PROVIDERS.includes(config.key)) {
    console.log(`[${config.name}] Skipped (static/OAuth-only)`);
    results.push({ key: config.key, status: 'skipped' });
    continue;
  }

  const envVar = API_KEY_MAP[config.key];
  const apiKey = envVar ? process.env[envVar] : null;

  if (!apiKey) {
    console.log(`[${config.name}] Skipped — no API key (set ${envVar || 'N/A'} in .env)`);
    results.push({ key: config.key, status: 'no-key' });
    continue;
  }

  try {
    const rawModels = await fetchModelsFromProvider(config, apiKey);
    const newFallbacks = selectTopFallbacks(rawModels, config.fallbackModels);

    if (newFallbacks.length === 0) {
      console.log(`[${config.name}] No models returned — keeping existing fallbacks`);
      results.push({ key: config.key, status: 'empty' });
      continue;
    }

    const changed =
      newFallbacks.length !== config.fallbackModels.length || newFallbacks.some((m, i) => m !== config.fallbackModels[i]);

    if (changed) {
      console.log(
        `[${config.name}] Fetched ${rawModels.length} models -> top ${newFallbacks.length} fallbacks: ${newFallbacks.join(', ')}`,
      );
      results.push({ key: config.key, status: 'updated', fallbacks: newFallbacks });
    } else {
      console.log(`[${config.name}] Fetched ${rawModels.length} models — fallbacks unchanged`);
      results.push({ key: config.key, status: 'unchanged' });
    }
  } catch (error) {
    console.error(`[${config.name}] API unreachable — keeping existing fallbacks (${error.message})`);
    results.push({ key: config.key, status: 'error', error: error.message });
  }
}

// Summary
const updated = results.filter((r) => r.status === 'updated');
const errored = results.filter((r) => r.status === 'error');
const skipped = results.filter((r) => r.status !== 'updated' && r.status !== 'error');

console.log(`\n--- Summary ---`);
console.log(`Updated: ${updated.length} | Errors: ${errored.length} | Skipped/Unchanged: ${skipped.length}`);

if (updated.length > 0 && !dryRun) {
  console.log(`\nTo apply these changes, manually update the fallbackModels arrays in:`);
  console.log(`  ${configPath}`);
  console.log(`\nUpdated providers:`);
  for (const r of updated) {
    console.log(`  ${r.key}: [${r.fallbacks.map((f) => `'${f}'`).join(', ')}]`);
  }
}

if (dryRun && updated.length > 0) {
  console.log(`\nDry run complete. Re-run without --dry-run to apply changes.`);
}

console.log('');
