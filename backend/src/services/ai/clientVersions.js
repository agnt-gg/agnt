/**
 * clientVersions.js — single source of truth for upstream CLI version strings
 *
 * AGNT's CLI-subscription providers (Claude Code, OpenAI Codex, Kimi Code) gate
 * access based on the client version in either a header or query param. Those
 * versions drift — real CLIs ship new releases constantly, and stale spoofs
 * cause rejections or silently hide new models.
 *
 * This module resolves each provider's current version from its authoritative
 * registry (npm for Claude Code + Codex, PyPI for Kimi CLI) and caches the
 * result to disk for 7 days. Call sites import `getClientIdentity(key)` to get
 * a formatted header-ready string, or `getClientVersion(key)` for the raw
 * version. If the network is unavailable, the module falls back through:
 *   (1) fresh in-memory value → (2) stale on-disk value → (3) last-known-good
 *   fallback baked into SOURCES.
 */

import fs from 'fs';
import path from 'path';
import pathManager from '../../utils/PathManager.js';

// Client-version cache is a small (~1 KB) JSON file. Lives at the rootDir
// (parent on Electron, collapsed elsewhere) so it sits alongside other
// config-style files like mcp.json. See PRD-060 for resolver semantics.
const CACHE_FILE = pathManager.getPath('client-versions.json');
const CACHE_DIR = path.dirname(CACHE_FILE);
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 5000;

/**
 * Each entry describes how to discover and format one client's version.
 * `fallback` is the value used when the network and disk cache both fail —
 * bump it occasionally as the real CLIs move so first-run users aren't stuck
 * on something ancient.
 */
const SOURCES = {
  'claude-code': {
    label: 'Claude Code CLI',
    registry: 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest',
    extract: (json) => json?.version,
    format: (v) => `claude-cli/${v} (external, cli)`,
    fallback: '2.1.2',
  },
  'openai-codex': {
    label: 'OpenAI Codex CLI',
    registry: 'https://registry.npmjs.org/@openai/codex/latest',
    extract: (json) => json?.version,
    format: (v) => v,
    fallback: '0.124.0',
  },
  'kimi-code': {
    label: 'Kimi CLI',
    registry: 'https://pypi.org/pypi/kimi-cli/json',
    extract: (json) => json?.info?.version,
    format: (v) => `KimiCLI/${v}`,
    fallback: '1.38.0',
  },
};

// In-memory cache: { [key]: { version, timestamp, source: 'registry'|'disk'|'fallback' } }
let memoryCache = null;
let diskHydrated = false;
// Track in-flight refreshes so concurrent callers don't all hit the registry.
const inflight = new Map();

function hydrateFromDisk() {
  if (diskHydrated) return;
  diskHydrated = true;
  memoryCache = memoryCache || {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v.version === 'string' && typeof v.timestamp === 'number') {
            memoryCache[k] = { ...v, source: 'disk' };
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[clientVersions] failed to hydrate disk cache: ${err.message}`);
  }
}

function persistToDisk() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const serializable = {};
    for (const [k, v] of Object.entries(memoryCache || {})) {
      serializable[k] = { version: v.version, timestamp: v.timestamp };
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serializable, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[clientVersions] failed to persist cache: ${err.message}`);
  }
}

async function fetchFromRegistry(key, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(config.registry, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const version = config.extract(json);
    if (!version || typeof version !== 'string') {
      throw new Error('registry response missing version field');
    }
    return version;
  } finally {
    clearTimeout(timer);
  }
}

function setEntry(key, version, source) {
  memoryCache = memoryCache || {};
  memoryCache[key] = { version, timestamp: Date.now(), source };
  persistToDisk();
}

function isFresh(entry) {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Returns the raw version string for the given provider client.
 * Never throws — degrades through cache → fallback.
 */
export async function getClientVersion(key) {
  const config = SOURCES[key];
  if (!config) throw new Error(`Unknown client-version provider: ${key}`);

  hydrateFromDisk();
  const cached = memoryCache[key];

  // Fresh cache → return immediately, no network.
  if (isFresh(cached)) return cached.version;

  // Stale or missing → dedupe concurrent refreshes.
  if (!inflight.has(key)) {
    inflight.set(
      key,
      fetchFromRegistry(key, config)
        .then((v) => {
          setEntry(key, v, 'registry');
          return v;
        })
        .catch((err) => {
          console.warn(`[clientVersions] ${config.label} refresh failed: ${err.message}`);
          return null;
        })
        .finally(() => inflight.delete(key))
    );
  }

  const fetched = await inflight.get(key);
  if (fetched) return fetched;

  // Registry fetch failed. Prefer the stale disk value over the hardcoded
  // fallback — it's more recent even if expired.
  if (cached?.version) return cached.version;

  setEntry(key, config.fallback, 'fallback');
  return config.fallback;
}

/**
 * Returns a formatted identity string ready for a header or query param.
 * E.g. for claude-code returns "claude-cli/2.1.2 (external, cli)".
 */
export async function getClientIdentity(key) {
  const config = SOURCES[key];
  if (!config) throw new Error(`Unknown client-version provider: ${key}`);
  const version = await getClientVersion(key);
  return config.format(version);
}

/**
 * Fire-and-forget warmup for boot. Never blocks; never throws.
 * Runs all providers in parallel so the first user request has warm values.
 */
export function warmupClientVersions() {
  for (const key of Object.keys(SOURCES)) {
    getClientVersion(key).catch(() => {});
  }
}

/**
 * Force a registry re-fetch for one or all providers. Used by the admin
 * refresh endpoint. Returns the updated map.
 */
export async function refreshClientVersions(keys = null) {
  hydrateFromDisk();
  const targets = keys && keys.length ? keys : Object.keys(SOURCES);
  const results = {};
  await Promise.all(
    targets.map(async (key) => {
      const config = SOURCES[key];
      if (!config) {
        results[key] = { error: 'unknown key' };
        return;
      }
      try {
        const version = await fetchFromRegistry(key, config);
        setEntry(key, version, 'registry');
        results[key] = { version, identity: config.format(version), source: 'registry' };
      } catch (err) {
        const cached = memoryCache?.[key];
        results[key] = {
          version: cached?.version || config.fallback,
          identity: config.format(cached?.version || config.fallback),
          source: cached?.version ? 'disk' : 'fallback',
          error: err.message,
        };
      }
    })
  );
  return results;
}

/**
 * Snapshot of current cache state, for the admin status endpoint.
 */
export function inspectClientVersions() {
  hydrateFromDisk();
  const out = {};
  for (const [key, config] of Object.entries(SOURCES)) {
    const cached = memoryCache?.[key];
    out[key] = {
      label: config.label,
      registry: config.registry,
      fallback: config.fallback,
      cached: cached
        ? {
            version: cached.version,
            identity: config.format(cached.version),
            age_ms: Date.now() - cached.timestamp,
            source: cached.source,
            fresh: isFresh(cached),
          }
        : null,
    };
  }
  return out;
}
