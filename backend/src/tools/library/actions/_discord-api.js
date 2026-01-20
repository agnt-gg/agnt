import { Client, GatewayIntentBits, Partials } from 'discord.js';
import BaseAction from '../BaseAction.js';
import AuthManager from '../../../services/auth/AuthManager.js';

class DiscordAPI extends BaseAction {
  static schema = {
    title: 'Discord API',
    category: 'action',
    type: 'discord-api',
    icon: 'discord',
    description: 'Interact with Discord to perform various operations such as sending messages, managing roles, and uploading files.',
    authRequired: 'apiKey',
    authProvider: 'discord',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: ['SEND_MESSAGE', 'ASSIGN_ROLE', 'GET_MEMBERS', 'UPLOAD_FILE'],
        description: 'The action to perform on Discord',
      },
      channelId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Discord channel (for SEND_MESSAGE and UPLOAD_FILE actions)',
        conditional: {
          field: 'action',
          value: ['SEND_MESSAGE', 'UPLOAD_FILE'],
        },
      },
      message: {
        type: 'string',
        inputType: 'textarea',
        description: 'The message to send (for SEND_MESSAGE action)',
        conditional: {
          field: 'action',
          value: ['SEND_MESSAGE', 'UPLOAD_FILE'],
        },
      },
      guildId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Discord guild (server) (for ASSIGN_ROLE and GET_MEMBERS actions)',
        conditional: {
          field: 'action',
          value: ['ASSIGN_ROLE', 'GET_MEMBERS'],
        },
      },
      roleId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the role to assign (for ASSIGN_ROLE action)',
        conditional: {
          field: 'action',
          value: 'ASSIGN_ROLE',
        },
      },
      memberIds: {
        type: 'string',
        inputType: 'textarea',
        description: 'Comma-separated list of member IDs to assign the role to (for ASSIGN_ROLE action)',
        conditional: {
          field: 'action',
          value: 'ASSIGN_ROLE',
        },
      },
      fileName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the file to upload (for UPLOAD_FILE action)',
        conditional: {
          field: 'action',
          value: 'UPLOAD_FILE',
        },
      },
      fileData: {
        type: 'string',
        inputType: 'textarea',
        description: 'The base64-encoded file data to upload (for UPLOAD_FILE action)',
        conditional: {
          field: 'action',
          value: 'UPLOAD_FILE',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the Discord operation was successful',
      },
      result: {
        type: 'object',
        description: 'The result of the Discord operation',
      },
      error: {
        type: 'string',
        description: 'Error message if the Discord operation failed',
      },
    },
  };

  constructor() {
    super('discord-api');
  }
  async execute(params, inputData, workflowEngine) {
    console.log('Executing Discord API with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'discord');
      if (!accessToken) {
        throw new Error('No valid access token found. Please reconnect to Discord.');
      }

      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
        partials: [Partials.Channel],
      });

      await client.login(accessToken);

      let result;
      switch (params.action) {
        case 'SEND_MESSAGE':
          result = await this.sendMessage(client, params);
          break;
        case 'ASSIGN_ROLE':
          result = await this.assignRole(client, params);
          break;
        case 'GET_MEMBERS':
          result = await this.getMembers(client, params);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(client, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      client.destroy();

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('Error executing Discord API:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }
  async sendMessage(client, params) {
    const channel = await client.channels.fetch(params.channelId);
    const message = await channel.send(params.message);

    return {
      success: true,
      result: {
        messageId: message.id,
        timestamp: message.createdTimestamp,
      },
    };
  }
  async assignRole(client, params) {
    const guild = await client.guilds.fetch(params.guildId);
    const role = await guild.roles.fetch(params.roleId);
    const memberIds = params.memberIds.split(',').map((id) => id.trim());

    const results = await Promise.all(
      memberIds.map(async (memberId) => {
        try {
          const member = await guild.members.fetch(memberId);
          await member.roles.add(role);
          return { memberId, success: true };
        } catch (error) {
          return { memberId, success: false, error: error.message };
        }
      })
    );

    return {
      success: true,
      result: {
        assignedRoles: results,
      },
    };
  }
  async getMembers(client, params) {
    const guild = await client.guilds.fetch(params.guildId);
    await guild.members.fetch(); // This fetches all members

    const members = guild.members.cache.map((member) => ({
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: member.joinedAt.toISOString(),
      roles: member.roles.cache.map((role) => ({
        id: role.id,
        name: role.name,
      })),
    }));

    return {
      success: true,
      result: {
        members: members,
      },
    };
  }
  async uploadFile(client, params) {
    const { channelId, fileName, fileData, message } = params;

    const channel = await client.channels.fetch(channelId);

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    const attachment = { attachment: buffer, name: fileName };

    const sentMessage = await channel.send({
      content: message || '',
      files: [attachment],
    });

    return {
      success: true,
      result: {
        messageId: sentMessage.id,
        timestamp: sentMessage.createdTimestamp,
      },
    };
  }
}

export default new DiscordAPI();
