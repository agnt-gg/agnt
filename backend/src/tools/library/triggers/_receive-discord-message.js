import BaseTrigger from '../BaseTrigger.js';
import DiscordReceiver from '../../triggers/DiscordReceiver.js';

class ReceiveDiscordMessage extends BaseTrigger {
  static schema = {
    title: 'Receive Discord Message',
    category: 'trigger',
    type: 'receive-discord-message',
    icon: 'discord',
    description:
      'This trigger node listens for incoming Discord messages in a specified channel and triggers the workflow when a new message is received.',
    authRequired: 'apiKey',
    authProvider: 'discord',
    parameters: {
      channelId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Discord channel to monitor',
      },
    },
    outputs: {
      content: {
        type: 'string',
        description: 'The content of the message',
      },
      author: {
        type: 'string',
        description: 'The username of the message author',
      },
      timestamp: {
        type: 'number',
        description: 'The timestamp of when the message was created',
      },
      response: {
        type: 'object',
        description: 'The complete raw API response as received from Slack',
      },
    },
  };

  constructor() {
    super('receive-discord-message');
    this.discordReceiver = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    if (!node.parameters || !node.parameters.channelId) {
      throw new Error('Discord trigger node is missing required parameters');
    }

    // Create DiscordReceiver instance
    this.discordReceiver = new DiscordReceiver();
    await this.discordReceiver.initialize(engine.userId);

    // Store in engine receivers
    engine.receivers.discord = this.discordReceiver;

    // Subscribe to channel
    await this.discordReceiver.subscribeToChannel(node.parameters.channelId, (messageData) => {
      engine.processWorkflowTrigger(messageData);
    });

    console.log(`Discord receiver subscribed to channel ${node.parameters.channelId}`);
  }

  async validate(triggerData) {
    return 'content' in triggerData && 'author' in triggerData;
  }

  async process(inputData) {
    return {
      content: inputData.content,
      author: inputData.author,
      authorId: inputData.authorId,
      channelId: inputData.channelId,
      guildId: inputData.guildId,
      timestamp: inputData.timestamp,
      response: inputData,
    };
  }

  async teardown() {
    // Clean up Discord receiver
    if (this.discordReceiver) {
      // DiscordReceiver handles its own cleanup
      this.discordReceiver = null;
      console.log('Discord receiver cleaned up');
    }

    await super.teardown();
  }
}

export default new ReceiveDiscordMessage();
