import BaseAction from '../BaseAction.js';
import slackReceiver from '../../triggers/SlackReceiver.js';

class SendSlackMessage extends BaseAction {
  static schema = {
    title: 'Slack API',
    category: 'action',
    type: 'send-slack-message',
    icon: 'slack-send',
    description: 'This action node sends a message to a specified Slack channel.',
    authRequired: 'oauth',
    authProvider: 'slack',
    parameters: {
      channelId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Slack channel to send the message to',
      },
      message: {
        type: 'string',
        inputType: 'textarea',
        description: 'The message to send',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the message was sent successfully',
      },
      timestamp: {
        type: 'string',
        description: 'The timestamp of the sent message',
      },
      error: {
        type: 'string',
        description: 'Error message if the message sending failed',
      },
    },
  };

  constructor() {
    super('sendSlackMessage');
  }
  async execute(params, inputData, workflowEngine) {
    try {
      const userId = workflowEngine.userId;
      if (!userId) {
        throw new Error('User ID is not available in the workflow engine');
      }

      // ALWAYS initialize a fresh client to ensure we have valid credentials
      // Don't use cached client as it may have stale/disconnected credentials
      console.log('Initializing fresh SlackReceiver to ensure valid credentials');
      const slackClient = slackReceiver();
      await slackClient.initialize(userId);

      const result = await slackClient.sendMessage(userId, params.channelId, params.message);

      return this.formatOutput({
        success: true,
        timestamp: result.ts,
        error: null,
      });
    } catch (error) {
      console.error('Error sending Slack message:', error);
      return this.formatOutput({
        success: false,
        timestamp: null,
        error: error.message,
      });
    }
  }
}

export default new SendSlackMessage();
