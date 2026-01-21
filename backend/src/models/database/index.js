import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import WebhookModel from '../WebhookModel.js';

// Get user data path - prioritize USER_DATA_PATH env var (set by Electron)
const getUserDataPath = () => {
  // 1. Docker: Use /app/data if it exists (mounted volume)
  if (process.env.NODE_ENV === 'production' && fs.existsSync('/app/data')) {
    console.log('Using Docker volume for database: /app/data');
    return '/app/data';
  }

  // 2. Electron: Use USER_DATA_PATH env var (ASAR-compatible)
  if (process.env.USER_DATA_PATH) {
    const userPath = path.join(process.env.USER_DATA_PATH, 'Data');
    console.log('Using USER_DATA_PATH for database:', userPath);
    return userPath;
  }

  // 3. Development: Use ./data in project root
  const devPath = path.resolve(process.cwd(), 'data');
  if (process.env.NODE_ENV !== 'production' || process.cwd().includes('backend')) {
    console.log('Using development data directory:', devPath);
    return devPath;
  }

  // 4. User home fallback (self-hosted, non-Docker)
  const userPath =
    process.platform === 'darwin'
      ? path.join(process.env.HOME, 'Library', 'Application Support', 'AGNT', 'Data') // Mac: ~/Library/Application Support/AGNT/Data
      : process.platform === 'win32'
      ? path.join(process.env.APPDATA || process.env.USERPROFILE, 'AGNT', 'Data') // Windows: %APPDATA%/AGNT/Data
      : path.join(process.env.HOME || '/tmp', '.agnt', 'data'); // GNU/Linux: ~/.agnt/data

  console.log('Using user home directory for database:', userPath);
  return userPath;
};

// Ensure database directory exists with error handling
let dbDir = getUserDataPath();
try {
  if (!fs.existsSync(dbDir)) {
    console.log('Creating directory:', dbDir);
    fs.mkdirSync(dbDir, { recursive: true });
  }
  // Test write permissions
  const testFile = path.join(dbDir, '.test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('Successfully verified write permissions to:', dbDir);
} catch (error) {
  console.error('Error with primary directory:', error);
  // Fallback to user's Documents folder on Mac
  if (process.platform === 'darwin') {
    dbDir = path.join(process.env.HOME, 'Documents', 'AGNT_Data');
  } else {
    dbDir = path.join(process.env.HOME || process.env.USERPROFILE, 'AGNT_Data');
  }
  console.log('Falling back to:', dbDir);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// Database path in user's data directory
const dbPath = path.join(dbDir, 'agnt.db');
console.log('Final database path:', dbPath);

// Initialize database with error handling
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database initialization error:', err);
  } else {
    console.log('Database successfully initialized at:', dbPath);

    // WAL mode for better concurrency (optional, disabled by default)
    // Enable with SQLITE_WAL_MODE=true environment variable
    // WARNING: WAL mode may cause issues with single-user scenarios or networked filesystems
    const enableWAL = process.env.SQLITE_WAL_MODE === 'true';
    if (enableWAL) {
      db.run('PRAGMA journal_mode = WAL', (err) => {
        if (err) {
          console.error('Failed to enable WAL mode:', err);
        } else {
          console.log('✓ WAL mode enabled (multi-client concurrency support)');
        }
      });
    } else {
      console.log('WAL mode disabled (default). Set SQLITE_WAL_MODE=true to enable multi-client support.');
    }

    // Set busy timeout to 5 seconds to handle concurrent access
    db.run('PRAGMA busy_timeout = 5000', (err) => {
      if (err) {
        console.error('Failed to set busy_timeout:', err);
      } else {
        console.log('Busy timeout set to 5000ms');
      }
    });
  }
});

// Function to create tables
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
        default_model TEXT DEFAULT 'claude-3-5-sonnet-20240620'
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      )`);

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
      )`,
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
    // Add provider and model columns to agents table if they don't exist
    // db.run(`ALTER TABLE agents ADD COLUMN provider TEXT`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding provider column:', err);
    //   }
    // });
    // db.run(`ALTER TABLE agents ADD COLUMN model TEXT`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding model column:', err);
    //   }
    // });
    // // Add default_provider and default_model columns to users table if they don't exist
    // db.run(`ALTER TABLE users ADD COLUMN default_provider TEXT DEFAULT 'Anthropic'`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding default_provider column:', err);
    //   }
    // });
    // db.run(`ALTER TABLE users ADD COLUMN default_model TEXT DEFAULT 'claude-3-5-sonnet-20240620'`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding default_model column:', err);
    //   }
    // });
    // // Add updated_at column to users table if it doesn't exist
    // db.run(`ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding updated_at column:', err);
    //   }
    // });
    // // Add input, output, and error columns to tasks table if they don't exist
    // db.run(`ALTER TABLE tasks ADD COLUMN input JSON`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding input column to tasks:', err);
    //   }
    // });
    // db.run(`ALTER TABLE tasks ADD COLUMN output JSON`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding output column to tasks:', err);
    //   }
    // });
    // db.run(`ALTER TABLE tasks ADD COLUMN error TEXT`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding error column to tasks:', err);
    //   }
    // });
    // // Add content_type and conversation_id columns to content_outputs table if they don't exist
    // db.run(`ALTER TABLE content_outputs ADD COLUMN content_type TEXT DEFAULT 'html'`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding content_type column:', err);
    //   }
    // });
    // db.run(`ALTER TABLE content_outputs ADD COLUMN conversation_id TEXT`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding conversation_id column:', err);
    //   }
    // });
    // db.run(`ALTER TABLE content_outputs ADD COLUMN title TEXT`, (err) => {
    //   if (err && !err.message.includes('duplicate column name')) {
    //     console.error('Error adding title column:', err);
    //   } else {
    //     resolve();
    //   }
    // });
  });
}

// Ensure tables are created before exporting the database
createTables()
  .then(() => {
    console.log('All tables created successfully');
    return runMigrations();
  })
  .then(() => {
    console.log('All migrations completed successfully');
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

export default db;
