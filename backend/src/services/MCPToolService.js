/**
 * MCPToolService
 * --------------
 * Surfaces MCP tools as first-class entries in AGNT's tool registry, the same
 * way native, registry, and plugin tools are exposed. Each MCP tool gets its
 * own schema with a namespaced name (`mcp__<server>__<tool>`) so the chat
 * orchestrator can call it directly — no more 3-step `mcp_client` operation
 * ceremony, no more "operation/action/serverName/toolName/toolArgs" dance.
 *
 * Schema source — disk-backed cache:
 *   Tool schemas (name + description + inputSchema per server) are persisted
 *   at PathManager.getPath('mcp-schema-cache.json') and loaded synchronously
 *   at module import. `build()` returns from the in-memory cache without ever
 *   spawning a server. The chat hot path therefore costs ZERO MCP server
 *   spawns when the LLM doesn't actually invoke any MCP tool — which is the
 *   common case.
 *
 *   The cache is refreshed via `refreshSchemas()`, which is the only method
 *   that calls `tools/list` against the live servers (and therefore spawns
 *   stdio processes / opens HTTP connections). `refreshSchemas()` runs in
 *   exactly three places:
 *     1. Background, after server boot, ONLY when no cache file exists yet.
 *     2. When the user saves an MCP config change (via MCPService → invalidate).
 *     3. When the user clicks "Refresh schemas" / "Test" on the MCP page.
 *
 * Tool execution — fully lazy:
 *   `executeTool()` spawns the relevant server, runs `initialize` + `callTool`,
 *   and closes the connection. One spawn per tool call. We don't pool — by
 *   design — so MCP servers only run when their tools are being used.
 *
 * Why namespaced rather than flat tool names?
 *   - Two MCP servers can legitimately expose tools with the same short name
 *     (`search`, `list`, `read`, etc.) — namespacing keeps them distinct.
 *   - LLM tool selection accuracy improves: `mcp__notion__search_pages` is
 *     more specific than a bare `search_pages` from a registry of 120+ tools.
 *
 * Failure isolation:
 *   - If the disk cache is corrupt, we fall back to an empty surface and log.
 *     Chat keeps working without MCP tools.
 *   - During refresh, per-server failures don't fail the whole refresh —
 *     working servers still surface, dead servers are skipped (and remembered
 *     so we can warn at the UI layer).
 */

import fs from 'fs';
import path from 'path';
import MCPDiscovery from '../tools/library/mcp/MCPDiscovery.js';
import MCPClient from '../tools/library/mcp/MCPClient.js';
import PathManager from '../utils/PathManager.js';

const TOOL_NAME_PREFIX = 'mcp__';
// A healthy already-cached MCP server initializes in <500ms — but `npx -y
// thing@latest` on first run can spend 10-20s downloading the package before
// the actual process even starts. With a short cutoff those slow-first-run
// servers were getting cached with `tools: []`, which is why they showed up
// in the chat selector with no tools while the live MCP page (which bypasses
// the cache and re-spawns) saw them fine. Parallel refresh means the total
// boot wait is capped at the slowest server, not the sum, so we can afford
// to be generous here. Env override available for both.
function resolveTimeoutMs(envName, fallback) {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const INITIALIZE_TIMEOUT_MS = resolveTimeoutMs('MCP_INITIALIZE_TIMEOUT_MS', 30000);
const LIST_TOOLS_TIMEOUT_MS = resolveTimeoutMs('MCP_LIST_TOOLS_TIMEOUT_MS', 30000);

const SCHEMA_CACHE_FILE = PathManager.getPath('mcp-schema-cache.json');
const SCHEMA_CACHE_VERSION = 1;

/**
 * Sanitize a name segment for OpenAI/Anthropic tool-function-name compliance.
 * Most providers require `^[a-zA-Z0-9_-]+$` and ≤64 chars total — we replace
 * anything outside that set with `_` and cap each segment at 50 chars so the
 * combined `mcp__<server>__<tool>` stays under the limit.
 */
function sanitize(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}

function isMCPToolName(name) {
  return typeof name === 'string' && name.startsWith(TOOL_NAME_PREFIX);
}

class MCPToolService {
  constructor() {
    this.discovery = new MCPDiscovery();
    // In-memory cache. Populated synchronously at import time from
    // SCHEMA_CACHE_FILE if it exists, otherwise an empty surface that
    // refreshSchemas() will fill in on first call.
    this._cache = this._readCacheFromDisk() || this._emptyCache();
    // De-duplicates concurrent refreshSchemas() calls.
    this._refreshPromise = null;
  }

  _emptyCache() {
    return {
      schemas: [],
      categories: [],
      byMcpName: new Map(),
      cachedAt: 0,
      hasFile: false,
    };
  }

  /**
   * Read the persisted schema cache. Synchronous so the constructor can
   * populate `_cache` before the first call to `build()` / `getSchemas()`.
   * Returns null if the file is missing or corrupt — caller treats that as
   * "no cache yet, refresh in the background."
   */
  _readCacheFromDisk() {
    try {
      if (!fs.existsSync(SCHEMA_CACHE_FILE)) return null;
      const raw = fs.readFileSync(SCHEMA_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SCHEMA_CACHE_VERSION || !Array.isArray(parsed?.entries)) {
        console.warn('[MCPToolService] Schema cache file present but unreadable; ignoring');
        return null;
      }

      // Reconstruct the {schemas, categories, byMcpName} shape from the
      // serialized per-server entries. We persist per-server because that's
      // the natural unit of refresh — schemas/categories/byMcpName are all
      // derived from it.
      return this._buildCacheFromEntries(parsed.entries, parsed.cachedAt || 0);
    } catch (err) {
      console.warn('[MCPToolService] Failed to read schema cache:', err.message);
      return null;
    }
  }

  /**
   * Take the persisted form (an array of `{ serverConfig, tools }` entries)
   * and produce the in-memory cache shape. Used by both _readCacheFromDisk
   * and refreshSchemas so the disk format and the runtime shape stay in sync.
   */
  _buildCacheFromEntries(entries, cachedAt) {
    const schemas = [];
    const categories = [];
    const byMcpName = new Map();

    for (const entry of entries) {
      const { serverConfig, tools } = entry || {};
      if (!serverConfig) continue;
      const toolList = Array.isArray(tools) ? tools : [];

      const categoryTools = [];
      for (const t of toolList) {
        if (!t || !t.name) continue;
        const mcpName = `${TOOL_NAME_PREFIX}${sanitize(serverConfig.name)}__${sanitize(t.name)}`;
        if (byMcpName.has(mcpName)) continue; // dedupe colliding sanitized names

        const schema = {
          type: 'function',
          function: {
            name: mcpName,
            description: t.description || `MCP tool "${t.name}" from server "${serverConfig.name}".`,
            parameters: t.inputSchema && typeof t.inputSchema === 'object'
              ? t.inputSchema
              : { type: 'object', properties: {} },
          },
        };
        schemas.push(schema);
        categoryTools.push({ name: mcpName, description: schema.function.description });
        byMcpName.set(mcpName, { server: serverConfig, originalToolName: t.name });
      }

      // Emit a category for EVERY configured server, even if it has zero tools,
      // so the chat selector lists it (otherwise servers that failed discovery
      // silently disappear from the UI). Schemas stay filtered — empty
      // categories contribute no tool functions to the LLM toolset.
      const hasTools = categoryTools.length > 0;
      categories.push({
        id: `mcp:${serverConfig.name}`,
        name: serverConfig.name,
        description: hasTools
          ? `${serverConfig.transport} • ${categoryTools.length} tool${categoryTools.length === 1 ? '' : 's'}`
          : `${serverConfig.transport} • no tools discovered`,
        locked: false,
        empty: !hasTools,
        tools: categoryTools,
      });
    }

    return { schemas, categories, byMcpName, cachedAt, hasFile: true };
  }

  /**
   * Persist the cache to disk. Best-effort — failures are logged but don't
   * fail the refresh; the in-memory cache stays valid for the rest of the
   * process lifetime even if the write fails.
   */
  _writeCacheToDisk(entries, cachedAt) {
    try {
      const dir = path.dirname(SCHEMA_CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = {
        version: SCHEMA_CACHE_VERSION,
        cachedAt,
        entries,
      };
      fs.writeFileSync(SCHEMA_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[MCPToolService] Failed to write schema cache:', err.message);
    }
  }

  /**
   * Returns the in-memory cache. NEVER spawns servers. The chat hot path
   * (orchestrator building its tool list) calls this on every request and
   * must remain free of side effects.
   *
   * If the cache hasn't been built yet (first run, no cache file), kick off
   * a background refresh and return the empty surface for now — better to
   * have the first chat after install ship with no MCP tools than to block
   * it on N spawn timeouts.
   */
  async build() {
    if (!this._cache.hasFile && !this._refreshPromise) {
      // Fire-and-forget — we don't await. Chat tool-list building shouldn't
      // block on MCP server discovery.
      this.refreshSchemas().catch((err) => {
        console.warn('[MCPToolService] First-run refresh failed:', err.message);
      });
    }
    return this._cache;
  }

  /**
   * Force a full re-discovery: spawn each configured MCP server, call
   * `tools/list`, write the result to disk. Concurrent callers share the
   * same in-flight promise.
   *
   * Call sites:
   *   - server.js boot path, only when cache file is missing
   *   - MCPService.writeMCPConfig (after the user changes their MCP config)
   *   - MCP page "Refresh" / "Test" buttons (via a dedicated route)
   *
   * Returns the refreshed cache.
   */
  async refreshSchemas() {
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      let servers;
      try {
        servers = await this.discovery.discoverAll();
      } catch (err) {
        console.warn('[MCPToolService] Discovery failed:', err.message);
        // Persist an empty cache so we don't keep retrying the failing
        // discovery on every chat call.
        this._cache = this._buildCacheFromEntries([], Date.now());
        this._writeCacheToDisk([], Date.now());
        return this._cache;
      }

      if (!Array.isArray(servers) || servers.length === 0) {
        this._cache = this._buildCacheFromEntries([], Date.now());
        this._writeCacheToDisk([], Date.now());
        return this._cache;
      }

      // Parallel per-server discovery. One slow/dead server doesn't block
      // the others; per-server failures just produce an empty tool list
      // for that server.
      const perServerResults = await Promise.all(
        servers.map(async (serverConfig) => {
          try {
            const tools = await this._listToolsForServer(serverConfig);
            return { serverConfig, tools };
          } catch (err) {
            console.warn(
              `[MCPToolService] listTools failed for ${serverConfig.name}:`,
              err.message,
            );
            return { serverConfig, tools: [] };
          }
        }),
      );

      const cachedAt = Date.now();
      this._cache = this._buildCacheFromEntries(perServerResults, cachedAt);
      this._writeCacheToDisk(perServerResults, cachedAt);
      console.log(
        `[MCPToolService] Refreshed: ${this._cache.schemas.length} tool schemas across ${this._cache.categories.length} servers`,
      );
      return this._cache;
    })().finally(() => {
      this._refreshPromise = null;
    });

    return this._refreshPromise;
  }

  async _listToolsForServer(serverConfig) {
    const client = this._buildClient(serverConfig);
    try {
      await Promise.race([
        client.initialize(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`initialize timed out after ${INITIALIZE_TIMEOUT_MS}ms`)),
            INITIALIZE_TIMEOUT_MS,
          ),
        ),
      ]);
      const tools = await Promise.race([
        client.listTools(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`listTools timed out after ${LIST_TOOLS_TIMEOUT_MS}ms`)),
            LIST_TOOLS_TIMEOUT_MS,
          ),
        ),
      ]);
      return Array.isArray(tools) ? tools : [];
    } finally {
      await client.close().catch(() => {});
    }
  }

  _buildClient(serverConfig) {
    const opts = {
      transport: serverConfig.transport,
      clientName: 'AGNT-MCP-Client',
      roots: serverConfig.roots || [],
    };
    if (serverConfig.transport === 'http' || serverConfig.transport === 'http-post') {
      opts.transportOptions = {
        endpoint: serverConfig.http?.endpoint,
        headers: serverConfig.http?.headers || {},
      };
    } else if (serverConfig.transport === 'stdio') {
      opts.transportOptions = {
        command: serverConfig.stdio?.command,
        args: serverConfig.stdio?.args || [],
        cwd: serverConfig.stdio?.cwd,
        env: serverConfig.stdio?.env || {},
      };
    } else {
      throw new Error(`Unknown MCP transport: ${serverConfig.transport}`);
    }
    if (serverConfig.timeoutMs != null) {
      opts.transportOptions.requestTimeoutMs = serverConfig.timeoutMs;
    }
    return new MCPClient(opts);
  }

  /** All MCP tool schemas (OpenAI tool-function format). */
  async getSchemas() {
    return (await this.build()).schemas;
  }

  /**
   * UI categories — a SINGLE top-level "MCP" group that contains one
   * subcategory per server. The frontend selector renders subcategories
   * nested so users only see one MCP entry at the top level (preventing
   * the dropdown from being flooded when many servers are configured).
   * Returns `[]` (no top-level category at all) when no servers contributed
   * any tools.
   */
  async getCategories() {
    const built = await this.build();
    const subcategories = built.categories;
    if (!subcategories || subcategories.length === 0) return [];

    let totalTools = 0;
    for (const sc of subcategories) {
      totalTools += (sc.tools || []).length;
    }

    return [
      {
        id: 'mcp',
        name: 'MCP',
        description: `Tools from configured MCP (Model Context Protocol) servers — ${subcategories.length} server${subcategories.length === 1 ? '' : 's'}, ${totalTools} tool${totalTools === 1 ? '' : 's'}.`,
        locked: false,
        tools: [],
        subcategories,
      },
    ];
  }

  /**
   * Resolve a namespaced MCP tool name back to (serverConfig, originalToolName).
   * Returns null if the name isn't a known MCP tool — caller should fall back
   * to native dispatch.
   */
  async resolve(mcpName) {
    if (!isMCPToolName(mcpName)) return null;
    const cache = await this.build();
    return cache.byMcpName.get(mcpName) || null;
  }

  /**
   * Execute an MCP tool by its namespaced name. Connection is short-lived by
   * design — spawn → initialize → callTool → close. We deliberately do NOT
   * pool: an MCP server should only be running while one of its tools is
   * being used. The user's intent is "lazy spawn, no daemons."
   */
  async executeTool(mcpName, args) {
    const resolved = await this.resolve(mcpName);
    if (!resolved) {
      throw new Error(`MCP tool "${mcpName}" not found. The schema cache may be stale — try clicking Refresh on the MCP page.`);
    }
    const { server, originalToolName } = resolved;
    const client = this._buildClient(server);
    try {
      await client.initialize();
      const result = await client.callTool(originalToolName, args || {});
      return result;
    } finally {
      await client.close().catch(() => {});
    }
  }

  /**
   * Trigger a fresh discovery on the next opportunity. Called from the MCP
   * config writer (MCPService) so a user adding/editing/removing a server
   * sees the change reflected the next time they look at the tool selector.
   *
   * Runs the refresh in the background — callers don't await. The currently-
   * cached schemas remain visible until the refresh completes; only after
   * a successful refresh does `_cache` flip to the new surface.
   */
  invalidate() {
    console.log('[MCPToolService] Cache invalidated — refreshing in background');
    this.refreshSchemas().catch((err) => {
      console.warn('[MCPToolService] Background refresh after invalidate failed:', err.message);
    });
  }
}

const instance = new MCPToolService();

export default instance;
export { isMCPToolName, TOOL_NAME_PREFIX };
