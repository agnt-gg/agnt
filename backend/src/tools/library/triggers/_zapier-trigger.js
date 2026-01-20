import BaseTrigger from '../BaseTrigger.js';
import ProcessManager from '../../../workflow/ProcessManager.js';

class ZapierTrigger extends BaseTrigger {
  static schema = {
    title: 'Zapier Trigger',
    category: 'trigger',
    type: 'zapier-trigger',
    icon: 'zapier',
    description:
      'Receive events from 6,000+ apps via Zapier. When something happens in your connected apps (new email, form submission, sale, etc.), this trigger fires your workflow.',
    documentation: 'https://docs.slop.ai/docs/triggers/zapier-trigger',
    parameters: {
      webhookUrl: {
        type: 'string',
        inputType: 'readonly',
        value: '{{WEBHOOK_URL}}/webhook/{{WORKFLOWID}}',
        description: "Copy this URL into your Zapier webhook action. In Zapier, add a 'Webhooks by Zapier' action and paste this URL.",
      },
      authType: {
        type: 'string',
        inputType: 'select',
        options: ['None', 'Basic', 'Bearer'],
        default: 'Bearer',
        description: 'Authentication method (recommended: Bearer for security)',
      },
      authToken: {
        type: 'string',
        inputType: 'text',
        description:
          "Secret token to verify requests from Zapier. Generate a random string and add it to your Zap's headers as 'Authorization: Bearer YOUR_TOKEN'",
        conditional: {
          field: 'authType',
          value: ['Bearer'],
        },
      },
      username: {
        type: 'string',
        inputType: 'text',
        description: 'Username for Basic authentication',
        conditional: {
          field: 'authType',
          value: 'Basic',
        },
      },
      password: {
        type: 'string',
        inputType: 'password',
        description: 'Password for Basic authentication',
        conditional: {
          field: 'authType',
          value: 'Basic',
        },
      },
    },
    outputs: {
      method: {
        type: 'string',
        description: 'The HTTP method (always POST for Zapier)',
      },
      headers: {
        type: 'object',
        description: 'Request headers from Zapier',
      },
      body: {
        type: 'object',
        description: 'All data sent from Zapier - access fields like zapierTrigger.body.email, zapierTrigger.body.name, etc.',
      },
      query: {
        type: 'object',
        description: 'Query parameters (if any)',
      },
      params: {
        type: 'object',
        description: 'Route parameters (if any)',
      },
    },
  };

  constructor() {
    super('zapier-trigger');
    this.webhookUrl = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    try {
      const { authType, authToken, username, password } = node.parameters;
      this.webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(
        engine.workflowId,
        engine.userId,
        'POST', // Zapier always uses POST
        authType,
        authToken,
        username,
        password
      );
      console.log(`Zapier webhook registered for workflow ${engine.workflowId}: ${this.webhookUrl}`);
    } catch (error) {
      console.error(`Error setting up Zapier trigger: ${error.message}`);
      engine._updateNodeError(node.id, error.message);
      await engine._updateWorkflowStatus('error');
      engine.emit('workflowError', {
        globalError: error.message,
        nodeErrors: engine.errors,
      });
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
    await super.teardown();
  }
}

export default new ZapierTrigger();
