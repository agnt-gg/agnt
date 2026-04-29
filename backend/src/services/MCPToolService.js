/**
 * MCPToolService
 * --------------
 * Surfaces MCP tools as first-class entries in AGNT's tool registry, the same
 * way native, registry, and plugin tools are exposed. Each MCP tool gets its
 * own schema with a namespaced name (`mcp__<server>__<tool>`) so the chat
 * orchestrator can call it directly — no more 3-step `mcp_client` operation
 * ceremony, no more "operation/action/serverName/toolName/toolArgs" dance.
 *
 * Pipeline:
 *   1. discoverAll() — merge servers from every config source
 *      (env, AGNT user-data mcp.json, ./mcp.json, ~/.config/mcp/mcp.json,
 *      VSCode workspace, MCP_SERVERS env, .well-known endpoints)
 *   2. for each server: spawn / connect, run MCP `initialize`, call
 *      `tools/list` — short-lived connection, closed immediately
 *   3. cache the resulting schemas + UI categories + reverse-lookup map
 *      (5-minute TTL, manual invalidate() on MCP page writes)
 *
 * On tool dispatch the orchestrator calls `executeTool(mcpName, args)` which
 * resolves the namespaced name back to (serverConfig, originalToolName) and
 * runs `MCPClient.callTool()`.
 *
 * Why namespaced rather than flat tool names?
 *   - Two MCP servers can legitimately expose tools with the same short name
 *     (`search`, `list`, `read`, etc.) — namespacing keeps them distinct.
 *   - LLM tool selection accuracy improves: `mcp__notion__search_pages` is
 *     more specific than a bare `search_pages` from a registry of 120+ tools.
 *
 * Failure isolation:
 *   - If discovery fails, no MCP tools are exposed (chat keeps working).
 *   - If listTools fails for one server, other servers still surface.
 */

import MCPDiscovery from '../tools/library/mcp/MCPDiscovery.js';
import MCPClient from '../tools/library/mcp/MCPClient.js';

const TOOL_NAME_PREFIX = 'mcp__';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const INITIALIZE_TIMEOUT_MS = 8000; // STDIO spawn + MCP handshake budget
const LIST_TOOLS_TIMEOUT_MS = 5000;

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
    this._cache = null; // { schemas, categories, byMcpName, cachedAt }
    this._buildPromise = null;
  }

  /**
   * Build the full MCP tool surface (or return the cached copy if fresh).
   * Concurrent callers share a single in-flight build promise.
   */
  async build() {
    if (this._cache && Date.now() - this._cache.cachedAt < CACHE_TTL_MS) {
      return this._cache;
    }
    if (this._buildPromise) return this._buildPromise;

    this._buildPromise = this._build().finally(() => {
      this._buildPromise = null;
    });
    return this._buildPromise;
  }

  async _build() {
    const schemas = [];
    const categories = [];
    const byMcpName = new Map(); // mcpName -> { server: serverConfig, originalToolName }

    let servers;
    try {
      servers = await this.discovery.discoverAll();
    } catch (err) {
      console.warn('[MCPToolService] Discovery failed:', err.message);
      this._cache = { schemas: [], categories: [], byMcpName, cachedAt: Date.now() };
      return this._cache;
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      this._cache = { schemas: [], categories: [], byMcpName, cachedAt: Date.now() };
      return this._cache;
    }

    // Discover tools per server in parallel — one slow/dead server shouldn't
    // block the others. We tolerate per-server failures (skip the server,
    // keep the rest).
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

    for (const { serverConfig, tools } of perServerResults) {
      if (tools.length === 0) continue;

      const categoryTools = [];
      for (const t of tools) {
        if (!t || !t.name) continue;
        const mcpName = `${TOOL_NAME_PREFIX}${sanitize(serverConfig.name)}__${sanitize(t.name)}`;

        // Guard: if two MCP tools sanitize to the same name (rare — e.g. a
        // server with literal underscores in its name), keep the first one
        // discovered and warn. The user can rename one to disambiguate.
        if (byMcpName.has(mcpName)) {
          console.warn(
            `[MCPToolService] Sanitized name collision for "${mcpName}" — keeping first registration`,
          );
          continue;
        }

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
        categoryTools.push({
          name: mcpName,
          description: schema.function.description,
        });
        byMcpName.set(mcpName, {
          server: serverConfig,
          originalToolName: t.name,
        });
      }

      if (categoryTools.length > 0) {
        // Subcategory under the parent "MCP" group — surfaces just the
        // server name (no `MCP:` prefix); the prefix lives on the parent.
        categories.push({
          id: `mcp:${serverConfig.name}`,
          name: serverConfig.name,
          description: `${serverConfig.transport} • ${categoryTools.length} tool${categoryTools.length === 1 ? '' : 's'}`,
          locked: false,
          tools: categoryTools,
        });
      }
    }

    this._cache = { schemas, categories, byMcpName, cachedAt: Date.now() };
    console.log(
      `[MCPToolService] Built ${schemas.length} MCP tool schemas across ${categories.length} servers`,
    );
    return this._cache;
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

    // Total tool count across all servers — surfaced on the parent header
    // badge so users see e.g. "MCP 25/25" without expanding.
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
        tools: [], // No tools directly under the parent — they live in subcategories.
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
   * Execute an MCP tool by its namespaced name. Connection is short-lived
   * (spawn → initialize → callTool → close) — fine for occasional calls,
   * but if a tool is called many times in a row this becomes the bottleneck.
   * Connection pooling is a follow-up.
   */
  async executeTool(mcpName, args) {
    const resolved = await this.resolve(mcpName);
    if (!resolved) {
      throw new Error(`MCP tool "${mcpName}" not found. Available servers may have changed — try listing tools again.`);
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

  /** Force a rebuild of the MCP tool surface on the next call. */
  invalidate() {
    this._cache = null;
    this._buildPromise = null;
    console.log('[MCPToolService] Cache invalidated — next call will re-discover');
  }
}

const instance = new MCPToolService();

export default instance;
export { isMCPToolName, TOOL_NAME_PREFIX };
