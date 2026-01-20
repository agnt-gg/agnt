import { WebClient } from '@slack/web-api';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Slack API Plugin Tool
 *
 * This is a plugin-based tool that loads @slack/web-api from its own isolated node_modules.
 * The plugin system automatically runs `npm install` on server startup.
 */
class SlackAPI {
  constructor() {
    this.name = 'slack-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[SlackPlugin] Executing Slack API with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'slack');
      if (!accessToken) {
        throw new Error('No valid access token found. Please reconnect to Slack.');
      }

      const client = new WebClient(accessToken);

      let result;
      switch (params.action) {
        case 'SEND_MESSAGE':
          result = await this.sendMessage(client, params);
          break;
        case 'REPLY_TO_THREAD':
          result = await this.replyToThread(client, params);
          break;
        case 'GET_CHANNELS':
          result = await this.getChannels(client, params);
          break;
        case 'GET_USERS':
          result = await this.getUsers(client, params);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(client, params);
          break;
        case 'ADD_REACTION':
          result = await this.addReaction(client, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return {
        success: true,
        result: result.result || result,
        timestamp: result.timestamp || null,
        error: null,
      };
    } catch (error) {
      console.error('[SlackPlugin] Error executing Slack API:', error);
      return {
        success: false,
        result: null,
        timestamp: null,
        error: error.message,
      };
    }
  }

  async sendMessage(client, params) {
    const { channelId, message } = params;

    const response = await client.chat.postMessage({
      channel: channelId,
      text: message,
    });

    return {
      success: true,
      timestamp: response.ts,
      result: {
        channel: response.channel,
        ts: response.ts,
        message: response.message,
      },
    };
  }

  async replyToThread(client, params) {
    const { channelId, message, threadTs } = params;

    const response = await client.chat.postMessage({
      channel: channelId,
      text: message,
      thread_ts: threadTs,
    });

    return {
      success: true,
      timestamp: response.ts,
      result: {
        channel: response.channel,
        ts: response.ts,
        thread_ts: threadTs,
        message: response.message,
      },
    };
  }

  async getChannels(client, params) {
    const { limit = 100 } = params;

    const response = await client.conversations.list({
      limit: limit,
      types: 'public_channel,private_channel',
    });

    const channels = response.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      isPrivate: channel.is_private,
      isMember: channel.is_member,
      numMembers: channel.num_members,
      topic: channel.topic?.value || '',
      purpose: channel.purpose?.value || '',
    }));

    return {
      success: true,
      result: {
        channels: channels,
        count: channels.length,
      },
    };
  }

  async getUsers(client, params) {
    const { limit = 100 } = params;

    const response = await client.users.list({
      limit: limit,
    });

    const users = response.members
      .filter((user) => !user.is_bot && !user.deleted)
      .map((user) => ({
        id: user.id,
        name: user.name,
        realName: user.real_name,
        displayName: user.profile?.display_name || user.name,
        email: user.profile?.email,
        isAdmin: user.is_admin,
        isOwner: user.is_owner,
        avatar: user.profile?.image_72,
      }));

    return {
      success: true,
      result: {
        users: users,
        count: users.length,
      },
    };
  }

  async uploadFile(client, params) {
    const { channelId, fileName, fileData, message } = params;

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    const response = await client.files.uploadV2({
      channel_id: channelId,
      file: buffer,
      filename: fileName,
      initial_comment: message || '',
    });

    return {
      success: true,
      result: {
        file: response.file,
      },
    };
  }

  async addReaction(client, params) {
    const { channelId, threadTs, emoji } = params;

    // Remove colons if user included them
    const emojiName = emoji.replace(/:/g, '');

    const response = await client.reactions.add({
      channel: channelId,
      timestamp: threadTs,
      name: emojiName,
    });

    return {
      success: true,
      result: {
        ok: response.ok,
      },
    };
  }
}

export default new SlackAPI();
