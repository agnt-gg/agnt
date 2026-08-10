import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import WebhookModel from '../WebhookModel.js';
import pathManager from '../../utils/PathManager.js';
import { setupFullTextSearch } from './fts.js';
import { migrateLegacyDatabase } from './legacyMigration.js';
import { ensureWidgetLayoutRouteUniqueness } from './widgetLayoutDedupe.js';

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
// copy it into place. See legacyMigration.js — this used to be an unguarded
// copyFileSync that would happily start a 30 GB copy with no free-space
// check and leave a truncated database behind if it died partway.
migrateLegacyDatabase({ dbDir });

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

  // auto_vacuum can ONLY be set while the database is still empty (zero pages).
  // On an existing database this statement is silently ignored, and the only
  // way to enable it afterwards is a full VACUUM — which needs free disk space
  // equal to the whole file. Once a database has grown past the free space on
  // its volume, VACUUM is no longer possible at all — so auto_vacuum can never
  // be retrofitted, and that is exactly the state a long-lived install reaches.
  //
  // Setting it here means every NEW database (fresh install, Docker image,
  // per-tenant cloud instance) is born able to return freed pages to the OS via
  // `PRAGMA incremental_vacuum`, instead of growing monotonically forever.
  // Existing installs are unaffected: they keep reusing the freelist, which is
  // sufficient once payload externalization cuts the write rate.
  db.run('PRAGMA auto_vacuum = INCREMENTAL');
});

// ── Index creation is DEFERRED until after migrations ──────────────────────
//
// An index is derived from a table's columns, so it can only be built once the
// schema is final. `CREATE TABLE IF NOT EXISTS` supplies every column on a
// FRESH database — but on an EXISTING one it is a no-op, and the columns it
// names arrive later, from runMigrations(). An index declared inline in
// createTables() therefore works on a new install and fails on every upgrade
// across the migration that adds its column.
//
// It fails badly, in two compounding ways (both measured, node-sqlite3 v5):
//   1. The index is silently never created. `IF NOT EXISTS` did not save it;
//      the statement errored, so nothing was built and nothing said so.
//   2. A callback-less db.run emits its error on the *Statement* object. No
//      Database-level 'error' listener can catch it — verified: adding
//      db.on('error') does NOT help — so it lands as an UNCAUGHT EXCEPTION
//      and kills the process during boot.
//
// idx_content_outputs_channel did exactly this to every existing install on
// the day channel_key shipped: `SQLITE_ERROR: no such column: channel_key`,
// thrown before the migration that adds the column had run. It is the fourth
// index in this file to have the shape; the other three predate any install
// still in use and healed on their second boot, which is why they were never
// seen. It would have happened again on the next migration + index pair.
//
// So: collect index DDL next to its table (where it reads best), run it after
// runMigrations(), always with a callback. The ORDERING makes the failure
// impossible; the CALLBACK makes any future one a log line instead of a dead
// app. Enforced structurally by databaseSchemaOrder.test.js.
const deferredIndexes = [];

function createIndex(sql) {
  deferredIndexes.push(sql);
}

function createIndexes() {
  return new Promise((resolve) => {
    if (deferredIndexes.length === 0) return resolve();
    db.serialize(() => {
      let pending = deferredIndexes.length;
      let failed = 0;
      for (const sql of deferredIndexes) {
        db.run(sql, (err) => {
          if (err) {
            failed++;
            // Non-fatal by design: a missing index costs speed, never
            // correctness, and must not stop the app from starting. Loud so it
            // cannot rot silently the way the channel_key one did.
            console.error(
              `[schema] index build failed (non-fatal): ${err.message}\n         ${sql.replace(/\s+/g, ' ').trim()}`
            );
          }
          if (--pending === 0) {
            if (failed > 0) console.error(`[schema] ${failed} of ${deferredIndexes.length} indexes could not be built`);
            resolve();
          }
        });
      }
    });
  });
}

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
        async_tools_enabled INTEGER DEFAULT 0,
        tool_output_cap INTEGER DEFAULT 100000,
        max_tool_rounds INTEGER DEFAULT 100,
        fallback_providers TEXT,
        fallback_enabled INTEGER DEFAULT 0,
        subscription_costs TEXT,
        preferences TEXT
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
        fallback_providers TEXT,
        fallback_enabled INTEGER DEFAULT 0,
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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id)`);
      // Composite index for status-filtered queries (active workflows panel)
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflows_user_status ON workflows(user_id, status)`);

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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_created_at ON workflow_versions(created_at)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_versions_checkpoint ON workflow_versions(is_checkpoint)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON groups(parent_id)`);

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
        last_read_at DATETIME,
        archived_at DATETIME,
        channel_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
      )`);

      // Index for faster content_outputs queries by user_id, sorted by updated_at
      createIndex(`CREATE INDEX IF NOT EXISTS idx_content_outputs_user_id ON content_outputs(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_content_outputs_user_updated ON content_outputs(user_id, updated_at DESC)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_content_outputs_group_id ON content_outputs(group_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_content_outputs_channel ON content_outputs(user_id, channel_key)`);

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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id ON workflow_executions(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_status ON workflow_executions(user_id, status)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_start ON workflow_executions(user_id, start_time)`);

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
      )`);      // Index for faster node execution lookups by execution_id (CRITICAL for run details)
      createIndex(`CREATE INDEX IF NOT EXISTS idx_node_executions_execution_id ON node_executions(execution_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_node_executions_execution_status ON node_executions(execution_id, status)`);

      // Daily activity rollup for the dashboard's Automation Activity chart.
      // One row per (user_id, local date) with pre-aggregated credits/tokens/cost.
      // Finished days are immutable, so each is computed at most once from the
      // raw execution tables (lazily, by ExecutionModel._getActivityViaRollup)
      // and then served from here — O(days in window) per chart request instead
      // of O(entire execution history).
      db.run(`CREATE TABLE IF NOT EXISTS daily_usage_stats (
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        credits_used REAL DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, date)
      )`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_conversation_settings_user_id ON conversation_settings(user_id)`);

      // Migration: per-conversation AI override (provider + model). NULL means
      // "inherit" — the conversation follows the global default. Lives here
      // rather than a new table because conversation_settings already models
      // exactly this: lazily-created per-conversation bindings.
      const conversationAiColumns = [
        { table: 'conversation_settings', name: 'provider', type: 'TEXT' },
        { table: 'conversation_settings', name: 'model', type: 'TEXT' },
      ];
      conversationAiColumns.forEach((col) => {
        db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to ${col.table}:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to ${col.table} table`);
          }
        });
      });

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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_executions_user_id ON agent_executions(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON agent_executions(agent_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_executions_user_start ON agent_executions(user_id, start_time)`);

      // How much larger a real request is than our estimate of it, per
      // provider+model. Learned from provider-reported usage rather than
      // configured: CLI-backed providers (Claude Code, Codex, Kimi) inject
      // their own preamble and built-in tools into every request, and AGNT
      // never receives those bytes, so the only way to know their cost is to
      // measure the response. Keyed by provider+model because it is a property
      // of the backend, not of any one conversation.
      db.run(`CREATE TABLE IF NOT EXISTS estimate_calibration (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        ratio REAL NOT NULL,
        samples INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, model)
      )`);

      // ==================== EXECUTION LEDGER (PRD-122) ====================
      // One row per LLM request/response round-trip, written by exactly one
      // caller: services/execution/LedgerRecorder.js.
      //
      // This table exists because four subsystems (orchestrator chat, workflow
      // LLM node, goal task, goal evaluation) each invented their own
      // bookkeeping and two of them kept no books at all — so "what did this
      // cost?" was not answerable from AGNT's own data.
      //
      // cost_usd IS NULLABLE ON PURPOSE. NULL means "this model has no pricing
      // metadata, so the cost is unknown". Writing 0 there is the exact defect
      // this table was created to fix (see the old `0 as estimated_cost` in
      // ExecutionModel._computeActivityRaw), so every aggregate reports an
      // unpriced COUNT alongside the SUM rather than presenting a total it
      // cannot vouch for.
      //
      // is_notional is frozen at write time rather than looked up at read time:
      // a provider can move between subscription and metered billing, and a
      // historical row must keep describing what was actually true when it was
      // written.
      db.run(`CREATE TABLE IF NOT EXISTS llm_calls (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        execution_id TEXT,
        parent_execution_id TEXT,
        root_execution_id TEXT,
        origin TEXT NOT NULL,
        origin_id TEXT,
        conversation_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_5m_tokens INTEGER DEFAULT 0,
        cache_write_1h_tokens INTEGER DEFAULT 0,
        cost_usd REAL,
        uncached_cost_usd REAL,
        is_notional INTEGER DEFAULT 0,
        duration_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok',
        error TEXT,
        ts DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      createIndex(`CREATE INDEX IF NOT EXISTS idx_llm_calls_user_ts ON llm_calls(user_id, ts)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_llm_calls_execution ON llm_calls(execution_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_llm_calls_root ON llm_calls(root_execution_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_llm_calls_origin ON llm_calls(origin, origin_id)`);

      // Cross-process tripwire for dropped ledger writes.
      //
      // recordLlmCall never throws — losing a bookkeeping row must not fail a
      // provider response the user already paid for. The counter is what keeps
      // that swallow honest, and it MUST be shared: AGNT runs the workflow
      // engine in a separate OS process (backend/src/workflow/WorkflowProcess.js)
      // from the HTTP API, so a counter held in one process's memory is
      // structurally blind to failures in the other — a tripwire that cannot
      // trip for the very path most likely to break.
      //
      // Keyed by process role so a failure can be traced to the process that
      // suffered it. Written best-effort: if THIS write fails too, it is
      // swallowed, because bookkeeping about bookkeeping must never be fatal.
      // Durable mirror of providerConfigs' in-memory dynamicPricingCache
      // (PRD-122). That cache is populated whenever a provider's model list is
      // fetched — including per-model pricing for catalogs that publish it —
      // but it lived only in one process's memory and died on restart. So the
      // boot-time repricer, which runs before any client opens a model picker,
      // could never use it, and models AGNT had already seen priced went
      // "unknown" again every boot. Every process hydrates from this table at
      // startup; registerDynamicPricing writes through to it best-effort.
      db.run(`CREATE TABLE IF NOT EXISTS model_metadata_cache (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        metadata TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS ledger_write_failures (
        source TEXT PRIMARY KEY,
        failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_at DATETIME
      )`);

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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_execution_id ON agent_tool_executions(execution_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_widget_definitions_user_id ON widget_definitions(user_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_widget_layouts_user_id ON widget_layouts(user_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)`);

      // Migration: add slug column for kebab-case canonical name lookup
      // "duplicate column name" is the expected outcome on every boot after
      // the first and is not worth a line; anything else is a real schema
      // failure and must not vanish into an empty callback.
      db.run(`ALTER TABLE skills ADD COLUMN slug TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding slug column to skills:', err);
        }
      });
      createIndex(`CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_id ON skill_versions(skill_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_skill_evaluations_skill_id ON skill_evaluations(skill_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_skill_evaluations_user_id ON skill_evaluations(user_id)`);

      // Security policy — versioned per-user NOPE enforcement settings
      db.run(`CREATE TABLE IF NOT EXISTS security_policies (
        user_id TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

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

      // Evolution performance snapshots — time-series telemetry for meta-cognition
      db.run(`CREATE TABLE IF NOT EXISTS evolution_performance_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        target_type TEXT,
        target_id TEXT,
        score REAL,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_evolution_perf_user ON evolution_performance_snapshots(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_evolution_perf_target ON evolution_performance_snapshots(target_type, target_id)`);

      // Evolution core run receipts — baseline vs best, delta, genome, and routing counts
      db.run(`CREATE TABLE IF NOT EXISTS evolution_core_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        apply_requested INTEGER NOT NULL DEFAULT 0,
        applied INTEGER NOT NULL DEFAULT 0,
        lookback_days INTEGER NOT NULL DEFAULT 7,
        pending_insights_considered INTEGER NOT NULL DEFAULT 0,
        baseline_score REAL,
        best_score REAL,
        delta REAL,
        snapshot_score REAL,
        weights_json TEXT,
        biases_json TEXT,
        genome_json TEXT,
        counts_json TEXT,
        recommendation_json TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_evolution_core_runs_user ON evolution_core_runs(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_evolution_core_runs_created ON evolution_core_runs(created_at)`);


      // Goal iteration history for AGI loop
      db.run(`CREATE TABLE IF NOT EXISTS goal_iterations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id TEXT NOT NULL,
        iteration_number INTEGER NOT NULL,
        evaluation_score REAL,
        evaluation_passed INTEGER DEFAULT 0,
        world_state_snapshot JSON,
        replanned_tasks JSON,
        task_snapshot JSON,
        git_commit_hash TEXT,
        duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
      )`);

      createIndex(`CREATE INDEX IF NOT EXISTS idx_goal_iterations_goal_id ON goal_iterations(goal_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_experiments_user_id ON experiments(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_experiment_runs_experiment_id ON experiment_runs(experiment_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment_id ON experiment_results(experiment_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_eval_datasets_user_id ON eval_datasets(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_eval_datasets_skill_id ON eval_datasets(skill_id)`);

      // ==================== PERFORMANCE INDEXES ====================
      // Agents - faster lookup by user
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(updated_at DESC)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_resources_agent_id ON agent_resources(agent_id)`);

      // Goals - faster lookup by user and status
      createIndex(`CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)`);

      // Tasks - faster lookup by goal
      createIndex(`CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id)`);

      // Custom tools - faster lookup by user
      createIndex(`CREATE INDEX IF NOT EXISTS idx_tools_created_by ON tools(created_by)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_insights_user_id ON insights(user_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_insights_target ON insights(target_type, target_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_insights_source ON insights(source_type, source_id)`);

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

      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_memory_user_id ON agent_memory(user_id)`);

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
      createIndex(`CREATE INDEX IF NOT EXISTS idx_installed_plugin_assets_plugin ON installed_plugin_assets(plugin_name)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_installed_plugin_assets_local ON installed_plugin_assets(asset_type, local_id)`);

      // PRD-091: Closed Loop — Layer 1 (Clock)
      db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        cron TEXT NOT NULL,
        timezone TEXT DEFAULT 'UTC',
        next_run DATETIME,
        last_run DATETIME,
        last_status TEXT,
        last_error TEXT,
        enabled INTEGER DEFAULT 1,
        on_missed TEXT DEFAULT 'fire_once',
        run_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_schedules_target ON schedules(target_type, target_id)`);

      db.run(`CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        run_target_id TEXT,
        fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'fired',
        error TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, fired_at)`);

      // PRD-091: Layer 3 (Wallets) — linear capability budgets
      db.run(`CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT,
        parent_id TEXT,
        kind TEXT NOT NULL DEFAULT 'tokens',
        balance REAL NOT NULL DEFAULT 0,
        allocated REAL NOT NULL DEFAULT 0,
        consumed REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        period_start DATETIME,
        period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (parent_id) REFERENCES wallets(id) ON DELETE CASCADE
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_type, owner_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_wallets_parent ON wallets(parent_id)`);

      db.run(`CREATE TABLE IF NOT EXISTS wallet_ledger (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        amount REAL NOT NULL,
        op TEXT NOT NULL,
        source_kind TEXT,
        source_id TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet ON wallet_ledger(wallet_id, created_at)`);

      // PRD-091: Layer 5 (Contracts) — refinement-type runtime contracts
      db.run(`CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        name TEXT NOT NULL,
        predicate_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'mined',
        confidence REAL DEFAULT 0.5,
        status TEXT DEFAULT 'active',
        evidence_count INTEGER DEFAULT 0,
        violation_count INTEGER DEFAULT 0,
        last_violation_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_contracts_target ON contracts(target_type, target_id, status)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id, status)`);

      db.run(`CREATE TABLE IF NOT EXISTS contract_violations (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        runtime_value TEXT,
        severity TEXT DEFAULT 'warn',
        source_execution_id TEXT,
        observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_contract_violations_contract ON contract_violations(contract_id, observed_at)`);

      // PRD-091: Layer 7 (FitnessScore) — mutation provenance and reward signal
      db.run(`CREATE TABLE IF NOT EXISTS mutation_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        insight_id TEXT,
        target_type TEXT NOT NULL,
        target_id TEXT,
        applied_via TEXT NOT NULL DEFAULT 'router',
        snapshot_kind TEXT,
        snapshot_ref TEXT,
        fitness_before REAL,
        fitness_after REAL,
        delta REAL,
        status TEXT NOT NULL DEFAULT 'applied',
        reverted_at DATETIME,
        revert_reason TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_mutation_history_target ON mutation_history(target_type, target_id, created_at)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_mutation_history_insight ON mutation_history(insight_id)`);
      createIndex(`CREATE INDEX IF NOT EXISTS idx_mutation_history_status ON mutation_history(status)`);

      createIndex(`CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id)`);

      // Table DDL is queued; sqlite3 runs it in call order, so a trailing
      // no-op statement resolving here means every CREATE TABLE above has
      // completed. Indexes are NOT part of this phase (see createIndexes).
      db.run(`SELECT 1`, (err) => (err ? reject(err) : resolve()));
    });
  });
}// --- Guarded build for the activity-chart covering index (2026-07-03) -------
//
// SQLite has no online index build: CREATE INDEX holds the write lock for its
// full duration (it must read every table row once). On small tables that is
// milliseconds and nobody notices; on whale installs (this table has carried
// 1.3M rows / 100+ GB of blob payload) it is minutes — long enough to storm
// every concurrent writer past the 10s busy_timeout. The guard cannot remove
// that stall, only relocate it: small tables build inline at boot, large ones
// defer to a post-boot idle window so the build doesn't collide with startup
// activity (goal processors, waking workflows). Once built, the sqlite_master
// check makes the whole path a permanent no-op.
const ACTIVITY_INDEX = {
  name: 'idx_node_executions_exec_tokens',
  sql: `CREATE INDEX IF NOT EXISTS idx_node_executions_exec_tokens
        ON node_executions(execution_id, input_tokens, output_tokens)`,
  // ~500k rows ≈ a few seconds of build. Below this an inline build is
  // imperceptible; above it the stall is long enough to break writers.
  bigTableRows: 500000,
};

// Idle heuristic: mtime of the WAL sidecar. Every write from EVERY process
// (main server + WorkflowProcess child) touches the WAL, so this observes
// cross-process activity that an in-memory tracker would miss. Checkpoint
// truncation also bumps mtime — an acceptable false-busy, never a false-idle.
function isDbIdle(idleMs, cb) {
  fs.stat(dbPath + '-wal', (err, st) => {
    if (err) return cb(true); // no WAL file => no recent writes; fail open
    cb(Date.now() - st.mtimeMs > idleMs);
  });
}

function scheduleDeferredIndexBuild(attempt = 0) {
  // Env overrides exist for tests only (time-compressing a 5-min/1-h schedule);
  // production installs should never set them.
  const RETRY_DELAY_MS = Number(process.env.AGNT_INDEX_GUARD_RETRY_MS) || 5 * 60 * 1000; // re-check every 5 min
  const IDLE_THRESHOLD_MS = Number(process.env.AGNT_INDEX_GUARD_IDLE_MS) || 3 * 60 * 1000; // "quiet" = no writes for 3 min
  const MAX_GATED_ATTEMPTS = Number(process.env.AGNT_INDEX_GUARD_MAX_ATTEMPTS) || 12; // gate on idleness for ~1h, then force

  const timer = setTimeout(() => {
    isDbIdle(IDLE_THRESHOLD_MS, (idle) => {
      if (!idle && attempt < MAX_GATED_ATTEMPTS) {
        return scheduleDeferredIndexBuild(attempt + 1);
      }
      if (!idle) {
        console.warn(
          `[migrations] DB never went idle within ~1h — building ${ACTIVITY_INDEX.name} anyway; writes may stall for a few minutes`
        );
      }
      const t0 = Date.now();
      db.run(ACTIVITY_INDEX.sql, (err) => {
        if (err) {
          // DDL is transactional: a failed/interrupted build rolls back and the
          // sqlite_master check re-arms this path on next boot. No torn state.
          console.error('[migrations] deferred index build failed (will retry next boot):', err);
        } else {
          console.log(`[migrations] ${ACTIVITY_INDEX.name} built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        }
      });
    });
  }, RETRY_DELAY_MS);
  // Maintenance must never be the reason the process won't exit.
  if (typeof timer.unref === 'function') timer.unref();
}

// Function to run migrations
function runMigrations() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Migration: normalised shape key for near-duplicate memory detection
      // (2026-07-31). The store had 97,502 rows and exactly 2 byte-identical
      // duplicates, so exact-match dedupe was a no-op while 82.5% of rows were
      // near-identical auto-extracted insights. Deliberately NOT backfilled:
      // the column only has to stop future growth, existing rows are already
      // excluded from prompts by the user-set/auto candidate quotas, and a
      // 97k-row rewrite at startup would be a poor trade for that. Existing
      // rows have NULL here and simply never match a dedupe probe.
      db.run(`ALTER TABLE agent_memory ADD COLUMN content_shape TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding content_shape column to agent_memory:', err);
        }
      });
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_memory_shape
              ON agent_memory(agent_id, memory_type, content_shape)`);

      // Migration: duplicate-sighting census on memories (2026-08-01).
      // A near-duplicate write no longer inserts; it bumps these instead, so
      // "this finding recurred 4,859 times" becomes one row carrying a count
      // rather than 4,859 rows. `last_seen_at` is separate from `updated_at`
      // because updated_at is a relevance SORT KEY — writing it on every
      // sighting would make recording a duplicate silently reorder retrieval.
      db.run(`ALTER TABLE agent_memory ADD COLUMN occurrence_count INTEGER DEFAULT 1`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding occurrence_count column to agent_memory:', err);
        }
      });
      db.run(`ALTER TABLE agent_memory ADD COLUMN last_seen_at TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding last_seen_at column to agent_memory:', err);
        }
      });

      // Migration: durable prompt-prefix state (2026-08-01).
      // The frozen system-prompt sections, tool ordering and eviction
      // watermark lived only in ConversationManager's in-memory Map, so every
      // backend restart re-derived the prefix for every live conversation and
      // the next turn paid the 2.0x cache-WRITE rate instead of the 0.1x read
      // rate. Measured at 69,617 rewritten tokens on one 147k conversation.
      // See services/orchestrator/conversationStateStore.js.
      db.run(`CREATE TABLE IF NOT EXISTS conversation_prompt_state (
        conversation_id TEXT PRIMARY KEY,
        user_id TEXT,
        state TEXT NOT NULL,
        state_hash TEXT,
        updated_at TEXT
      )`);
      // Prune scans by age, never by user.
      createIndex(`CREATE INDEX IF NOT EXISTS idx_conversation_prompt_state_updated
              ON conversation_prompt_state(updated_at)`);

      // Migration: novelty gate in front of insight extraction (2026-08-01).
      // Keyed by the SHAPE of an execution's outcome, so a workflow that keeps
      // succeeding identically extracts once instead of once per run. See
      // services/evolution/ExtractionGate.js.
      db.run(`CREATE TABLE IF NOT EXISTS extraction_gate (
        user_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        occurrence_count INTEGER DEFAULT 1,
        first_seen_at TEXT,
        last_seen_at TEXT,
        last_extracted_at TEXT,
        PRIMARY KEY (user_id, source_type, scope_id, signature)
      )`);

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

      // Migration: Add tool_access_mode to agents table (2026-07-18).
      // 'restricted' (default) = assignedTools are the ceiling (plus agent
      // defaults + universal primitives). 'open' = full main-chat dynamic
      // tool surface with assignedTools as always-on pins.
      db.run(`ALTER TABLE agents ADD COLUMN tool_access_mode TEXT DEFAULT 'restricted'`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding tool_access_mode column to agents:', err);
        } else if (!err) {
          console.log('✓ Added tool_access_mode column to agents table');
        }
      });

      // Migration: Per-agent provider-failover chain (2026-07-30, Phase 4).
      // fallback_providers = JSON array of up to 3 { provider, model } tiers;
      // fallback_enabled gates it (0 = off → agent inherits no chain, identical
      // to pre-Phase-4 behavior). Mirrors the users-table columns.
      db.run(`ALTER TABLE agents ADD COLUMN fallback_providers TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding fallback_providers column to agents:', err);
        } else if (!err) {
          console.log('✓ Added fallback_providers column to agents table');
        }
      });

      db.run(`ALTER TABLE agents ADD COLUMN fallback_enabled INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding fallback_enabled column to agents:', err);
        } else if (!err) {
          console.log('✓ Added fallback_enabled column to agents table');
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

      // Migration: Add fallback provider columns to users for automatic
      // cross-provider failover (2026-07-30). fallback_providers holds a JSON
      // array of up to 3 { provider, model } tiers; fallback_enabled gates the
      // whole feature (0 = off, so existing rows behave exactly as before).
      db.run(`ALTER TABLE users ADD COLUMN fallback_providers TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding fallback_providers column to users:', err);
        } else if (!err) {
          console.log('✓ Added fallback_providers column to users table');
        }
      });

      // Migration: what each subscription seat costs per month (PRD-122).
      //
      // AGNT already knows WHICH providers are flat-rate seats
      // (SUBSCRIPTION_PROVIDERS) and what their usage would have cost on a
      // metered API. The one thing it cannot know is what the user actually
      // pays for them — nothing ever asked. Without it the spend panel can say
      // "your seats did $18,463 of metered work" but not what that work cost
      // you, which is the only figure that turns the number into a decision.
      //
      // JSON object keyed by provider: { "claude-code": 200, "openai-codex": 20 }.
      // Entirely optional — NULL means "not told", and every seat figure still
      // renders, just without the comparison.
      db.run(`ALTER TABLE users ADD COLUMN subscription_costs TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding subscription_costs column to users:', err);
        } else if (!err) {
          console.log('✓ Added subscription_costs column to users table');
        }
      });

      db.run(`ALTER TABLE users ADD COLUMN fallback_enabled INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding fallback_enabled column to users:', err);
        } else if (!err) {
          console.log('✓ Added fallback_enabled column to users table');
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

      // Migration: run-tree columns on agent_executions (PRD-122, 2026-08-01)
      //
      // Without a parent pointer a nested run is indistinguishable from a
      // user-initiated one, so "what did this run spawn, and what did the whole
      // tree cost?" was not answerable by any query — the edge was never
      // stored.
      //
      // root_execution_id is denormalised deliberately. Subtree cost is the
      // most frequent query the run tree and the spend HUD will issue, and a
      // recursive CTE on every render is a cost AGNT does not need to pay. It
      // is written once at insert (root = parent ? parent.root : self.id) and
      // never updated, so it cannot drift out of agreement with the parent
      // chain.
      const runTreeColumns = [
        { table: 'agent_executions', name: 'parent_execution_id', type: 'TEXT' },
        { table: 'agent_executions', name: 'root_execution_id', type: 'TEXT' },
        { table: 'agent_executions', name: 'origin', type: "TEXT DEFAULT 'chat'" },
      ];

      runTreeColumns.forEach((col) => {
        db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to ${col.table}:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to ${col.table} table`);
          }
        });
      });

      // Was `db.run(..., () => {})` — an empty callback, which is the other
      // way to lose a schema failure: not fatal, just invisible. createIndex()
      // logs it.
      createIndex(`CREATE INDEX IF NOT EXISTS idx_agent_executions_root ON agent_executions(root_execution_id)`);

      // One-time cache invalidation for the usage rollup (PRD-122).
      //
      // daily_usage_stats is a derived cache of _computeActivityRaw, and that
      // query used to hard-code `0 as estimated_cost` for every workflow day.
      // Rows computed under the old query would keep reporting zero forever,
      // because only "yesterday" carries a freshness window — older days are
      // cached permanently.
      //
      // The predicate is deliberately `computed_at < <now>` rather than an
      // unqualified delete: the rows that need invalidating are exactly those
      // computed by the PREVIOUS version of the query, and this migration body
      // runs once (marker-guarded). Rows written afterwards come from the
      // corrected query and must survive. Nothing is lost either way — it is a
      // cache, and the recompute is the same query the dashboard runs anyway.
      db.run(
        `CREATE TABLE IF NOT EXISTS schema_markers (
          marker TEXT PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        () => {
          db.get(
            `SELECT marker FROM schema_markers WHERE marker = ?`,
            ['prd122_usage_rollup_reset'],
            (markerErr, markerRow) => {
              if (markerErr || markerRow) return; // already applied, or cannot tell — leave it alone
              const cutoff = new Date().toISOString().replace('T', ' ').slice(0, 19);
              db.run(
                `DELETE FROM daily_usage_stats WHERE computed_at <= ?`,
                [cutoff],
                (delErr) => {
                  if (delErr) {
                    // Status quo (stale cache persists); self-heals next boot.
                    console.error('[migrations] usage rollup reset failed:', delErr);
                    return;
                  }
                  db.run(`INSERT OR IGNORE INTO schema_markers (marker) VALUES (?)`, [
                    'prd122_usage_rollup_reset',
                  ]);
                  console.log('✓ Reset stale daily_usage_stats so workflow spend recomputes (PRD-122)');
                }
              );
            }
          );
        }
      );

      // Migration: Covering index for the activity chart's token aggregation (2026-07-03).
      // Contains every column the /executions/activity inner subquery touches, so
      // SQLite serves it index-only and never reads node_executions table rows —
      // which matters because those rows carry multi-MB input/output JSON blobs in
      // overflow-page chains that must be walked just to reach the trailing token
      // columns. Must run AFTER the token-column migration above: the base CREATE
      // TABLE does not include input_tokens/output_tokens on fresh installs.
      // (db.run calls are serialized per connection, so submission order holds.)
      //
      // GUARDED: see ACTIVITY_INDEX above. Small tables build inline; large
      // tables defer to an idle window instead of stalling writers at boot.
      db.get(
        `SELECT name FROM sqlite_master WHERE type='index' AND name = ?`,
        [ACTIVITY_INDEX.name],
        (idxErr, idxRow) => {
          if (idxErr) {
            // Status quo (no index this boot); self-heals on next boot.
            console.error('[migrations] activity index existence check failed:', idxErr);
            return;
          }
          if (idxRow) return; // already built — permanent no-op (the common case)

          // MAX(rowid) is O(1) (one b-tree descent); COUNT(*) would scan an
          // index. Overestimates after deletes — fine for a threshold heuristic.
          db.get(`SELECT MAX(rowid) AS approxRows FROM node_executions`, (cntErr, r) => {
            if (cntErr) {
              console.error('[migrations] activity index row estimate failed:', cntErr);
              return;
            }
            const approxRows = (r && r.approxRows) || 0;
            if (approxRows < ACTIVITY_INDEX.bigTableRows) {
              db.run(ACTIVITY_INDEX.sql, (err) => {
                if (err) {
                  console.error('Error creating idx_node_executions_exec_tokens:', err);
                }
              });
            } else {
              console.warn(
                `[migrations] node_executions has ~${approxRows.toLocaleString()} rows — ` +
                  `deferring ${ACTIVITY_INDEX.name} build to an idle window (activity chart ` +
                  `uses the slower un-indexed path until then)`
              );
              scheduleDeferredIndexBuild();
            }
          });
        }
      );

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
        { name: 'task_snapshot', type: 'JSON' },
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

      // Migration: Add last_read_at column to content_outputs for server-side
      // cross-device unread tracking (2026-08-04). Unread is DERIVED, not
      // stored: a conversation is unread iff it HAS a watermark and a later
      // change has overtaken it (updated_at > last_read_at).
      //
      // NO BACKFILL. This migration originally ran
      //   UPDATE content_outputs SET last_read_at = updated_at
      // once, on the run that added the column, so that no pre-existing
      // conversation would retroactively count as unread. That was a trap in
      // three ways and it fired:
      //
      //   1. It is a single fire-and-forget write across every conversation
      //      the user has ever had — ~780MB of `content` on a real install,
      //      rewritten row by row. Slow, and interruptible by quitting the app.
      //   2. It only runs in the `!err` branch, i.e. exactly once ever. There
      //      is no second chance and nothing checks the outcome.
      //   3. Its failure mode is not "a few rows look odd" — it is that EVERY
      //      conversation in history becomes unread, because the old predicate
      //      read a missing watermark as "needs your attention". Observed on a
      //      live install: 1624 of 1649 conversations in the triage rail.
      //
      // Correctness now comes from the predicate instead of from a write: a
      // NULL watermark means "no evidence of anything unseen", so legacy rows
      // are quiet by construction, and each one acquires a real watermark the
      // first time it is saved (ContentOutputModel.createOrUpdate) or opened.
      // Idempotent, incremental, and it cannot half-apply.
      db.run(`ALTER TABLE content_outputs ADD COLUMN last_read_at DATETIME`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding last_read_at column to content_outputs:', err);
        } else if (!err) {
          console.log('✓ Added last_read_at column to content_outputs table');
        }
      });

      // Migration: Add channel_key column to content_outputs (2026-08-05).
      //
      // WHO OWNS THIS ROW. NULL means the main chat list owns it: it is one of
      // the user's conversations and belongs in the sidebar. Non-NULL means it
      // belongs to a chat channel embedded somewhere else in the app
      // ('workspace:<id>', 'artifact:<id>', 'widget:<id>', ...), and the
      // sidebar must not list it.
      //
      // Needed because durable transcripts for those embedded chats landed in
      // the same table with content_type 'conversation' — and the sidebar
      // query has NO type filter at all, it lists every row a user owns. So
      // every workspace chat appeared in the main conversation list. Scope is
      // not a property of the CONTENT (they are all conversations), so it
      // could not be expressed by content_type; it is a property of who the
      // row belongs to, which is what this column says.
      //
      // NO BACKFILL, and none is possible here: which rows are channel-scoped
      // is knowledge only the client holds (it owns the channel -> conversation
      // map). Existing rows are repaired by chatUnified's one-time
      // reclaimChannelScopes sweep, and every save from a channel carries its
      // channelKey from now on. A NULL column therefore degrades to exactly
      // the old behaviour rather than to a wrong answer.
      db.run(`ALTER TABLE content_outputs ADD COLUMN channel_key TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding channel_key column to content_outputs:', err);
        } else if (!err) {
          console.log('✓ Added channel_key column to content_outputs table');
        }
      });

      // Migration: Add archived_at column to content_outputs for the
      // conversation done/archive lifecycle (2026-08-04). NULL = live;
      // non-NULL = archived out of the main sidebar list (still searchable,
      // never counts as unread). Deliberately does not touch updated_at so
      // unarchiving restores the conversation's original sort position.
      db.run(`ALTER TABLE content_outputs ADD COLUMN archived_at DATETIME`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding archived_at column to content_outputs:', err);
        } else if (!err) {
          console.log('✓ Added archived_at column to content_outputs table');
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

      // Migration: Add tool_output_cap column to users — user-tunable hard cap
      // on tool result size returned to the LLM. Backs the "Tool output limit"
      // control on Settings → AI Provider. Default 100000 chars (~28k tokens)
      // matches the prior hardcoded MAX_TOOL_RESULT_CHARS in OrchestratorService.
      db.run(`ALTER TABLE users ADD COLUMN tool_output_cap INTEGER DEFAULT 100000`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding tool_output_cap column to users:', err);
        } else if (!err) {
          console.log('✓ Added tool_output_cap column to users table');
        }
      });

      // Migration: Add max_tool_rounds column to users — user-tunable cap on
      // the number of tool execution rounds per chat turn. Overrides the
      // per-surface defaults in chatConfigs.js (orchestrator/agent/tool/widget/
      // goal default 100; workflow/artifact default 25). Default 100 matches
      // the highest historical surface cap, so existing users see no change.
      db.run(`ALTER TABLE users ADD COLUMN max_tool_rounds INTEGER DEFAULT 100`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding max_tool_rounds column to users:', err);
        } else if (!err) {
          console.log('✓ Added max_tool_rounds column to users table');
        }
      });

      // Migration: Add preferences column to users — cross-device UI
      // preferences (theme, font, panel geometry) as a single JSON blob
      // (2026-08-06). A blob rather than a column per setting because these
      // are presentation keys with no query, index or constraint against
      // them: a column each would mean a schema migration every time someone
      // adds a toggle, for no gain the blob does not already provide.
      //
      // Structure and validation live in src/utils/userPreferences.js. NULL
      // (every existing row) is the documented empty state and reads back as
      // "no stored preferences", so upgrading installs keep whatever their
      // browsers already have in localStorage.
      db.run(`ALTER TABLE users ADD COLUMN preferences TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding preferences column to users:', err);
        } else if (!err) {
          console.log('✓ Added preferences column to users table');
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

      // PRD-091: Layer 4 (Autonomy Router) — insight routing decisions
      const autonomyInsightColumns = [
        { name: 'autonomy_decision', type: 'TEXT' },
        { name: 'autonomy_reason', type: 'TEXT' },
        { name: 'blast_radius', type: 'REAL' },
        { name: 'gate_delta', type: 'REAL' },
        { name: 'gated_at', type: 'DATETIME' },
        { name: 'escalated_at', type: 'DATETIME' },
      ];
      autonomyInsightColumns.forEach((col) => {
        db.run(`ALTER TABLE insights ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding ${col.name} column to insights:`, err);
          } else if (!err) {
            console.log(`✓ Added ${col.name} column to insights table`);
          }
        });
      });

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
    // Indexes LAST: the schema is only final once migrations have run. See the
    // createIndex() comment — building them any earlier is what took boot down
    // with `no such column: channel_key` on every upgrading install.
    return createIndexes();
  })
  .then(() => {
    console.log('All indexes ready');
  })
  .then(async () => {
    // Heal duplicate widget_layouts route pages and make (user_id, route)
    // structurally unique. See widgetLayoutDedupe.js for the full history —
    // a frontend race leaked one orphaned page row per cold start. Non-fatal:
    // a database that can't be deduped is still a usable database.
    try {
      await ensureWidgetLayoutRouteUniqueness(db);
    } catch (error) {
      console.error('widget_layouts dedupe failed (non-fatal):', error.message);
    }
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
    // Startup stale-run sweep. The orchestrator's finally block can
    // never fire across a process restart, so any agent_executions row still
    // marked 'running' at boot belongs to a process that no longer exists and
    // would otherwise stay 'running' forever. Mark them interrupted so the UI
    // and stats reflect reality. Main process only (the workflow child skips
    // schema init via AGNT_SKIP_DB_INIT=1 and never reaches this chain).
    // NOTE: if AGNT is ever deployed multi-worker against a shared DB, this
    // sweep must be scoped to the booting worker's own runs.
    try {
      const sweptCount = await new Promise((resolve, reject) => {
        db.run(
          `UPDATE agent_executions
             SET status = 'interrupted',
                 end_time = CURRENT_TIMESTAMP,
                 error = 'Run interrupted by app restart'
           WHERE status = 'running'`,
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
      if (sweptCount > 0) {
        console.log(`Startup sweep: marked ${sweptCount} stale 'running' execution(s) as 'interrupted'`);
      }
    } catch (error) {
      console.error('Startup stale-run sweep failed (non-fatal):', error);
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
  .then(() => {
    // One-time remediation for pre-2026-07 conversation blobs that carry
    // inline base64 images (the frontend used to inline at save time; it no
    // longer does). Extracts images into ImageStorage and rewrites blobs to
    // {{IMAGE_REF}} tokens. Idle-gated and deferred — boot cost is zero —
    // and every row is byte-verified on disk before its blob is touched.
    // Dynamic import: a defect in the backfill module must never break boot.
    // Installs with no legacy blobs scan once, find nothing, and no-op.
    try {
      import('../../services/storage/ConversationImageBackfill.js')
        .then(({ scheduleConversationImageBackfill }) =>
          import('../../services/ImageStorage.js').then((imageStorage) => {
            scheduleConversationImageBackfill({
              dbAll: (sql, params = []) =>
                new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || [])))),
              dbRun: (sql, params = []) =>
                dbRunWithRetry(
                  () =>
                    new Promise((resolve, reject) =>
                      db.run(sql, params, function (e) {
                        if (e) reject(e);
                        else resolve(this.changes);
                      })
                    )
                ),
              saveBase64Image: imageStorage.saveBase64Image,
              findImageFile: imageStorage.findImageFile,
              walPath: dbPath + '-wal',
              backupDir: path.join(dbDir, 'backfill-backups'),
              log: (msg) => console.log(msg),
            });
          })
        )
        .catch((error) => {
          console.error('[migrations] conversation image backfill failed to schedule (non-fatal):', error.message);
        });
    } catch (error) {
      console.error('[migrations] conversation image backfill scheduling error (non-fatal):', error.message);
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
