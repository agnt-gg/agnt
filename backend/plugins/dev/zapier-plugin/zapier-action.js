import axios from 'axios';

class ZapierAction {
  constructor() {
    this.name = 'zapier-action';
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    console.log('ZapierAction params:', JSON.stringify(params, null, 2));

    try {
      const result = await this.sendToWebhook(params);
      return this.formatOutput(result);
    } catch (error) {
      console.error('Zapier Action Error:', error);
      return this.formatOutput({
        success: false,
        zapResponse: null,
        triggeredZaps: [],
        error: error.message,
      });
    }
  }

  async sendToWebhook(params) {
    try {
      // Parse payload if it's a string
      let payload;
      if (typeof params.payload === 'string') {
        try {
          payload = JSON.parse(params.payload);
        } catch (parseError) {
          throw new Error(`Invalid JSON payload: ${parseError.message}`);
        }
      } else {
        payload = params.payload;
      }

      console.log('Sending to Zapier webhook:', {
        url: params.zapWebhookUrl,
        payload: payload,
      });

      const response = await axios.post(params.zapWebhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      });

      return {
        success: true,
        zapResponse: response.data,
        triggeredZaps: [
          {
            status: 'triggered',
            timestamp: new Date().toISOString(),
            statusCode: response.status,
          },
        ],
        error: null,
      };
    } catch (error) {
      console.error('Error sending to Zapier webhook:', error);
      return {
        success: false,
        zapResponse: error.response?.data || null,
        triggeredZaps: [],
        error: error.response?.data?.error || error.message,
      };
    }
  }

  validateParams(params) {
    if (!params.zapWebhookUrl) {
      throw new Error('Zap webhook URL is required');
    }
    if (!params.payload) {
      throw new Error('Payload is required');
    }
  }

  formatOutput(output) {
    return {
      success: output.success,
      zapResponse: output.zapResponse || null,
      triggeredZaps: output.triggeredZaps || [],
      zaps: output.zaps || undefined,
      count: output.count || undefined,
      zapId: output.zapId || undefined,
      zapTitle: output.zapTitle || undefined,
      actions: output.actions || undefined,
      error: output.error || null,
    };
  }
}

export default new ZapierAction();
