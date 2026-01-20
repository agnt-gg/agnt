import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import plugin system
import PluginInstaller from './src/plugins/PluginInstaller.js';
import PluginManager from './src/plugins/PluginManager.js';

// Import your API routes
import UserRoutes from './src/routes/UserRoutes.js';
import StreamRoutes from './src/routes/StreamRoutes.js';
import WorkflowRoutes from './src/routes/WorkflowRoutes.js';
import ExecutionRoutes from './src/routes/ExecutionRoutes.js';
import CustomToolRoutes from './src/routes/CustomToolRoutes.js';
import ContentOutputRoutes from './src/routes/ContentOutputRoutes.js';
import AgentRoutes from './src/routes/AgentRoutes.js';
import GoalRoutes from './src/routes/GoalRoutes.js';
import OrchestratorRoutes from './src/routes/OrchestratorRoutes.js';
import ToolsRoutes from './src/routes/ToolsRoutes.js';
import ModelRoutes from './src/routes/ModelRoutes.js';
import CustomProviderRoutes from './src/routes/CustomProviderRoutes.js';
import MCPRoutes from './src/routes/MCPRoutes.js';
import NPMRoutes from './src/routes/NPMRoutes.js';
import WebhookRoutes from './src/routes/WebhookRoutes.js';
import SpeechRoutes from './src/routes/SpeechRoutes.js';
import PluginRoutes from './src/routes/PluginRoutes.js';
import WorkflowProcessBridge from './src/workflow/WorkflowProcessBridge.js';
import { sessionMiddleware } from './src/routes/Middleware.js';

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
      'http://localhost:3333',
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
app.use(bodyParser.json({ limit: config.bodyParserLimit }));
app.use(bodyParser.urlencoded({ limit: config.bodyParserLimit, extended: true }));
app.use(sessionMiddleware);

// Conditionally serve built frontend static files if they exist
// Assumes the frontend build output is in ../frontend/dist relative to this file.
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendExists = fs.existsSync(frontendDistPath) && fs.existsSync(path.join(frontendDistPath, 'index.html'));

if (frontendExists) {
  console.log('Frontend dist found - serving static files from:', frontendDistPath);
  // Disable caching for development - ensures fresh files are served
  app.use(express.static(frontendDistPath, {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
      // No cache for HTML files (they reference the JS/CSS bundles)
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
} else {
  console.log('No frontend dist found - running in backend-only mode');
}

// Define API routes
app.use('/lite', express.static(path.join(__dirname, '..', 'lite')));
app.use('/api/users', UserRoutes);
app.use('/api/stream', StreamRoutes);
app.use('/api/agents', AgentRoutes);
app.use('/api/workflows', WorkflowRoutes);
app.use('/api/executions', ExecutionRoutes);
app.use('/api/custom-tools', CustomToolRoutes);
app.use('/api/content-outputs', ContentOutputRoutes);
app.use('/api/goals', GoalRoutes);
app.use('/api/orchestrator', OrchestratorRoutes);
app.use('/api/tools', ToolsRoutes);
app.use('/api/models', ModelRoutes); // Generic models endpoint for all providers
app.use('/api/openrouter', ModelRoutes); // Legacy support for OpenRouter
app.use('/api/custom-providers', CustomProviderRoutes);
app.use('/api/mcp', MCPRoutes);
app.use('/api/npm', NPMRoutes);
app.use('/api/webhooks', WebhookRoutes);
app.use('/api/speech', SpeechRoutes);
app.use('/api/plugins', PluginRoutes);
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
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  // Fallback route for backend-only mode
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'API endpoint not found' });
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

  // Step 1: Install plugin dependencies (npm install for each plugin)
  console.log('Installing plugin dependencies...');
  const installResult = await PluginInstaller.installAllPlugins();
  console.log('Plugin installation result:', installResult);

  // Step 2: Initialize plugin manager (scan and register plugins)
  console.log('Initializing plugin manager...');
  await PluginManager.initialize();
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

function startServer() {
  const maxRetries = 5;
  let retries = 0;

  const tryStarting = async () => {
    // Start server FIRST so health check responds immediately
    const server = app.listen(config.port, async () => {
      console.log(`Master server listening on port ${config.port}`);
      retries = 0; // Reset retries on successful start

      // Initialize plugins FIRST before spawning workflow process
      // This ensures all plugins are copied and registered before WorkflowProcess starts
      console.log('Initializing plugins before spawning workflow process...');
      try {
        await initializePlugins();
        console.log('Plugin initialization complete');
      } catch (error) {
        console.error('Plugin initialization error (non-fatal):', error);
      }

      // Spawn workflow process AFTER plugins are ready
      console.log('Spawning workflow process...');
      try {
        await WorkflowProcessBridge.spawn();
        console.log('Workflow process spawned successfully');

        // Delay workflow restart to allow server to start immediately
        // This prevents blocking the server startup and allows frontend to load quickly
        setTimeout(() => {
          console.log('Starting workflow restart...');
          WorkflowProcessBridge.restartActiveWorkflows().catch((error) => {
            console.error('Error restarting active workflows:', error);
          });
        }, 10000); // 10 second delay - server starts first
        console.log('Workflow restart scheduled in 10 seconds...');
      } catch (error) {
        console.error('Failed to spawn workflow process:', error);
        console.error('Server will continue running but workflows will not be available');
      }
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
