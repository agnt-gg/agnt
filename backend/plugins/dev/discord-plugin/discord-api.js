import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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
      const accessToken = params.__auth?.token;
      if (!accessToken) {
        throw new Error('Not connected to Discord. Connect in Settings → Connections.');
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
    const { channelId, fileName, filePath, fileData, message, description, spoiler } = params;

    const channel = await client.channels.fetch(channelId);

    // Resolve the attachment source. Prefer filePath (no base64 bloat, streams from disk)
    // and fall back to fileData (base64) for backward compatibility.
    let source;
    let resolvedName = fileName;
    let sourceSize = null;

    if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        throw new Error(`filePath does not exist: ${absPath}`);
      }
      const stats = fs.statSync(absPath);
      if (!stats.isFile()) {
        throw new Error(`filePath is not a regular file: ${absPath}`);
      }
      sourceSize = stats.size;
      // Read the whole file into a Buffer. Buffers give discord.js a deterministic
      // Content-Length on the multipart part, which is what Discord's CDN uses to
      // tag the attachment with a proper content_type (needed for inline video/image previews).
      // Streams would skip that, and some attachments lose the content_type field
      // — which is the exact cause of "click to download" tiles for valid MP4s.
      source = fs.readFileSync(absPath);
      if (!resolvedName) {
        resolvedName = path.basename(absPath);
      }
    } else if (fileData && typeof fileData === 'string' && fileData.length > 0) {
      source = Buffer.from(fileData, 'base64');
      sourceSize = source.length;
      if (!resolvedName) {
        throw new Error('fileName is required when uploading via fileData (base64).');
      }
    } else {
      throw new Error('UPLOAD_FILE requires either filePath or fileData.');
    }

    // Use AttachmentBuilder so discord.js infers and sets the correct Content-Type
    // on the multipart part. Without this, raw { attachment, name } can land on
    // Discord's CDN without a content_type field, and the client falls back to a
    // download tile instead of the inline video/image player.
    const attachment = new AttachmentBuilder(source, { name: resolvedName });

    if (description && typeof description === 'string') {
      attachment.setDescription(description);
    }
    if (spoiler === true || spoiler === 'true') {
      attachment.setSpoiler(true);
    }

    const sentMessage = await channel.send({
      content: message || '',
      files: [attachment],
    });

    const sentAttachment = sentMessage.attachments?.first?.();

    return {
      success: true,
      result: {
        messageId: sentMessage.id,
        timestamp: sentMessage.createdTimestamp,
        fileName: resolvedName,
        fileSize: sourceSize,
        source: filePath ? 'filePath' : 'fileData',
        attachment: sentAttachment
          ? {
              id: sentAttachment.id,
              url: sentAttachment.url,
              proxyUrl: sentAttachment.proxyURL,
              contentType: sentAttachment.contentType || null,
              size: sentAttachment.size,
              width: sentAttachment.width || null,
              height: sentAttachment.height || null,
              name: sentAttachment.name,
            }
          : null,
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
