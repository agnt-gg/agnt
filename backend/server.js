import 'dotenv/config';
// MUST stay directly under dotenv, and BEFORE every other import: AuthManager
// (`export default new AuthManager()`) and Middleware (`new Middleware()`)
// capture these values in constructors that run at import time, so filling the
// defaults from a statement further down would run too late. Replaces the
// non-secret half of the committed backend/.env — see src/config/envDefaults.js.
import './src/config/envDefaults.js';
// Populates process.env.JWT_SECRET, which five sites read directly and which
// the committed backend/.env used to supply. Without it every session on the
// machine is rejected — jwt.verify(token, undefined) throws and each caller
// downgrades to unauthenticated. See src/config/secretsBootstrap.js.
import './src/config/secretsBootstrap.js';
// MUST stay directly under dotenv: import hoisting means diagnostics are live
// before any other module's top-level code can throw.
import './src/diagnostics/bootstrap.js';
import cors from 'cors';
import express from 'express';
import compression from 'compression';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { resolveSocketIdentity, SocketIdentitySource } from './src/utils/socketIdentity.js';
import { createSpaFallback } from './src/routes/spaFallback.js';

// Import plugin system
import PluginInstaller from './src/plugins/PluginInstaller.js';
import PluginManager from './src/plugins/PluginManager.js';

// Import your API routes
import UserRoutes from './src/routes/UserRoutes.js';
import AuthRoutes from './src/routes/AuthRoutes.js';
import ProviderAuthRoutes from './src/routes/ProviderAuthRoutes.js';
import StreamRoutes from './src/routes/StreamRoutes.js';
import WorkflowRoutes from './src/routes/WorkflowRoutes.js';
import ExecutionRoutes from './src/routes/ExecutionRoutes.js';
import CustomToolRoutes from './src/routes/CustomToolRoutes.js';
import ContentOutputRoutes from './src/routes/ContentOutputRoutes.js';
import AgentRoutes from './src/routes/AgentRoutes.js';
import GoalRoutes from './src/routes/GoalRoutes.js';
import LayoutRoutes from './src/routes/LayoutRoutes.js';
import WorkspaceRoutes from './src/routes/WorkspaceRoutes.js';
import OrchestratorRoutes from './src/routes/OrchestratorRoutes.js';
import ToolsRoutes from './src/routes/ToolsRoutes.js';
import ToolSchemaRoutes from './src/routes/ToolSchemaRoutes.js';
import ModelRoutes from './src/routes/ModelRoutes.js';
import CustomProviderRoutes from './src/routes/CustomProviderRoutes.js';
import LlmGatewayRoutes from './src/routes/LlmGatewayRoutes.js';
import BrowserAgentRoutes from './src/routes/BrowserAgentRoutes.js';
import MCPRoutes from './src/routes/MCPRoutes.js';
import NPMRoutes from './src/routes/NPMRoutes.js';
import WebhookRoutes from './src/routes/WebhookRoutes.js';
import EmailListenerRoutes from './src/routes/EmailListenerRoutes.js';
import SpeechRoutes from './src/routes/SpeechRoutes.js';
import PluginRoutes from './src/routes/PluginRoutes.js';
import AsyncToolRoutes from './src/routes/AsyncToolRoutes.js';
import WidgetDefinitionRoutes from './src/routes/WidgetDefinitionRoutes.js';
import SkillRoutes from './src/routes/SkillRoutes.js';
import SkillDiscoveryRoutes from './src/routes/SkillDiscoveryRoutes.js';
import SkillForgeRoutes from './src/routes/SkillForgeRoutes.js';
import ExperimentRoutes from './src/routes/ExperimentRoutes.js';
import FileSystemRoutes from './src/routes/FileSystemRoutes.js';
import InsightRoutes from './src/routes/InsightRoutes.js';
import MemoryRoutes from './src/routes/MemoryRoutes.js';
import GroupRoutes from './src/routes/GroupRoutes.js';
import ImageRoutes from './src/routes/ImageRoutes.js';
import LocalFileRoutes from './src/routes/LocalFileRoutes.js';
import AdminClientVersionRoutes from './src/routes/AdminClientVersionRoutes.js';
import ConversationSettingsRoutes from './src/routes/ConversationSettingsRoutes.js';
import RoutingRoutes from './src/routes/RoutingRoutes.js';
import ScheduleRoutes from './src/routes/ScheduleRoutes.js';
import SchedulerService from './src/services/scheduler/SchedulerService.js';
import WalletRoutes from './src/routes/WalletRoutes.js';
import LedgerRoutes from './src/routes/LedgerRoutes.js';
import ContractRoutes from './src/routes/ContractRoutes.js';
import MutationHistoryRoutes from './src/routes/MutationHistoryRoutes.js';
import EvolutionCoreRoutes from './src/routes/EvolutionCoreRoutes.js';
import { dbReady } from './src/models/database/index.js';
import { warmupClientVersions } from './src/services/ai/clientVersions.js';
import { prewarmCodexModels } from './src/routes/ModelRoutes.js';
import WorkflowProcessBridge from './src/workflow/WorkflowProcessBridge.js';
import { broadcastToUser, broadcast, RealtimeEvents } from './src/utils/realtimeSync.js';
import { sessionMiddleware } from './src/routes/Middleware.js';
import CodexCliSessionManager from './src/services/ai/CodexCliSessionManager.js';
import { stashSteer, clearSteer } from './src/services/OrchestratorService.js';
import SystemRoutes from './src/routes/SystemRoutes.js';
import ImportRoutes from './src/routes/ImportRoutes.js';
import PairingRoutes from './src/routes/PairingRoutes.js';
import RemoteAccessConfig from './src/services/RemoteAccessConfig.js';
import RestartManager from './src/services/RestartManager.js';
import { createGracefulShutdown } from './src/utils/gracefulShutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server configuration
const config = {
  port: process.env.PORT || 3333,
  corsOptions: {
    origin: [
      process.env.FRONTEND_DEV_URL,
      process.env.FRONTEND_DIST_URL,
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3333',
      'http://127.0.0.1:33333',
      'http://localhost:3333',
      'http://localhost:33333',
      'https://agnt.gg',
      'https://www.agnt.gg',
      'https://alpha.agnt.gg',
      'https://www.alpha.agnt.gg',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 204,
  },
  bodyParserLimit: '250mb',
};

// Initialize express app
const app = express();

// Enable CORS and body parsing
app.use(cors(config.corsOptions));
// Gzip JSON / text responses above 1 KB. JSON compresses 10-20x.
//
// CRITICAL: compression buffers responses by default, which destroys
// Server-Sent Events streaming (chat tokens arrive only after the full
// response, not incrementally). We exclude known streaming route prefixes
// up front, and additionally honour `x-no-compression` so any new endpoint
// can opt out without touching this file.
//
// SSE-bearing route prefixes (verified via grep for `text/event-stream`
// and `Content-Type: text/event-stream`):
//   /api/stream/*         — StreamEngine SSE
//   /api/orchestrator/*   — chat orchestrator SSE (every chat surface)
//   /api/users/*          — magic-link SSE response
//   /api/plugins/*        — plugin install/uninstall progress SSE
const STREAMING_PATH_PREFIXES = [
  '/api/stream',
  '/api/orchestrator',
  '/api/users/auth/magic-link',
  '/api/plugins',
];
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    if (STREAMING_PATH_PREFIXES.some((p) => req.path.startsWith(p))) return false;
    // Last-resort guard: if the route has already set a streaming
    // content-type by the time the filter runs, skip too.
    const ct = res.getHeader('Content-Type');
    if (typeof ct === 'string' && ct.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));
// Reachability witness. One assignment per request, only for non-loopback
// callers. It exists so the Phone Access panel can answer "has my phone
// actually reached this machine?" instead of failing silently.
app.use((req, _res, next) => {
  RemoteAccessConfig.recordExternalRequest(req);
  next();
});
app.use(bodyParser.json({ limit: config.bodyParserLimit }));
app.use(bodyParser.urlencoded({ limit: config.bodyParserLimit, extended: true }));
app.use(sessionMiddleware);

// Drain guard: while a supervisor-sanctioned restart is in progress, new API
// calls get a clean 503 { restarting: true } instead of dying mid-flight on a
// closing socket. /api/health and /api/system stay reachable for the poller.
app.use(RestartManager.drainGuard);

// Conditionally serve built frontend static files if they exist
// Assumes the frontend build output is in ../frontend/dist relative to this file.
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendExists = fs.existsSync(frontendDistPath) && fs.existsSync(path.join(frontendDistPath, 'index.html'));

if (frontendExists) {
  console.log('Frontend dist found - serving static files from:', frontendDistPath);
  app.use(express.static(frontendDistPath, {
    // Let express set ETags on every static asset so reload conditional GETs
    // can short-circuit with 304 when nothing changed.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        // `no-cache` = store but always revalidate. With ETag the browser
        // sends a conditional GET on reload and gets a 0-byte 304 when the
        // bundle hash hasn't changed (instead of re-downloading the shell).
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        // Vite-hashed JS/CSS/asset filenames are content-addressed — safe
        // to cache forever. New deploys ship new filenames; old ones stay
        // valid for already-loaded pages.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
} else {
  console.log('No frontend dist found - running in backend-only mode');
}

// Define API routes
app.use('/lite', express.static(path.join(__dirname, '..', 'lite')));
app.use('/api/users', UserRoutes);
app.use('/api/auth', AuthRoutes);
app.use('/api/providers', ProviderAuthRoutes);
app.use('/api/stream', StreamRoutes);
app.use('/api/agents', AgentRoutes);
app.use('/api/workflows', WorkflowRoutes);
app.use('/api/executions', ExecutionRoutes);
app.use('/api/custom-tools', CustomToolRoutes);
app.use('/api/content-outputs', ContentOutputRoutes);
app.use('/api/goals', GoalRoutes);
app.use('/api/layouts', LayoutRoutes);
app.use('/api/workspaces', WorkspaceRoutes);
app.use('/api/orchestrator', OrchestratorRoutes);
app.use('/api/tools', ToolsRoutes);
app.use('/api/tool-schemas', ToolSchemaRoutes);
app.use('/api/models', ModelRoutes); // Generic models endpoint for all providers
app.use('/api/openrouter', ModelRoutes); // Legacy support for OpenRouter
app.use('/api/custom-providers', CustomProviderRoutes);
// Loopback-only OpenAI-compatible shim over our own providers, so a child
// process (the Browser Agent's Python runner) can reach subscription-auth
// providers it could never hold credentials for. Auth is its own short-lived
// per-run token, NOT the session JWT — see services/ai/localGatewayTokens.js.
app.use('/api/llm', LlmGatewayRoutes);
// Drives the browser rendered inside the Browser widget, via a CDP endpoint the
// Electron main process exposes for that one surface.
app.use('/api/browser-agent', BrowserAgentRoutes);
app.use('/api/mcp', MCPRoutes);
app.use('/api/npm', NPMRoutes);
app.use('/api/webhooks', WebhookRoutes);
app.use('/api/email-listeners', EmailListenerRoutes);
app.use('/api/speech', SpeechRoutes);
app.use('/api/plugins', PluginRoutes);
app.use('/api/async-tools', AsyncToolRoutes);
app.use('/api/widget-definitions', WidgetDefinitionRoutes);
app.use('/api/skills/discovered', SkillDiscoveryRoutes);
app.use('/api/skills', SkillRoutes);
app.use('/api/skillforge', SkillForgeRoutes);
app.use('/api/experiments', ExperimentRoutes);
app.use('/api/insights', InsightRoutes);
app.use('/api/memory', MemoryRoutes);
app.use('/api/groups', GroupRoutes);
app.use('/api/filesystem', FileSystemRoutes);
app.use('/api/images', ImageRoutes);
app.use('/api/local-file', LocalFileRoutes);
app.use('/api/admin', AdminClientVersionRoutes);
app.use('/api/conversations', ConversationSettingsRoutes);
app.use('/api/schedules', ScheduleRoutes);
app.use('/api/wallets', WalletRoutes);
app.use('/api/ledger', LedgerRoutes);
app.use('/api/routing', RoutingRoutes);
app.use('/api/contracts', ContractRoutes);
app.use('/api/mutations', MutationHistoryRoutes);
app.use('/api/evolution', EvolutionCoreRoutes);
app.use('/api/system', SystemRoutes);
app.use('/api/import', ImportRoutes);
app.use('/api/pairing', PairingRoutes);

// PRD-122: inherit pre-ledger history from agent_executions, once. Marker-
// guarded and per-row idempotent, so this line is a no-op on every boot after
// the first. Without it, a spend window of "last 30 days" and "last 1 day"
// returned identical figures — the ledger only knew about calls made after it
// shipped.
dbReady.then(async () => {
  const { backfillFromAgentExecutions, backfillFromNodeExecutions, repriceUnpricedCalls } =
    await import('./src/services/execution/LedgerRecorder.js');
  const { initModelMetadataPersistence, syncPublicModelCatalog } = await import('./src/services/ai/modelMetadataPersistence.js');
  try {
    // Order matters: hydrate what past runs learned, refresh from the public
    // catalog (fail-soft when offline), THEN reprice — so a model that gained
    // a price since the last boot heals its history in this same boot.
    await initModelMetadataPersistence();
    await syncPublicModelCatalog();
    await backfillFromAgentExecutions();
    await backfillFromNodeExecutions();
    // Runs every start on purpose: when a model gains pricing metadata,
    // history heals itself without anyone remembering this exists.
    await repriceUnpricedCalls();
  } catch (err) {
    console.error('[Ledger] backfill/reprice failed (will retry next boot):', err);
  }
});

// PRD-091: Closed Loop — boot the durable scheduler once the DB is ready.
dbReady.then(() => {
  SchedulerService.start().catch((err) => {
    console.error('[Scheduler] Failed to start:', err);
  });
});

// Restore turns that were still generating when the last process died.
//
// The sibling of the stale-run sweep in models/database/index.js, and for the
// same reason: the orchestrator's finally block cannot fire across a restart.
// The sweep marks those executions 'interrupted' so the UI stops lying about
// them; this puts the ANSWER back, from the on-disk replay journal, into the
// conversation where the user will look for it.
//
// Main process only, matching the sweep — the workflow child sets
// AGNT_SKIP_DB_INIT=1 and has no runs of its own to recover.
//
// Deliberately not awaited: recovery reads files and writes a handful of rows,
// and no request depends on it having finished. A failure inside is logged and
// swallowed by the function itself.
if (process.env.AGNT_SKIP_DB_INIT !== '1') {
  dbReady.then(async () => {
    try {
      const { recoverJournaledRuns } = await import('./src/services/orchestrator/recoverJournaledRuns.js');
      await recoverJournaledRuns();
    } catch (err) {
      console.error('[RunRecovery] Boot recovery failed (non-fatal):', err);
    }

    // Safety net for the journal. The event-driven throttle already gets every
    // published event to disk within seconds; what it cannot do is retry a
    // write that FAILED, because it only ever schedules work when the next
    // event arrives — and during a long synchronous tool call none does. This
    // sweeps for runs whose journal is behind, and skips silently when none is.
    try {
      const [{ startJournalHeartbeat }, { liveRuns }] = await Promise.all([
        import('./src/services/orchestrator/runJournal.js'),
        import('./src/services/orchestrator/activeRuns.js'),
      ]);
      startJournalHeartbeat(liveRuns);
    } catch (err) {
      console.warn('[RunJournal] Heartbeat not started (non-fatal):', err?.message || err);
    }
  });
}
// Version + update-check endpoints share a one-time cached package.json read
// (PRD-084-R2 §0.5) — the app version cannot change without a restart, so
// re-reading and re-parsing the file on every request was wasted I/O.
let cachedPackageJson = null;
const getPackageJson = () => {
  if (!cachedPackageJson) {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    cachedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  }
  return cachedPackageJson;
};

/**
 * Liveness, and — for callers on this machine only — identity.
 *
 * The desktop app asks this BEFORE forking a backend, so that "port 3333 is
 * already taken" becomes a choice (attach to the running AGNT, or replace it)
 * instead of a failed bind that reads as a crash. Making that choice requires
 * knowing WHO is there, and replacing it requires a pid.
 *
 * The identity fields are loopback-only. An install that has opted into LAN
 * access has no reason to publish its process id to the network, and a remote
 * caller could not act on it anyway — process.kill only means something to a
 * caller on the same machine.
 */
const LOOPBACK = /^(::1|::ffff:127\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+)$/;
app.get('/api/health', (req, res) => {
  const body = { status: 'OK' };
  if (LOOPBACK.test(req.socket?.remoteAddress || '')) {
    body.pid = process.pid;
    try {
      body.version = getPackageJson().version;
    } catch {
      /* identity is a convenience; liveness is the contract */
    }
  }
  res.status(200).json(body);
});

app.get('/api/version', (req, res) => {
  try {
    const packageJson = getPackageJson();
    res.status(200).json({
      version: packageJson.version,
      name: packageJson.name,
      productName: packageJson.productName,
    });
  } catch (error) {
    console.error('Error reading package.json:', error);
    res.status(500).json({ error: 'Failed to read version' });
  }
});

// Update check endpoint - proxies to agnt.gg to avoid CORS issues
app.get('/api/updates/check', async (req, res) => {
  try {
    // Get current version from the cached package.json (PRD-084-R2 §0.5)
    const currentVersion = getPackageJson().version;

    // Call agnt.gg API to check for updates
    const response = await fetch(`https://agnt.gg/api/updates/check?version=${currentVersion}`);
    const data = await response.json();

    // Return the result
    res.status(200).json({
      ...data,
      currentVersion: currentVersion,
    });
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({
      error: 'Failed to check for updates',
      updateAvailable: false,
    });
  }
});

// Catch-all route for client-side routing (only if frontend exists)
if (frontendExists) {
  // Never let the SPA fallback swallow API misses or missing build artefacts —
  // both turn into silent 200 OK + HTML. See src/routes/spaFallback.js.
  app.get('*', createSpaFallback({ frontendDistPath }));
} else {
  // Fallback route for backend-only mode
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'API endpoint not found', path: req.path });
    } else {
      res.status(404).json({
        error: 'Frontend not available',
        message: 'This server is running in backend-only mode. Frontend files are not present.',
        availableEndpoints: '/api/',
      });
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

async function initializePlugins() {
  console.log('=== Plugin System Initialization ===');

  // Step 1: Install plugin dependencies (npm install for each plugin that needs it)
  // This validates all plugins and ensures node_modules exist
  console.log('Installing plugin dependencies...');
  const installResult = await PluginInstaller.installAllPlugins();
  console.log('Plugin installation result:', installResult);

  // Step 2: Initialize plugin manager (scan and register plugins)
  // Pass the already-validated plugin list to skip redundant filesystem checks
  console.log('Initializing plugin manager...');
  await PluginManager.initialize(installResult?.plugins);
  console.log('Plugin manager initialized');

  // Step 3: Reload plugin tools in orchestrator toolRegistry
  // This is needed because toolRegistry initializes before plugins are loaded
  try {
    const { default: toolRegistry } = await import('./src/services/orchestrator/toolRegistry.js');
    await toolRegistry.reloadPluginTools();
    console.log('Orchestrator toolRegistry plugin tools reloaded');
  } catch (error) {
    console.error('Failed to reload orchestrator plugin tools:', error);
  }

  // Log plugin stats
  const stats = PluginManager.getStats();
  console.log('Plugin stats:', stats);
  console.log('=== Plugin System Ready ===');
}

async function deferredInit() {
  // Re-encrypt credentials written under the published key with this install's
  // own key. A no-op unless a legacy key is available AND legacy rows exist,
  // and idempotent by construction, so it costs one small SELECT per boot.
  //
  // Deferred rather than blocking: dual-key decrypt (utils/encryption.js) means
  // every row is readable whether or not this ever runs, so there is no reason
  // to hold up the listener for it, and no reason to let a failure here stop
  // the app from starting.
  try {
    const { default: db } = await import('./src/models/database/index.js');
    const { migrateEncryptedColumns } = await import('./src/utils/encryptionMigration.js');
    const result = await migrateEncryptedColumns(db);
    if (result.migrated > 0 || result.skipped > 0 || result.unreadable > 0) {
      console.log(
        `[encryption] migrated=${result.migrated} skipped=${result.skipped} ` +
          `unreadable=${result.unreadable} sidecar=${result.sidecar || 'none'}`
      );
    }
  } catch (error) {
    console.warn('[Server] Credential re-encryption failed (non-fatal, data still readable):', error);
  }

  // Warm Codex thread cache so conversations can resume after restarts
  try {
    await CodexCliSessionManager.init();
  } catch (error) {
    console.warn('[Server] Codex thread cache initialization failed (non-fatal):', error);
  }

  // Bootstrap builtin skills to ~/.agnt/skills/ (first run or app update)
  try {
    const { bootstrapBuiltinSkills } = await import('./src/utils/builtinSkillBootstrap.js');
    await bootstrapBuiltinSkills();
  } catch (error) {
    console.warn('[Server] Builtin skill bootstrap failed (non-fatal):', error);
  }

  // Initialize Agent Skills discovery (agentskills.io standard)
  try {
    const { default: SkillDiscoveryService } = await import('./src/services/SkillDiscoveryService.js');
    await SkillDiscoveryService.init();
    console.log('Skill discovery initialized');
  } catch (error) {
    console.warn('[Server] Skill discovery initialization failed (non-fatal):', error);
  }

  // The MCP tool service loads its schema cache from disk synchronously at
  // import. We don't need to do anything here — `build()` returns the
  // disk-backed cache without spawning any servers, and the service kicks
  // off its own first-run refresh in the background if the cache file is
  // missing. Schemas are explicitly refreshed only when the user changes
  // their MCP config (via MCPService.invalidate) or clicks Refresh on the
  // MCP page. No more spawn-N-servers-on-every-chat.
  //
  // Touch the singleton here just so the lazy import + disk read happens
  // during deferredInit rather than on the first chat call.
  try {
    await import('./src/services/MCPToolService.js');
    console.log('[Server] MCP schema cache loaded from disk');
  } catch (error) {
    console.warn('[Server] MCP schema cache load failed (non-fatal):', error?.message);
  }

  // Initialize plugins before spawning workflow process
  console.log('Initializing plugins before spawning workflow process...');
  try {
    await initializePlugins();
    console.log('Plugin initialization complete');
  } catch (error) {
    console.error('Plugin initialization error (non-fatal):', error);
  }

  // Spawn workflow process AFTER plugins and database are ready.
  // PRD-084-R2 §0.2: the child is forked with AGNT_SKIP_DB_INIT=1 and trusts
  // this process to own schema init — this await IS the ordering guarantee,
  // not an optimization. dbReady never rejects (it catches internally).
  const { dbReady } = await import('./src/models/database/index.js');
  await dbReady;
  console.log('Spawning workflow process...');
  try {
    await WorkflowProcessBridge.spawn();
    console.log('Workflow process spawned successfully');

    // Wire up real-time workflow status broadcasts to connected clients
    WorkflowProcessBridge.onStatusUpdate((workflowId, statusData) => {
      const event = RealtimeEvents.WORKFLOW_STATUS_CHANGED;
      const payload = {
        id: workflowId,
        status: statusData.status,
        isActive: statusData.isActive,
        timestamp: new Date().toISOString(),
      };
      if (statusData.userId) {
        broadcastToUser(statusData.userId, event, payload);
      } else {
        broadcast(event, payload);
      }

      // Fire-and-forget: trigger insight extraction when a workflow execution finishes
      const terminalStatuses = ['listening', 'error', 'stopped'];
      if (terminalStatuses.includes(statusData.status) && statusData.userId) {
        import('./src/services/evolution/InsightTriggers.js').then(({ default: InsightTriggers }) => {
          // Look up the latest execution for this workflow to get the execution ID
          Promise.all([
            import('./src/models/database/index.js'),
            import('./src/models/UserModel.js'),
          ]).then(async ([{ default: db }, { default: UserModel }]) => {
            const row = await new Promise((resolve) => {
              db.get(
                'SELECT id FROM workflow_executions WHERE workflow_id = ? ORDER BY start_time DESC LIMIT 1',
                [workflowId],
                (err, r) => resolve(err ? null : r)
              );
            });
            if (!row) return;
            const userSettings = await UserModel.getUserSettings(statusData.userId);
            InsightTriggers.onWorkflowExecutionCompleted(row.id, statusData.userId, {
              workflowId,
              provider: userSettings?.selectedProvider,
              model: userSettings?.selectedModel,
            }).catch(e => {
              console.error('[InsightTriggers] Workflow insight extraction failed (non-critical):', e.message);
            });
          }).catch(() => {});
        }).catch(() => {});
      }
    });

    // Restart active workflows - workflow process waits for DB readiness
    // before accepting messages, so no arbitrary delay needed
    console.log('Starting workflow restart...');
    WorkflowProcessBridge.restartActiveWorkflows().catch((error) => {
      console.error('Error restarting active workflows:', error);
    });
  } catch (error) {
    console.error('Failed to spawn workflow process:', error);
    console.error('Server will continue running but workflows will not be available');
  }

  // If this boot is the back half of a supervisor-sanctioned restart,
  // consume its one-shot receipt and log measured recovery diagnostics.
  RestartManager.consumeRestartManifest().catch((err) =>
    console.warn('[Server] Restart manifest consumption failed (non-fatal):', err.message)
  );
}

/**
 * Exit-code protocol, second entry (see RESTART_EXIT_CODE = 42 in
 * RestartManager.js): the backend exits with 43 to tell the Electron
 * supervisor "the port is taken, I am otherwise fine" — a condition with a UI
 * and a user choice, not a crash. main.js declares the same constant and
 * electron/mainWiring.test.js pins the two together so they cannot drift.
 * 43 collides with nothing Node emits naturally (1, 3-13, 128+signal).
 */
export const PORT_IN_USE_EXIT_CODE = 43;

function startServer() {
  const maxRetries = 5;
  let retries = 0;

  const tryStarting = async () => {
    // Create HTTP server from Express app
    const httpServer = createServer(app);

    // Initialize Socket.IO with CORS configuration
    const io = new SocketIOServer(httpServer, {
      cors: config.corsOptions,
      transports: ['websocket', 'polling'],
    });

    // Socket.IO connection handling with authentication
    io.on('connection', (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      // Handle user authentication and room joining.
      //
      // Identity is derived from the bearer token, NEVER from the payload's
      // `userId`. Every realtime fan-out targets `user:<id>` rooms, so trusting
      // a client-supplied id would let any socket join any user's room and read
      // their live chat stream, tool calls and goal progress. See
      // src/utils/socketIdentity.js for the full policy (and why a stale client
      // with no token is still tolerated on local desktop installs).
      socket.on('authenticate', (data) => {
        const identity = resolveSocketIdentity(data);

        if (!identity.ok) {
          console.warn(`[Socket.IO] Authentication rejected for ${socket.id}: ${identity.reason}`);
          socket.emit('authenticated', { success: false, error: identity.reason });
          return;
        }

        const { userId } = identity;

        // Re-authenticating as someone else must not leave the socket in the
        // previous user's room — otherwise identity switching leaks backwards.
        if (socket.userId && socket.userId !== userId) {
          socket.leave(`user:${socket.userId}`);
        }

        socket.join(`user:${userId}`);
        socket.userId = userId;
        socket.identityVerified = identity.verified;

        if (identity.source === SocketIdentitySource.UNVERIFIED_CLAIM) {
          console.warn(
            `[Socket.IO] User ${userId} joined user:${userId} via UNVERIFIED legacy claim ` +
            `(no token sent — stale client). Set SOCKET_AUTH_STRICT=true to refuse these.`,
          );
        } else {
          console.log(`[Socket.IO] User ${userId} authenticated and joined room user:${userId}`);
        }

        socket.emit('authenticated', { success: true, userId, verified: identity.verified });
      });

      // Mid-run steering: user types a message while a turn is streaming.
      // Stash it; OrchestratorService drains between tool rounds.
      socket.on('steer', ({ conversationId, content } = {}, ack) => {
        if (!socket.userId) {
          return ack?.({ ok: false, error: 'unauthenticated' });
        }
        if (!conversationId || typeof conversationId !== 'string') {
          return ack?.({ ok: false, error: 'no_conversation' });
        }
        if (!content || typeof content !== 'string' || !content.trim()) {
          return ack?.({ ok: false, error: 'empty' });
        }
        const ok = stashSteer(conversationId, content);
        if (!ok) return ack?.({ ok: false, error: 'rejected' });
        console.log(`[Socket.IO] Steer stashed for ${conversationId} from user ${socket.userId} (${content.length} chars)`);
        ack?.({ ok: true });
      });

      // Cancel a pending steer before it's drained — user clicked the X
      // on the steering chip. Clears the backend queue so the next tool
      // round (or auto-fire) doesn't see it.
      socket.on('clear_steer', ({ conversationId } = {}, ack) => {
        if (!socket.userId || !conversationId) {
          return ack?.({ ok: false });
        }
        const cleared = clearSteer(conversationId);
        console.log(`[Socket.IO] Steer cleared for ${conversationId} from user ${socket.userId} (had-pending=${cleared})`);
        ack?.({ ok: true });
      });

      // Live page-scan response from a client tab. Resolves a pending
      // `scan_page_elements` tool call in tutorialScanRegistry. First
      // response wins; later responses (other tabs) are dropped.
      socket.on('tutorial:scan_response', async ({ requestId, elements } = {}) => {
        if (!socket.userId || !requestId) return;
        const { resolvePendingScan } = await import('./src/services/orchestrator/tutorialScanRegistry.js');
        const ok = resolvePendingScan(requestId, Array.isArray(elements) ? elements : []);
        if (ok) {
          console.log(`[Socket.IO] tutorial:scan_response ${requestId} accepted from user ${socket.userId}: ${elements?.length || 0} elements`);
        } else {
          console.log(`[Socket.IO] tutorial:scan_response ${requestId} ignored (no pending request — already resolved or expired)`);
        }
      });

      // Canvas tool response from a client tab (get_canvas_state /
      // inspect_canvas_widget / open|close|move_canvas_widget). Same
      // first-response-wins registry as the tutorial scan — the pending map is
      // generic over requestId, so both rails share it safely.
      socket.on('canvas:response', async ({ requestId, result } = {}) => {
        if (!socket.userId || !requestId) return;
        const { resolvePendingScan } = await import('./src/services/orchestrator/tutorialScanRegistry.js');
        const ok = resolvePendingScan(requestId, result ?? { success: false, error: 'Empty canvas response' });
        console.log(`[Socket.IO] canvas:response ${requestId} ${ok ? 'accepted' : 'ignored (already resolved or expired)'} from user ${socket.userId}`);
      });

      socket.on('disconnect', () => {
        if (socket.userId) {
          console.log(`[Socket.IO] User ${socket.userId} disconnected: ${socket.id}`);
        } else {
          console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
        }
      });
    });

    // Export io instance for use in other modules
    global.io = io;

    // Start server FIRST so health check responds immediately.
    //
    // BIND HOST: loopback by default. Binding 0.0.0.0 unconditionally meant
    // every install was reachable from every network the machine ever joined.
    // LAN exposure is now an explicit choice (Settings -> Phone Access, or
    // BIND_HOST in the environment / Dockerfile).
    const bind = RemoteAccessConfig.resolveBindHost();
    const server = httpServer.listen(config.port, bind.host, () => {
      // Ground truth from the OS. Everything that answers "is my phone able to
      // reach this?" reads from here, not from our intent — the two diverge the
      // moment someone flips the setting without restarting.
      RemoteAccessConfig.recordActualBind(server.address());
      console.log(`Master server listening on ${bind.host}:${config.port} (bind source: ${bind.source})`);
      if (bind.lanEnabled) {
        const urls = RemoteAccessConfig.lanAddresses().map((a) => `http://${a.address}:${config.port}`);
        console.log(`[RemoteAccess] LAN access ENABLED${urls.length ? ` — reachable at ${urls.join(', ')}` : ''}`);
      } else {
        console.log('[RemoteAccess] LAN access disabled — loopback only.');
      }
      console.log(`[Socket.IO] Real-time sync enabled`);
      retries = 0; // Reset retries on successful start
      // Warm the upstream CLI version cache so the first Claude Code / Codex /
      // Kimi Code call uses current values instead of stale fallbacks.
      warmupClientVersions();

      // Prewarm the Codex model list on a small delay so the CLI version has
      // a chance to refresh first (Codex gates model visibility on
      // ?client_version=X). Best-effort — silent on failure. When the user
      // opens the model dropdown, they see the current live list instead of
      // whatever localStorage had cached.
      setTimeout(() => { prewarmCodexModels(); }, 3000);

      // Defer all heavy initialization to next tick so the listen callback
      // returns immediately and the server can respond to health checks
      setImmediate(() => {
        deferredInit().catch((error) => {
          console.error('Deferred initialization error:', error);
        });
      });
    });

    // Give RestartManager the live handles it needs to drain and exit(42).
    RestartManager.attach({ server, workflowBridge: WorkflowProcessBridge });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${config.port} is already in use. Retrying...`);
        if (retries < maxRetries) {
          retries++;
          setTimeout(() => {
            server.close();
            tryStarting();
          }, 5000); // Wait for 5 seconds before retrying
        } else {
          console.error(`Failed to start server after ${maxRetries} attempts. Exiting.`);
          // A DISTINCT exit code, because this is not a crash. Exiting 1 made
          // the supervisor treat "someone else owns the port" identically to
          // "the backend blew up", so it logged a crash and quit the whole app
          // — the one failure where the machine is provably fine and the user
          // has a real choice to make. 43 routes it to the connection UI.
          process.exit(PORT_IN_USE_EXIT_CODE);
        }
      } else {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

    // Shutdown that is guaranteed to terminate. The rationale, the measured
    // failure and the tests all live in src/utils/gracefulShutdown.js — in
    // short: server.close() waits forever on the Socket.IO and SSE streams
    // AGNT holds open by design, so the old inline handler never reached
    // process.exit and left an orphan holding this port.
    const gracefulShutdown = createGracefulShutdown({
      server,
      drain: async () => {
        // FIRST, and synchronously: write every in-flight turn to disk.
        //
        // SIGTERM is what `launchctl kickstart -k`, systemd, Ctrl-C and an app
        // quit all send, so the ordinary restart is not a crash at all — the
        // process is still alive and holds the only copy of a turn that has
        // not reached conversation_logs yet. Saving it here is the difference
        // between losing an answer and keeping it.
        //
        // Sync, and before the drain proper, because this path has a hard
        // deadline: an awaited write can lose the race to process.exit.
        try {
          const [{ liveRuns }, { flushAllSync, stopJournalHeartbeat }] = await Promise.all([
            import('./src/services/orchestrator/activeRuns.js'),
            import('./src/services/orchestrator/runJournal.js'),
          ]);
          // Stop the heartbeat FIRST: an async write it started could still be
          // in flight, and letting it race the synchronous flush below is the
          // one way to have two writers for the same run at once.
          stopJournalHeartbeat();
          flushAllSync(liveRuns());
        } catch (err) {
          console.warn('[RunJournal] Shutdown flush skipped:', err?.message || err);
        }
        return WorkflowProcessBridge.shutdown();
      },
    });
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    // SIGINT too: Ctrl-C in a dev terminal produced exactly the same orphan.
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      // Close the server and exit
      // server.close(() => {
      //   console.log('Server closed due to uncaught exception. Exiting...');
      //   process.exit(1);
      // });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Close the server and exit
      // server.close(() => {
      //   console.log('Server closed due to unhandled rejection. Exiting...');
      //   process.exit(1);
      // });
    });

    // PRD-084-R2 §0.5: memory heartbeat every 60s (10s was pure log noise);
    // set DEBUG_MEM=1 to restore the 10s cadence when actively profiling.
    setInterval(() => {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      console.log(`Current memory usage: approximately ${Math.round(used * 100) / 100} MB`);
    }, process.env.DEBUG_MEM === '1' ? 10 * 1000 : 60 * 1000);

    console.log(`Server process ID: ${process.pid}`);
  };

  tryStarting();
}

startServer();

export default app;
