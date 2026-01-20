import { Client, GatewayIntentBits } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

/**
 * Discord Receiver Plugin Tool (Trigger)
 *
 * This is a trigger tool that listens for incoming Discord messages.
 * It maintains a persistent connection to Discord and emits events when messages arrive.
 */
class DiscordReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-discord-message';
    this.client = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   * Creates Discord client and subscribes to channel
   */
  async setup(engine, node) {
    console.log('[DiscordPlugin] Setting up Discord receiver trigger');

    if (!node.parameters || !node.parameters.channelId) {
      throw new Error('Discord trigger node is missing required channelId parameter');
    }

    try {
      // Import AuthManager dynamically using APP_PATH for correct resolution
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(engine.userId, 'discord');
      if (!accessToken) {
        throw new Error('No valid Discord access token found. Please reconnect to Discord.');
      }

      // Create Discord client
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      });

      await this.client.login(accessToken);
      console.log(`[DiscordPlugin] Discord bot connected for user ${engine.userId}`);

      // Store in engine receivers for cleanup
      engine.receivers.discord = this;

      // Listen for messages
      this.client.on('messageCreate', (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Only process messages from the subscribed channel
        if (message.channel.id === node.parameters.channelId) {
          const messageData = {
            content: message.content,
            author: message.author.username,
            authorId: message.author.id,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: message.createdTimestamp,
            attachments: Array.from(message.attachments.values()).map((a) => ({
              id: a.id,
              name: a.name,
              url: a.url,
              size: a.size,
            })),
          };

          // Trigger the workflow
          engine.processWorkflowTrigger(messageData);
        }
      });

      console.log(`[DiscordPlugin] Subscribed to channel ${node.parameters.channelId}`);
    } catch (error) {
      console.error('[DiscordPlugin] Error setting up Discord receiver:', error);
      throw error;
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'content' in triggerData && 'author' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      content: inputData.content,
      author: inputData.author,
      authorId: inputData.authorId,
      channelId: inputData.channelId,
      guildId: inputData.guildId,
      timestamp: inputData.timestamp,
      attachments: inputData.attachments || [],
      response: inputData,
    };
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[DiscordPlugin] Tearing down Discord receiver');
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

export default new DiscordReceiver();
