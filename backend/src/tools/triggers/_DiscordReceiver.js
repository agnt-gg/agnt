import { Client, GatewayIntentBits } from 'discord.js';
import EventEmitter from 'events';
import AuthManager from '../../services/auth/AuthManager.js';

class DiscordReceiver extends EventEmitter {
  constructor() {
    super();
    this.client = null;
  }
  async initialize(userId) {
    try {
      console.log(`Initializing DiscordReceiver for user ${userId}`);
      const accessToken = await AuthManager.getValidAccessToken(userId, 'discord');

      if (!accessToken) {
        console.error(`Discord access token not found for user ${userId}`);
        throw new Error('Discord access token not found for this user');
      }

      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      });

      await this.client.login(accessToken);
      console.log(`Discord bot is ready for user ${userId}`);

      this.client.on('messageCreate', (message) => {
        if (!message.author.bot) {
          this.emit('message', {
            content: message.content,
            author: message.author.username,
            authorId: message.author.id,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: message.createdTimestamp,
            attachments: message.attachments,
          });
        }
      });
    } catch (error) {
      console.error(`Error initializing DiscordReceiver for user ${userId}:`, error);
      throw error;
    }
  }
  async subscribeToChannel(channelId, callback) {
    this.on('message', (messageData) => {
      if (messageData.channelId === channelId) {
        callback(messageData);
      }
    });
  }
}

export default DiscordReceiver;
