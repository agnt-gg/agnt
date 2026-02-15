import { Client, GatewayIntentBits, Partials } from 'discord.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

/**
 * Discord API Plugin Tool
 *
 * This is a plugin-based tool that loads discord.js from its own isolated node_modules.
 * The plugin system automatically runs `npm install` on server startup.
 */
class DiscordAPI {
  constructor() {
    this.name = 'discord-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[DiscordPlugin] Executing Discord API with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically using APP_PATH for correct resolution
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

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
        case 'BAN_MEMBER':
          result = await this.banMember(client, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      client.destroy();

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[DiscordPlugin] Error executing Discord API:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async sendMessage(client, params) {
    const channel = await client.channels.fetch(params.channelId);
    const message = await channel.send(params.message);
    const messageAuthor = message.author;

    return {
      success: true,
      result: {
        messageId: message.id,
        timestamp: message.createdTimestamp,
        username: messageAuthor?.username || null,
        avatarUrl: messageAuthor ? messageAuthor.displayAvatarURL({ extension: 'png', size: 256 }) : null,
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
      }),
    );

    return {
      success: true,
      result: {
        assignedRoles: results,
      },
    };
  }

  async getMembers(client, params) {
    const { guildId, includeAvatarMeta, includeGlobalProfile, trackRoles = [], hashFields = [] } = params;
    const normalizedTrackRoles = Array.isArray(trackRoles)
      ? trackRoles
      : typeof trackRoles === 'string' && trackRoles.length
        ? trackRoles
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
    const normalizedHashFields = Array.isArray(hashFields)
      ? hashFields
      : typeof hashFields === 'string' && hashFields.length
        ? hashFields
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean)
        : [];
    const trackSet = new Set(normalizedTrackRoles);

    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch();

    const members = guild.members.cache.map((member) => {
      const base = {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        roles: member.roles.cache.map((role) => ({
          id: role.id,
          name: role.name,
        })),
      };

      if (includeGlobalProfile) {
        base.discriminator = member.user.discriminator;
        base.globalName = member.user.globalName;
        base.bannerHash = member.user.banner;
      }

      if (includeAvatarMeta) {
        base.avatarHash = member.user.avatar;
        base.avatarUrl = member.displayAvatarURL({ extension: 'png', size: 256 });
      }

      if (normalizedTrackRoles.length) {
        base.isTracked = member.roles.cache.some((role) => trackSet.has(role.id));
      }

      if (normalizedHashFields.length) {
        const hashes = {};
        normalizedHashFields.forEach((field) => {
          if (base[field] !== undefined && base[field] !== null) {
            hashes[field] = crypto.createHash('sha256').update(String(base[field])).digest('hex');
          }
        });
        if (Object.keys(hashes).length) {
          base.hashes = hashes;
        }
      }

      return base;
    });

    return {
      success: true,
      result: {
        members: members,
        fetchedAt: new Date().toISOString(),
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

  async banMember(client, params) {
    const { guildId, targetUserId, banReason, deleteMessageDays } = params;
    const guild = await client.guilds.fetch(guildId);
    const numericDays =
      typeof deleteMessageDays === 'number' ? deleteMessageDays : deleteMessageDays !== undefined ? parseInt(deleteMessageDays, 10) : 0;
    const clampedDays = Number.isNaN(numericDays) ? 0 : Math.min(Math.max(numericDays, 0), 7);
    const deleteMessageSeconds = clampedDays * 24 * 60 * 60;
    const banOptions = {};
    if (banReason) {
      banOptions.reason = banReason;
    }
    if (deleteMessageSeconds > 0) {
      banOptions.deleteMessageSeconds = deleteMessageSeconds;
    }
    await guild.members.ban(targetUserId, banOptions);

    return {
      success: true,
      result: {
        guildId,
        userId: targetUserId,
        bannedAt: new Date().toISOString(),
        deleteMessageDays: clampedDays,
        deleteMessageSeconds: deleteMessageSeconds || 0,
        reason: banReason || null,
      },
    };
  }
}

export default new DiscordAPI();
