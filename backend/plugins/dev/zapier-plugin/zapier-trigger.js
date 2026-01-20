import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


class ZapierTrigger extends EventEmitter {
  constructor() {
    super();
    this.name = 'zapier-trigger';
    this.webhookUrl = null;
  }

  async setup(engine, node) {
    console.log('[ZapierPlugin] Setting up Zapier trigger');

    try {
      // Import ProcessManager dynamically to access the singleton instance
      const ProcessManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/workflow/ProcessManager.js').replace(/\\/g, '/')}`);
      const ProcessManager = ProcessManagerModule.default;

      const { authType, authToken, username, password } = node.parameters || {};

      this.webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(
        engine.workflowId,
        engine.userId,
        'POST', // Zapier always uses POST
        authType,
        authToken,
        username,
        password
      );

      console.log(`[ZapierPlugin] Zapier webhook registered for workflow ${engine.workflowId}: ${this.webhookUrl}`);
    } catch (error) {
      console.error(`[ZapierPlugin] Error setting up Zapier trigger: ${error.message}`);

      // Update node error if engine supports it
      if (engine._updateNodeError) {
        engine._updateNodeError(node.id, error.message);
      }

      // Update workflow status if engine supports it
      if (engine._updateWorkflowStatus) {
        await engine._updateWorkflowStatus('error');
      }

      // Emit error if engine supports it
      if (engine.emit) {
        engine.emit('workflowError', {
          globalError: error.message,
          nodeErrors: engine.errors || {},
        });
      }

      throw error;
    }
  }

  async validate(triggerData) {
    return triggerData.type === 'webhook';
  }

  async process(inputData) {
    // Just like a normal HTTP request: method, headers, body, query, params
    return {
      method: inputData.method,
      headers: inputData.headers,
      body: inputData.body,
      query: inputData.query,
      params: inputData.params,
    };
  }

  async teardown() {
    // Webhook cleanup is handled by ProcessManager
    console.log('[ZapierPlugin] Tearing down Zapier trigger');
    // We don't need to explicitly unregister here as ProcessManager handles it when workflow stops
  }
}

export default new ZapierTrigger();
