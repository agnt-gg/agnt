// memory-graph.js — Knowledge Graph layer for AGNT Memory Toolkit
// Creates and queries a graph of entities and relationships extracted from memories, insights, and traces
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

// Lazy-loaded DB handle
let _db = null;
async function getDb() {
  if (_db) return _db;
  const dbPath = path.join(APP_PATH, 'backend', 'src', 'models', 'database', 'index.js');
  const dbUrl = 'file://' + dbPath.replace(/\\/g, '/');
  const mod = await import(dbUrl);
  _db = mod.default;
  return _db;
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function generateId() {
  return 'mtk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function ensureTables(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS memory_entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT DEFAULT 'concept',
    mentions INTEGER DEFAULT 1,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    user_id TEXT NOT NULL
  )`);
  await dbRun(db, `CREATE TABLE IF NOT EXISTS memory_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    relationship TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT NOT NULL
  )`);
  // Indexes for fast lookups
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_me_name ON memory_entities(name COLLATE NOCASE)`).catch(() => {});
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_me_user ON memory_entities(user_id)`).catch(() => {});
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_medge_source ON memory_edges(source_id)`).catch(() => {});
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_medge_target ON memory_edges(target_id)`).catch(() => {});
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_medge_user ON memory_edges(user_id)`).catch(() => {});
}

// ---- Entity extraction using keyword heuristics (no LLM needed) ----
function extractEntitiesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const entities = [];
  
  // Technology patterns
  const techPatterns = /\b(Redis|Docker|PostgreSQL|MySQL|MongoDB|SQLite|Node\.js|React|Vue|Angular|Python|TypeScript|JavaScript|Rust|Go|AWS|GCP|Azure|Kubernetes|Nginx|Apache|GraphQL|REST|WebSocket|OAuth|JWT|CORS|SSL|TLS|HTTP|HTTPS|Git|GitHub|GitLab|Vercel|Netlify|Heroku|Supabase|Firebase|Stripe|Twilio|SendGrid|Cloudflare|Figma|Notion|Slack|Discord|Obsidian|VS Code|Claude|GPT|OpenAI|Anthropic|Gemini|AGNT|Webpack|Vite|ESLint|Prettier|Jest|Vitest|Playwright|Cypress|Tailwind|SCSS|SASS|CSS|HTML|WASM|WebAssembly|FFmpeg|Remotion|Three\.js|D3|Chart\.js|Express|Fastify|Hono|Drizzle|Prisma|Sequelize|Electron|Tauri)\b/gi;
  
  // File/path patterns
  const filePatterns = /\b([a-zA-Z_][\w-]*\.(js|ts|jsx|tsx|py|rs|go|md|json|yaml|yml|toml|css|scss|html|sql|sh|bat|env|config|lock))\b/gi;
  
  // Project/service patterns (capitalized compound words)
  const projectPatterns = /\b([A-Z][a-zA-Z]+(?:Service|Manager|Controller|Handler|Router|Model|Plugin|Tool|Widget|Agent|Module|Engine|API))\b/g;
  
  let match;
  while ((match = techPatterns.exec(text)) !== null) {
    entities.push({ name: match[1], type: 'technology' });
  }
  while ((match = filePatterns.exec(text)) !== null) {
    entities.push({ name: match[1], type: 'file' });
  }
  while ((match = projectPatterns.exec(text)) !== null) {
    entities.push({ name: match[1], type: 'service' });
  }
  
  // Deduplicate by lowercased name
  const seen = new Set();
  return entities.filter(e => {
    const key = e.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class MemoryGraph {
  constructor() {
    this.name = 'memory-graph';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const db = await getDb();
      await ensureTables(db);
      const userId = workflowEngine?.userId;
      if (!userId) return { success: false, error: 'No user context' };

      switch (params.action) {
        case 'EXTRACT_ENTITIES': return await this.extractEntities(db, userId);
        case 'BUILD_GRAPH': return await this.buildGraph(db, userId);
        case 'CRAWL': return await this.crawl(db, userId, params);
        case 'GET_ENTITY': return await this.getEntity(db, userId, params);
        case 'LIST_ENTITIES': return await this.listEntities(db, userId, params);
        case 'GET_EDGES': return await this.getEdges(db, userId, params);
        case 'STATS': return await this.stats(db, userId);
        default: return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }

  async extractEntities(db, userId) {
    // Pull all memories and insights
    const memories = await dbAll(db, 'SELECT id, content, memory_type FROM agent_memory WHERE user_id = ?', [userId]);
    const insights = await dbAll(db, 'SELECT id, title, description FROM insights WHERE user_id = ?', [userId]);
    
    let totalExtracted = 0;
    const entityMap = new Map(); // name_lower -> { name, type, sources: Set, mentions }

    // Extract from memories
    for (const mem of memories) {
      const entities = extractEntitiesFromText(mem.content);
      for (const ent of entities) {
        const key = ent.name.toLowerCase();
        if (!entityMap.has(key)) {
          entityMap.set(key, { name: ent.name, type: ent.type, sources: new Set(), mentions: 0 });
        }
        const entry = entityMap.get(key);
        entry.mentions++;
        entry.sources.add(`memory:${mem.id}`);
      }
    }

    // Extract from insights
    for (const ins of insights) {
      const text = `${ins.title || ''} ${ins.description || ''}`;
      const entities = extractEntitiesFromText(text);
      for (const ent of entities) {
        const key = ent.name.toLowerCase();
        if (!entityMap.has(key)) {
          entityMap.set(key, { name: ent.name, type: ent.type, sources: new Set(), mentions: 0 });
        }
        const entry = entityMap.get(key);
        entry.mentions++;
        entry.sources.add(`insight:${ins.id}`);
      }
    }

    // Upsert entities into DB
    for (const [, ent] of entityMap) {
      const existing = await dbGet(db, 'SELECT id, mentions FROM memory_entities WHERE LOWER(name) = LOWER(?) AND user_id = ?', [ent.name, userId]);
      if (existing) {
        await dbRun(db, 'UPDATE memory_entities SET mentions = ?, last_seen = CURRENT_TIMESTAMP, metadata = ? WHERE id = ?',
          [existing.mentions + ent.mentions, JSON.stringify([...ent.sources]), existing.id]);
      } else {
        const id = generateId();
        await dbRun(db, 'INSERT INTO memory_entities (id, name, entity_type, mentions, metadata, user_id) VALUES (?, ?, ?, ?, ?, ?)',
          [id, ent.name, ent.type, ent.mentions, JSON.stringify([...ent.sources]), userId]);
        totalExtracted++;
      }
    }

    return {
      success: true,
      entitiesExtracted: totalExtracted,
      totalEntities: entityMap.size,
      data: { memoriesScanned: memories.length, insightsScanned: insights.length }
    };
  }

  async buildGraph(db, userId) {
    // Build edges between entities that co-occur in the same memory/insight
    const memories = await dbAll(db, 'SELECT id, content FROM agent_memory WHERE user_id = ?', [userId]);
    const entities = await dbAll(db, 'SELECT id, name FROM memory_entities WHERE user_id = ?', [userId]);
    
    const entityByName = new Map();
    for (const e of entities) entityByName.set(e.name.toLowerCase(), e);
    
    let edgesCreated = 0;
    
    for (const mem of memories) {
      const found = extractEntitiesFromText(mem.content);
      const foundEntities = found
        .map(f => entityByName.get(f.name.toLowerCase()))
        .filter(Boolean);
      
      // Create edges between co-occurring entities
      for (let i = 0; i < foundEntities.length; i++) {
        for (let j = i + 1; j < foundEntities.length; j++) {
          const a = foundEntities[i];
          const b = foundEntities[j];
          
          // Check if edge exists
          const existing = await dbGet(db,
            'SELECT id FROM memory_edges WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)) AND user_id = ?',
            [a.id, b.id, b.id, a.id, userId]);
          
          if (!existing) {
            await dbRun(db, 'INSERT INTO memory_edges (id, source_id, source_type, target_id, target_type, relationship, confidence, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [generateId(), a.id, 'entity', b.id, 'entity', 'co_occurs_with', 0.5, userId]);
            edgesCreated++;
          }
        }
        
        // Also create edges from entity to the memory that mentions it
        const a = foundEntities[i];
        const memEdgeExists = await dbGet(db,
          'SELECT id FROM memory_edges WHERE source_id = ? AND target_id = ? AND user_id = ?',
          [a.id, mem.id, userId]);
        if (!memEdgeExists) {
          await dbRun(db, 'INSERT INTO memory_edges (id, source_id, source_type, target_id, target_type, relationship, confidence, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [generateId(), a.id, 'entity', mem.id, 'memory', 'mentioned_in', 0.8, userId]);
          edgesCreated++;
        }
      }
    }

    return { success: true, edgesCreated, data: { memoriesProcessed: memories.length, entitiesLinked: entities.length } };
  }

  async crawl(db, userId, params) {
    const { entityName, depth = 2, limit = 50 } = params;
    if (!entityName) return { success: false, error: 'entityName is required for CRAWL' };

    const startEntity = await dbGet(db, 'SELECT * FROM memory_entities WHERE LOWER(name) = LOWER(?) AND user_id = ?', [entityName, userId]);
    if (!startEntity) return { success: false, error: `Entity "${entityName}" not found` };

    // BFS crawl
    const visited = new Set();
    const nodes = [];
    const edges = [];
    let queue = [{ id: startEntity.id, type: 'entity', depth: 0 }];

    while (queue.length > 0 && nodes.length < limit) {
      const { id, type, depth: d } = queue.shift();
      if (visited.has(id) || d > depth) continue;
      visited.add(id);

      // Add node
      if (type === 'entity') {
        const ent = await dbGet(db, 'SELECT * FROM memory_entities WHERE id = ?', [id]);
        if (ent) nodes.push({ ...ent, nodeType: 'entity', depth: d });
      } else if (type === 'memory') {
        const mem = await dbGet(db, 'SELECT id, content, memory_type, created_at FROM agent_memory WHERE id = ?', [id]);
        if (mem) nodes.push({ ...mem, nodeType: 'memory', depth: d, content: mem.content?.substring(0, 200) });
      }

      // Get connected edges
      const outEdges = await dbAll(db, 'SELECT * FROM memory_edges WHERE source_id = ? AND user_id = ?', [id, userId]);
      const inEdges = await dbAll(db, 'SELECT * FROM memory_edges WHERE target_id = ? AND user_id = ?', [id, userId]);

      for (const e of [...outEdges, ...inEdges]) {
        edges.push(e);
        const nextId = e.source_id === id ? e.target_id : e.source_id;
        const nextType = e.source_id === id ? e.target_type : e.source_type;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, type: nextType, depth: d + 1 });
        }
      }
    }

    // Deduplicate edges
    const uniqueEdges = [...new Map(edges.map(e => [e.id, e])).values()];

    return {
      success: true,
      data: {
        startEntity: startEntity.name,
        nodes,
        edges: uniqueEdges,
        nodeCount: nodes.length,
        edgeCount: uniqueEdges.length,
        maxDepthReached: Math.max(...nodes.map(n => n.depth || 0), 0)
      }
    };
  }

  async getEntity(db, userId, params) {
    const entity = await dbGet(db, 'SELECT * FROM memory_entities WHERE LOWER(name) = LOWER(?) AND user_id = ?', [params.entityName, userId]);
    if (!entity) return { success: false, error: `Entity "${params.entityName}" not found` };

    const edges = await dbAll(db, 'SELECT * FROM memory_edges WHERE (source_id = ? OR target_id = ?) AND user_id = ?', [entity.id, entity.id, userId]);
    
    // Resolve connected entities
    const connectedIds = new Set();
    for (const e of edges) {
      if (e.source_id !== entity.id) connectedIds.add(e.source_id);
      if (e.target_id !== entity.id) connectedIds.add(e.target_id);
    }

    const connected = [];
    for (const cid of connectedIds) {
      const ent = await dbGet(db, 'SELECT id, name, entity_type, mentions FROM memory_entities WHERE id = ?', [cid]);
      if (ent) connected.push(ent);
      else {
        const mem = await dbGet(db, 'SELECT id, content, memory_type FROM agent_memory WHERE id = ?', [cid]);
        if (mem) connected.push({ id: mem.id, name: mem.content?.substring(0, 80), entity_type: 'memory', mentions: 0 });
      }
    }

    return { success: true, data: { entity, edges, connected } };
  }

  async listEntities(db, userId, params) {
    const { entityType = 'all', limit = 50 } = params;
    let query = 'SELECT * FROM memory_entities WHERE user_id = ?';
    const qParams = [userId];
    if (entityType && entityType !== 'all') {
      query += ' AND entity_type = ?';
      qParams.push(entityType);
    }
    query += ' ORDER BY mentions DESC, last_seen DESC LIMIT ?';
    qParams.push(limit);

    const entities = await dbAll(db, query, qParams);
    return { success: true, data: { entities, total: entities.length } };
  }

  async getEdges(db, userId, params) {
    const edges = params.entityId
      ? await dbAll(db, 'SELECT * FROM memory_edges WHERE (source_id = ? OR target_id = ?) AND user_id = ?', [params.entityId, params.entityId, userId])
      : await dbAll(db, 'SELECT * FROM memory_edges WHERE user_id = ? LIMIT 100', [userId]);
    return { success: true, data: { edges, total: edges.length } };
  }

  async stats(db, userId) {
    const entityCount = await dbGet(db, 'SELECT COUNT(*) as count FROM memory_entities WHERE user_id = ?', [userId]);
    const edgeCount = await dbGet(db, 'SELECT COUNT(*) as count FROM memory_edges WHERE user_id = ?', [userId]);
    const memoryCount = await dbGet(db, 'SELECT COUNT(*) as count FROM agent_memory WHERE user_id = ?', [userId]);
    const insightCount = await dbGet(db, 'SELECT COUNT(*) as count FROM insights WHERE user_id = ?', [userId]);
    
    const topEntities = await dbAll(db, 'SELECT name, entity_type, mentions FROM memory_entities WHERE user_id = ? ORDER BY mentions DESC LIMIT 10', [userId]);
    const entityTypes = await dbAll(db, 'SELECT entity_type, COUNT(*) as count FROM memory_entities WHERE user_id = ? GROUP BY entity_type', [userId]);
    const relationshipTypes = await dbAll(db, 'SELECT relationship, COUNT(*) as count FROM memory_edges WHERE user_id = ? GROUP BY relationship', [userId]);

    return {
      success: true,
      data: {
        entities: entityCount?.count || 0,
        edges: edgeCount?.count || 0,
        memories: memoryCount?.count || 0,
        insights: insightCount?.count || 0,
        topEntities,
        entityTypes: Object.fromEntries(entityTypes.map(r => [r.entity_type, r.count])),
        relationshipTypes: Object.fromEntries(relationshipTypes.map(r => [r.relationship, r.count]))
      }
    };
  }
}

export default new MemoryGraph();
