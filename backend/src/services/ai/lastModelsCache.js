/**
 * lastModelsCache.js — persistent last-successful model lists, all providers.
 *
 * Whenever an upstream models fetch succeeds we persist the mapped model list
 * to disk so a later degraded state (upstream 5xx, network out, auth blip)
 * can still show the currently-shipping models instead of collapsing to the
 * hardcoded fallback lists in providerConfigs.js — which inevitably drift out
 * of date the day a new model family ships.
 *
 * Design:
 *   - One JSON file (`last-models.json`, ~2 KB per provider) at the same
 *     rootDir as client-versions.json (see PathManager / PRD-060).
 *   - No TTL. The persisted list is never authoritative — it's only read when
 *     a live fetch fails AND the in-memory cache is empty. A fresh live fetch
 *     always supersedes it.
 *   - Keys are lowercase provider keys ('openai', 'openai-codex', 'gemini'…).
 *   - Write failures are non-fatal (log + continue); a read failure just
 *     means we fall back to the hardcoded lists, same as before this existed.
 */

import fs from 'fs';
import path from 'path';
import pathManager from '../../utils/PathManager.js';

const CACHE_FILE = pathManager.getPath('last-models.json');

let memoryCache = null;

function load() {
  if (memoryCache) return memoryCache;
  try {
    memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

/**
 * Persist a successful model fetch for a provider.
 * @param {string} providerKey - lowercase provider key (e.g. 'openai-codex')
 * @param {Array<Object>} models - mapped model objects ({ id, name, ... })
 */
export function persistLastModels(providerKey, models) {
  if (!providerKey || !Array.isArray(models) || models.length === 0) return;
  const cache = load();
  cache[String(providerKey).toLowerCase()] = { models, timestamp: Date.now() };
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn(`[lastModelsCache] Failed to persist for ${providerKey}: ${err.message}`);
  }
}

/**
 * Get the last successfully-fetched model list for a provider, or null.
 * @param {string} providerKey - lowercase provider key
 * @returns {Array<Object>|null}
 */
export function getLastSuccessfulModels(providerKey) {
  const entry = load()[String(providerKey || '').toLowerCase()];
  return entry && Array.isArray(entry.models) && entry.models.length > 0 ? entry.models : null;
}
