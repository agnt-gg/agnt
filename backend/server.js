import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import compression from 'compression';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// Import plugin system
import PluginInstaller from './src/plugins/PluginInstaller.js';
import PluginManager from './src/plugins/PluginManager.js';

// Import your API routes
import UserRoutes from './src/routes/UserRoutes.js';
import ProviderAuthRoutes from './src/routes/ProviderAuthRoutes.js';
import StreamRoutes from './src/routes/StreamRoutes.js';
import WorkflowRoutes from './src/routes/WorkflowRoutes.js';
import ExecutionRoutes from './src/routes/ExecutionRoutes.js';
import CustomToolRoutes from './src/routes/CustomToolRoutes.js';
import ContentOutputRoutes from './src/routes/ContentOutputRoutes.js';
import AgentRoutes from './src/routes/AgentRoutes.js';
import GoalRoutes from './src/routes/GoalRoutes.js';
import LayoutRoutes from './src/routes/LayoutRoutes.js';
import OrchestratorRoutes from './src/routes/OrchestratorRoutes.js';
import ToolsRoutes from './src/routes/ToolsRoutes.js';
import ToolSchemaRoutes from './src/routes/ToolSchemaRoutes.js';
import ModelRoutes from './src/routes/ModelRoutes.js';
import CustomProviderRoutes from './src/routes/CustomProviderRoutes.js';
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
import GroupRoutes from './src/routes/GroupRoutes.js';
import ImageRoutes from './src/routes/ImageRoutes.js';
import LocalFileRoutes from './src/routes/LocalFileRoutes.js';
import AdminClientVersionRoutes from './src/routes/AdminClientVersionRoutes.js';
import ConversationSettingsRoutes from './src/routes/ConversationSettingsRoutes.js';
import { warmupClientVersions } from './src/services/ai/clientVersions.js';
import WorkflowProcessBridge from './src/workflow/WorkflowProcessBridge.js';
import { broadcastToUser, broadcast, RealtimeEvents } from './src/utils/realtimeSync.js';
import { sessionMiddleware } from './src/routes/Middleware.js';
import CodexCliSessionManager from './src/services/ai/CodexCliSessionManager.js';
import { stashSteer, clearSteer } from './src/services/OrchestratorService.js';

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
app.use(bodyParser.json({ limit: config.bodyParserLimit }));
app.use(bodyParser.urlencoded({ limit: config.bodyParserLimit, extended: true }));
app.use(sessionMiddleware);

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
app.use('/api/providers', ProviderAuthRoutes);
app.use('/api/stream', StreamRoutes);
app.use('/api/agents', AgentRoutes);
app.use('/api/workflows', WorkflowRoutes);
app.use('/api/executions', ExecutionRoutes);
app.use('/api/custom-tools', CustomToolRoutes);
app.use('/api/content-outputs', ContentOutputRoutes);
app.use('/api/goals', GoalRoutes);
app.use('/api/layouts', LayoutRoutes);
app.use('/api/orchestrator', OrchestratorRoutes);
app.use('/api/tools', ToolsRoutes);
app.use('/api/tool-schemas', ToolSchemaRoutes);
app.use('/api/models', ModelRoutes); // Generic models endpoint for all providers
app.use('/api/openrouter', ModelRoutes); // Legacy support for OpenRouter
app.use('/api/custom-providers', CustomProviderRoutes);
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
app.use('/api/groups', GroupRoutes);
app.use('/api/filesystem', FileSystemRoutes);
app.use('/api/images', ImageRoutes);
app.use('/api/local-file', LocalFileRoutes);
app.use('/api/admin', AdminClientVersionRoutes);
app.use('/api/conversations', ConversationSettingsRoutes);
app.get('/api/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Version endpoint - reads dynamically from package.json
app.get('/api/version', (req, res) => {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
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
    // Get current version from local package.json
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;

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
  app.get('*', (req, res) => {
    // Never let the SPA fallback swallow API misses — that turns 404s into
    // silent 200 OK + HTML responses and confuses every API client (including
    // LLM agents, which then JSON.parse the HTML and quietly continue).
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found', path: req.path });
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
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

  // Spawn workflow process AFTER plugins and database are ready
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
}

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

      // Handle user authentication and room joining
      socket.on('authenticate', (data) => {
        const { userId } = data;
        if (userId) {
          // Join user-specific room
          socket.join(`user:${userId}`);
          socket.userId = userId; // Store userId on socket
          console.log(`[Socket.IO] User ${userId} authenticated and joined room user:${userId}`);
          socket.emit('authenticated', { success: true, userId });
        } else {
          console.log(`[Socket.IO] Authentication failed - no userId provided`);
          socket.emit('authenticated', { success: false, error: 'No userId provided' });
        }
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

    // Start server FIRST so health check responds immediately
    const server = httpServer.listen(config.port, () => {
      console.log(`Master server listening on port ${config.port}`);
      console.log(`[Socket.IO] Real-time sync enabled`);
      retries = 0; // Reset retries on successful start
      // Warm the upstream CLI version cache so the first Claude Code / Codex /
      // Kimi Code call uses current values instead of stale fallbacks.
      warmupClientVersions();

      // Defer all heavy initialization to next tick so the listen callback
      // returns immediately and the server can respond to health checks
      setImmediate(() => {
        deferredInit().catch((error) => {
          console.error('Deferred initialization error:', error);
        });
      });
    });

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
          process.exit(1);
        }
      } else {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM signal received: closing HTTP server');

      // Shutdown workflow process first
      await WorkflowProcessBridge.shutdown();

      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    });

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

    setInterval(() => {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      console.log(`Current memory usage: approximately ${Math.round(used * 100) / 100} MB`);
    }, 1 * 10 * 1000);

    console.log(`Server process ID: ${process.pid}`);
  };

  tryStarting();
}

startServer();

export default app;
