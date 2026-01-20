import BaseTrigger from '../BaseTrigger.js';
import slackReceiver from '../../triggers/SlackReceiver.js';
import AuthManager from '../../../services/auth/AuthManager.js';

class ReceiveSlackMessage extends BaseTrigger {
  static schema = {
    title: 'Receive Slack Message',
    category: 'trigger',
    type: 'receive-slack-message',
    icon: 'slack-receive',
    description:
      'This trigger node listens for incoming Slack messages in a specified channel and triggers the workflow when a new message is received.',
    authRequired: 'oauth',
    authProvider: 'slack',
    parameters: {
      channelId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Slack channel to monitor',
      },
    },
    outputs: {
      user: {
        type: 'string',
        description: 'The user who sent the message',
      },
      text: {
        type: 'string',
        description: 'The content of the message',
      },
      timestamp: {
        type: 'string',
        description: 'The timestamp of the message',
      },
      image: {
        type: 'object',
        description: 'Image data if an image was attached to the message',
        properties: {
          type: {
            type: 'string',
            description: 'The MIME type of the image',
          },
          data: {
            type: 'string',
            description: 'The base64-encoded image data',
          },
        },
      },
      response: {
        type: 'object',
        description: 'The complete raw API response as received from Slack',
      },
    },
  };

  constructor() {
    super('receive-slack-message');
    this.slackReceiver = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    // Get or create SlackReceiver singleton
    this.slackReceiver = slackReceiver();
    await this.slackReceiver.initialize(engine.userId);

    // Store in engine receivers
    engine.receivers.slack = this.slackReceiver;

    // Find the Slack trigger node to get channelId
    const slackTriggerNode = engine.workflow.nodes.find((n) => n.type === 'receive-slack-message');
    if (slackTriggerNode && slackTriggerNode.parameters && slackTriggerNode.parameters.channelId) {
      await this.slackReceiver.subscribeToChannel(slackTriggerNode.parameters.channelId, (messageData) => {
        engine.processWorkflowTrigger(messageData);
      });

      console.log(`Slack receiver subscribed to channel ${slackTriggerNode.parameters.channelId}`);
    } else {
      throw new Error('Slack trigger node is missing channelId parameter');
    }
  }

  async validate(triggerData) {
    return 'text' in triggerData && 'user' in triggerData;
  }

  async process(inputData, engine) {
    // Get Slack token to fetch image data if needed
    const token = await AuthManager.getValidAccessToken(engine.userId, 'slack');
    const slackReceiverInstance = slackReceiver();
    const imageData = await slackReceiverInstance.getImageData(inputData, token);

    return {
      ...inputData,
      timestamp: inputData.ts,
      image: imageData,
      response: { ...inputData },
    };
  }

  async teardown() {
    // Unsubscribe from Slack channel if needed
    if (this.slackReceiver) {
      // SlackReceiver handles its own cleanup via singleton pattern
      this.slackReceiver = null;
      console.log('Slack receiver cleaned up');
    }

    await super.teardown();
  }
}

export default new ReceiveSlackMessage();
