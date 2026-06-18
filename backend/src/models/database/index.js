import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import WebhookModel from '../WebhookModel.js';
import pathManager from '../../utils/PathManager.js';
import { setupFullTextSearch } from './fts.js';

// Canonical data dir comes from PathManager (see PRD-060). PathManager itself
// already creates the directory and falls back to a temp dir on failure.
let dbDir = pathManager.getDataDir();

// Verify write permissions at the resolved location. If it's read-only for
// some reason, fall back to a Documents/HOME-relative directory so the app
// can still boot.
try {
  const testFile = path.join(dbDir, '.test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
} catch (error) {
  console.error('Error with primary directory:', error);
  if (process.platform === 'darwin' && process.env.HOME) {
    dbDir = path.join(process.env.HOME, 'Documents', 'AGNT_Data');
  } else {
    dbDir = path.join(process.env.HOME || process.env.USERPROFILE || os.tmpdir(), 'AGNT_Data');
  }
  console.log('Falling back to:', dbDir);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// One-time migration shim (PRD-060 §6.3). If a legacy or buggy install left
// agnt.db at a non-canonical location and the canonical path has no DB yet,
// copy it (plus WAL/SHM sidecars) into place. Copy-not-move keeps the legacy
// file around for manual recovery if anything goes wrong.
const buildLegacyLocations = () => {
  const locs = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    // Benny's bug: false /app/data hit on Windows resolved to C:\app\data
    locs.push('C:\\app\\data');
    if (process.env.APPDATA) {
      locs.push(path.join(process.env.APPDATA, 'AGNT', 'Data'));
    }
    // System-wide installs and Electron localappdata variants
    if (process.env.PROGRAMDATA) {
      locs.push(path.join(process.env.PROGRAMDATA, 'AGNT', 'Data'));
    }
    if (process.env.LOCALAPPDATA) {
      locs.push(path.join(process.env.LOCALAPPDATA, 'AGNT', 'Data'));
    }
    // Pre-PRD-060 emergency fallbacks (see prior database/index.js fallback paths)
    if (process.env.USERPROFILE) {
      locs.push(path.join(process.env.USERPROFILE, 'Documents', 'AGNT_Data'));
      locs.push(path.join(process.env.USERPROFILE, 'AGNT_Data'));
    }
  }
  if (process.platform === 'darwin' && home) {
    locs.push(path.join(home, 'Library', 'Application Support', 'AGNT', 'Data'));
    // Pre-PRD-060 macOS fallback
    locs.push(path.join(home, 'Documents', 'AGNT_Data'));
  }
  if (process.platform === 'linux' && home) {
    locs.push(path.join(home, '.config', 'AGNT', 'Data'));
    // Pre-PRD-060 linux fallback
    locs.push(path.join(home, 'AGNT_Data'));
  }
  return locs.filter((p) => p && p !== dbDir);
};

const targetDbForMigration = path.join(dbDir, 'agnt.db');
if (!fs.existsSync(targetDbForMigration)) {
  for (const legacy of buildLegacyLocations()) {
    const legacyDb = path.join(legacy, 'agnt.db');
    if (fs.existsSync(legacyDb)) {
      try {
        console.warn(`📦 AGNT migrating orphaned DB from ${legacy} → ${dbDir}`);
        fs.mkdirSync(dbDir, { recursive: true });
        fs.copyFileSync(legacyDb, targetDbForMigration);
        for (const ext of ['-wal', '-shm']) {
          const src = legacyDb + ext;
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, targetDbForMigration + ext);
          }
        }
        console.log('✓ Data migration completed successfully');
      } catch (error) {
        console.error('Migration failed:', error);
      }
      break; // only migrate from one source
    }
  }
}

// Database path in user's data directory
const dbPath = path.join(dbDir, 'agnt.db');
console.log('Final database path:', dbPath);

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database initialization error:', err);
  } else {
    console.log('Database successfully initialized at:', dbPath);
  }
});

// CRITICAL: PRAGMAs must be queued BEFORE createTables() below.
// sqlite3 queues operations in call order, so these will execute first.
db.serialize(() => {
  // WAL mode is required for multi-process access (main server + workflow process).
  // Without WAL, concurrent writes cause SQLITE_BUSY: database is locked.
  // Disable with SQLITE_WAL_MODE=false only for networked/NFS filesystems.
  const disableWAL = process.env.SQLITE_WAL_MODE === 'false';
  if (!disableWAL) {
    db.run('PRAGMA journal_mode = WAL', (err) => {
      if (err) {
        console.error('Failed to enable WAL mode:', err);
      } else {
        console.log('WAL mode enabled (multi-process concurrency)');
      }
    });
  } else {
    console.log('WAL mode disabled via SQLITE_WAL_MODE=false');
  }

  // Enable foreign key enforcement (required for ON DELETE CASCADE)
  db.run('PRAGMA foreign_keys = ON', (err) => {
    if (err) {
      console.error('Failed to enable foreign keys:', err);
    } else {
      console.log('Foreign key enforcement enabled');
    }
  });

  // Busy timeout: retry for up to 10s when the DB is locked.
  // Covers startup race between main process migrations and workflow process queries.
  db.run('PRAGMA busy_timeout = 10000', (err) => {
    if (err) {
      console.error('Failed to set busy_timeout:', err);
    } else {
      console.log('Busy timeout set to 10000ms');
    }
  });
});

// Function to create tables
// PRD-084-R2 §0.4: performance PRAGMA pack — documented-safe under WAL.
// - synchronous=NORMAL: WAL preserves integrity on crash; only durability of
//   the last few transactions is at risk on power loss (never corruption).
// - cache_size=-64000: 64 MB page cache (driver default is ~2 MB).
// - temp_store=MEMORY: temp b-trees (ORDER BY / GROUP BY) stay in RAM.
// - mmap_size=256 MB: page reads served via the OS memory map.
// Queued at module evaluation, so these run before createTables() below.
db.serialize(() => {
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA cache_size = -64000');
  db.run('PRAGMA temp_store = MEMORY');
  db.run('PRAGMA mmap_size = 268435456');
});

function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        credits INTEGER DEFAULT 0,
        default_provider TEXT DEFAULT 'Anthropic',
        default_model TEXT DEFAULT 'claude-3-5-sonnet-20240620',
        custom_instructions TEXT,
        async_tools_enabled INTEGER DEFAULT 0
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        icon TEXT,
        category TEXT,
        tools TEXT,
        workflows TEXT,
        provider TEXT,
        model TEXT,
        created_by TEXT NOT NULL,
        last_active DATETIME,
        success_rate REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS agent_resources (
        agent_id TEXT PRIMARY KEY,
        credit_limit INTEGER NOT NULL,
        credits_used INTEGER DEFAULT 0,
        reset_period TEXT,
        last_reset DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS agent_workflows (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        base TEXT NOT NULL DEFAULT 'AI',
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        icon TEXT NOT NULL,
        description TEXT NOT NULL,
        config JSON,
        code TEXT,
        parameters TEXT NOT NULL,
        outputs TEXT NOT NULL,
        created_by TEXT NOT NULL,
        is_shareable INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        workflow_data TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'stopped',
        is_shareable INTEGER DEFAULT 0,
        current_version_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // Index for faster workflow queries by user_id
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id)`);
      // Composite index for status-filtered queries (active workflows panel)
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflows_user_status ON workflows(user_id, status)`);

      // Workflow version history table
      db.run(`CREATE TABLE IF NOT EXISTS workflow_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        workflow_state TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'system',
        change_type TEXT DEFAULT 'auto',
        change_summary TEXT,
        tool_calls TEXT,
        parent_version_id INTEGER,
        is_checkpoint INTEGER DEFAULT 0,
        is_compressed INTEGER DEFAULT 0,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_version_id) REFERENCES workflow_versions(id) ON DELETE SET NULL
      )`);

      // Indexes for workflow versions
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_created_at ON workflow_versions(created_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_checkpoint ON workflow_versions(is_checkpoint)`);

      // Groups for organizing conversations
      db.run(`CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#6366f1',
        sort_order INTEGER DEFAULT 0,
        parent_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (parent_id) REFERENCES groups(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON groups(parent_id)`);

      db.run(`CREATE TABLE IF NOT EXISTS content_outputs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workflow_id TEXT,
        tool_id TEXT,
        content TEXT NOT NULL,
        content_type TEXT DEFAULT 'html',
        conversation_id TEXT,
        title TEXT,
        is_shareable INTEGER DEFAULT 0,
        group_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
      )`);

      // Index for faster content_outputs queries by user_id, sorted by updated_at
      db.run(`CREATE INDEX IF NOT EXISTS idx_content_outputs_user_id ON content_outputs(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_content_outputs_user_updated ON content_outputs(user_id, updated_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_content_outputs_group_id ON content_outputs(group_id)`);

      db.run(
        `CREATE TABLE IF NOT EXISTS user_data (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        data JSON NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
      );

      db.run(`CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT,
        user_id TEXT NOT NULL,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        status TEXT NOT NULL,
        log TEXT,
        credits_used REAL DEFAULT 0,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // Index for faster workflow execution queries
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id ON workflow_executions(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_status ON workflow_executions(user_id, status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_start ON workflow_executions(user_id, start_time)`);

      db.run(`CREATE TABLE IF NOT EXISTS node_executions (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        status TEXT NOT NULL,
        input JSON,
        output JSON,
        error TEXT,
        credits_used REAL DEFAULT 0,
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
      )`);

      // Index for faster node execution lookups by execution_id (CRITICAL for run details)
      db.run(`CREATE INDEX IF NOT EXISTS idx_node_executions_execution_id ON node_executions(execution_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_node_executions_execution_status ON node_executions(execution_id, status)`);

      // Goal system tables - extending existing architecture
      db.run(`CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'planning',
        priority TEXT DEFAULT 'medium',
        estimated_duration INTEGER,
        actual_duration INTEGER,
        success_criteria JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        parent_task_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        agent_id TEXT,
        workflow_id TEXT,
        required_tools JSON,
        estimated_duration INTEGER,
        order_index INTEGER,
        dependencies JSON,
        progress INTEGER DEFAULT 0,
        input JSON,
        output JSON,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        FOREIGN KEY (goal_id) REFERENCES goals(id),
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workflow_execution_id TEXT,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        output JSON,
        error_message TEXT,
        credits_used REAL DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (workflow_execution_id) REFERENCES workflow_executions(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS goal_outputs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        task_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT,
        output_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )`);

      // Evaluation system tables
      db.run(`CREATE TABLE IF NOT EXISTS goal_evaluations (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        evaluation_type TEXT DEFAULT 'automatic',
        overall_score REAL,
        passed INTEGER DEFAULT 0,
        evaluation_data JSON,
        feedback TEXT,
        evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        evaluated_by TEXT DEFAULT 'system',
        FOREIGN KEY (goal_id) REFERENCES goals(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS task_evaluations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        goal_evaluation_id TEXT,
        criteria_met JSON,
        score REAL,
        feedback TEXT,
        evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (goal_evaluation_id) REFERENCES goal_evaluations(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS golden_standards (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        success_score REAL,
        template_data JSON,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      db.run(
        `CREATE TABLE IF NOT EXISTS conversation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT UNIQUE NOT NULL,
        user_id TEXT,
        initial_prompt TEXT,
        full_history TEXT,
        final_response TEXT,
        tool_calls TEXT,
        errors TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
      );

      // Per-conversation context bindings (active skill, active goal, etc.).
      // Kept separate from conversation_logs so the row can be created lazily
      // when the user attaches a skill/goal *before* sending any message.
      db.run(
        `CREATE TABLE IF NOT EXISTS conversation_settings (
        conversation_id TEXT PRIMARY KEY,
        user_id TEXT,
        active_skill_id TEXT,
        active_goal_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
      );

      db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_settings_user_id ON conversation_settings(user_id)`);

      // Persist Codex CLI thread IDs so conversations can resume after restarts
      db.run(
        `CREATE TABLE IF NOT EXISTS codex_threads (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai-codex',
        scope TEXT NOT NULL DEFAULT 'conversation',
        conversation_id TEXT NOT NULL DEFAULT '',
        thread_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider, scope, conversation_id)
      )`
      );

      db.run(
        `CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        method TEXT,
        auth_type TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
      );

      // ==================== OAUTH_TOKENS TABLE ====================
      db.run(`CREATE TABLE IF NOT EXISTS oauth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, provider_id)
      )`);

      // ==================== API_KEYS TABLE ====================
      db.run(`CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        api_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, provider_id)
      )`);

      db.run(
        `CREATE TABLE IF NOT EXISTS custom_openai_providers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
      );

      // Agent execution tracking tables - for displaying agent runs in Runs screen
      db.run(`CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        agent_name TEXT,
        user_id TEXT NOT NULL,
        conversation_id TEXT,
        status TEXT NOT NULL DEFAULT 'started',
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        credits_used REAL DEFAULT 0,
        tool_calls_count INTEGER DEFAULT 0,
        initial_prompt TEXT,
        final_response TEXT,
        error TEXT,
        provider TEXT,
        model TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // Index for faster agent execution lookups
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_executions_user_id ON agent_executions(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON agent_executions(agent_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_executions_user_start ON agent_executions(user_id, start_time)`);

      db.run(`CREATE TABLE IF NOT EXISTS agent_tool_executions (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_call_id TEXT,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        status TEXT NOT NULL DEFAULT 'started',
        input JSON,
        output JSON,
        error TEXT,
        credits_used REAL DEFAULT 0,
        FOREIGN KEY (execution_id) REFERENCES agent_executions(id)
      )`);

      // Index for faster agent tool execution lookups (CRITICAL for run details)
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_execution_id ON agent_tool_executions(execution_id)`);

      // Custom widget definitions for Widget Forge system
      db.run(`CREATE TABLE IF NOT EXISTS widget_definitions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT 'fas fa-puzzle-piece',
        category TEXT DEFAULT 'custom',
        widget_type TEXT NOT NULL DEFAULT 'html',
        source_code TEXT,
        config JSON DEFAULT '{}',
        data_bindings JSON DEFAULT '[]',
        default_size JSON DEFAULT '{"cols":4,"rows":3}',
        min_size JSON DEFAULT '{"cols":2,"rows":2}',
        is_shared INTEGER DEFAULT 0,
        is_published INTEGER DEFAULT 0,
        version TEXT DEFAULT '1.0.0',
        thumbnail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_widget_definitions_user_id ON widget_definitions(user_id)`);

      // Widget layouts for dynamic canvas system
      db.run(`CREATE TABLE IF NOT EXISTS widget_layouts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        page_id TEXT NOT NULL,
        page_name TEXT NOT NULL,
        page_icon TEXT DEFAULT 'fas fa-th',
        page_order INTEGER DEFAULT 0,
        route TEXT,
        layout_data TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_widget_layouts_user_id ON widget_layouts(user_id)`);

      // ==================== SKILLS TABLE ====================
      db.run(`CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT,
        license TEXT,
        compatibility TEXT,
        metadata TEXT,
        allowed_tools TEXT,
        icon TEXT DEFAULT '🧩',
        category TEXT DEFAULT 'general',
        is_builtin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)`);

      // Migration: add slug column for kebab-case canonical name lookup
      db.run(`ALTER TABLE skills ADD COLUMN slug TEXT`, () => {});
      db.run(`CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug)`);

      // ==================== SKILLFORGE TABLES ====================
      // Skill version history — tracks evolutionary lineage of skills
      db.run(`CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        instructions TEXT NOT NULL,
        instructions_diff TEXT,
        effectiveness_score REAL,
        parent_version_id TEXT,
        source_goal_id TEXT,
        trace_analysis_summary TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_id ON skill_versions(skill_id)`);

      // Skill A/B test evaluations — experiment log
      db.run(`CREATE TABLE IF NOT EXISTS skill_evaluations (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        skill_version_id TEXT,
        user_id TEXT NOT NULL,
        source_goal_id TEXT NOT NULL,
        baseline_ses REAL,
        baseline_completion REAL,
        baseline_tool_calls INTEGER,
        baseline_errors INTEGER,
        baseline_duration_ms INTEGER,
        treatment_ses REAL,
        treatment_completion REAL,
        treatment_tool_calls INTEGER,
        treatment_errors INTEGER,
        treatment_duration_ms INTEGER,
        delta REAL,
        decision TEXT NOT NULL,
        trace_analysis TEXT,
        judge_reasoning TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_skill_evaluations_skill_id ON skill_evaluations(skill_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_skill_evaluations_user_id ON skill_evaluations(user_id)`);

      // SkillForge settings — persisted per-user configuration
      db.run(`CREATE TABLE IF NOT EXISTS skillforge_settings (
        user_id TEXT PRIMARY KEY,
        settings TEXT NOT NULL DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // Evolution settings — controls automated insight extraction
      db.run(`CREATE TABLE IF NOT EXISTS evolution_settings (
        user_id TEXT PRIMARY KEY,
        settings TEXT NOT NULL DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // Goal iteration history for AGI loop
      db.run(`CREATE TABLE IF NOT EXISTS goal_iterations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id TEXT NOT NULL,
        iteration_number INTEGER NOT NULL,
        evaluation_score REAL,
        evaluation_passed INTEGER DEFAULT 0,
        world_state_snapshot JSON,
        replanned_tasks JSON,
        git_commit_hash TEXT,
        duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_goal_iterations_goal_id ON goal_iterations(goal_id)`);

      // ==================== EXPERIMENT ECOSYSTEM ====================
      db.run(`CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        hypothesis TEXT,
        status TEXT DEFAULT 'planned',
        type TEXT DEFAULT 'ab_test',
        benchmark_id TEXT,
        skill_id TEXT,
        source_goal_id TEXT,
        eval_dataset_id TEXT,
        config TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS experiment_runs (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        goal_id TEXT,
        eval_example_index INTEGER,
        status TEXT DEFAULT 'pending',
        metrics TEXT DEFAULT '{}',
        evaluation_score REAL,
        evaluation_passed INTEGER,
        judge_feedback TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS experiment_results (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        iteration INTEGER DEFAULT 1,
        control_avg_ses REAL,
        treatment_avg_ses REAL,
        delta REAL,
        confidence REAL,
        per_dimension TEXT,
        constraint_results TEXT,
        decision TEXT,
        analysis TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS eval_datasets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        skill_id TEXT,
        category TEXT,
        source TEXT DEFAULT 'synthetic',
        items TEXT DEFAULT '[]',
        split_config TEXT DEFAULT '{"trainRatio":0.6,"valRatio":0.2,"holdoutRatio":0.2}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_experiments_user_id ON experiments(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_experiment_runs_experiment_id ON experiment_runs(experiment_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment_id ON experiment_results(experiment_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_eval_datasets_user_id ON eval_datasets(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_eval_datasets_skill_id ON eval_datasets(skill_id)`);

      // ==================== PERFORMANCE INDEXES ====================
      // Agents - faster lookup by user
      db.run(`CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(updated_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_resources_agent_id ON agent_resources(agent_id)`);

      // Goals - faster lookup by user and status
      db.run(`CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)`);

      // Tasks - faster lookup by goal
      db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id)`);

      // Custom tools - faster lookup by user
      db.run(`CREATE INDEX IF NOT EXISTS idx_tools_created_by ON tools(created_by)`);

      // Webhooks - faster lookup by user
      // ==================== EVOLUTION ENGINE TABLES ====================
      // Insights — unified observations extracted from any execution trace
      db.run(`CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_context TEXT,
        target_type TEXT NOT NULL,
        target_id TEXT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence TEXT,
        confidence REAL DEFAULT 0.5,
        status TEXT DEFAULT 'pending',
        applied_at DATETIME,
        applied_result TEXT,
        occurrence_count INTEGER DEFAULT 1,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_insights_user_id ON insights(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_insights_target ON insights(target_type, target_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_insights_source ON insights(source_type, source_id)`);

      // Agent memory — persistent memory for agents across conversations
      db.run(`CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_conversation_id TEXT,
        relevance_score REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_memory_user_id ON agent_memory(user_id)`);

      // PRD-057: installed_plugin_assets — registry tying ecosystem-plugin-installed
      // assets (agents, workflows, skills, widgets) back to the plugin that owns them.
      // Walked by uninstall (clean/purge/detach modes) and update (mod-flag respect).
      db.run(`CREATE TABLE IF NOT EXISTS installed_plugin_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_name TEXT NOT NULL,
        plugin_version TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        asset_slug TEXT NOT NULL,
        local_id TEXT NOT NULL,
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deprecated_at DATETIME,
        UNIQUE (plugin_name, asset_type, asset_slug)
      )`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_installed_plugin_assets_plugin ON installed_plugin_assets(plugin_name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_installed_plugin_assets_local ON installed_plugin_assets(asset_type, local_id)`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id)`,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  });
}

// Function to run migrations
function runMigrations() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Migration: Add current_version_id to workflows table for version control (2026-02-04)
      db.run(`ALTER TABLE workflows ADD COLUMN current_version_id INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding current_version_id column to workflows:', err);
        } else if (!err) {
          console.log('✓ Added current_version_id column to workflows table');
        }
      });

      // Migration: Add system_prompt and skills columns to agents table (2026-02-28)
      db.run(`ALTER TABLE agents ADD COLUMN system_prompt TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding system_prompt column to agents:', err);
        } else if (!err) {
          console.log('✓ Added system_prompt column to agents table');
        }
      });

      db.run(`ALTER TABLE agents ADD COLUMN skills TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding skills column to agents:', err);
        } else if (!err) {
          console.log('✓ Added skills column to agents table');
        }
      });

      // Migration: Add AGI loop columns to goals table (2026-03-04)
      const agiLoopColumns = [
        { name: 'world_state', type: "JSON DEFAULT '{}'" },
        { name: 'current_iteration', type: 'INTEGER DEFAULT 0' },
        { name: 'max_iterations', type: 'INTEGER DEFAULT 50' },
        { name: 'loop_status', type: 'TEXT DEFAULT NULL' },
      ];

      agiLoopColumns.forEach((col) => {
        db.run(`ALTER TABLE goals ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to goals:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to goals table`);
          }
        });
      });

      // Migration: Add deleted_at column to goals for soft-delete (2026-03-10)
      db.run(`ALTER TABLE goals ADD COLUMN deleted_at DATETIME DEFAULT NULL`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding deleted_at column to goals:', err);
        } else if (!err) {
          console.log('✓ Added deleted_at column to goals table');
        }
      });

      // Migration: Add deleted_at column to agents and workflows for soft-delete (2026-04-12)
      // Preserves execution history (agent_executions, workflow_executions, tasks, etc.)
      // which have FK references that would otherwise block hard deletes.
      ['agents', 'workflows'].forEach((table) => {
        db.run(`ALTER TABLE ${table} ADD COLUMN deleted_at DATETIME DEFAULT NULL`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding deleted_at column to ${table}:`, err);
          } else if (!err) {
            console.log(`✓ Added deleted_at column to ${table} table`);
          }
        });
      });

      // Migration: Add token usage columns to execution tables (2026-03-11)
      const tokenColumns = [
        { table: 'agent_executions', name: 'input_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_executions', name: 'output_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_executions', name: 'total_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_executions', name: 'estimated_cost', type: 'REAL DEFAULT 0' },
        { table: 'agent_executions', name: 'cache_read_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_executions', name: 'cache_creation_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_tool_executions', name: 'input_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_tool_executions', name: 'output_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_tool_executions', name: 'cache_read_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'agent_tool_executions', name: 'cache_creation_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'node_executions', name: 'input_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'node_executions', name: 'output_tokens', type: 'INTEGER DEFAULT 0' },
      ];

      tokenColumns.forEach((col) => {
        db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to ${col.table}:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to ${col.table} table`);
          }
        });
      });

      // Migration: Add token usage columns to evaluation tables (2026-03-11)
      const evalTokenColumns = [
        { table: 'goal_evaluations', name: 'input_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'goal_evaluations', name: 'output_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'goal_evaluations', name: 'total_tokens', type: 'INTEGER DEFAULT 0' },
        { table: 'goal_evaluations', name: 'estimated_cost', type: 'REAL DEFAULT 0' },
      ];

      evalTokenColumns.forEach((col) => {
        db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to ${col.table}:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to ${col.table} table`);
          }
        });
      });

      // Migration: Add user_id to widget_layouts for per-user page isolation (2026-03-05)
      db.run(`ALTER TABLE widget_layouts ADD COLUMN user_id TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding user_id column to widget_layouts:', err);
        } else if (!err) {
          console.log('✓ Added user_id column to widget_layouts table');
          // Backfill: assign existing layouts to the first user (owner of the system)
          db.get('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', (err, row) => {
            if (!err && row) {
              db.run('UPDATE widget_layouts SET user_id = ? WHERE user_id IS NULL', [row.id], (err) => {
                if (!err) console.log('✓ Backfilled widget_layouts with default user_id');
              });
            }
          });
        }
      });

      // Migration: Add insight_version column to agents for evolution tracking (2026-03-12)
      db.run(`ALTER TABLE agents ADD COLUMN insight_version INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding insight_version column to agents:', err);
        } else if (!err) {
          console.log('✓ Added insight_version column to agents table');
        }
      });

      // Migration: Add evaluation_score column to goal_iterations for AGI loop tracking (2026-03-12)
      const goalIterationColumns = [
        { name: 'evaluation_score', type: 'REAL' },
        { name: 'evaluation_passed', type: 'INTEGER DEFAULT 0' },
        { name: 'world_state_snapshot', type: 'JSON' },
        { name: 'replanned_tasks', type: 'JSON' },
        { name: 'git_commit_hash', type: 'TEXT' },
        { name: 'duration_ms', type: 'INTEGER' },
      ];
      goalIterationColumns.forEach(col => {
        db.run(`ALTER TABLE goal_iterations ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to goal_iterations:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to goal_iterations table`);
          }
        });
      });

      // Migration: Add parent_id column to groups for nested groups (2026-04-06)
      db.run(`ALTER TABLE groups ADD COLUMN parent_id TEXT REFERENCES groups(id) ON DELETE CASCADE`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding parent_id column to groups:', err);
        } else if (!err) {
          console.log('✓ Added parent_id column to groups table');
        }
      });

      // Migration: Add group_id column to content_outputs for group organization (2026-04-06)
      db.run(`ALTER TABLE content_outputs ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding group_id column to content_outputs:', err);
        } else if (!err) {
          console.log('✓ Added group_id column to content_outputs table');
        }
      });

      // Migration: Add custom_instructions column to users for orchestrator system prompt additions (2026-04-20)
      db.run(`ALTER TABLE users ADD COLUMN custom_instructions TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding custom_instructions column to users:', err);
        } else if (!err) {
          console.log('✓ Added custom_instructions column to users table');
        }
      });

      // Migration: Add async_tools_enabled column to users for the chat-side
      // capability toggle (2026-05-04). Defaults to 0 (off) — async tool
      // execution is currently an experimental capability and users opt in
      // via Settings → AI Provider → "Async tool execution".
      db.run(`ALTER TABLE users ADD COLUMN async_tools_enabled INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding async_tools_enabled column to users:', err);
        } else if (!err) {
          console.log('✓ Added async_tools_enabled column to users table');
        }
      });

      // Migration: Add denormalized metadata columns to workflows for fast summary queries (2026-02-26)
      // These columns avoid parsing the full workflow_data JSON blob for list/summary views
      const summaryColumns = [
        { name: 'name', type: 'TEXT' },
        { name: 'description', type: 'TEXT' },
        { name: 'category', type: 'TEXT' },
        { name: 'node_summary', type: 'TEXT' },  // JSON array of {type, icon, label}
      ];

      let columnsAdded = 0;
      summaryColumns.forEach((col, i) => {
        db.run(`ALTER TABLE workflows ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to workflows:`, err);
          } else if (!err) {
            columnsAdded++;
            console.log(`✓ Added ${col.name} column to workflows table`);
          }

          // After last column, always attempt backfill for rows with NULL name
          // (handles both fresh migrations and DBs where columns existed but were never populated)
          if (i === summaryColumns.length - 1) {
            backfillWorkflowSummaryColumns();

            // PRD-057: Origin-tracking on existing ecosystem tables (2026-05-06)
            // The `installed_plugin_assets` table itself is created in
            // createTables() so it's guaranteed present before any code path
            // queries it.
            const ecosystemTables = ['agents', 'workflows', 'skills', 'widget_definitions'];
            ecosystemTables.forEach((table) => {
              db.run(`ALTER TABLE ${table} ADD COLUMN source_plugin TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                  console.error(`Error adding source_plugin column to ${table}:`, err);
                } else if (!err) {
                  console.log(`✓ Added source_plugin column to ${table} table`);
                }
              });
              db.run(`ALTER TABLE ${table} ADD COLUMN is_user_modified INTEGER NOT NULL DEFAULT 0`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                  console.error(`Error adding is_user_modified column to ${table}:`, err);
                } else if (!err) {
                  console.log(`✓ Added is_user_modified column to ${table} table`);
                }
              });
            });

            resolve();
          }
        });
      });
    });
  });
}

/**
 * Backfill denormalized columns from existing workflow_data.
 * Runs once after migration adds new columns.
 */
function backfillWorkflowSummaryColumns() {
  db.all('SELECT id, workflow_data FROM workflows WHERE name IS NULL', (err, rows) => {
    if (err || !rows || rows.length === 0) return;
    console.log(`Backfilling ${rows.length} workflow(s) with summary columns...`);

    rows.forEach((row) => {
      try {
        const data = JSON.parse(row.workflow_data);
        const nodes = Array.isArray(data.nodes) ? data.nodes : [];
        const nodeSummary = JSON.stringify(nodes.map(n => ({
          type: n.type || '',
          icon: n.icon || n.data?.icon || 'custom',
          label: n.text || n.data?.label || n.type || 'Unknown Tool',
        })));

        db.run(
          `UPDATE workflows SET name = ?, description = ?, category = ?, node_summary = ? WHERE id = ?`,
          [data.name || '', data.description || '', data.category || '', nodeSummary, row.id]
        );
      } catch (e) {
        console.error(`Failed to backfill workflow ${row.id}:`, e.message);
      }
    });

    console.log('✓ Workflow summary columns backfilled');
  });
}

// Ensure tables are created before exporting the database.
//
// PRD-084-R2 §0.2: the workflow child process is forked only after the main
// process has fully initialized the schema (server.js awaits dbReady before
// WorkflowProcessBridge.spawn()), so re-running createTables + ~25 migration
// probes + FTS setup in the child is pure duplicated work and creates a
// startup write-lock race between the two processes. The child is forked
// with AGNT_SKIP_DB_INIT=1 and resolves dbReady immediately; per-connection
// PRAGMAs above still run (they are connection-scoped, not schema work).
const skipSchemaInit = process.env.AGNT_SKIP_DB_INIT === '1';

const dbReady = skipSchemaInit
  ? Promise.resolve().then(() => {
      console.log('Database schema init skipped (AGNT_SKIP_DB_INIT=1) — schema owned by parent process');
    })
  : createTables()
  .then(() => {
    console.log('All tables created successfully');
    return runMigrations();
  })
  .then(() => {
    console.log('All migrations completed successfully');
  })
  .then(async () => {
    // Set up FTS5 search indexes (memory layer) before announcing readiness.
    try {
      await setupFullTextSearch(db);
    } catch (error) {
      console.error('Error setting up full-text search:', error);
    }
  })
  .then(async () => {
    console.log('Database initialization complete');

    // Sync webhooks from existing workflows
    try {
      await WebhookModel.syncFromWorkflows();
    } catch (error) {
      console.error('Error syncing webhooks:', error);
    }
  })
  .catch((error) => {
    console.error('Error creating tables or running migrations:', error);
  });

/**
 * Run a db operation with automatic retry on SQLITE_BUSY errors.
 * @param {Function} fn - async function that performs the db operation
 * @param {number} maxRetries - maximum number of retries (default 5)
 * @param {number} baseDelay - base delay in ms between retries (default 500)
 * @returns {Promise<*>} - result of the db operation
 */
async function dbRunWithRetry(fn, maxRetries = 5, baseDelay = 500) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isBusy = error && (
        error.code === 'SQLITE_BUSY' ||
        (error.message && error.message.includes('SQLITE_BUSY'))
      );
      if (isBusy && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
        console.warn(`[DB Retry] SQLITE_BUSY on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// PRD-084-R2 §0.4: WAL checkpoint hygiene (main process only — the child
// skips schema init and must not compete for the checkpoint lock). A
// TRUNCATE checkpoint resets the -wal file to zero bytes when no reader
// blocks it; failures are non-fatal and simply retried on the next cycle.
if (!skipSchemaInit) {
  const runWalCheckpoint = () => {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
      if (err) console.warn('[DB] WAL checkpoint failed (non-fatal):', err.message);
    });
  };
  dbReady.then(() => runWalCheckpoint());
  const walCheckpointTimer = setInterval(runWalCheckpoint, 5 * 60 * 1000);
  if (typeof walCheckpointTimer.unref === 'function') walCheckpointTimer.unref();
}

export { dbReady, dbRunWithRetry };
export default db;
